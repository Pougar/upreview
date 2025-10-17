// app/api/next-user-step/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";

/* ========= Easily change the required flow & target URLs here ========= */
// Ordered list of actions that define the onboarding flow
export const ACTION_FLOW = [
  "signed_in",
  "google_connected",
  "finished_onboarding",
  "xero_connected",
  "welcomed",
] as const;

type Action = (typeof ACTION_FLOW)[number];

// Where to send the user when the corresponding action is the *next* missing step.
// (Adjust these paths to your app’s routes.)
export const ACTION_TO_URL: Record<Action, string> = {
  signed_in: "/login",
  google_connected: "/onboarding-flow/link-google",
  finished_onboarding: "/onboarding-flow/onboarding",
  xero_connected: "/onboarding-flow/link-xero",
  welcomed: "/onboarding-flow/welcome",
};
/* ===================================================================== */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

type Row = { action: string };

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { userId } = body as { userId?: string };

    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "MISSING_USER_ID" }, { status: 400 });
    }

    // Fetch all actions this user has performed
    const { rows } = await pool.query<Row>(
      `
      SELECT DISTINCT action
      FROM user_actions
      WHERE user_id = $1
      `,
      [userId]
    );

    // Normalise to a Set of known actions (ignore unknowns)
    const completed = new Set<Action>(
      rows
        .map((r) => r.action)
        .filter((a): a is Action => (ACTION_FLOW as readonly string[]).includes(a))
    );

    // Determine the first missing action in the flow
    const nextMissing = ACTION_FLOW.find((a) => !completed.has(a));

    // If nothing is missing, the user is complete — no redirect needed
    if (!nextMissing) {
      return NextResponse.json({
        success: true,
        redirect: null,
        status: "complete",
        completed: ACTION_FLOW.filter((a) => completed.has(a)),
        missing: [],
      });
    }

    // Otherwise, compute the redirect URL for the earliest missing action
    const redirect = ACTION_TO_URL[nextMissing] ?? null;

    return NextResponse.json({
      success: true,
      redirect,
      next_action: nextMissing,
      status: "incomplete",
      completed_in_order: ACTION_FLOW.filter((a) => completed.has(a)),
      missing_in_order: ACTION_FLOW.filter((a) => !completed.has(a)),
    });
  } catch (err) {
    console.error("next-user-step error:", err);
    return NextResponse.json({ error: "INTERNAL" }, { status: 500 });
  }
}
