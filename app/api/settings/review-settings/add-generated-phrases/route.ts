import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

/** ---------- PG Pool (singleton across hot reloads) ---------- */
declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}
function getPool(): Pool {
  if (!global._pgPool) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error("DATABASE_URL is not set");
    global._pgPool = new Pool({
      connectionString: cs,
      // Neon typically needs SSL unless the URL has sslmode=require
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPool;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Sentiment = "good" | "bad";
type ReqItem = { phrase: string; counts?: number; sentiment?: Sentiment };
type ReqBody = {
  userId?: string;
  phrases?: ReqItem[]; // desired phrases with optional counts & sentiment
};

function normalizePhrase(raw: string): string {
  // trim, collapse all whitespace to single space, cap to 120 chars
  return raw.trim().replace(/\s+/g, " ").slice(0, 120);
}

export async function POST(req: NextRequest) {
  try {
    const { userId, phrases } = (await req.json().catch(() => ({}))) as ReqBody;

    if (!userId) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }
    if (!Array.isArray(phrases) || phrases.length === 0) {
      return NextResponse.json({ error: "NO_PHRASES_GIVEN" }, { status: 400 });
    }

    // --- 1) Clean & dedupe incoming items (case-insensitive) ---
    // - normalize text
    // - ensure counts is a non-negative int (cap to a reasonable max)
    // - sentiment is optional; if provided must be 'good' or 'bad'
    const MAX_CNT = 1_000_000;
    const map = new Map<
      string,
      { phrase: string; counts: number; sentiment?: Sentiment }
    >(); // key = lower(normalized)

    let skippedInvalid = 0;
    for (const it of phrases) {
      const normalized = normalizePhrase(String(it?.phrase ?? ""));
      if (!normalized) {
        skippedInvalid++;
        continue;
      }

      // counts
      const cntRaw: any = (it as any)?.counts;
      let counts = Number.isFinite(cntRaw) ? Number(cntRaw) : parseInt(String(cntRaw ?? "0"), 10);
      if (!Number.isFinite(counts) || counts < 0) counts = 0;
      if (counts > MAX_CNT) counts = MAX_CNT;

      // sentiment (normalize, allow undefined)
      const sRaw = String((it as any)?.sentiment ?? "").toLowerCase();
      const sentiment: Sentiment | undefined =
        sRaw === "good" ? "good" : sRaw === "bad" ? "bad" : undefined;

      const key = normalized.toLowerCase();

      // If duplicates are provided:
      // - keep the largest counts (makes sense for mentions)
      // - keep the first non-undefined sentiment we saw (don’t flip unexpectedly)
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { phrase: normalized, counts, sentiment });
      } else {
        const newCounts = Math.max(prev.counts, counts);
        const newSentiment = prev.sentiment ?? sentiment; // prefer existing if already set
        map.set(key, { phrase: normalized, counts: newCounts, sentiment: newSentiment });
      }
    }

    if (map.size === 0) {
      return NextResponse.json(
        { error: "NO_VALID_PHRASES", skippedInvalid },
        { status: 400 }
      );
    }

    const cleanedItems = Array.from(map.values());
    const lcList = cleanedItems.map((x) => x.phrase.toLowerCase());

    const pool = getPool();
    const db = await pool.connect();

    try {
      await db.query("BEGIN");

      // --- 2) Find which already exist for this user (case-insensitive) ---
      const existingQ = await db.query<{ id: string; phrase: string }>(
        `
        SELECT id, phrase
        FROM public.phrases
        WHERE user_id = $1
          AND LOWER(phrase) = ANY($2::text[])
        `,
        [userId, lcList]
      );

      const existingByLC = new Map<string, { id: string; phrase: string }>();
      for (const row of existingQ.rows) {
        existingByLC.set(row.phrase.toLowerCase(), { id: row.id, phrase: row.phrase });
      }

      // Partition into toUpdate / toInsert
      const toUpdate: { phraseLC: string; counts: number; sentiment?: Sentiment }[] = [];
      const toInsert: { phrase: string; counts: number; sentiment?: Sentiment }[] = [];
      for (const it of cleanedItems) {
        const key = it.phrase.toLowerCase();
        if (existingByLC.has(key)) {
          toUpdate.push({ phraseLC: key, counts: it.counts, sentiment: it.sentiment });
        } else {
          toInsert.push({ phrase: it.phrase, counts: it.counts, sentiment: it.sentiment });
        }
      }

      // --- 3) Apply updates (batch) ---
      // Update counts, and update sentiment *only if provided* (otherwise keep existing).
      let updatedRows: { id: string; phrase: string; counts: number; sentiment: string | null }[] = [];
      if (toUpdate.length > 0) {
        const phraseLCs = toUpdate.map((u) => u.phraseLC);
        const cnts = toUpdate.map((u) => u.counts);
        const sents = toUpdate.map((u) => (u.sentiment ?? null)); // allow nulls to "keep existing"

        const upQ = await db.query<{
          id: string;
          phrase: string;
          counts: number;
          sentiment: string | null;
        }>(
          `
          UPDATE public.phrases p
          SET
            counts = u.cnt,
            sentiment = COALESCE(u.sentiment, p.sentiment),
            updated_at = NOW()
          FROM (
            SELECT
              UNNEST($1::text[])  AS lc,
              UNNEST($2::int[])   AS cnt,
              UNNEST($3::text[])  AS sentiment
          ) AS u
          WHERE p.user_id = $4
            AND LOWER(p.phrase) = u.lc
          RETURNING p.id, p.phrase, p.counts, p.sentiment
          `,
          [phraseLCs, cnts, sents, userId]
        );
        updatedRows = upQ.rows;
      }

      // --- 4) Insert new phrases (loop is fine for small-ish batches) ---
      // If sentiment is undefined on insert, default to 'good' (keeps column non-null and useful).
      let insertedRows: { id: string; phrase: string; counts: number; sentiment: string | null }[] = [];
      for (const it of toInsert) {
        const ins = await db.query<{
          id: string;
          phrase: string;
          counts: number;
          sentiment: string | null;
        }>(
          `
          INSERT INTO public.phrases
            (phrase, user_id, counts, good_count, bad_count, sentiment, created_at, updated_at)
          VALUES
            ($1, $2, $3, 0, 0, COALESCE($4, 'good'), NOW(), NOW())
          RETURNING id, phrase, counts, sentiment
          `,
          [it.phrase, userId, it.counts, it.sentiment ?? null]
        );
        insertedRows.push(ins.rows[0]);
      }

      await db.query("COMMIT");

      return NextResponse.json(
        {
          success: true,
          userId,
          inserted: insertedRows,
          updated: updatedRows,
          skipped_invalid: skippedInvalid,
          requested: cleanedItems.length,
        },
        { status: 200 }
      );
    } catch (e) {
      try {
        await db.query("ROLLBACK");
      } catch {}
      console.error("[add-phrases] DB error:", e);
      return NextResponse.json({ error: "DB_WRITE_ERROR" }, { status: 500 });
    } finally {
      db.release();
    }
  } catch (err: any) {
    console.error("[/api/settings/review-settings/add-phrases] error:", err?.stack || err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
