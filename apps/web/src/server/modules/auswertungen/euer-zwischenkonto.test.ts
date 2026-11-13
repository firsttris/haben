import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * EÜR und das Zwischenkonto einer Gutschrift „erstattet bereits Bezahltes“ (#786): SKR03 1548 / SKR04 1434 sind
 * Bestandskonten (sonstige Vermögensgegenstände), kein Aufwand und keine Einnahme. Die EÜR aus dem Journal
 * (euer-journal.ts) zählt die Buchung deshalb genau wie ohne die Angabe: Das Entgelt mindert den Aufwand, die Vorsteuer
 * steht in ihrer eigenen Zeile — nur eben erst, wenn das Geld zurückkommt, denn vorher ist der Beleg noch offen.
 * Der Test vergleicht vorher, geparkt und nach dem Ausgleich, damit das Konto nicht unbemerkt als Aufwand durchschlägt.
 */

describe.skipIf(!testDatabaseUrl)("EÜR: Zwischenkonto der Gutschrift „erstattet bereits Bezahltes“ (Postgres, #786)", () => {
  let euerJournal: typeof import("./euer-journal.ts");
  let bank: typeof import("../bank/bank.ts");
  let documents: typeof import("../belege/documents.ts");
  let core: typeof import("@haben/core");
  let sql: postgres.Sql;
  const actor = "euer-zwischenkonto";
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 43]);
  let lauf = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    euerJournal = await import("./euer-journal.ts");
    bank = await import("../bank/bank.ts");
    documents = await import("../belege/documents.ts");
    core = await import("@haben/core");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma(kontenrahmen: "SKR03" | "SKR04" = "SKR03") {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, write_offs, allocations,
      bank_transactions, bank_imports, bank_accounts, cash_entries, journal_lines, journal_entries, document_amounts,
      document_splits, documents, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, rechtsform, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'soll', ${kontenrahmen}, 'einzelunternehmen', 14)`;
  }

  /** Gebuchte Gutschrift des Lieferanten über 100,00 € netto zu 19 % */
  async function gutschrift(erstattetBezahltes: boolean) {
    lauf++;
    const bytes = new Uint8Array([...JPEG, lauf % 251]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `gutschrift-${lauf}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Stadtwerke Beispiel GmbH",
      supplierUstId: "",
      invoiceNumber: `GS-${lauf}`,
      documentDate: "2026-09-15",
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      erstattetBezahltes,
      amounts: [{ taxRate: 1900, net: -10_000, tax: -1_900 }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  /** Erstattung über einen echten Bankumsatz; `betrag` in Cent, positiv wie auf dem Konto */
  async function erstattung(documentId: string, betrag: number) {
    const euro = (betrag / 100).toFixed(2).replace(".", ",");
    const csv =
      `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"05.10.26";"05.10.26";"Gebucht";"Stadtwerke Beispiel GmbH";"Testfirma";"Erstattung";"Eingang";"DE02100100100006820101";"${euro}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `erstattung-${++lauf}.csv` }, null);
    const [umsatz] = await sql`select id from bank_transactions order by booking_date limit 1`;
    await bank.allocate(actor, { kind: "document", transactionId: umsatz!.id as string, documentId, amount: betrag });
  }

  const zeilen = async (year = 2026) => (await euerJournal.euerAusJournal(year)).summe.zeilen;

  it("die Konten sind in der EÜR kein Aufwand und keine Einnahme", () => {
    for (const kr of ["SKR03", "SKR04"] as const) expect(core.euerZuordnung(kr, core.ACCOUNTS[kr].vorsteuerNochNichtAbziehbar), kr).toBeNull();
  });

  it("geparkt ändert die EÜR nichts; nach der Erstattung ist sie so wie ohne die Angabe", async () => {
    await firma();
    const vorher = await zeilen();

    const id = await gutschrift(true);
    // Gebucht, aber noch nicht erstattet: der Beleg ist offen, die EÜR zählt nichts — auch nicht das Zwischenkonto
    expect(await zeilen()).toEqual(vorher);

    await erstattung(id, 11_900);
    const mitAngabe = await zeilen();
    expect(mitAngabe).toEqual({ "ausgabe:software": -10_000, vorsteuer: -1_900 });

    // Dieselbe Gutschrift ohne die Angabe: gleiche EÜR, nur die Steuer stand von Anfang an auf der Vorsteuer
    await firma();
    const ohneId = await gutschrift(false);
    await erstattung(ohneId, 11_900);
    expect(await zeilen()).toEqual(mitAngabe);
  }, 30_000);

  it("SKR04: dasselbe Bild, die Vorsteuerzeile kommt aus 1406", async () => {
    await firma("SKR04");
    const id = await gutschrift(true);
    expect(await zeilen()).toEqual({});
    await erstattung(id, 11_900);
    expect(await zeilen()).toEqual({ "ausgabe:software": -10_000, vorsteuer: -1_900 });
  }, 30_000);
});
