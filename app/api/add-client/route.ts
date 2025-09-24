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
  try {
    // 1) Auth: read the BetterAuth session from cookies/headers
    const session = await auth.api.getSession({ headers: req.headers });
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }

    // 2) Body + basic validation
    const body = await req.json().catch(() => ({}));
    const {
      name,
      email,
      phone_number,
      sentiment,
      review,
    } = (body ?? {}) as {
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
    const cleanedReview = (review ?? "").trim() || null;

    const validSentiments: Sentiment[] = ["good", "bad", "unreviewed"];
    const cleanedSentiment: Sentiment =
      validSentiments.includes(sentiment as Sentiment)
        ? (sentiment as Sentiment)
        : "unreviewed";

    // 3) Insert into clients (id is TEXT; using UUID string is fine)
    const clientId = crypto.randomUUID();

    const insertClient = await pool.query(
      `
      INSERT INTO clients (id, user_id, name, email, phone_number, sentiment, review)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, user_id, name, email, phone_number, sentiment, review, created_at
      `,
      [
        clientId,
        userId,
        String(name).trim(),
        cleanedEmail,
        cleanedPhone,
        cleanedSentiment,
        cleanedReview,
      ]
    );

    const client = insertClient.rows[0];

    // 4) Log into client_actions (id is UUID; pass explicit value)
    const actionId = crypto.randomUUID();
    await pool.query(
      `
      INSERT INTO client_actions (id, client_id, action)
      VALUES ($1::uuid, $2, 'client_added')
      `,
      [actionId, clientId]
    );

    return NextResponse.json({ success: true, client });
  } catch (err) {
    console.error("add-client error:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
