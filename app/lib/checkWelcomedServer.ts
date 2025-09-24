// app/lib/checkWelcomedServer.ts
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

/**
 * Returns true iff there is a user_actions row with action = 'welcomed' for userId.
 */
export async function checkWelcomedServer(userId: string): Promise<boolean> {
  if (!userId) {
    console.log("checkWelcomedServer: No userId provided");
    return false;
  }
  try {
    const { rows } = await pool.query<{ welcomed: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM user_actions
        WHERE user_id = $1
          AND action = 'welcomed'
      ) AS welcomed
      `,
      [userId]
    );

    return rows[0]?.welcomed === true;
  } catch (err) {
    console.error("Error in checkWelcomedServer:", err);
    return false;
  }
}
