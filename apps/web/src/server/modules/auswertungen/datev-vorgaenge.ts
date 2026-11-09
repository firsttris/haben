import type { PersonenkontoBezug } from "@haben/import";
import { inArray, sql } from "drizzle-orm";
import { db, schema } from "../../db/index.ts";

/*
 * Zu welcher Rechnung bzw. welchem Beleg eine Buchung gehört, für den DATEV-Export: Rechnungen und Belege direkt,
 * Zahlungen (allocation), Ausbuchungen wie Skonto und Forderungsausfall (ausbuchung) und Bareinnahmen im Kassenbuch
 * (kasse) über die zugeordnete Rechnung bzw. den Beleg. Daraus kommen Belegfeld 1 und das Personenkonto (#327).
 */

type Entry = Pick<typeof schema.journalEntries.$inferSelect, "sourceType" | "sourceId">;

interface Rechnung {
  kind: "rechnung";
  number: string;
  contactId: string | null;
  inEroeffnung: boolean;
}

interface Beleg {
  kind: "beleg";
  number: string;
  filename: string;
  contactId: string | null;
  inEroeffnung: boolean;
}

export interface DatevVorgang {
  /** Belegfeld 1: Rechnungsnummer bzw. Belegnummer des Lieferanten */
  voucher: string;
  /** Personenkonto der Buchung; null = weder Rechnung noch Beleg */
  bezug: PersonenkontoBezug | null;
  /**
   * Übernommener offener Posten ohne eigene Buchung: Sein Betrag steht in der Eröffnung aus dem DATEV-Stapel auf dem
   * Sammelkonto (siehe openingDependents), also bleibt auch alles dazu dort, sonst stünde der Kontakt nach der Zahlung im
   * Minus und das Sammelkonto bliebe offen (#452)
   */
  inEroeffnung: boolean;
}

async function links(entries: readonly Entry[]): Promise<Map<string, { invoiceId: string | null; documentId: string | null }>> {
  const ids = (type: Entry["sourceType"]) => [...new Set(entries.filter((e) => e.sourceType === type).map((e) => e.sourceId))];
  const allocationIds = ids("allocation");
  const writeOffIds = ids("ausbuchung");
  const cashIds = ids("kasse");
  const rows = [
    ...ids("invoice").map((id) => ({ id, invoiceId: id, documentId: null })),
    ...ids("document").map((id) => ({ id, invoiceId: null, documentId: id })),
    ...(allocationIds.length
      ? await db
          .select({ id: schema.allocations.id, invoiceId: schema.allocations.invoiceId, documentId: schema.allocations.documentId })
          .from(schema.allocations)
          .where(inArray(schema.allocations.id, allocationIds))
      : []),
    ...(writeOffIds.length
      ? await db
          .select({ id: schema.writeOffs.id, invoiceId: schema.writeOffs.invoiceId, documentId: schema.writeOffs.documentId })
          .from(schema.writeOffs)
          .where(inArray(schema.writeOffs.id, writeOffIds))
      : []),
    // Bareinnahmen auf Rechnungen; bar bezahlte Belege buchen Aufwand an Kasse ohne offenen Posten, Einlagen und
    // Geldtransit haben keinen Vorgang
    ...(cashIds.length
      ? (
          await db
            .select({ id: schema.cashEntries.id, invoiceId: schema.cashEntries.invoiceId })
            .from(schema.cashEntries)
            .where(inArray(schema.cashEntries.id, cashIds))
        ).map((c) => ({ ...c, documentId: null }))
      : []),
  ];
  return new Map(rows.map((r) => [r.id, { invoiceId: r.invoiceId, documentId: r.documentId }]));
}

async function sources(invoiceIds: string[], documentIds: string[]): Promise<Map<string, Rechnung | Beleg>> {
  const invoices = invoiceIds.length
    ? await db
        .select({
          id: schema.invoices.id,
          number: schema.invoices.number,
          contactId: schema.invoices.contactId,
          inEroeffnung: sql<boolean>`${schema.invoices.lexofficeVoucherId} is not null and not exists (select 1 from journal_entries j where j.source_type = 'invoice' and j.source_id = ${schema.invoices.id})`,
        })
        .from(schema.invoices)
        .where(inArray(schema.invoices.id, invoiceIds))
    : [];
  const documents = documentIds.length
    ? await db
        .select({
          id: schema.documents.id,
          number: schema.documents.invoiceNumber,
          filename: schema.documents.filename,
          contactId: schema.documents.supplierContactId,
          inEroeffnung: sql<boolean>`${schema.documents.lexofficeVoucherId} is not null and not exists (select 1 from journal_entries j where j.source_type = 'document' and j.source_id = ${schema.documents.id})`,
        })
        .from(schema.documents)
        .where(inArray(schema.documents.id, documentIds))
    : [];
  return new Map<string, Rechnung | Beleg>([
    ...invoices.map((i): [string, Rechnung] => [
      i.id,
      { kind: "rechnung", number: i.number ?? "", contactId: i.contactId, inEroeffnung: Boolean(i.inEroeffnung) },
    ]),
    ...documents.map((d): [string, Beleg] => [
      d.id,
      { kind: "beleg", number: d.number ?? "", filename: d.filename, contactId: d.contactId, inEroeffnung: Boolean(d.inEroeffnung) },
    ]),
  ]);
}

async function contactsById(ids: string[]) {
  const rows = ids.length
    ? await db
        .select({ id: schema.contacts.id, name: schema.contacts.name, debitorNr: schema.contacts.debitorNr, kreditorNr: schema.contacts.kreditorNr })
        .from(schema.contacts)
        .where(inArray(schema.contacts.id, ids))
    : [];
  return new Map(rows.map((c) => [c.id, c]));
}

/** Vorgang je Quelle (sourceId) der Buchungen */
export async function datevVorgaenge(entries: readonly Entry[]): Promise<Map<string, DatevVorgang>> {
  const linked = await links(entries);
  const values = [...linked.values()];
  const source = await sources(
    [...new Set(values.flatMap((l) => (l.invoiceId ? [l.invoiceId] : [])))],
    [...new Set(values.flatMap((l) => (l.documentId ? [l.documentId] : [])))],
  );
  const contacts = await contactsById([...new Set([...source.values()].flatMap((s) => (s.contactId ? [s.contactId] : [])))]);
  const result = new Map<string, DatevVorgang>();
  for (const [id, link] of linked) {
    const s = source.get(link.invoiceId ?? link.documentId ?? "");
    if (!s) {
      result.set(id, { voucher: "", bezug: null, inEroeffnung: false });
      continue;
    }
    const contact = s.contactId ? contacts.get(s.contactId) : undefined;
    const rolle = s.kind === "rechnung" ? "debitor" : "kreditor";
    const vorgang = s.kind === "rechnung" ? `Rechnung ${s.number}` : s.number ? `Beleg ${s.number}` : `Beleg „${s.filename}“`;
    result.set(id, {
      voucher: s.number,
      inEroeffnung: s.inEroeffnung,
      bezug: {
        vorgang,
        rolle,
        kontakt: contact ? { name: contact.name, nummer: rolle === "debitor" ? contact.debitorNr : contact.kreditorNr } : null,
      },
    });
  }
  return result;
}
