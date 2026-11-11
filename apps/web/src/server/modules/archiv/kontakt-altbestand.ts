import { sql } from "drizzle-orm";
import { db } from "../../db/index.ts";
import type { LegacySource } from "../../db/schema.ts";
import { effectiveDirection, effectiveType } from "./sevdesk-richtung.ts";

/**
 * Archivierte Belege eines Kontakts für die Kontaktseite (#587): über die Kontakt-ID, mit Richtung und Art wie unter
 * Archiv › Belege, Gutschriften negativ. Ohne die, die als offener Posten übernommen sind: Die stehen als Rechnung bzw.
 * Beleg in Haben und zählen sonst doppelt.
 */
export async function legacyVouchersForContact(contactId: string) {
  const rows = await db.execute<{
    id: string;
    source: LegacySource;
    source_name: string | null;
    type: string;
    direction: "einnahme" | "ausgabe";
    number: string;
    date: string;
    net: number;
    gross: number;
  }>(sql`
    select v.id, v.source, case when v.source = 'import' then v.raw->>'sourceName' end as source_name,
      ${effectiveType("v")} as type, ${effectiveDirection("v")} as direction, v.number, v.date::text as date, v.net, v.gross
    from lexoffice_vouchers v
    where v.contact_id = ${contactId}
      and not exists (select 1 from invoices i where i.lexoffice_voucher_id = v.id)
      and not exists (select 1 from documents d where d.lexoffice_voucher_id = v.id)`);
  return [...rows].map((r) => ({
    id: r.id,
    source: r.source,
    sourceName: r.source_name,
    type: r.type,
    direction: r.direction,
    number: r.number,
    date: r.date,
    net: Number(r.net),
    gross: Number(r.gross),
  }));
}
