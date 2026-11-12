import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * § 13b und innergemeinschaftlicher Erwerb mit Privatanteil: Der private Teil der selbst geschuldeten Steuer ist keine
 * Vorsteuer, geht aber mit der Voranmeldung ans Finanzamt. Die EÜR zählt ihn als Umsatzsteuer auf die Entnahme
 * (Zeile 17), wie die DATEV-Formel, die die Konten der selbst geschuldeten Steuer mitzählt. Ohne die Zeile zeigte der
 * Abgleich beim Gewinn nach der DATEV-Formel eine Abweichung in Höhe dieses Teils (#542).
 */

describe.skipIf(!testDatabaseUrl)("EÜR: privater Teil der selbst geschuldeten Steuer, Sachentnahme auf 4630", () => {
  let cash: typeof import("../bank/cash-income.ts");
  let documents: typeof import("../belege/documents.ts");
  let cancellation: typeof import("../belege/cancellation.ts");
  let abgleich: typeof import("./abgleich.ts");
  let reports: typeof import("./reports.ts");
  let quelle: typeof import("./euer-quelle.ts");
  let db: typeof import("../../db/index.ts").db;
  let sql: postgres.Sql;
  const actor = "test-user";
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    db = (await import("../../db/index.ts")).db;
    cash = await import("../bank/cash-income.ts");
    documents = await import("../belege/documents.ts");
    cancellation = await import("../belege/cancellation.ts");
    abgleich = await import("./abgleich.ts");
    reports = await import("./reports.ts");
    quelle = await import("./euer-quelle.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04") {
    await leeren(sql)`truncate asset_depreciations, assets, vat_return_submissions, vat_returns, write_offs, allocations, bank_transactions,
      bank_imports, bank_accounts, cash_entries, document_cancellations, journal_lines, journal_entries, document_amounts, documents, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen})`;
    await cash.createCashIncome(
      actor,
      { date: "2025-11-01", amount: 300_000, text: "Markt", steuer: { behandlung: "regulaer", steuersatz: 1900 } },
      "2026-11-10",
    );
  }

  /** Bar bezahlter Beleg mit selbst geschuldeter Steuer; netto 1.000 €, Steuer 190 € bzw. 70 € */
  async function selbstGeschuldet(date: string, reverseCharge: "eu" | "drittland" | "ig_erwerb", privateShare: number, taxRate: 1900 | 700 = 1900) {
    docSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 31]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `s${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant",
      supplierUstId: reverseCharge === "drittland" ? "" : "ATU12345678",
      invoiceNumber: `S${docSeq}`,
      documentDate: date,
      dueDate: null,
      category: "edv",
      payment: "kasse",
      note: "",
      amounts: [{ taxRate, net: 100_000, tax: taxRate === 1900 ? 19_000 : 7_000 }],
      privateShare,
      reverseCharge,
    } as never);
    await documents.bookDocument(actor, id);
    return id;
  }

  const ustZeile = (euer: { einnahmen: { key: string; amount: number }[] }) => euer.einnahmen.find((l) => l.key === "vereinnahmteUst")?.amount ?? 0;

  for (const kontenrahmen of ["SKR03", "SKR04"] as const)
    for (const versteuerung of ["soll", "ist"] as const) {
      it(`§ 13b mit 30 % Privatanteil: Zeile 17 um den privaten Teil höher, Abgleich ohne Abweichung, auch nach dem Storno (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const vorher = ustZeile(await reports.euerAusNebenbuechern(2025, db));
        const id = await selbstGeschuldet("2025-12-05", "eu", 30);
        const nebenbuch = await reports.euerAusNebenbuechern(2025, db);
        expect(ustZeile(nebenbuch) - vorher).toBe(5_700);
        expect(ustZeile(await quelle.euerAusDemJournal(2025, db))).toBe(ustZeile(nebenbuch));
        expect(abgleich.abweichungen((await abgleich.euerAbgleich(2025)).zeilen)).toEqual([]);

        await cancellation.cancelDocument(actor, id, { reason: "Falsch erfasst" } as never, "2026-01-15");
        expect(ustZeile(await reports.euerAusNebenbuechern(2026, db))).toBe(-5_700);
        expect(ustZeile(await quelle.euerAusDemJournal(2026, db))).toBe(-5_700);
        expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
      }, 60_000);
    }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    it(`Innergemeinschaftlicher Erwerb zu 7 % und Drittland mit Privatanteil (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen);
      const vorher = ustZeile(await reports.euerAusNebenbuechern(2025, db));
      await selbstGeschuldet("2025-12-05", "ig_erwerb", 50, 700);
      await selbstGeschuldet("2025-12-06", "drittland", 25);
      const nebenbuch = await reports.euerAusNebenbuechern(2025, db);
      // 50 % von 70 € und 25 % von 190 €
      expect(ustZeile(nebenbuch) - vorher).toBe(3_500 + 4_750);
      expect(ustZeile(await quelle.euerAusDemJournal(2025, db))).toBe(ustZeile(nebenbuch));
      expect(abgleich.abweichungen((await abgleich.euerAbgleich(2025)).zeilen)).toEqual([]);
    }, 60_000);

    it(`§ 13b ohne Privatanteil: keine Umsatzsteuer in der EÜR (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen);
      const vorher = ustZeile(await reports.euerAusNebenbuechern(2025, db));
      await selbstGeschuldet("2025-12-05", "eu", 0);
      expect(ustZeile(await reports.euerAusNebenbuechern(2025, db))).toBe(vorher);
      expect(ustZeile(await quelle.euerAusDemJournal(2025, db))).toBe(vorher);
      expect(abgleich.abweichungen((await abgleich.euerAbgleich(2025)).zeilen)).toEqual([]);
    }, 60_000);
  }

  // TDD-Review #598: Bis zu diesem Pull Request buchte die Sachentnahme 7 % in SKR04 auf 4630 (jetzt 4610); was dort
  // gebucht ist, zählt weiter in der Zeile der Sachentnahmen
  it("SKR04: gebuchte Sachentnahme 7 % auf 4630 zählt weiter in der EÜR", async () => {
    await reset("soll", "SKR04");
    const { withActor } = await import("../../db/actor.ts");
    const ledger = await import("../buchhaltung/ledger.ts");
    await withActor(actor, async (tx) =>
      ledger.post(tx, await ledger.openBooks(tx), {
        date: "2026-09-10",
        description: "Sachentnahme 7 %",
        sourceType: "manuell",
        sourceId: crypto.randomUUID(),
        lines: [
          { account: "2100", debit: 1_070, credit: 0, taxCode: null },
          { account: "4630", debit: 0, credit: 1_000, taxCode: "USt7" },
          { account: "3801", debit: 0, credit: 70, taxCode: "USt7" },
        ],
      }),
    );
    const zeile = (euer: { einnahmen: { key: string; amount: number }[] }) => euer.einnahmen.find((l) => l.key === "sachentnahmen")?.amount ?? 0;
    expect(zeile(await quelle.euerAusDemJournal(2026, db))).toBe(1_000);
    expect(zeile(await reports.euerAusNebenbuechern(2026, db))).toBe(1_000);
    expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
  }, 60_000);
});
