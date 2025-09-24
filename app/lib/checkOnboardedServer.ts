import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

export async function checkOnboardedServer(userId: string): Promise<boolean> {
  if (!userId) return false;

  try {
    const { rows } = await pool.query<{ onboarded: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM user_actions
        WHERE user_id = $1
          AND action = 'finished_onboarding'
      ) AS onboarded
      `,
      [userId]
    );
    return rows[0]?.onboarded === true;
  } catch (err) {
    console.error("Error in checkOnboardedServer:", err);
    return false;
  }
}
