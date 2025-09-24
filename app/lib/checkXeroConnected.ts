// app/lib/CheckXeroConnected.ts
import { Pool } from "pg";
import type { QueryResult } from "pg";
import { redirect } from "next/navigation";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true }, // keep consistent with your other server util
});

/**
 * Returns true if the user (betterauth_id) has at least one connected Xero tenant.
 * @param userId BetterAuth user id (stored as betterauth_id in xero_details)
 */
export async function isXeroConnectedServer(userId: string): Promise<boolean> {
  if (!userId) return false;

  try {
    type Row = { connected: boolean };
    const result: QueryResult<Row> = await pool.query(
      `
      SELECT EXISTS (
        SELECT 1
        FROM public.xero_details
        WHERE betterauth_id = $1
          AND is_connected IS TRUE
      ) AS connected
      `,
      [userId]
    );

    return result.rows[0]?.connected === true;
  } catch (err) {
    console.error("Error in isXeroConnectedServer:", err);
    return false;
  }
}

/**
 * Ensures the user has a Xero connection; otherwise redirects to link-xero.
 * Use this in Server Components / server actions / loaders.
 * (Throws a redirect if not connected.)
 */
export async function ensureXeroConnectedOrRedirect(userId: string): Promise<void> {
  // If we don't even have a userId, send them to link flow directly
  if (!userId) {
    redirect(`/link-xero?userID=`);
  }

  const connected = await isXeroConnectedServer(userId);
  if (!connected) {
    redirect(`/link-xero?userID=${encodeURIComponent(userId)}`);
  }
  // If connected, just return (no-op)
}
