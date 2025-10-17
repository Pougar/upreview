// app/api/add-client/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth"; // BetterAuth server instance

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

type Sentiment = "good" | "bad" | "unreviewed";

function isValidEmail(str?: string | null) {
  if (!str) return true; // optional
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

export async function POST(req: NextRequest) {
  let client;
  try {
    // 1) Auth
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    // 2) Body + validation
    const body = await req.json().catch(() => ({}));
    const { name, email, phone_number, sentiment, review } = (body ?? {}) as {
      name?: string;
      email?: string | null;
      phone_number?: string | null;
      sentiment?: Sentiment;
      review?: string | null;
    };

    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: "MISSING_NAME" }, { status: 400 });
    }

    const cleanedEmail = (email ?? "").trim() || null;
    if (!isValidEmail(cleanedEmail)) {
      return NextResponse.json({ error: "INVALID_EMAIL" }, { status: 400 });
    }
    const cleanedPhone = (phone_number ?? "").trim() || null;
    const cleanedReview = (review ?? "").trim();
    const hasReview = cleanedReview.length > 0;

    const validSentiments: Sentiment[] = ["good", "bad", "unreviewed"];
    const cleanedSentiment: Sentiment = validSentiments.includes(
      (sentiment as Sentiment)
    )
      ? (sentiment as Sentiment)
      : "unreviewed";

    // happy for reviews table (boolean | null)
    const happy =
      cleanedSentiment === "good" ? true : cleanedSentiment === "bad" ? false : null;

    // 3) Transaction
    client = await pool.connect();
    await client.query("BEGIN");

    // 3a) Insert client (NO review column now)
    const clientId = crypto.randomUUID();
    const insertClient = await client.query(
      `
      INSERT INTO public.clients (id, user_id, name, email, phone_number, sentiment)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, user_id, name, email, phone_number, sentiment, created_at, updated_at
      `,
      [clientId, userId, String(name).trim(), cleanedEmail, cleanedPhone, cleanedSentiment]
    );
    const clientRow = insertClient.rows[0];

    // 3b) Optionally insert initial review into public.reviews (only if non-empty)
    let newReview: {
      id: string;
      is_primary: "google" | "internal";
      happy: boolean | null;
      stars: number | null;
      review: string | null;
      google_review: string | null;
      created_at: string;
      updated_at: string;
    } | null = null;

    if (hasReview) {
      const insReview = await client.query(
        `
        INSERT INTO public.reviews
          (client_id, user_id, review, "isPrimary", happy)
        VALUES
          ($1,        $2,     $3,     'internal'::review_primary_source, $4)
        RETURNING
          id,
          "isPrimary" AS is_primary,
          happy,
          stars,
          review,
          google_review,
          created_at,
          updated_at
        `,
        [clientId, userId, cleanedReview, happy]
      );
      newReview = insReview.rows[0];
    }

    // 3c) Log action
    const actionId = crypto.randomUUID();
    await client.query(
      `
      INSERT INTO public.client_actions (id, client_id, action)
      VALUES ($1::uuid, $2, 'client_added')
      `,
      [actionId, clientId]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      client: clientRow,
      review: newReview, // null when no non-empty review provided
    });
  } catch (err) {
    if (client) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    console.error("add-client error:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  } finally {
    if (client) client.release();
  }
}
