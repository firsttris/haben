import { ACCOUNTS } from "@haben/core";
import { parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #675: Belegfeld 1 erlaubt nur Ziffern, Buchstaben und $ & % * + - / (DATEV-Serviceinformation Dok.-Nr. 1003221, Stand
 * 13.09.2025). Das Nummernformat von Haben erlaubt Punkte; der Export ersetzt sie durch „-“. Belegfeld 1 ist in DATEV der
 * Schlüssel für den Ausgleich offener Posten, deshalb tragen Rechnung bzw. Beleg und Zahlung dieselbe Nummer.
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

describe.skipIf(!testDatabaseUrl)("DATEV-Export: Belegfeld 1 im Zeichensatz von DATEV (Postgres, #675)", () => {
  let datev: typeof import("./datev-export.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let bank: typeof import("../bank/bank.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const inhaber = { id: actor, role: "inhaber" as const };
  let fileSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    datev = await import("./datev-export.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    bank = await import("../bank/bank.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await leeren(sql)`truncate datev_personenkonten, document_cancellations, write_offs, allocations, bank_transactions, bank_imports, bank_accounts,
      cash_entries, journal_lines, journal_entries, document_amounts, documents, invoice_lines, invoices, invoice_number_counters, contact_versions,
      contacts, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen,
              datev_berater_nr, datev_mandant_nr, invoice_number_format)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE136695976', 'BY',
              'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, '29098', '55003', 'RE.{JJJJ}.{NNN}')`;
  }

  async function invoice(contactId: string, net: number) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate: "2026-05-02",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Std." as const, unitPrice: net, taxRate: 1900 as const }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function beleg(invoiceNumber: string, gross: number) {
    fileSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, fileSeq % 256, 9, 27]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${fileSeq}.jpg` });
    const net = Math.round(gross / 1.19);
    await documents.updateDocument(actor, id, {
      supplierName: "Musterpartner GmbH",
      supplierUstId: "",
      supplierContactId: null,
      invoiceNumber,
      documentDate: "2026-05-10",
      dueDate: null,
      category: "buero",
      payment: "bank",
      note: "",
      reverseCharge: null,
      asset: null,
      amounts: [{ taxRate: 1900, net, tax: gross - net }],
    } as Parameters<typeof documents.updateDocument>[2]);
    await documents.bookDocument(actor, id);
    return id;
  }

  async function pay(target: { invoiceId: string } | { documentId: string }, amount: number) {
    const label = `Zahlung ${Object.values(target)[0]!.slice(0, 8)} ${amount}`;
    const euros = (Math.abs(amount) / 100).toFixed(2).replace(".", ",");
    const date = "2026-06-15";
    const row = [
      date,
      date,
      "Gebucht",
      "Musterpartner",
      "Testfirma",
      label,
      amount < 0 ? "Ausgang" : "Eingang",
      "DE02100100100006820101",
      `${amount < 0 ? "-" : ""}${euros}`,
      "",
      "",
      "",
    ];
    await bank.importStatement(actor, { bytes: dkbCsv([row]), filename: `${label}.csv` }, null);
    const [tx] = await sql`select id from bank_transactions where purpose = ${label}`;
    if ("invoiceId" in target) await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: target.invoiceId, amount });
    else await bank.allocate(actor, { kind: "document", transactionId: tx!.id, documentId: target.documentId, amount });
  }

  // Belegfeld 1 hängt nicht am Kontenrahmen oder an der Versteuerung; zwei Kombinationen statt aller vier
  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("%s, %s: Rechnung und Beleg mit Punkt tragen mit ihrer Zahlung dieselbe Nummer mit „-“", async (kontenrahmen, versteuerung) => {
    await reset(kontenrahmen, versteuerung);
    const kunde = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk GmbH",
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
    const rechnung = await invoice(kunde.id, 100_000);
    expect(rechnung.number).toBe("RE.2026.001");
    await pay({ invoiceId: rechnung.id }, 119_000);
    const belegId = await beleg("ER.17/ä", 11_900);
    await pay({ documentId: belegId }, -11_900);

    const { bytes, warnings } = await datev.datevExport(2026, new Date(2026, 9, 4), inhaber);
    const stack = parseDatevBuchungsstapel(bytes);
    const felder = [...new Set(stack.bookings.map((b) => b.voucherField1))].sort();
    expect(felder).toEqual(["ER-17/", "RE-2026-001"]);
    // Rechnung bzw. Beleg und Zahlung (Buchung auf dem Bankkonto) unter derselben Nummer
    const { bank: bankkonto, forderungen, verbindlichkeiten } = ACCOUNTS[kontenrahmen];
    const konten = (feld: string) => stack.bookings.filter((b) => b.voucherField1 === feld).flatMap((b) => [b.account, b.contraAccount]);
    expect(konten("RE-2026-001")).toEqual(expect.arrayContaining([forderungen, bankkonto]));
    expect(konten("ER-17/")).toEqual(expect.arrayContaining([verbindlichkeiten, bankkonto]));
    expect(warnings).toEqual([]);
  });

  it("warnt, wenn eine Belegnummer nach dem Ersetzen wie eine Rechnungsnummer aussieht", async () => {
    await reset("SKR03", "ist");
    const kunde = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk GmbH",
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
    await invoice(kunde.id, 100_000);
    await beleg("RE-2026-001", 11_900);

    const { warnings } = await datev.datevExport(2026, new Date(2026, 9, 4), inhaber);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("„RE.2026.001“");
    expect(warnings[0]).toContain("„RE-2026-001“");
  });
});
