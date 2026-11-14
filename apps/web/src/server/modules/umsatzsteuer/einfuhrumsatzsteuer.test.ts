import { computeUstva, ebilanzPosition, postenForSaldo } from "@haben/core";
import { buildUstvaXml } from "@haben/elster";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Einfuhrumsatzsteuer (Roadmap Platz 13, Kz 62): Beleg der Kategorie „Einfuhrumsatzsteuer“ (Bescheid des Zolls), gebucht
 * auf „Entstandene Einfuhrumsatzsteuer“ (DATEV-Kontenrahmen 2026: SKR03 1588, SKR04 1433), in der Voranmeldung nach
 * Belegdatum als Kz 62 (§ 15 Abs. 1 Satz 1 Nr. 2 UStG), in der EÜR als gezahlte Vorsteuer bei Zahlung. SKR03 und SKR04,
 * Ist und Soll, Kleinunternehmer abgelehnt.
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

describe.skipIf(!testDatabaseUrl)("Einfuhrumsatzsteuer (Postgres)", () => {
  let documents: typeof import("../belege/documents.ts");
  let figures: typeof import("./vat-figures.ts");
  let bank: typeof import("../bank/bank.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let fileSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("../belege/documents.ts");
    figures = await import("./vat-figures.ts");
    bank = await import("../bank/bank.ts");
    reports = await import("../auswertungen/reports.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
    annual = await import("../jahreserklaerung/annual.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", kleinunternehmer = false) {
    await leeren(sql)`truncate document_cancellations, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, cash_entries,
      journal_lines, journal_entries, document_amounts, documents, vat_returns, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen,
              kleinunternehmer)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010', 'DE136695976', 'BY',
              'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, ${kleinunternehmer})`;
  }

  async function zollbescheid(amounts: { taxRate: 0 | 1900; net: number; tax: number }[], date = "2026-09-15") {
    fileSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, fileSeq % 256, 7, 62]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `zoll-${fileSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Hauptzollamt Regensburg",
      supplierUstId: "",
      invoiceNumber: `ATB-${fileSeq}`,
      documentDate: date,
      dueDate: null,
      category: "einfuhrumsatzsteuer",
      payment: "bank",
      note: "",
      reverseCharge: null,
      asset: null,
      amounts,
    } as Parameters<typeof documents.updateDocument>[2]);
    return id;
  }

  it.each([
    ["SKR03", "ist", "1588", "1600", "1200"],
    ["SKR04", "soll", "1433", "3300", "1800"],
  ] as const)("%s, %s: Bescheid gebucht, Kz 62 im Monat des Bescheids, EÜR bei Zahlung", async (kr, versteuerung, konto, verbindlichkeiten, bankKonto) => {
    await reset(kr, versteuerung);
    const id = await zollbescheid([{ taxRate: 0, net: 380_00, tax: 0 }]);
    await documents.bookDocument(actor, id);
    const lines = await sql`select l.account, l.debit, l.credit, l.tax_code from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_type = 'document' order by l.debit desc`;
    expect(lines.map((l) => [l.account, l.debit, l.credit, l.tax_code])).toEqual([
      [konto, 380_00, 0, "EUSt"],
      [verbindlichkeiten, 0, 380_00, null],
    ]);
    // Voranmeldung September: Kz 62, keine Vorsteuer in Kz 66, Kz 83 um die Einfuhrumsatzsteuer gemindert
    const september = await figures.computeVatFigures({ year: 2026, month: 9 });
    expect(september).toMatchObject({ kz62: 380_00, kz66: 0, kz81: 0 });
    const ustva = computeUstva({ ...september });
    expect(ustva.kz83).toBe(-380_00);
    expect(
      buildUstvaXml({
        period: { year: 2026, month: 9 },
        steuernummer13: "9198011310010",
        figures: ustva,
        datenlieferant: { name: "Testfirma", strasse: "Musterstraße 1", plz: "93047", ort: "Regensburg" },
        herstellerId: "00000",
        produktVersion: "1",
        test: true,
      }),
    ).toContain("<Kz62>380.00</Kz62>");
    expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2026, month: 9 })).zeilen)).toEqual([]);
    // Bezahlt im Oktober: in der EÜR gezahlte Vorsteuer, keine Betriebsausgabe
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([["05.10.26", "05.10.26", "Gebucht", "Testfirma", "Hauptzollamt Regensburg", "ATB", "Ausgang", "", "-380,00", "", "", ""]]),
        filename: "zoll.csv",
      },
      null,
    );
    const [t] = await sql`select id from bank_transactions`;
    await bank.allocate(actor, { kind: "document", transactionId: t!.id, documentId: id, amount: -380_00 });
    const euer = await reports.euerForYear(2026);
    expect(euer.ausgaben.find((l) => l.key === "vorsteuer")?.amount).toBe(380_00);
    expect(euer.gewinn).toBe(-380_00);
    expect(euer.ausgaben.filter((l) => l.key.startsWith("ausgabe:"))).toEqual([]);
    const salden =
      await sql`select l.account, sum(l.debit - l.credit)::int as saldo from journal_lines l group by l.account having sum(l.debit - l.credit) <> 0 order by l.account`;
    for (const { account, saldo } of salden) {
      expect(postenForSaldo(kr, account, saldo), account).not.toBeNull();
      expect(ebilanzPosition(kr, account, saldo), account).not.toBeNull();
    }
    expect(salden.find((s) => s.account === bankKonto)?.saldo).toBe(-380_00);
    // Die Jahreserklärung übernimmt die Einfuhrumsatzsteuer als Kz 62 und sperrt deshalb nicht mehr
    const ust = await annual.ustYear(2026);
    expect(ust.figures.kz62).toBe(380_00);
    expect(annual.ustIssues(false, ust, 2026).every((i) => i.tone !== "fehler")).toBe(true);
  });

  it("lehnt einen Bescheid mit Steuersatz und als Kleinunternehmer ab", async () => {
    await reset("SKR03", "ist");
    const mitSatz = await zollbescheid([{ taxRate: 1900, net: 2000_00, tax: 380_00 }]);
    await expect(documents.bookDocument(actor, mitSatz)).rejects.toThrow(/als ein Betrag zu 0 %/);
    await reset("SKR03", "ist", true);
    const ku = await zollbescheid([{ taxRate: 0, net: 380_00, tax: 0 }]);
    await expect(documents.bookDocument(actor, ku)).rejects.toThrow(/Ohne Vorsteuerabzug/);
    expect(await sql`select id from journal_entries`).toEqual([]);
  });
});
