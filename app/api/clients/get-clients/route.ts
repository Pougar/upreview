// app/api/get-clients/route.ts
import { NextResponse } from "next/server";
import { headers as nextHeaders } from "next/headers";
import { auth } from "@/app/lib/auth";
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
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return global._pgPool;
}

/** Convert Next 15 ReadonlyHeaders -> standard Fetch Headers for Better Auth */
async function getNodeHeaders(): Promise<Headers> {
  const h = await Promise.resolve(nextHeaders() as any);
  return new Headers(Object.fromEntries(h.entries()));
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

/**
 * GET /api/clients
 * Returns clients for the authenticated user.
 * - Derives timeline from public.client_actions:
 *   - latest email_sent, latest link_clicked
 * - For reviewed clients (sentiment <> 'unreviewed'), uses reviews.updated_at for when review happened
 * - Adds `stage` + `stage_at` for the frontend to render a single status
 * - Keeps the existing latest non-empty review text selection
 */
export async function GET() {
  try {
    // 1) Auth
    const requestHeaders = await getNodeHeaders();
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = String(session.user.id);

    // 2) Query
    const pool = getPool();
    const { rows } = await pool.query(
      `
      WITH base AS (
        SELECT
          c.id,
          c.user_id,
          c.name,
          c.email,
          c.phone_number,
          c.sentiment,
          c.email_sent,          -- legacy booleans preserved
          c.review_clicked,      -- legacy booleans preserved
          c.review_submitted,    -- legacy booleans preserved
          c.invoice_status::text AS invoice_status,
          c.created_at AS added_at
        FROM public.clients c
        WHERE c.user_id = $1
      ),
      actions AS (
        SELECT
          ca.client_id,
          MAX(CASE WHEN ca.action = 'email_sent'::client_action_type THEN ca.created_at END) AS email_last_sent_at,
          MAX(CASE WHEN ca.action = 'link_clicked'::client_action_type THEN ca.created_at END)  AS click_at,
          MAX(CASE WHEN ca.action = 'review_submitted'::client_action_type THEN ca.created_at END) AS action_review_submitted_at,
          MAX(CASE WHEN ca.action = 'client_added'::client_action_type THEN ca.created_at END) AS client_added_at
        FROM public.client_actions ca
        GROUP BY ca.client_id
      ),
      latest_review AS (
        /* Latest non-empty review text + its time, scoping to same user */
        SELECT
          rv.client_id,
          /* choose text based on isPrimary (google vs internal) */
          CASE
            WHEN rv."isPrimary" = 'google'::review_primary_source
              THEN NULLIF(BTRIM(rv.google_review), '')
            ELSE NULLIF(BTRIM(rv.review), '')
          END AS review_text,
          COALESCE(rv.updated_at, rv.created_at) AS review_time
        FROM public.reviews rv
        WHERE (
          CASE
            WHEN rv."isPrimary" = 'google'::review_primary_source
              THEN NULLIF(BTRIM(rv.google_review), '')
            ELSE NULLIF(BTRIM(rv.review), '')
          END
        ) IS NOT NULL
        /* We'll pick the latest per client in a lateral join below */
      )
      SELECT
        b.id,
        b.name,
        b.email,
        b.phone_number,
        b.sentiment,

        /* Only return review text when sentiment is not 'unreviewed' */
        CASE
          WHEN b.sentiment <> 'unreviewed' THEN r.review_text
          ELSE NULL
        END AS review,

        /* legacy flags (unchanged) */
        b.email_sent,
        b.review_clicked,
        b.review_submitted,

        b.invoice_status,
        b.added_at,

        /* Derived from client_actions */
        a.email_last_sent_at,
        a.click_at,

        /* If reviewed, use reviews.updated_at (or created_at) as the submitted time */
        CASE
          WHEN b.sentiment <> 'unreviewed' THEN r.review_time
          ELSE NULL
        END AS review_submitted_at,

        /* Single canonical stage + when it occurred */
        CASE
          WHEN b.sentiment <> 'unreviewed' THEN 'review_submitted'
          WHEN a.click_at IS NOT NULL THEN 'button_clicked'
          WHEN a.email_last_sent_at IS NOT NULL THEN 'email_sent'
          ELSE 'no_email_sent'
        END AS stage,
        CASE
          WHEN b.sentiment <> 'unreviewed' THEN r.review_time
          WHEN a.click_at IS NOT NULL THEN a.click_at
          WHEN a.email_last_sent_at IS NOT NULL THEN a.email_last_sent_at
          ELSE NULL
        END AS stage_at

      FROM base b

      /* Aggregate latest actions for each client */
      LEFT JOIN actions a
        ON a.client_id = b.id

      /* Choose latest non-empty review for this client+user */
      LEFT JOIN LATERAL (
        SELECT lr.review_text, lr.review_time
        FROM latest_review lr
        WHERE lr.client_id = b.id
        ORDER BY lr.review_time DESC NULLS LAST
        LIMIT 1
      ) r ON b.sentiment <> 'unreviewed'

      /* keep server-side default; UI re-sorts for its custom order */
      ORDER BY b.added_at DESC, b.id DESC
      `,
      [userId],
    );

    return NextResponse.json({ clients: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /api/clients] Error:", err?.message || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
