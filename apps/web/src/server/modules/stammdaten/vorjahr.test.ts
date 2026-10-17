import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/**
 * Umstellung zum Jahreswechsel: Wer zum 1. Januar Kleinunternehmer wird, schuldet die Voranmeldung für Dezember und die
 * Umsatzsteuererklärung des Vorjahres trotzdem. Vorher richtete sich alles nach der heutigen Einstellung: Die Fristen
 * verschwanden, die Übersicht zeigte keine Voranmeldung, die Umsatzsteuererklärung des Vorjahres war gesperrt.
 */
describe.skipIf(!testDatabaseUrl)("Kleinunternehmer ab dem neuen Jahr, Vorjahr regulär (Postgres)", () => {
  let sql: postgres.Sql;
  let company: typeof import("./company.ts");
  let fristen: typeof import("../finanzamt/fristen.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  // Das Änderungsprotokoll trägt die echte Uhrzeit; „heute“ ist also dieses Jahr, das Vorjahr davor
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
  const year = Number(today.slice(0, 4));
  const vorjahr = year - 1;

  beforeAll(async () => {
    sql = await setupTestDb();
    company = await import("./company.ts");
    fristen = await import("../finanzamt/fristen.ts");
    annual = await import("../jahreserklaerung/annual.ts");
    figures = await import("../umsatzsteuer/vat-figures.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate journal_lines, journal_entries, vat_return_submissions, vat_returns, annual_submissions, company cascade`;
    // Firmendaten angelegt (regulär), im Vorjahr gebucht, dann zum neuen Jahr auf Kleinunternehmer umgestellt
    await sql`insert into company (id, name, strasse, plz, ort, steuernummer, bundesland, kleinunternehmer)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', '198/113/10010', 'BY', false)`;
    await sql.begin(async (tx) => {
      const [e] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values (${`${vorjahr}-12-10`}, 'Rechnung', 'invoice', gen_random_uuid(), 'SKR03') returning id`;
      await tx`insert into journal_lines (entry_id, account, debit, credit, tax_code) values
        (${e!.id}, '1400', 11900, 0, null), (${e!.id}, '8400', 0, 10000, 'USt19'), (${e!.id}, '1776', 0, 1900, 'USt19')`;
      await tx`update journal_entries set locked_at = now() where id = ${e!.id}`;
    });
    await sql`update company set kleinunternehmer = true`;
  });

  it("der Stand im Jahr bzw. Monat zählt, nicht der heutige", async () => {
    expect((await company.loadCompany()).kleinunternehmer).toBe(true);
    expect(await company.kleinunternehmerForYear(vorjahr)).toBe(false);
    expect(await company.kleinunternehmerForYear(year)).toBe(true);
    expect(await company.kleinunternehmerForMonth(vorjahr, 12)).toBe(false);
    expect(await company.kleinunternehmerForMonth(year, Number(today.slice(5, 7)))).toBe(true);
  });

  it("Fristen: Voranmeldung Dezember und Umsatzsteuererklärung des Vorjahres bleiben, ab der Umstellung keine Voranmeldung", async () => {
    const list = await fristen.listFristen(today);
    const ids = new Set(list.map((f) => f.id));
    expect(ids.has(`ustva-${vorjahr}-12`)).toBe(true);
    expect(ids.has(`ust-${vorjahr}`)).toBe(true);
    // Das Protokoll kennt die Umstellung mit dem heutigen Datum: ab diesem Monat keine Voranmeldung mehr
    expect(ids.has(`ustva-${today.slice(0, 7)}`)).toBe(false);
    expect(ids.has(`ust-${year}`)).toBe(false);
  });

  it("Voranmeldung Dezember: nicht als Kleinunternehmer markiert", async () => {
    expect((await figures.computeVatFigures({ year: vorjahr, month: 12 })).kleinunternehmer).toBe(false);
    expect((await figures.computeVatFigures({ year, month: Number(today.slice(5, 7)) })).kleinunternehmer).toBe(true);
  });

  it("Umsatzsteuererklärung des Vorjahres ist nicht als Kleinunternehmer gesperrt", async () => {
    const overview = await annual.annualOverview(vorjahr, `${year}-03-01`);
    expect(overview.ust.issues.map((i) => i.text).join(" ")).not.toMatch(/Als Kleinunternehmer/);
    if (year >= 2025) {
      const current = await annual.annualOverview(year, `${year + 1}-03-01`);
      expect(current.ust.issues.map((i) => i.text).join(" ")).toMatch(/Als Kleinunternehmer gibst du ab 2024 keine Umsatzsteuererklärung/);
    }
  });
});

describe.skipIf(!testDatabaseUrl)("Meldungen der Datenbank-Trigger (Postgres)", () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  it("kommen als Klartext beim Nutzer an statt als „Interner Fehler“", async () => {
    const { db, schema } = await import("../../db/index.ts");
    const { userMessage } = await import("../../errors.ts");
    const { eq } = await import("drizzle-orm");
    const year = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()).slice(0, 4);
    await sql`truncate journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, kontenrahmen) values (1, 'SKR03')`;
    await sql.begin(async (tx) => {
      const [e] = await tx`insert into journal_entries (date, description, source_type, source_id, kontenrahmen)
        values (${`${year}-02-01`}, 'Test', 'invoice', gen_random_uuid(), 'SKR03') returning id`;
      await tx`insert into journal_lines (entry_id, account, debit, credit) values (${e!.id}, '1400', 100, 0), (${e!.id}, '8400', 0, 100)`;
      await tx`update journal_entries set locked_at = now() where id = ${e!.id}`;
    });
    // So wie aus der App: über Drizzle, der den Fehler des Treibers verpackt
    const error = await db
      .update(schema.company)
      .set({ kontenrahmen: "SKR04" })
      .where(eq(schema.company.id, 1))
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).not.toBeNull();
    expect(userMessage(error)).toBe(
      `Im Jahr ${year} gibt es schon Buchungen. Kontenrahmen, Versteuerung und Kleinunternehmer lassen sich nur zum Jahreswechsel umstellen, bevor im neuen Jahr gebucht wird.`,
    );
    // Verletzte CHECK-Constraint bleibt intern
    const check = await db
      .insert(schema.journalLines)
      .values({ entryId: "00000000-0000-0000-0000-000000000000", account: "1", debit: -1, credit: 0 })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(check).not.toBeNull();
    expect(userMessage(check)).toBeUndefined();
  });
});
