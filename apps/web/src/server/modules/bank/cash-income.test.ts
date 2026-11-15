import { parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Bareinnahme ohne Rechnung im Kassenbuch (#276), etwa die Tagessumme eines Marktstands: Kasse an Erlöse am Tag der
 * Bareinnahme mit Steuerbehandlung (regulär 19 % oder 7 %, Kleinunternehmer, steuerfrei nach § 4 Nr. 8 bis 29 UStG),
 * fortlaufende Nummer, Notiz, Storno als Gegenzeile. Voranmeldung, EÜR, Abgleich Journal gegen Nebenbücher und DATEV;
 * SKR03 und SKR04, Ist und Soll.
 */

describe.skipIf(!testDatabaseUrl)("Bareinnahme ohne Rechnung (Postgres, #276)", () => {
  let cash: typeof import("./index.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let datev: typeof import("../auswertungen/datev-export.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const today = "2026-12-15";

  beforeAll(async () => {
    sql = await setupTestDb();
    cash = await import("./index.ts");
    reports = await import("../auswertungen/reports.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
    datev = await import("../auswertungen/datev-export.ts");
    annual = await import("../jahreserklaerung/annual.ts");
    figures = await import("../umsatzsteuer/vat-figures.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", kleinunternehmer = false) {
    await leeren(sql)`truncate write_offs, allocations, cash_entries, journal_lines, journal_entries, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, kleinunternehmer,
                                   datev_berater_nr, datev_mandant_nr)
      values (1, 'Glühwein & Kerzen', 'Marktplatz 1', '93047', 'Regensburg', 'stand@example.com', '198/113/10010', 'BY',
              ${kontenrahmen}, ${versteuerung}, ${kleinunternehmer}, '29098', '55003')`;
  }

  async function salden() {
    const rows = await sql<{ account: string; saldo: number }[]>`
      select account, sum(debit - credit)::int as saldo from journal_lines group by account having sum(debit - credit) <> 0 order by account`;
    return Object.fromEntries(rows.map((r) => [r.account, r.saldo]));
  }

  const keineAbweichung = async (year: number, month: number) => {
    expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year, month })).zeilen)).toEqual([]);
    expect(abgleich.abweichungen((await abgleich.euerAbgleich(year)).zeilen)).toEqual([]);
    const zeilen = await sql`select id::text from cash_entries union all select id::text from journal_entries`;
    const ids = new Set(zeilen.map((z) => z.id));
    expect((await sql`select art, befund, zeile::text from haben_integrity_problems(1000)`).filter((p) => ids.has(p.zeile))).toEqual([]);
  };

  it.each([
    ["SKR03", "ist", { kasse: "1000", erloese: "8400", ust: "1776" }],
    ["SKR03", "soll", { kasse: "1000", erloese: "8400", ust: "1776" }],
    ["SKR04", "ist", { kasse: "1600", erloese: "4400", ust: "3806" }],
    ["SKR04", "soll", { kasse: "1600", erloese: "4400", ust: "3806" }],
  ] as const)("%s, %s: Tagessumme vom Markt mit 19 %, Storno als Gegenzeile", async (kr, versteuerung, k) => {
    await firma(kr, versteuerung);
    const entry = await cash.createCashIncome(
      actor,
      { date: "2026-11-28", amount: 342_50, text: "Weihnachtsmarkt 28.11., Tagessumme", steuer: { behandlung: "regulaer", steuersatz: 1900 } },
      today,
    );
    expect(entry).toMatchObject({ number: 1, kind: "einnahme", amount: 342_50, taxTreatment: "regulaer", taxRate: 1900 });

    // Fällige Umsatzsteuer, kein „nicht fällig“ auch bei Ist; gesperrt und versiegelt
    expect(await salden()).toEqual({ [k.kasse]: 342_50, [k.erloese]: -287_82, [k.ust]: -54_68 });
    const [journal] = await sql`select description, date::text, locked_at from journal_entries`;
    expect(journal).toMatchObject({ description: "Weihnachtsmarkt 28.11., Tagessumme · 19 %", date: "2026-11-28" });
    expect(journal!.locked_at).not.toBeNull();
    await expect(sql`update cash_entries set tax_rate = 700 where id = ${entry.id}`).rejects.toThrow();
    expect(await sql`select count(*)::int as n from seals where table_name = 'cash_entries' and row_id = ${entry.id}`).toEqual([{ n: 1 }]);

    // Voranmeldung November: Kz 81 am Tag der Bareinnahme, bei Ist wie bei Soll
    const november = await figures.computeVatFigures({ year: 2026, month: 11 });
    expect([november.kz81, november.tax81, november.kz48]).toEqual([287_82, 54_68, 0]);
    expect(november.revenue).toMatchObject([{ type: "kasse", cashEntryId: entry.id, date: "2026-11-28", rate: 1900, base: 287_82, tax: 54_68 }]);

    // EÜR und Anlage EÜR: steuerpflichtige Einnahme netto und vereinnahmte Umsatzsteuer
    const euer = await reports.euerForYear(2026);
    expect(euer.einnahmen.find((l) => l.key === "einnahmenSteuerpflichtig")?.amount).toBe(287_82);
    expect(euer.einnahmen.find((l) => l.key === "vereinnahmteUst")?.amount).toBe(54_68);
    const year = await annual.euerYear(2026);
    expect([year.figures.steuerpflichtig, year.figures.vereinnahmteUst]).toEqual([287_82, 54_68]);
    await keineAbweichung(2026, 11);

    // DATEV: Erlös auf dem Automatikkonto mit BU 40 wie eine Direktbuchung im Bankabgleich, die Steuer ohne Schlüssel
    const stack = parseDatevBuchungsstapel((await datev.datevExport(2026)).bytes);
    expect(stack.bookings.map((b) => `${b.account}/${b.contraAccount}/${b.buKey}/${b.amount}`).sort()).toEqual(
      [`${k.kasse}/${k.erloese}/40/28782`, `${k.kasse}/${k.ust}//5468`].sort(),
    );

    // Kassenbuch zeigt Art und Behandlung
    const book = await cash.cashBook(2026);
    expect(book.entries[0]).toMatchObject({ kind: "einnahme", text: "Weihnachtsmarkt 28.11., Tagessumme", taxTreatment: "regulaer", taxRate: 1900 });
    expect(await cash.cashBookCsv(2026)).toContain(`;"Bareinnahme";"Weihnachtsmarkt 28.11., Tagessumme";342,50;;342,50;`);

    // Storno: Gegenzeile mit heutigem Datum und neuer Nummer, Gegenbuchung; im Dezember mindert er Kz 81
    const storno = await cash.reverseCashEntry(actor, entry.id, today);
    expect(storno).toMatchObject({ number: 2, kind: "einnahme", amount: -342_50, taxTreatment: "regulaer", taxRate: 1900, reversesId: entry.id, date: today });
    expect(await salden()).toEqual({});
    const dezember = await figures.computeVatFigures({ year: 2026, month: 12 });
    expect([dezember.kz81, dezember.tax81]).toEqual([-287_82, -54_68]);
    expect((await reports.euerForYear(2026)).einnahmen.find((l) => l.key === "einnahmenSteuerpflichtig")?.amount).toBe(0);
    await keineAbweichung(2026, 12);
    await expect(cash.reverseCashEntry(actor, entry.id, today)).rejects.toThrow(/bereits storniert/);
  });

  it.each([
    ["SKR03", "ist", { kasse: "1000", erloese: "8300", ust: "1771", frei: "8100" }],
    ["SKR04", "soll", { kasse: "1600", erloese: "4300", ust: "3801", frei: "4100" }],
  ] as const)("%s, %s: 7 % in Kz 86, steuerfrei nach § 4 Nr. 8 bis 29 in Kz 48", async (kr, versteuerung, k) => {
    await firma(kr, versteuerung);
    await cash.createCashIncome(
      actor,
      { date: "2026-10-03", amount: 10_70, text: "Bücherflohmarkt", steuer: { behandlung: "regulaer", steuersatz: 700 } },
      today,
    );
    await cash.createCashIncome(
      actor,
      { date: "2026-10-05", amount: 80_00, text: "Nachhilfe bar", steuer: { behandlung: "steuerfrei", steuersatz: 0 } },
      today,
    );
    expect(await salden()).toEqual({ [k.kasse]: 90_70, [k.erloese]: -10_00, [k.ust]: -70, [k.frei]: -80_00 });
    const oktober = await figures.computeVatFigures({ year: 2026, month: 10 });
    expect([oktober.kz86, oktober.tax86, oktober.kz48, oktober.kz81]).toEqual([10_00, 70, 80_00, 0]);
    const euer = await reports.euerForYear(2026);
    expect(euer.einnahmen.find((l) => l.key === "einnahmenSteuerpflichtig")?.amount).toBe(10_00);
    expect(euer.einnahmen.find((l) => l.key === "einnahmenSteuerfrei")?.amount).toBe(80_00);
    await keineAbweichung(2026, 10);
  });

  it("Kleinunternehmer: ohne Umsatzsteuer; regulär besteuert abgelehnt, als Nicht-Kleinunternehmer umgekehrt", async () => {
    await firma("SKR03", "ist", true);
    const steuer = { behandlung: "regulaer", steuersatz: 1900 } as const;
    await expect(cash.createCashIncome(actor, { date: "2026-11-28", amount: 50_00, text: "Markt", steuer }, today)).rejects.toThrow(/§ 19 UStG/);
    await cash.createCashIncome(actor, { date: "2026-11-28", amount: 50_00, text: "Markt", steuer: { behandlung: "kleinunternehmer", steuersatz: 0 } }, today);
    expect(await salden()).toEqual({ "1000": 50_00, "8192": -50_00 });
    const euer = await reports.euerForYear(2026);
    expect(euer.einnahmen.find((l) => l.key === "einnahmenKleinunternehmer")?.amount).toBe(50_00);
    expect((await figures.computeVatFigures({ year: 2026, month: 11 })).kz81).toBe(0);
    await keineAbweichung(2026, 11);

    await firma("SKR04", "soll");
    await expect(
      cash.createCashIncome(actor, { date: "2026-11-28", amount: 50_00, text: "Markt", steuer: { behandlung: "kleinunternehmer", steuersatz: 0 } }, today),
    ).rejects.toThrow(/nicht Kleinunternehmer/);
    await expect(
      cash.createCashIncome(actor, { date: "2026-11-28", amount: 50_00, text: "Markt", steuer: { behandlung: "regulaer", steuersatz: 0 } }, today),
    ).rejects.toThrow(/19 % oder 7 %/);
    await expect(cash.createCashIncome(actor, { date: "2026-12-16", amount: 50_00, text: "Markt", steuer }, today)).rejects.toThrow(/Zukunft/);
    await expect(cash.createCashIncome(actor, { date: "2026-11-28", amount: 50_00, text: " ", steuer }, today)).rejects.toThrow(/Notiz/);
    expect(await sql`select count(*)::int as n from cash_entries`).toEqual([{ n: 0 }]);
  });

  it("Datenbank: eine Bareinnahme braucht Behandlung und Steuersatz, andere Arten haben keine", async () => {
    await firma("SKR03", "soll");
    await expect(sql`insert into cash_entries (number, date, amount, kind, text) values (1, '2026-11-01', 100, 'einnahme', 'x')`).rejects.toThrow(
      /cash_entries_einnahme/,
    );
    await expect(
      sql`insert into cash_entries (number, date, amount, kind, text, tax_treatment, tax_rate) values (1, '2026-11-01', 100, 'einlage', 'x', 'regulaer', 1900)`,
    ).rejects.toThrow(/cash_entries_einnahme/);
  });
});
