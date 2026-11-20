import type postgres from "postgres";
import { leeren } from "../../test-db.ts";

/*
 * Gemeinsames für die Postgres-Tests der Liquiditätsvorschau: Firma anlegen, Kontoauszug als DKB-CSV, Kunde. Nur von Tests
 * importiert.
 */

export const ACTOR = "test-user";

/** DKB-CSV mit den Zeilen [Datum TT.MM.JJ, Gegenpartei, Verwendungszweck, Betrag] */
export function dkbCsv(rows: [date: string, party: string, purpose: string, amount: string][], filename = "auszug.csv") {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows
    .map(([date, party, purpose, amount]) =>
      [date, date, "Gebucht", party, party, purpose, amount.startsWith("-") ? "Ausgang" : "Eingang", "DE02100100100006820101", amount, "", "", ""]
        .map((c) => `"${c}"`)
        .join(";"),
    )
    .join("\n");
  return { bytes: new TextEncoder().encode(`﻿${header}${columns}${body}\n`), filename };
}

export interface Firma {
  rechtsform?: "einzelunternehmen" | "gmbh";
  kontenrahmen: "SKR03" | "SKR04";
  versteuerung: "ist" | "soll";
  taxpayer?: Record<string, unknown>;
}

/** Leert alles, was die Vorschau liest, und legt die Firma in Bayern an */
export async function firma(sql: postgres.Sql, { rechtsform = "einzelunternehmen", kontenrahmen, versteuerung, taxpayer = {} }: Firma) {
  await leeren(sql)`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, document_amounts,
    documents, recurring_documents, recurring_invoices, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts,
    vat_returns, vat_frequencies, vat_extensions, income_tax_inputs, company cascade`;
  await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung,
                                 kontenrahmen, rechtsform, einkunftsart, taxpayer)
    values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
            'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, ${rechtsform}, 'gewerbe',
            ${JSON.stringify(taxpayer)}::jsonb)`;
}

export async function kunde(contacts: Pick<typeof import("../stammdaten/index.ts"), "createContact">): Promise<string> {
  const contact = await contacts.createContact(ACTOR, {
    kundennummer: "",
    name: "Nordwerk Software GmbH",
    strasse: "Hafenstraße 5",
    plz: "20457",
    ort: "Hamburg",
    land: "DE",
    email: "",
    ustId: "",
    iban: "",
    leitwegId: "",
    defaultFormat: null,
  });
  return contact.id;
}
