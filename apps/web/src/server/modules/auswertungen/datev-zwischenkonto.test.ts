import { ACCOUNTS, EXPENSE_CATEGORIES } from "@haben/core";
import { parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * DATEV-Export des Zwischenkontos einer Gutschrift „erstattet bereits Bezahltes“ (#786): Die Buchung des Belegs trägt
 * SKR03 1548 / SKR04 1434 neben dem Aufwand und den Verbindlichkeiten, die Umbuchung beim Ausgleich zusätzlich die
 * Vorsteuer. Beides muss im echten Stapel ankommen, mit Gegenkonto und, weil die Zeile zu einem Beleg gehört, auf dem
 * Personenkonto des Lieferanten — sonst meldet `personenkonto()` „Konto 1600 ohne Beleg“ und der Stapel geht nicht raus.
 *
 * BU-Schlüssel: keiner, und das ist Absicht. 1548/1434 sind wie 1766/1761 Bestandskonten ohne Steuerautomatik; ein
 * BU-Schlüssel 8/9 sagt DATEV, dass der Betrag brutto ist, und es rechnete aus 19,00 € noch einmal 3,03 € Steuer heraus.
 * BU 40 („Automatik aus“) gehört nur auf Automatikkonten. Die Zeile geht deshalb mit leerem Schlüssel und der
 * gebuchten Steuer raus.
 */

describe.skipIf(!testDatabaseUrl)("DATEV-Export: Zwischenkonto der Gutschrift „erstattet bereits Bezahltes“ (Postgres, #786)", () => {
  let datev: typeof import("./datev-export.ts");
  let bank: typeof import("../bank/bank.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let sql: postgres.Sql;
  const actor = "datev-zwischenkonto";
  const inhaber = { id: actor, role: "inhaber" as const };
  let lauf = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    datev = await import("./datev-export.ts");
    bank = await import("../bank/bank.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04") {
    await leeren(sql)`truncate datev_personenkonten, document_cancellations, document_settlements, write_offs, allocations,
      bank_transactions, bank_imports, bank_accounts, cash_entries, journal_lines, journal_entries, document_amounts,
      document_splits, documents, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts,
      year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, versteuerung,
        kontenrahmen, datev_berater_nr, datev_mandant_nr)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE136695976',
              'BY', 'DE89370400440532013000', 'soll', ${kontenrahmen}, '29098', '55003')`;
    await datev.saveDatevNumbers(actor, { beraterNr: "29098", mandantNr: "55003", personenkontenAb: 2026 }, new Date(2026, 0, 1));
  }

  /** Gebuchte Gutschrift über 100,00 € netto zu 19 % mit der Angabe „erstattet bereits Bezahltes“ */
  async function gutschrift(supplierContactId: string, nummer: string) {
    lauf++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, lauf % 256, 9, 1]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `datev-zwischenkonto-${lauf}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Musterpartner GmbH",
      supplierUstId: "",
      supplierContactId,
      invoiceNumber: nummer,
      documentDate: "2026-05-10",
      dueDate: null,
      category: "buero",
      payment: "bank",
      note: "",
      erstattetBezahltes: true,
      amounts: [{ taxRate: 1900, net: -10_000, tax: -1_900 }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  /** Erstattung über einen echten Bankumsatz, damit die Umbuchung entsteht */
  async function erstattung(documentId: string, betrag: number) {
    const euro = (betrag / 100).toFixed(2).replace(".", ",");
    const csv =
      `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"20.05.26";"20.05.26";"Gebucht";"Musterpartner GmbH";"Testfirma";"Erstattung";"Eingang";"DE02100100100006820101";"${euro}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `erstattung-${++lauf}.csv` }, null);
    const [umsatz] = await sql`select id from bank_transactions order by booking_date limit 1`;
    await bank.allocate(actor, { kind: "document", transactionId: umsatz!.id as string, documentId, amount: betrag });
  }

  /** Lieferant mit Kreditorennummer, damit der Export ein Personenkonto setzen kann */
  async function lieferant() {
    return contacts.createContact(actor, {
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
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    it(`${kontenrahmen}: die Buchung und die Umbuchung stehen im Stapel, mit Gegenkonto und ohne BU-Schlüssel`, async () => {
      await reset(kontenrahmen);
      const a = ACCOUNTS[kontenrahmen];
      const kunde = await lieferant();
      const id = await gutschrift(kunde.id, "GS-100");
      await erstattung(id, 11_900);

      const { bytes, warnings } = await datev.datevExport(2026, new Date(2026, 9, 4), inhaber);
      expect(warnings).toEqual([]);
      const stack = parseDatevBuchungsstapel(bytes);

      // Die Buchung des Belegs: Aufwand und Zwischenkonto gegen den Kreditor, Betrag und Belegnummer bleiben
      const aufwand = EXPENSE_CATEGORIES.buero[kontenrahmen];
      expect(
        stack.bookings
          .filter((b) => b.account === "70087")
          .map((b) => `${b.account}/${b.contraAccount}/${b.buKey}/${b.amount}`)
          .sort(),
      ).toEqual([`70087/${aufwand}//10000`, `70087/${a.vorsteuerNochNichtAbziehbar}//1900`].sort());
      // Die Erstattung selbst: Bank an Kreditor, ohne BU-Schlüssel
      expect(stack.bookings.filter((b) => b.account === a.bank)).toEqual([expect.objectContaining({ contraAccount: "70087", amount: 11_900, buKey: "" })]);
      // Die Umbuchung beim Ausgleich: Zwischenkonto an Vorsteuer, ebenfalls ohne BU-Schlüssel
      const umbuchung = stack.bookings.filter((b) => b.account === a.vorsteuerNochNichtAbziehbar && b.contraAccount === a.vorsteuer[1900]);
      expect(umbuchung).toEqual([expect.objectContaining({ side: "S", amount: 1_900, buKey: "", voucherField1: "GS-100" })]);
      // Kz 66 bleibt über den Stapel stimmig: die Vorsteuer steht einmal, mit ihrem Betrag
      expect(stack.bookings.filter((b) => b.contraAccount === a.vorsteuer[1900]).reduce((s, b) => s + b.amount, 0)).toBe(1_900);
    }, 30_000);
  }
});
