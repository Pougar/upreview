// app/api/xero/get-clients-from-xero/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import type { QueryResult } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_INVOICES_URL = "https://api.xero.com/api.xro/2.0/Invoices";
const XERO_CONTACTS_URL = "https://api.xero.com/api.xro/2.0/Contacts";
const INVOICE_SINCE_WHERE = "Date >= DateTime(2025, 1, 1)"; // legacy default (kept for compatibility)

// --- DB pool (reuse in dev) ---
const pool =
  (globalThis as any).__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined,
  });
(globalThis as any).__pgPool = pool;

type XeroTokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  scope: string;
  expires_in: number; // seconds
  id_token?: string;
};

type XeroContactPhone = {
  PhoneType?: string; // "DEFAULT" | "MOBILE" | "DDI" | "FAX"
  PhoneNumber?: string | null;
  PhoneAreaCode?: string | null;
  PhoneCountryCode?: string | null;
};

type XeroContact = {
  ContactID?: string;
  Name?: string;
  EmailAddress?: string | null;
  Phones?: XeroContactPhone[] | null;
};

type XeroInvoice = {
  InvoiceID?: string;
  Contact?: { ContactID?: string; Name?: string } | null;
  Date?: string;
};

type XeroInvoicesResponse = { Invoices?: XeroInvoice[] };
type XeroContactsResponse = { Contacts?: XeroContact[] };

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
function nowPlus(ms: number) { return new Date(Date.now() + ms); }
function isExpired(expiresAt?: Date | string | null, skewSec = 60): boolean {
  if (!expiresAt) return true;
  const t = typeof expiresAt === "string" ? Date.parse(expiresAt) : expiresAt.getTime();
  return Date.now() + skewSec * 1000 >= t;
}
function pickPhone(phones?: XeroContactPhone[] | null): string | null {
  if (!phones || phones.length === 0) return null;
  const pref = ["DEFAULT", "MOBILE", "DDI", "FAX"];
  const sorted = [...phones].sort(
    (a, b) => pref.indexOf(a.PhoneType || "") - pref.indexOf(b.PhoneType || "")
  );
  for (const p of sorted) {
    const num = (p.PhoneNumber || "").trim();
    if (num) {
      const cc = (p.PhoneCountryCode || "").trim();
      const area = (p.PhoneAreaCode || "").trim();
      return [cc ? `+${cc}` : "", area, num].filter(Boolean).join(" ").trim();
    }
  }
  return null;
}

/** Upsert by Xero ContactID (unique on (user_id, xero_contact_id)) */
async function upsertClientByContactId(
  userId: string,
  xeroContactId: string,
  nameIn: string,
  emailIn: string | null,
  phoneIn: string | null
): Promise<"inserted" | "updated"> {
  const name = (nameIn || "").trim() || "(Unknown Contact)";
  const email = (emailIn || "")?.trim() || null;
  const phone = (phoneIn || "")?.trim() || null;
  const clientId = crypto.randomUUID();

  const q = `
    INSERT INTO public.clients
      (id, user_id, xero_contact_id, name, email, phone_number, sentiment, email_sent, review_clicked, review_submitted)
    VALUES
      ($1, $2, $3::uuid, $4, $5, $6, 'unreviewed', FALSE, FALSE, FALSE)
    ON CONFLICT ON CONSTRAINT uq_clients_user_xero_contact
    DO UPDATE SET
      name         = COALESCE(NULLIF(EXCLUDED.name, ''), public.clients.name),
      email        = COALESCE(EXCLUDED.email, public.clients.email),
      phone_number = COALESCE(NULLIF(EXCLUDED.phone_number, ''), public.clients.phone_number)
    RETURNING (xmax = 0) AS inserted
  `;

  const result: QueryResult<{ inserted: boolean }> = await pool.query(q, [
    clientId,
    userId,
    xeroContactId,
    name,
    email,
    phone,
  ]);
  return result.rows[0]?.inserted ? "inserted" : "updated";
}

async function refreshAccessToken(refresh_token: string): Promise<XeroTokenResponse> {
  const clientId = requireEnv("XERO_CLIENT_ID");
  const clientSecret = requireEnv("XERO_CLIENT_SECRET");

  const resp = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Xero token refresh failed (${resp.status}): ${body}`);
  }
  return (await resp.json()) as XeroTokenResponse;
}

/** Build Xero 'where' clause Date >= DateTime(Y, M, D) from an ISO date (YYYY-MM-DD). */
function buildSinceWhere(isoDate: string): { where: string; sinceISO: string } {
  // fallback to legacy
  if (!isoDate) return { where: INVOICE_SINCE_WHERE, sinceISO: "2025-01-01" };
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid since date. Use ISO format like 2025-01-01.");
  }
  // Use UTC parts to avoid TZ skew
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const sinceISO = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { where: `Date >= DateTime(${y}, ${m}, ${day})`, sinceISO };
}

/** Fetch invoices (paged) and collect unique ContactIDs + fallback names */
async function collectInvoiceContactIds(
  accessToken: string,
  tenantId: string,
  sinceWhere: string
) {
  const uniqueIds = new Set<string>();
  const fallbackNames = new Map<string, string>(); // ContactID -> Name (from invoice summary)
  let page = 1;
  const maxPages = 50;

  const doFetch = (p: number) => {
    const url = new URL(XERO_INVOICES_URL);
    url.searchParams.set("page", String(p));
    url.searchParams.set("where", sinceWhere);
    return fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/json",
      },
    });
  };

  while (page <= maxPages) {
    const resp = await doFetch(page);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Failed invoices page ${page}: ${resp.status} ${text}`);
    }
    const data = (await resp.json()) as XeroInvoicesResponse;
    const list = data.Invoices ?? [];
    if (list.length === 0) break;

    for (const inv of list) {
      const c = inv.Contact;
      const id = (c?.ContactID || "").trim();
      if (id) {
        uniqueIds.add(id);
        if (c?.Name) fallbackNames.set(id, c.Name);
      }
    }
    page += 1;
  }

  return { ids: Array.from(uniqueIds), names: fallbackNames };
}

/** Fetch contacts in batches using the Contacts endpoint with IDs=<csv> (100 per call) */
async function fetchContactsByIds(
  accessToken: string,
  tenantId: string,
  ids: string[],
  batchSize = 100
): Promise<XeroContact[]> {
  const all: XeroContact[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = ids.slice(i, i + batchSize);
    // Build query as .../Contacts?IDs=<id1>,<id2>,...
    const qs = new URLSearchParams();
    // NOTE: Xero expects a comma-separated list in a single IDs param.
    // URLSearchParams encodes commas, so build manually:
    const url = `${XERO_CONTACTS_URL}?IDs=${slice.map(encodeURIComponent).join(",")}`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/json",
      },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Failed contacts batch (${i}-${i + slice.length - 1}): ${resp.status} ${text}`);
    }
    const data = (await resp.json()) as XeroContactsResponse;
    if (data?.Contacts?.length) all.push(...data.Contacts);
  }
  return all;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const userId: string = body?.userId || new URL(req.url).searchParams.get("userId") || "";
    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    // NEW: since date handling (supports { since } or { date })
    let sinceWhere = INVOICE_SINCE_WHERE;
    let sinceISO = "2025-01-01";
    try {
      const sinceInput: string = (body?.since ?? body?.date ?? "").toString().trim();
      const built = buildSinceWhere(sinceInput);
      sinceWhere = built.where;
      sinceISO = built.sinceISO;
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Invalid since date" }, { status: 400 });
    }

    // 1) Find a connected tenant & tokens
    const { rows } = await pool.query(
      `
      SELECT
        id,
        tenant_id,
        access_token,
        refresh_token,
        access_token_expires_at,
        is_connected,
        is_primary
      FROM public.xero_details
      WHERE betterauth_id = $1
        AND is_connected IS TRUE
      ORDER BY is_primary DESC, last_refreshed_at DESC, created_at DESC
      LIMIT 1
      `,
      [userId]
    );
    if (!rows.length) {
      return NextResponse.json({ error: "No Xero connection found for this user." }, { status: 404 });
    }

    const xrow = rows[0] as {
      id: string;
      tenant_id: string;
      access_token: string;
      refresh_token: string;
      access_token_expires_at: string | Date;
    };

    let { access_token, refresh_token } = xrow;
    const tenantId = xrow.tenant_id;

    // 2) Ensure access token is valid (refresh if necessary)
    if (isExpired(xrow.access_token_expires_at)) {
      const refreshed = await refreshAccessToken(refresh_token);
      access_token = refreshed.access_token;
      refresh_token = refreshed.refresh_token;

      await pool.query(
        `
        UPDATE public.xero_details
        SET
          access_token = $1,
          refresh_token = $2,
          access_token_expires_at = $3,
          last_refreshed_at = NOW()
        WHERE id = $4
        `,
        [access_token, refresh_token, nowPlus(refreshed.expires_in * 1000), xrow.id]
      );
    }

    // 3) Fetch invoices (summary contacts) and collect unique ContactIDs
    const { ids: contactIds, names: invoiceNameFallbacks } = await collectInvoiceContactIds(
      access_token,
      tenantId,
      sinceWhere
    );

    if (contactIds.length === 0) {
      return NextResponse.json(
        { userId, tenantId, since: sinceISO, inserted: 0, updated: 0, totalClientsForUser: 0, notes: "No contacts from invoices." },
        { status: 200 }
      );
    }

    // 4) Fetch full contacts in batches via Contacts?IDs=...
    const contacts = await fetchContactsByIds(access_token, tenantId, contactIds);

    // Build a map for quick lookup; some IDs may not be returned (archived/permissions/etc.)
    const contactMap = new Map<string, XeroContact>();
    for (const c of contacts) {
      const id = (c.ContactID || "").trim();
      if (id) contactMap.set(id, c);
    }

    // 5) Upsert each unique contact
    let inserted = 0;
    let updated = 0;
    const errors: Array<{ contactId: string; name?: string | null; email?: string | null; phone?: string | null; error: string }> = [];
    const missingFromContacts: string[] = [];

    for (const id of contactIds) {
      const full = contactMap.get(id);
      if (!full) {
        // not returned by Contacts call; keep fallback name and insert with null email/phone
        missingFromContacts.push(id);
      }
      const name = (full?.Name || invoiceNameFallbacks.get(id) || "").trim() || "(Unknown Contact)";
      const email = (full?.EmailAddress || null)?.toString() ?? null;
      const phone = pickPhone(full?.Phones) || null;

      try {
        const res = await upsertClientByContactId(userId, id, name, email, phone);
        if (res === "inserted") inserted += 1;
        else updated += 1;
      } catch (e: any) {
        errors.push({ contactId: id, name, email, phone, error: e?.message || "DB upsert failed" });
      }
    }

    // 6) Return summary
    const countResult: QueryResult<{ cnt: number }> = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM public.clients WHERE user_id = $1`,
      [userId]
    );
    const total = countResult.rows[0]?.cnt ?? null;

    return NextResponse.json(
      {
        userId,
        tenantId,
        since: sinceISO,
        uniqueContactsFromInvoices: contactIds.length,
        contactsFetched: contacts.length,
        missingFromContacts: missingFromContacts.slice(0, 20),
        inserted,
        updated,
        totalClientsForUser: total,
        errors: errors.slice(0, 20),
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[/api/xero/get-clients-from-xero] error:", err?.stack || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
