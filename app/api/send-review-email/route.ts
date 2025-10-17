// app/api/send-email/route.ts
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

// Small helper to safely make HTML from plain text
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

export async function POST(req: Request) {
  try {
    // 0) Auth: get the sender (myusers row is keyed by betterauth_id)
    const session = await auth.api.getSession({ headers: req.headers as any });
    const senderId = session?.user?.id;
    if (!senderId) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const { clientId } = await req.json();
    if (!clientId) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    const pool = getPool();

    // 1) Get the sender's template + names (+ email for tester sends)
    const userQ = await pool.query<{
      name: string | null;           // slug
      display_name: string | null;   // human label
      email_subject: string | null;
      email_body: string | null;
      email: string | null;          // <-- needed for tester email
    }>(
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
    const { name: slug, display_name, email_subject, email_body, email: senderEmail } = userQ.rows[0];

    // These will be filled differently for normal vs tester mode
    let recipientEmail: string | null = null;
    let clientName: string = "Customer";

    // 2) Determine recipient & personalization
    if (clientId === "test") {
      // Tester mode: send to the owner's email address
      if (!senderEmail) {
        return NextResponse.json({ error: "SENDER_HAS_NO_EMAIL" }, { status: 400 });
      }
      recipientEmail = senderEmail;
      // Personalize to something sensible for a test
      clientName = display_name?.trim() || "Test Recipient";
    } else {
      // Normal flow: find the client
      const clientQ = await pool.query<{
        name: string | null;
        email: string | null;
        email_sent: boolean | null;
      }>(
        `SELECT name, email, email_sent
         FROM public.clients
         WHERE id = $1`,
        [clientId]
      );
      if (clientQ.rows.length === 0) {
        return NextResponse.json({ error: "Client not found" }, { status: 404 });
      }
      const client = clientQ.rows[0];
      if (!client.email) {
        return NextResponse.json({ error: "Client has no email" }, { status: 400 });
      }
      recipientEmail = client.email;
      clientName = (client.name || "Customer").trim();
    }

    // 3) Personalize: replace [Customer] in both subject & body (case-insensitive)
    const reCustomer = /\[customer\]/gi;
    const subject = (email_subject ?? "").replace(reCustomer, clientName);
    const bodyCore = (email_body ?? "").replace(reCustomer, clientName);

    // 4) Compose final text with greeting + sign-off
    const senderName = (display_name || slug || "Our Team").trim();
    const text = `Hi ${clientName},\n\n${bodyCore}\n\nBest regards,\n${senderName}`;
    const html = `
      <p>Hi ${escapeHtml(clientName)},</p>
      <p>${nl2br(bodyCore)}</p>

      <div style="margin:24px 0;">
        <!-- Good Review button -->
        <a href="http://localhost:3000/submit-review/${clientId}?type=good&userID=${encodeURIComponent(senderId)}"
           style="background:#16a34a;color:#ffffff;padding:12px 24px;text-decoration:none;
                  font-family:Arial, sans-serif;font-size:16px;font-weight:bold;border-radius:6px;
                  display:inline-block;margin-right:12px;">
          Happy
        </a>

        <!-- Bad Review button -->
        <a href="http://localhost:3000/submit-review/${clientId}?type=bad&userID=${encodeURIComponent(senderId)}"
           style="background:#dc2626;color:#ffffff;padding:12px 24px;text-decoration:none;
                  font-family:Arial, sans-serif;font-size:16px;font-weight:bold;border-radius:6px;
                  display:inline-block;">
          Unsatisfied
        </a>
      </div>

      <p>Best regards,<br>${escapeHtml(senderName)}</p>
    `.trim();

    // 5) Send email via Resend
    const sendRes = await resend.emails.send({
      from: `${senderName} <onboarding@resend.dev>`, // replace when your domain is verified
      to: [recipientEmail!],
      subject: subject || "We’d love your feedback!",
      text,
      html,
    });

    // 6) Only in NORMAL mode: mark email_sent & log action
    if (clientId !== "test") {
      const db = await pool.connect();
      try {
        await db.query("BEGIN");

        const upd = await db.query(
          `UPDATE public.clients
             SET email_sent = TRUE
           WHERE id = $1
             AND email_sent IS DISTINCT FROM TRUE`,
          [clientId]
        );

        if ((upd.rowCount ?? 0) > 0) {
          await db.query(
            `INSERT INTO public.client_actions (client_id, action)
             VALUES ($1, 'email_sent')`,
            [clientId]
          );
        }

        await db.query("COMMIT");
      } catch (e) {
        try { await db.query("ROLLBACK"); } catch {}
        throw e;
      } finally {
        db.release();
      }
    }

    return NextResponse.json({ ok: true, data: sendRes });
  } catch (err: any) {
    console.error("send-email error:", err);
    return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
  }
}
