import { ACCOUNTS } from "@haben/core";
import { parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * DATEV-Export einer Verrechnung zweier Belege (#786, Etappe 3): Die Buchung je Belegseite trägt ihren Beleg als Vorgang,
 * sonst meldet `personenkonto()` „Konto 1600 ohne Beleg“ und der Stapel geht nicht raus. Eine gemeinsame Sammelbuchung
 * über beide Belege (früher #785) hatte diesen Bezug nicht: Sie buchte Verbindlichkeiten gegen ein Zwischenkonto, ohne
 * dass eine der Zeilen zu einer Rechnung oder einem Beleg gehörte. Hier läuft der echte Export über eine verrechnete
 * Gutschrift: Beide Seiten stehen mit ihrer Belegnummer auf dem Kreditor, die Steuerzeile der Gutschrift daneben.
 */

describe.skipIf(!testDatabaseUrl)("DATEV-Export: Verrechnung zweier Belege (Postgres, #786)", () => {
  let datev: typeof import("./datev-export.ts");
  let verrechnung: typeof import("../bank/verrechnung.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let sql: postgres.Sql;
  const actor = "datev-verrechnung";
  const inhaber = { id: actor, role: "inhaber" as const };
  let lauf = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    datev = await import("./datev-export.ts");
    verrechnung = await import("../bank/verrechnung.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset() {
    await leeren(sql)`truncate datev_personenkonten, document_cancellations, document_settlements, write_offs, allocations,
      bank_transactions, bank_imports, bank_accounts, cash_entries, journal_lines, journal_entries, document_amounts,
      document_splits, documents, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, year_closings,
      company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, versteuerung,
        kontenrahmen, datev_berater_nr, datev_mandant_nr)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE136695976', 'BY',
              'DE89370400440532013000', 'ist', 'SKR03', '29098', '55003')`;
    await datev.saveDatevNumbers(actor, { beraterNr: "29098", mandantNr: "55003", personenkontenAb: 2026 }, new Date(2026, 0, 1));
  }

  /** Gebuchter Beleg des Lieferanten; negative Beträge ergeben die Gutschrift */
  async function beleg(input: { supplierContactId: string; nummer: string; net: number; tax: number; erstattetBezahltes?: boolean }) {
    lauf++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, lauf % 256, 3, 5]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `datev-verrechnung-${lauf}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Musterpartner GmbH",
      supplierUstId: "",
      supplierContactId: input.supplierContactId,
      invoiceNumber: input.nummer,
      documentDate: "2026-05-10",
      dueDate: null,
      category: "buero",
      payment: "bank",
      note: "",
      erstattetBezahltes: input.erstattetBezahltes ?? false,
      amounts: [{ taxRate: 1900, net: input.net, tax: input.tax }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  it("läuft über eine verrechnete Gutschrift durch und bucht beide Seiten auf den Kreditor", async () => {
    await reset();
    const { verbindlichkeiten, verrechnung: verrechnungskonto } = ACCOUNTS.SKR03;
    const lieferant = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Musterpartner GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
      isSupplier: true,
      kreditorNr: 70087,
    });
    const rechnung = await beleg({ supplierContactId: lieferant.id, nummer: "ER-100", net: 10_000, tax: 1_900 });
    const gutschrift = await beleg({
      supplierContactId: lieferant.id,
      nummer: "ER-200",
      net: -10_000,
      tax: -1_900,
      erstattetBezahltes: true,
    });
    await verrechnung.settleDocuments(actor, {
      documentId: rechnung,
      counterDocumentId: gutschrift,
      amount: 5_950,
      date: "2026-05-20",
      note: "Gutschrift verrechnet",
    });

    const { bytes, warnings } = await datev.datevExport(2026, new Date(2026, 9, 4), inhaber);
    const stack = parseDatevBuchungsstapel(bytes);
    expect(warnings).toEqual([]);

    // Rechnung: Soll Kreditor 70087 an Verrechnungskonto; Gutschrift: Soll Verrechnungskonto an Kreditor 70087
    const rechnungsseite = stack.bookings.filter((b) => b.voucherField1 === "ER-100" && b.account === "70087");
    expect(rechnungsseite).toEqual([expect.objectContaining({ side: "S", amount: 5_950, account: "70087", contraAccount: verrechnungskonto })]);
    const gutschriftseite = stack.bookings.filter((b) => b.voucherField1 === "ER-200" && b.contraAccount === "70087");
    expect(gutschriftseite).toEqual([expect.objectContaining({ side: "S", amount: 5_950, account: verrechnungskonto, contraAccount: "70087" })]);
    // Die Umbuchung der Vorsteuer steht in der Buchung der Gutschrift, Zwischenkonto an Vorsteuer
    const steuer = stack.bookings.filter((b) => b.voucherField1 === "ER-200" && b.contraAccount === ACCOUNTS.SKR03.vorsteuer[1900]);
    expect(steuer).toEqual([expect.objectContaining({ side: "S", amount: 950, account: ACCOUNTS.SKR03.vorsteuerNochNichtAbziehbar })]);
    // Auf dem Personenkonto hebt sich die Verrechnung auf, das Sammelkonto erscheint im Stapel nicht mehr
    expect(stack.bookings.some((b) => b.account === verbindlichkeiten || b.contraAccount === verbindlichkeiten)).toBe(false);
  }, 30_000);
});
