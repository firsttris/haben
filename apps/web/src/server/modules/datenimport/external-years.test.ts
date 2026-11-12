import { ACCOUNTS, documentPaymentPosting, documentPosting, invoicePaymentPosting, invoicePosting, totalsFromTaxes, type Kontenrahmen, type Versteuerung } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import type { ExternalImport } from "./external-schema.ts";

// § 11 EStG: Der Umzug ist kein Zufluss. § 16/18 UStG: Die Jahreswerte enthalten auch extern angemeldete Monate.
describe.skipIf(!testDatabaseUrl)("JSON-Umzug: Jahreswerte und offene Posten (Postgres, #634)", () => {
  let sql: postgres.Sql;
  let imports: typeof import("./external-import.ts");
  let reports: typeof import("../auswertungen/index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let annual: typeof import("../jahreserklaerung/index.ts");
  let database: typeof import("../../db/index.ts");
  const totals = totalsFromTaxes([{ rate: 1900, base: 100000, tax: 19000 }]);
  const actor = "import-pruefung";
  type Journal = Extract<ExternalImport["entries"][number], { kind: "journal" }> & { settles?: string };
  const entry = (externalId: string, date: string, lines: Journal["lines"], settles?: string): Journal => ({
    kind: "journal", externalId, date, description: `Erfundener Prüffall ${externalId}`, lines, ...(settles ? { settles } : {}),
  });
  const run = (entries: Journal[], kontenrahmen: Kontenrahmen) =>
    imports.runExternalImport(actor, { version: 2, source: "pruefung-634", kontenrahmen, entries }, async () => new Uint8Array());
  beforeAll(async () => {
    sql = await setupTestDb();
    imports = await import("./external-import.ts");
    reports = await import("../auswertungen/index.ts");
    vat = await import("../umsatzsteuer/index.ts");
    annual = await import("../jahreserklaerung/index.ts");
    database = await import("../../db/index.ts");
  }, 30000);
  afterAll(async () => {
    await database?.closeDatabase();
    await sql?.end();
  });
  async function reset(kr: Kontenrahmen, mode: Versteuerung) {
    await leeren(sql)`truncate company, journal_entries, external_imports, lexoffice_imports, vat_returns, vat_frequencies, cash_entries cascade`;
    await sql`insert into company (id,name,strasse,plz,ort,email,steuernummer,bundesland,iban,versteuerung,kontenrahmen,journal_ab)
      values (1,'Erfundener Testbetrieb','Musterweg 1','93047','Regensburg','test@example.com','198/113/10010','BY','DE89370400440532013000',${mode},${kr},2026)`;
  }
  const income = (euer: Awaited<ReturnType<typeof reports.euerForYear>>) => euer.einnahmen.find((l) => l.key === "einnahmenSteuerpflichtig")?.amount ?? 0;
  const expense = (euer: Awaited<ReturnType<typeof reports.euerForYear>>) => euer.ausgaben.find((l) => l.key === "ausgabe:edv")?.amount ?? 0;

  for (const kr of ["SKR03", "SKR04"] as const) for (const mode of ["ist", "soll"] as const) {
    it(`${kr}/${mode}: offene Quellrechnungen sind am Umzugstag keine Einnahmen oder Ausgaben`, async () => {
      await reset(kr, mode);
      await run([
        entry("AR", "2026-12-10", invoicePosting(totals, kr, mode)),
        entry("ER", "2026-12-11", documentPosting(totals, "edv", kr, "einzelunternehmen", "bank")),
      ], kr);
      const euer = await reports.euerForYear(2026);
      expect(income(euer)).toBe(0);
      expect(expense(euer)).toBe(0);
      expect(euer.gewinn).toBe(0);
      const figures = await vat.computeVatFigures({ year: 2026, month: 12 });
      expect(figures.kz81).toBe(mode === "soll" ? 100000 : 0);
      expect(figures.kz66).toBe(19000);
    });

    it(`${kr}/${mode}: Umzug zum 1.1., Vorjahresposten zählen erst mit Zahlung im Folgejahr`, async () => {
      await reset(kr, mode);
      await run([
        entry("alt-AR", "2025-12-10", invoicePosting(totals, kr, mode)),
        entry("alt-ER", "2025-12-11", documentPosting(totals, "edv", kr, "einzelunternehmen", "bank")),
      ], kr);
      expect(income(await reports.euerForYear(2025))).toBe(0);
      expect((await vat.computeVatFigures({ year: 2025, month: 12 })).kz81).toBe(0);
      // Eigene Quellidentitäten statt Belegnummer, auch bei einer späteren Importdatei.
      const payments = [
        entry("alt-AR-teil", "2026-01-15", invoicePaymentPosting(totals, 59500, kr, mode), "alt-AR"),
        entry("alt-AR-rest", "2026-02-15", invoicePaymentPosting(totals, 59500, kr, mode), "alt-AR"),
        entry("alt-ER-zahlung", "2026-02-16", documentPaymentPosting(-119000, kr), "alt-ER"),
      ];
      await run(payments, kr);
      expect((await run(payments, kr)).duplicates).toBe(3);
      const euer = await reports.euerForYear(2026);
      expect(income(euer)).toBe(100000);
      expect(expense(euer)).toBe(100000);
      expect(euer.monthly.einnahmen.slice(0, 2)).toEqual([50000, 50000]);
      expect(euer.gewinn).toBe(0);
      const yearly = await annual.annualOverview(2026, "2027-03-01");
      expect(yearly.ust.figures.base19).toBe(mode === "ist" ? 100000 : 0);
      expect(yearly.ust.figures.vorsteuer).toBe(0);
      expect(await sql`select id from invoices union all select id from documents`).toHaveLength(0);
      expect(await sql`select id from journal_entries`).toHaveLength(5);
    });

    it(`${kr}/${mode}: Umzug mitten im Jahr, bereits extern abgegebener Monat bleibt versiegelt`, async () => {
      await reset(kr, mode);
      await run([entry("januar", "2026-01-15", invoicePosting(totals, kr, "soll").map((l) => l.account === ACCOUNTS[kr].forderungen ? { ...l, account: ACCOUNTS[kr].bank } : l))], kr);
      const january = { year: 2026, month: 1 };
      const draft = await vat.saveDraft(actor, january, { mode: "berechnet" });
      const filed = await vat.vermerkeAbgabe(actor, draft.id, {
        filedOn: "2026-02-10", transferTicket: "extern-pruefung-634", kz83: 19000,
        file: { filename: "extern.pdf", bytes: new TextEncoder().encode("%PDF-1.4\n%%EOF") },
      }, "2026-02-10");
      // Nachgelieferte Originalbuchung: Jahreswerte ändern sich, der Abgabestand nicht.
      await run([
        entry("januar-nachtrag", "2026-01-20", invoicePosting(totals, kr, "soll").map((l) => l.account === ACCOUNTS[kr].forderungen ? { ...l, account: ACCOUNTS[kr].bank } : l)),
        entry("juli", "2026-07-15", invoicePosting(totals, kr, "soll").map((l) => l.account === ACCOUNTS[kr].forderungen ? { ...l, account: ACCOUNTS[kr].bank } : l)),
      ], kr);
      expect((await annual.annualOverview(2026, "2027-03-01")).ust.figures.base19).toBe(300000);
      expect(income(await reports.euerForYear(2026))).toBe(300000);
      expect((await vat.returnsForPeriod(january))[0]).toMatchObject({ id: filed.id, status: "sent", kz81: 100000, kz83: 19000 });
      await expect(vat.saveDraft(actor, january, { mode: "berechnet" })).rejects.toThrow(/berichtigte/);
      await expect(sql`update vat_returns set kz81 = 200000 where id = ${filed.id}`).rejects.toThrow(/festgeschrieben/);
      const correction = await vat.createCorrection(actor, january);
      expect(correction.correctsId).toBe(filed.id);
    });
  }
});
