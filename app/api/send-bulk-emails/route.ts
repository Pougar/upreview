// app/api/send-bulk-emails/route.ts
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { Pool } from "pg";
import { auth } from "@/app/lib/auth";

// ---------- Resend ----------
const resend = new Resend(process.env.RESEND_API_KEY);

// ---------- Neon PG Pool (singleton) ----------
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

export const runtime = "nodejs";

// Small helpers to safely make HTML from plain text
function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
function nl2br(s: string) {
  return escapeHtml(s).replace(/\n/g, "<br>");
}

// Optional: if you want to use a dynamic host instead of localhost, set this env
const BASE_URL =
  process.env.APP_ORIGIN /* e.g., https://yourdomain.com */ || "http://localhost:3000";

type SenderRow = {
  name: string | null;          // slug
  display_name: string | null;  // human label
  email_subject: string | null;
  email_body: string | null;
  email: string | null;         // not used here, but fetched for parity
};

type ClientRow = {
  id: string;
  name: string | null;
  email: string | null;
};

export async function POST(req: Request) {
  try {
    // 0) Auth
    const session = await auth.api.getSession({ headers: req.headers as any });
    const senderId = session?.user?.id;
    if (!senderId) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    // 1) Parse input
    const body = await req.json().catch(() => ({}));
    const clientIds: string[] = Array.isArray(body?.clientIds) ? body.clientIds : [];
    if (clientIds.length === 0) {
      return NextResponse.json({ error: "clientIds[] is required" }, { status: 400 });
    }

    const pool = getPool();

    // 2) Fetch sender/template
    const userQ = await pool.query<SenderRow>(
      `
      SELECT
        name,
        display_name,
        COALESCE(email_subject, 'We loved helping you! Please leave a review.') AS email_subject,
        COALESCE(email_body,   'We hope you enjoyed our service! pease leave us a review.') AS email_body,
        email
      FROM myusers
      WHERE betterauth_id = $1
      LIMIT 1
      `,
      [senderId]
    );
    if (userQ.rows.length === 0) {
      return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    }
    const { name: slug, display_name, email_subject, email_body } = userQ.rows[0];
    const senderName = (display_name || slug || "Our Team").trim();

    // 3) Fetch clients belonging to the authenticated user; ignore unknown IDs to avoid leakage
    const clientsQ = await pool.query<ClientRow>(
      `
      SELECT c.id, c.name, c.email
      FROM public.clients c
      WHERE c.user_id = $1
        AND c.id = ANY($2)
      `,
      [String(senderId), clientIds]
    );
    const clients = clientsQ.rows;

    // Build an easy lookup of requested IDs → found client rows
    const foundIds = new Set(clients.map(c => c.id));
    const missingIds = clientIds.filter(id => !foundIds.has(id));

    // 4) Prepare per-client send function (same personalisation as single-send)
    const reCustomer = /\[customer\]/gi;

    async function sendOne(client: ClientRow) {
      if (!client.email) {
        throw new Error("Client has no email");
      }
      const clientName = (client.name || "Customer").trim();
      const subject = (email_subject ?? "").replace(reCustomer, clientName);
      const bodyCore = (email_body ?? "").replace(reCustomer, clientName);

      const text = `Hi ${clientName},\n\n${bodyCore}\n\nBest regards,\n${senderName}`;
      const html = `
        <p>Hi ${escapeHtml(clientName)},</p>
        <p>${nl2br(bodyCore)}</p>

        <div style="margin:24px 0;">
          <!-- Good Review button -->
          <a href="${BASE_URL}/submit-review/${client.id}?type=good&userID=${encodeURIComponent(
            String(senderId)
          )}"
             style="background:#16a34a;color:#ffffff;padding:12px 24px;text-decoration:none;
                    font-family:Arial, sans-serif;font-size:16px;font-weight:bold;border-radius:6px;
                    display:inline-block;margin-right:12px;">
            Happy
          </a>

          <!-- Bad Review button -->
          <a href="${BASE_URL}/submit-review/${client.id}?type=bad&userID=${encodeURIComponent(
            String(senderId)
          )}"
             style="background:#dc2626;color:#ffffff;padding:12px 24px;text-decoration:none;
                    font-family:Arial, sans-serif;font-size:16px;font-weight:bold;border-radius:6px;
                    display:inline-block;">
            Unsatisfied
          </a>
        </div>

        <p>Best regards,<br>${escapeHtml(senderName)}</p>
      `.trim();

      // Send via Resend
      await resend.emails.send({
        from: `${senderName} <onboarding@resend.dev>`, // replace after domain verify
        to: [client.email],
        subject: subject || "We’d love your feedback!",
        text,
        html,
      });

      // Update DB for this client
      const db = await getPool().connect();
      try {
        await db.query("BEGIN");
        await db.query(
          `UPDATE public.clients
             SET email_sent = TRUE,
                 email_last_sent_at = NOW()
           WHERE id = $1`,
          [client.id]
        );
        await db.query(
          `INSERT INTO public.client_actions (client_id, action)
           VALUES ($1, 'email_sent')`,
          [client.id]
        );
        await db.query("COMMIT");
      } catch (e) {
        try { await db.query("ROLLBACK"); } catch {}
        throw e;
      } finally {
        db.release();
      }
    }

    // 5) Send with modest concurrency (keeps provider & DB happy)
    const results: {
      sent: { clientId: string; email: string }[];
      failed: { clientId: string; error: string }[];
      missing: string[];
    } = { sent: [], failed: [], missing: missingIds };

    const CONCURRENCY = 5;
    let i = 0;

    async function worker() {
      while (i < clients.length) {
        const myIndex = i++;
        const c = clients[myIndex];
        try {
          await sendOne(c);
          results.sent.push({ clientId: c.id, email: c.email! });
        } catch (err: any) {
          results.failed.push({ clientId: c.id, error: err?.message || "Send failed" });
        }
      }
    }

    const workers = Array.from({ length: Math.min(CONCURRENCY, clients.length) }, worker);
    await Promise.all(workers);

    return NextResponse.json({
      success: true,
      ...results,
    });
  } catch (err: any) {
    console.error("send-bulk-emails error:", err);
    return NextResponse.json({ error: "Failed to send bulk emails" }, { status: 500 });
  }
}
