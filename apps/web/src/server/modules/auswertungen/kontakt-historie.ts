import { contactEntriesOfYear, contactHistoryYear, contactYearTotals, type ContactHistoryEntry, type ContactYearTotal } from "@haben/core";
import type { LegacySource } from "../../db/schema.ts";
import { legacyVouchersForContact } from "../archiv/index.ts";
import { supplierDocuments } from "../belege/index.ts";
import { listInvoices, type InvoiceListStatus } from "../rechnungen/index.ts";

/** Eine Zeile auf der Kontaktseite (#587): Rechnung aus Haben, gebuchter Beleg oder archivierter Beleg aus dem Umzug */
export type ContactHistoryRow = ContactHistoryEntry &
  (
    | {
        kind: "rechnung";
        invoiceKind: "rechnung" | "storno" | "korrektur";
        variant: "abschlag" | "schluss" | null;
        status: InvoiceListStatus;
        /** Für die Auskunft unter dem Status, wie in der Rechnungsliste */
        statusFacts: {
          listStatus: InvoiceListStatus;
          dueDate: string;
          paid: number;
          open: number;
          settledOn: string | null;
          cancelledBy: string | null;
          correctsNumber: string | null;
        };
      }
    | { kind: "beleg"; filename: string; category: string | null; splitCount: number; cancelledOn: string | null }
    | { kind: "archiv"; type: string; source: LegacySource; sourceName: string | null }
  );

export interface ContactHistorySection {
  /** Summen aller Jahre, das neueste zuerst */
  years: ContactYearTotal[];
  /** Gezeigtes Jahr: das gewählte, sonst das neueste mit Einträgen */
  year: number | null;
  /** Einträge des gezeigten Jahres; alle Jahre auf einmal würden bei langen Kundenbeziehungen zu viel */
  rows: ContactHistoryRow[];
}

function section(rows: ContactHistoryRow[], requested?: number): ContactHistorySection {
  const years = contactYearTotals(rows);
  const year = contactHistoryYear(years, requested);
  return { years, year, rows: year === null ? [] : contactEntriesOfYear(rows, year) };
}

/**
 * Rechnungen (Kunde) und Belege (Lieferant) eines Kontakts mit Summen je Jahr, aus Haben und aus dem Altbestand.
 * Nur lesend; zugeordnet wird allein über die Kontakt-ID. Rechnungen zählen festgeschrieben, Storno und Korrektur
 * negativ im Jahr ihres Datums; Belege gebucht, ein stornierter steht da, zählt aber nicht. Der Altbestand rechnet wie
 * Archiv › Belege.
 */
export async function contactHistory(
  contactId: string,
  today: string,
  year?: number,
): Promise<{ sales: ContactHistorySection; purchases: ContactHistorySection }> {
  const [invoices, documents, archived] = await Promise.all([listInvoices(today), supplierDocuments(contactId), legacyVouchersForContact(contactId)]);
  const archive = (direction: "einnahme" | "ausgabe"): ContactHistoryRow[] =>
    archived
      .filter((v) => v.direction === direction)
      .map((v) => ({
        kind: "archiv",
        id: v.id,
        date: v.date,
        number: v.number,
        archive: true,
        net: v.net,
        gross: v.gross,
        counts: true,
        type: v.type,
        source: v.source,
        sourceName: v.sourceName,
      }));
  const sales: ContactHistoryRow[] = invoices
    .filter((i) => i.contactId === contactId && i.status === "final")
    .map((i) => ({
      kind: "rechnung",
      id: i.id,
      date: i.issueDate,
      number: i.number ?? "",
      archive: false,
      net: i.net,
      gross: i.gross,
      counts: true,
      invoiceKind: i.kind,
      variant: i.variant,
      status: i.listStatus,
      statusFacts: {
        listStatus: i.listStatus,
        dueDate: i.dueDate,
        paid: i.paid,
        open: i.open,
        settledOn: i.settledOn,
        cancelledBy: i.cancelledBy,
        correctsNumber: i.correctsNumber,
      },
    }));
  const purchases: ContactHistoryRow[] = documents.map((d) => ({
    kind: "beleg",
    id: d.id,
    date: d.date,
    number: d.number,
    archive: false,
    net: d.net,
    gross: d.gross,
    counts: d.cancelledOn === null,
    filename: d.filename,
    category: d.category,
    splitCount: d.splitCount,
    cancelledOn: d.cancelledOn,
  }));
  return { sales: section([...sales, ...archive("einnahme")], year), purchases: section([...purchases, ...archive("ausgabe")], year) };
}
