// app/api/clients/sync-with-google-reviews/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

type ReqBody = { userId?: string };

function cleanText(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

export async function POST(req: NextRequest) {
  let client;
  try {
    const { userId } = (await req.json().catch(() => ({}))) as ReqBody;
    if (!userId) {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    client = await pool.connect();
    await client.query("BEGIN");

    // 1) Pull all unlinked Google reviews for this user + the matching client (exact name, case-insensitive)
    const { rows: matches } = await client.query<{
      g_id: string;
      g_name: string | null;
      g_text: string | null;
      g_stars: number | null;
      client_id: string;
      client_sentiment: "good" | "bad" | "unreviewed" | null;
      created_at: string | null;
    }>(
      `
      SELECT
        gr.id        AS g_id,
        gr.name      AS g_name,
        gr.review    AS g_text,
        gr.stars     AS g_stars,
        c.id         AS client_id,
        c.sentiment  AS client_sentiment,
        gr.created_at
      FROM public.google_reviews gr
      JOIN public.clients c
        ON c.user_id = gr.user_id
       AND LOWER(c.name) = LOWER(gr.name)
      WHERE gr.user_id = $1
        AND gr.linked  = FALSE
      ORDER BY gr.created_at DESC NULLS LAST, gr.id
      `,
      [userId]
    );

    let matched = matches.length;
    let inserted = 0;
    let updatedExisting = 0;
    let clientsSentimentUpdated = 0;
    let googleLinked = 0;

    // 2) For each matched Google review, upsert into reviews and mark linked
    for (const m of matches) {
      const gId = m.g_id;
      const gText = cleanText(m.g_text);
      const gStars = m.g_stars;
      const clientId = m.client_id;

      // Find the most recent review row for this client (if any)
      const { rows: revRows } = await client.query<{
        id: string;
        review: string | null;
        google_review: string | null;
        is_primary: "google" | "internal";
      }>(
        `
        SELECT
          r.id,
          NULLIF(BTRIM(r.review), '')         AS review,
          NULLIF(BTRIM(r.google_review), '')  AS google_review,
          r."isPrimary"                       AS is_primary
        FROM public.reviews r
        WHERE r.client_id = $1 AND r.user_id = $2
        ORDER BY COALESCE(r.updated_at, r.created_at) DESC NULLS LAST, r.id DESC
        LIMIT 1
        `,
        [clientId, userId]
      );

      if (revRows.length > 0) {
        // There is an existing review row
        const existing = revRows[0];
        const hasInternal = !!existing.review;

        // Update that row: attach google text/id/stars, and if internal exists, force isPrimary='internal'
        const res = await client.query(
          `
          UPDATE public.reviews r
          SET
            google_review = COALESCE(NULLIF(BTRIM($1), ''), r.google_review),
            g_review_id   = $2,
            stars         = COALESCE($3, r.stars),
            "isPrimary"   = CASE WHEN $4 THEN 'internal'::review_primary_source ELSE r."isPrimary" END
          WHERE r.id = $5
          RETURNING 1
          `,
          [gText, gId, gStars, hasInternal, existing.id]
        );
        if (res.rowCount) updatedExisting++;

        // If client sentiment was unreviewed and stars exist, update it
        if (m.client_sentiment === "unreviewed" && gStars != null) {
          const sres = await client.query(
            `
            UPDATE public.clients
            SET sentiment = CASE WHEN $1 > 2.5 THEN 'good' ELSE 'bad' END,
                updated_at = NOW()
            WHERE id = $2
            RETURNING 1
            `,
            [gStars, clientId]
          );
          if (sres.rowCount) clientsSentimentUpdated++;
        }
      } else {
        // No existing review row: create one with the Google review as the primary text
        const ins = await client.query(
          `
          INSERT INTO public.reviews
            (client_id, user_id, google_review, g_review_id, stars, "isPrimary")
          VALUES
            ($1,        $2,      NULLIF(BTRIM($3), ''), $4, $5, 'google'::review_primary_source)
          RETURNING id
          `,
          [clientId, userId, gText, gId, gStars]
        );
        if (ins.rowCount) inserted++;

        if (m.client_sentiment === "unreviewed" && gStars != null) {
          const sres = await client.query(
            `
            UPDATE public.clients
            SET sentiment = CASE WHEN $1 > 2.5 THEN 'good' ELSE 'bad' END,
                updated_at = NOW()
            WHERE id = $2
            RETURNING 1
            `,
            [gStars, clientId]
          );
          if (sres.rowCount) clientsSentimentUpdated++;
        }
      }

      // Mark this google review as linked
      const lres = await client.query(
        `
        UPDATE public.google_reviews
        SET linked = TRUE, updated_at = NOW()
        WHERE id = $1 AND linked = FALSE
        RETURNING 1
        `,
        [gId]
      );
      if (lres.rowCount) googleLinked++;
    }

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      userId,
      matched,
      updatedExisting,
      inserted,
      clientsSentimentUpdated,
      googleLinked,
    });
  } catch (err: any) {
    if (client) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    console.error("[sync-with-google-reviews] error:", err?.stack || err);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500 });
  } finally {
    if (client) client.release();
  }
}
