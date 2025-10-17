// app/api/xero/get-clients-from-xero/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import type { QueryResult } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_INVOICES_URL = "https://api.xero.com/api.xro/2.0/Invoices";
const XERO_CONTACTS_URL = "https://api.xero.com/api.xro/2.0/Contacts";
const INVOICE_SINCE_WHERE = "Date >= DateTime(2025, 1, 1)";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true },
});

/* ---------------- Xero types (minimal fields used) ---------------- */

type XeroTokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  scope: string;
  expires_in: number; // seconds
  id_token?: string;
};

type XeroContactPhone = {
  PhoneType?: "DEFAULT" | "MOBILE" | "DDI" | "FAX" | string;
  PhoneNumber?: string | null;
  PhoneAreaCode?: string | null;
  PhoneCountryCode?: string | null;
};

type XeroContact = {
  ContactID?: string;
  Name?: string;
  EmailAddress?: string | null;
  Phones?: XeroContactPhone[] | null;
  /** <<< New: we only upsert when this is true */
  IsCustomer?: boolean | null;
};

type XeroLineItem = { Description?: string | null };

type XeroInvoice = {
  InvoiceID?: string;
  Contact?: { ContactID?: string; Name?: string } | null;
  Date?: string;
  LineItems?: XeroLineItem[] | null;
  SentToContact?: boolean | null;
  Status?: string | null;
};

type XeroInvoicesResponse = { Invoices?: XeroInvoice[] };
type XeroContactsResponse = { Contacts?: XeroContact[] };

/* ---------------- local types & utils ---------------- */

type InvoiceStatus = "PAID" | "SENT" | "DRAFT" | "PAID BUT NOT SENT";

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

function computeInvoiceStatus(sentToContact?: boolean | null, status?: string | null): InvoiceStatus {
  const isPaid = (status || "").toUpperCase() === "PAID";
  const sent = !!sentToContact;
  if (isPaid) return sent ? "PAID" : "PAID BUT NOT SENT";
  return sent ? "SENT" : "DRAFT";
}

/** Upsert by Xero ContactID (unique on (user_id, xero_contact_id)) */
async function upsertClientByContactId(
  userId: string,
  xeroContactId: string,
  nameIn: string,
  emailIn: string | null,
  phoneIn: string | null,
  itemDescriptionIn: string | null,
  invoiceStatusIn: InvoiceStatus | null
): Promise<"inserted" | "updated"> {
  const name = (nameIn || "").trim() || "(Unknown Contact)";
  const email = (emailIn || "")?.trim() || null;
  const phone = (phoneIn || "")?.trim() || null;
  const itemDesc = (itemDescriptionIn || "").trim() || null;
  const invoiceStatus = invoiceStatusIn ?? null;
  const clientId = crypto.randomUUID();

  const q = `
    INSERT INTO public.clients
      (id, user_id, xero_contact_id, name, email, phone_number, item_description, invoice_status, sentiment, email_sent, review_clicked, review_submitted)
    VALUES
      ($1, $2, $3::uuid, $4, $5, $6, $7, $8::public.invoice_status, 'unreviewed', FALSE, FALSE, FALSE)
    ON CONFLICT ON CONSTRAINT uq_clients_user_xero_contact
    DO UPDATE SET
      name             = COALESCE(NULLIF(EXCLUDED.name, ''), public.clients.name),
      email            = COALESCE(EXCLUDED.email, public.clients.email),
      phone_number     = COALESCE(NULLIF(EXCLUDED.phone_number, ''), public.clients.phone_number),
      item_description = COALESCE(NULLIF(EXCLUDED.item_description, ''), public.clients.item_description),
      invoice_status   = COALESCE(EXCLUDED.invoice_status, public.clients.invoice_status)
    RETURNING (xmax = 0) AS inserted
  `;

  const result: QueryResult<{ inserted: boolean }> = await pool.query(q, [
    clientId,
    userId,
    xeroContactId,
    name,
    email,
    phone,
    itemDesc,
    invoiceStatus,
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
  if (!isoDate) return { where: INVOICE_SINCE_WHERE, sinceISO: "2025-01-01" };
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid since date. Use ISO format like 2025-01-01.");
  }
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const sinceISO = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { where: `Date >= DateTime(${y}, ${m}, ${day})`, sinceISO };
}

/**
 * Fetch invoices (paged) and collect per-contact info
 * (we still use invoices to discover active contacts & descriptions).
 */
async function collectInvoiceContactData(
  accessToken: string,
  tenantId: string,
  sinceWhere: string
) {
  const uniqueIds = new Set<string>();
  const fallbackNames = new Map<string, string>();
  const descSets = new Map<string, Set<string>>();
  const latestByContact = new Map<string, { ts: number; sent?: boolean | null; status?: string | null }>();

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
    // NOTE: We *don't* set summaryOnly=true because we need LineItems
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
      if (!id) continue;

      uniqueIds.add(id);
      if (c?.Name) fallbackNames.set(id, c.Name);

      const items = inv.LineItems ?? [];
      if (Array.isArray(items) && items.length) {
        let set = descSets.get(id);
        if (!set) {
          set = new Set<string>();
          descSets.set(id, set);
        }
        for (const li of items) {
          const d = (li?.Description || "").toString().trim();
          if (d) set.add(d);
        }
      }

      const ts = Date.parse(inv.Date ?? "") || 0;
      const prev = latestByContact.get(id);
      if (!prev || ts >= prev.ts) {
        latestByContact.set(id, { ts, sent: inv.SentToContact ?? null, status: inv.Status ?? null });
      }
    }
    page += 1;
  }

  const descriptions = new Map<string, string>();
  for (const [id, set] of descSets) {
    descriptions.set(id, Array.from(set).join(" | "));
  }

  const statusByContact = new Map<string, InvoiceStatus>();
  for (const [id, info] of latestByContact) {
    statusByContact.set(id, computeInvoiceStatus(info.sent, info.status));
  }

  return {
    ids: Array.from(uniqueIds),
    names: fallbackNames,
    descriptions,
    statusByContact,
  };
}

/** Fetch contacts in batches using Contacts?IDs=... (100 per call) */
async function fetchContactsByIds(
  accessToken: string,
  tenantId: string,
  ids: string[],
  batchSize = 100
): Promise<XeroContact[]> {
  const all: XeroContact[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const slice = ids.slice(i, i + batchSize);
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

    // Since-date handling
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

    // 3) Discover contacts via invoices (IDs, fallbacks, descriptions, latest invoice status)
    const {
      ids: contactIds,
      names: invoiceNameFallbacks,
      descriptions: invoiceDescriptions,
      statusByContact,
    } = await collectInvoiceContactData(access_token, tenantId, sinceWhere);

    if (contactIds.length === 0) {
      return NextResponse.json(
        {
          userId,
          tenantId,
          since: sinceISO,
          inserted: 0,
          updated: 0,
          consideredFromInvoices: 0,
          customersOnly: 0,
          totalClientsForUser: 0,
          notes: "No contacts from invoices.",
        },
        { status: 200 }
      );
    }

    // 4) Fetch full contact objects for those IDs
    const contacts = await fetchContactsByIds(access_token, tenantId, contactIds);

    // Build map and a set of .IsCustomer === true
    const contactMap = new Map<string, XeroContact>();
    const customerSet = new Set<string>();
    for (const c of contacts) {
      const id = (c.ContactID || "").trim();
      if (!id) continue;
      contactMap.set(id, c);
      if (c.IsCustomer === true) customerSet.add(id);
    }

    // 5) Upsert ONLY contacts where IsCustomer === true.
    let inserted = 0;
    let updated = 0;

    // Metrics for visibility
    let consideredFromInvoices = contactIds.length;   // all contact ids seen in invoices
    let customersOnly = 0;                            // how many actually had IsCustomer true
    const skippedNotCustomer: string[] = [];
    const skippedMissingContact: string[] = [];
    const errors: Array<{
      contactId: string;
      name?: string | null;
      email?: string | null;
      phone?: string | null;
      item_description?: string | null;
      invoice_status?: InvoiceStatus | null;
      error: string;
    }> = [];

    for (const id of contactIds) {
      const full = contactMap.get(id);

      // If we don't have a full contact (not returned by Contacts), skip — can't verify IsCustomer
      if (!full) {
        skippedMissingContact.push(id);
        continue;
      }

      // Only proceed if IsCustomer is true
      if (full.IsCustomer !== true) {
        skippedNotCustomer.push(id);
        continue;
      }
      customersOnly += 1;

      // Prepare data
      const name =
        (full?.Name || invoiceNameFallbacks.get(id) || "").trim() || "(Unknown Contact)";
      const email = (full?.EmailAddress || null)?.toString() ?? null;
      const phone = pickPhone(full?.Phones) || null;
      const itemDescription = invoiceDescriptions.get(id) || null;
      const invoiceStatus = statusByContact.get(id) ?? null;

      try {
        const res = await upsertClientByContactId(
          userId,
          id,
          name,
          email,
          phone,
          itemDescription,
          invoiceStatus
        );
        if (res === "inserted") inserted += 1;
        else updated += 1;
      } catch (e: any) {
        errors.push({
          contactId: id,
          name,
          email,
          phone,
          item_description: itemDescription,
          invoice_status: invoiceStatus,
          error: e?.message || "DB upsert failed",
        });
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
        consideredFromInvoices,
        contactsFetched: contacts.length,
        customersOnly, // how many had IsCustomer === true
        inserted,
        updated,
        skippedNotCustomer: skippedNotCustomer.slice(0, 50),
        skippedMissingContact: skippedMissingContact.slice(0, 50),
        totalClientsForUser: total,
        // some debug samples
        sampleDescriptions: Array.from(invoiceDescriptions.entries()).slice(0, 5),
        sampleStatuses: Array.from(statusByContact.entries()).slice(0, 10),
        errors: errors.slice(0, 20),
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[/api/xero/get-clients-from-xero] error:", err?.stack || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
