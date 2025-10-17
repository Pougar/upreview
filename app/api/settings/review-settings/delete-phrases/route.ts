// app/api/settings/review-settings/delete-phrases/route.ts
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

type ReqBody = { userId?: string; phraseId?: string };

export async function POST(req: NextRequest) {
  try {
    const { userId, phraseId } = (await req.json().catch(() => ({}))) as ReqBody;

    if (!userId) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }
    const pid = String(phraseId ?? "").trim();
    if (!pid) {
      return NextResponse.json({ error: "MISSING_PHRASE_ID" }, { status: 400 });
    }

    const pool = getPool();
    const db = await pool.connect();

    try {
      await db.query("BEGIN");

      // Verify the phrase belongs to this user
      const found = await db.query<{ id: string }>(
        `SELECT id FROM public.phrases WHERE user_id = $1 AND id = $2`,
        [userId, pid]
      );
      if (found.rowCount === 0) {
        await db.query("ROLLBACK");
        return NextResponse.json({ error: "PHRASE_NOT_FOUND" }, { status: 404 });
      }

      // Count excerpts that will be removed (for response info)
      const exCntQ = await db.query<{ count: string }>(
        `SELECT COUNT(*)::int AS count FROM public.excerpts WHERE phrase_id = $1`,
        [pid]
      );
      const excerptsToDelete = Number(exCntQ.rows[0]?.count ?? 0);

      const tryDeletePhrase = async () =>
        db.query<{ id: string }>(
          `DELETE FROM public.phrases WHERE user_id = $1 AND id = $2 RETURNING id`,
          [userId, pid]
        );

      let delRes;
      try {
        // Attempt direct delete (works if ON DELETE CASCADE is present)
        delRes = await tryDeletePhrase();
      } catch (e: any) {
        // FK restriction -> manually delete dependent excerpts then retry
        if (e?.code === "23503") {
          await db.query(`DELETE FROM public.excerpts WHERE phrase_id = $1`, [pid]);
          delRes = await tryDeletePhrase();
        } else {
          throw e;
        }
      }

      await db.query("COMMIT");

      return NextResponse.json(
        {
          success: true,
          userId,
          phraseId: pid,
          deleted_phrases: delRes.rowCount,
          deleted_excerpts: excerptsToDelete,
        },
        { status: 200 }
      );
    } catch (err) {
      try {
        await db.query("ROLLBACK");
      } catch {}
      console.error("[delete-phrases] DB error:", err);
      return NextResponse.json({ error: "DB_WRITE_ERROR" }, { status: 500 });
    } finally {
      db.release();
    }
  } catch (err: any) {
    console.error("[/api/settings/review-settings/delete-phrases] error:", err?.stack || err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  }
}
