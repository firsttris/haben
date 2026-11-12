import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Weitere Ausgabekategorien (Roadmap Platz 1, #312) mit Postgres: Beleg buchen und bezahlen, Voranmeldung, EÜR, Anlage
 * EÜR und Abgleich. Konten nach DATEV-Kontenrahmen 2026; Zeilen nach dem Vordruck der Anlage EÜR 2025 (BMF-Schreiben vom
 * 29.08.2025). SKR03 und SKR04, Ist und Soll.
 */

const KATEGORIEN = {
  miete: { SKR03: "4210", SKR04: "6310", zeile: "miete" },
  betriebsbedarf: { SKR03: "4980", SKR04: "6850", zeile: "uebrige" },
  reparatur: { SKR03: "4805", SKR04: "6470", zeile: "erhaltung" },
  kfzSonstige: { SKR03: "4580", SKR04: "6570", zeile: "kfzSonstige" },
  berufsgenossenschaft: { SKR03: "4138", SKR04: "6120", zeile: "personal" },
  versorgungskassen: { SKR03: "4160", SKR04: "6150", zeile: "personal" },
} as const;

type Kategorie = keyof typeof KATEGORIEN;

describe.skipIf(!testDatabaseUrl)("Weitere Ausgabekategorien (Postgres)", () => {
  let documents: typeof import("./documents.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let fileSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
    figures = await import("../umsatzsteuer/vat-figures.ts");
    reports = await import("../auswertungen/reports.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
    annual = await import("../jahreserklaerung/annual.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await leeren(sql)`truncate document_cancellations, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, cash_entries,
      journal_lines, journal_entries, document_splits, document_amounts, documents, vat_returns, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, versteuerung, kontenrahmen, einkunftsart, taetigkeit)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', ${versteuerung},
              ${kontenrahmen}, 'gewerbe', 'Softwareentwicklung')`;
  }

  /** Beleg über 100 € netto und 19 € Vorsteuer, privat bezahlt (Abfluss am Belegdatum) */
  async function beleg(category: Kategorie, date = "2026-06-10") {
    fileSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, fileSeq % 256, 31, 2]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${fileSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant GmbH",
      supplierUstId: "",
      invoiceNumber: `R-${fileSeq}`,
      documentDate: date,
      dueDate: null,
      category,
      payment: "privat",
      note: "",
      reverseCharge: null,
      asset: null,
      amounts: [{ taxRate: 1900, net: 100_00, tax: 19_00 }],
    } as Parameters<typeof documents.updateDocument>[2]);
    await documents.bookDocument(actor, id);
    return id;
  }

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("%s, %s: je Kategorie Aufwandskonto, Vorsteuer, EÜR-Zeile und Zeile der Anlage EÜR", async (kr, versteuerung) => {
    await reset(kr, versteuerung);
    for (const kategorie of Object.keys(KATEGORIEN) as Kategorie[]) await beleg(kategorie);

    const aufwand = await sql<{ account: string; saldo: number }[]>`
      select l.account, sum(l.debit - l.credit)::int as saldo from journal_lines l group by l.account order by l.account`;
    const salden = Object.fromEntries(aufwand.map((r) => [r.account, r.saldo]));
    for (const { [kr]: konto } of Object.values(KATEGORIEN)) expect(salden[konto], konto).toBe(100_00);

    expect((await figures.computeVatFigures({ year: 2026, month: 6 })).kz66).toBe(6 * 19_00);

    const euer = await reports.euerForYear(2026);
    for (const kategorie of Object.keys(KATEGORIEN)) expect(euer.ausgaben.find((l) => l.key === `ausgabe:${kategorie}`)?.amount, kategorie).toBe(100_00);

    // Anlage EÜR: Berufsgenossenschaft und Versorgungskassen beim Personal, sonstige Kfz-Kosten bei den Fahrtkosten, Miete in
    // Zeile 39, Reparatur in Zeile 48, Betriebsbedarf bei den übrigen Betriebsausgaben
    const { figures: anlage } = await annual.euerYear(2026);
    expect(anlage.personal).toBe(200_00);
    expect(anlage.kfzSonstige).toBe(100_00);
    expect([anlage.miete, anlage.erhaltung, anlage.uebrige]).toEqual([100_00, 100_00, 100_00]);
    expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2026, month: 6 })).zeilen)).toEqual([]);
    expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
  });
});
