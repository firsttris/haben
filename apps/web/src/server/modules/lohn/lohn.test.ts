import { lohnabrechnung } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import type { EmployeeInput } from "./employees.ts";

/*
 * Lohnabrechnung mit Postgres: Entwürfe aus den Stammdaten, Festschreiben mit PDF, Sperre und Siegel, Storno mit neuer
 * Abrechnung, Audit-Log und Lohnkonto (docs/lohn-plan.md, PR 3).
 */

const GGF: EmployeeInput = {
  vorname: "Erika",
  nachname: "Muster",
  strasse: "Lindenweg 1",
  plz: "28195",
  ort: "Bremen",
  geburtsdatum: "1980-04-12",
  steuerId: "86095742719",
  steuerklasse: 1,
  konfession: "ev",
  art: "ggf",
  monatsgehalt: 6000_00,
  krankenversicherung: "gesetzlich",
  zusatzbeitrag: 290,
  kinderlosenzuschlag: true,
  statusfeststellung: "versicherungsfrei",
  eintritt: "2024-01-01",
  iban: "DE89 3704 0044 0532 0130 00",
};

const ANGESTELLT: EmployeeInput = {
  ...GGF,
  vorname: "Max",
  nachname: "Beispiel",
  steuerId: "47291830467",
  konfession: null,
  art: "beschaeftigt",
  monatsgehalt: 4000_00,
  krankenkasse: "Techniker Krankenkasse",
  krankenkasseBetriebsnummer: "15027365",
  kinderlosenzuschlag: false,
  kinderUnter25: 1,
  u1Satz: 160,
  u2Satz: 44,
  personengruppe: "101",
  beitragsgruppen: "1111",
  taetigkeitsschluessel: "431143111",
  svNummer: "12120480m123",
  statusfeststellung: "",
};

describe.skipIf(!testDatabaseUrl)("Lohnabrechnung (Postgres)", () => {
  let lohn: typeof import("./index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const heute = "2026-10-27";
  const oktober = { year: 2026, month: 10, zahltag: "2026-10-28" };

  beforeAll(async () => {
    sql = await setupTestDb();
    lohn = await import("./index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate payslip_cancellations, payslips, payroll_runs, employees, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht Software GmbH', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR04', 'soll', 'gmbh')`;
  });

  async function payslipsOf(employeeId: string) {
    return sql<{ id: string; locked_at: Date | null; replaces_id: string | null; lohnsteuer: number; netto: number; brutto: number }[]>`
      select id, locked_at, replaces_id, lohnsteuer, netto, brutto from payslips where employee_id = ${employeeId} order by created_at`;
  }

  it("legt Entwürfe aus den Stammdaten an, mit denselben Werten wie die Rechnung in @haben/core", async () => {
    const id = await lohn.saveEmployee(actor, null, GGF);
    expect(await lohn.abrechnen(actor, oktober)).toEqual({ angelegt: 1, fehler: [] });
    const [p] = await payslipsOf(id);
    const erwartet = lohnabrechnung({
      jahr: 2026,
      monat: 10,
      bundesland: "HB",
      stammdaten: {
        art: "ggf",
        monatsgehalt: 6000_00,
        eintritt: "2024-01-01",
        austritt: null,
        steuerklasse: 1,
        faktor: 1000,
        kinderfreibetraege: 0,
        konfession: "ev",
        kv: { art: "gesetzlich", zusatzbeitrag: 290 },
        pflege: { kinderlosenzuschlag: true, kinderUnter25: 0 },
        umlagen: { u1: null, u2: 0 },
        minijob: { rvBefreit: false, pauschsteuer: true },
      },
    });
    expect(erwartet.ok && [p!.brutto, p!.lohnsteuer, p!.netto]).toEqual(erwartet.ok && [erwartet.brutto, erwartet.lohnsteuer, erwartet.netto]);
    // BMF-Steuerrechner: 1.289,33 € Lohnsteuer (siehe lohnabrechnung.test.ts)
    expect(p!.lohnsteuer).toBe(1289_33);
    // Ein zweiter Lauf legt nichts doppelt an
    expect(await lohn.abrechnen(actor, oktober)).toEqual({ angelegt: 0, fehler: [] });
    // Audit-Log: Mitarbeiter, Lohnlauf und Abrechnung
    const audit = await sql`select table_name, action from audit_log where table_name in ('employees', 'payroll_runs', 'payslips') order by seq`;
    expect(audit.map((a) => `${a.table_name}:${a.action}`)).toEqual(["employees:INSERT", "payroll_runs:INSERT", "payslips:INSERT"]);
  });

  // Hinter dem ersten Test: dessen Audit-Log erwartet nur seinen eigenen Mitarbeiter
  it("kennt Mitarbeiter erst ab dem ersten angelegten, ausgetretene zählen mit (Menüpunkt SV-Meldeportal)", async () => {
    expect(await lohn.hasEmployees()).toBe(false);
    await lohn.saveEmployee(actor, null, { ...GGF, austritt: "2025-12-31" });
    expect(await lohn.hasEmployees()).toBe(true);
  });

  it("legt für einen Teilmonat keinen Entwurf an und nennt den Grund", async () => {
    await lohn.saveEmployee(actor, null, { ...GGF, eintritt: "2026-10-15" });
    const r = await lohn.abrechnen(actor, oktober);
    expect(r.angelegt).toBe(0);
    expect(r.fehler).toEqual([{ name: "Erika Muster", meldung: "Ein Teilmonat (Eintritt oder Austritt im Oktober 2026) ist nicht unterstützt." }]);
    const uebersicht = await lohn.monatsuebersicht(2026, 10);
    expect(uebersicht.zeilen[0]?.vorschau).toMatchObject({ ok: false, grund: "nicht-unterstuetzt" });
  });

  it("schreibt fest mit PDF, sperrt und versiegelt; Änderungen lehnt die Datenbank ab", async () => {
    const id = await lohn.saveEmployee(actor, null, GGF);
    await lohn.abrechnen(actor, oktober);
    const [p] = await payslipsOf(id);
    await lohn.festschreiben(actor, { id: p!.id }, heute);
    const [row] = await sql`select locked_at, sha256, substring(pdf from 1 for 5) as head from payslips where id = ${p!.id}`;
    expect(row!.locked_at).not.toBeNull();
    expect(Buffer.from(row!.head).toString("latin1")).toBe("%PDF-");
    expect(await sql`select count(*)::int as n from seals where table_name = 'payslips' and row_id = ${p!.id}`).toEqual([{ n: 1 }]);
    await expect(sql`update payslips set netto = 1 where id = ${p!.id}`).rejects.toThrow(/festgeschrieben/);
    await expect(sql`delete from payslips where id = ${p!.id}`).rejects.toThrow(/festgeschrieben/);
    await expect(lohn.entwurfNeuBerechnen(actor, { id: p!.id })).rejects.toThrow(/festgeschrieben/);
    expect(await sql`select art, befund from haben_integrity_problems(100) where zeile = ${p!.id}::text`).toEqual([]);
    // Das PDF zum Herunterladen ist das gespeicherte
    const datei = await lohn.abrechnungDatei(p!.id, "2026-12-01");
    const [gespeichert] = await sql`select pdf from payslips where id = ${p!.id}`;
    expect(Buffer.from(datei!.data).equals(gespeichert!.pdf)).toBe(true);
    expect(datei!.filename).toBe("Entgeltabrechnung-2026-10-Muster-Erika.pdf");
  });

  it("erkennt eine Änderung an Haben vorbei am Siegel", async () => {
    const id = await lohn.saveEmployee(actor, null, GGF);
    await lohn.abrechnen(actor, oktober);
    const [p] = await payslipsOf(id);
    await lohn.festschreiben(actor, { id: p!.id }, heute);
    await sql.begin(async (tx) => {
      await tx.unsafe("alter table payslips disable trigger payslips_locked");
      await tx`update payslips set netto = netto + 100 where id = ${p!.id}`;
      await tx.unsafe("alter table payslips enable trigger payslips_locked");
    });
    expect(await sql`select befund from haben_integrity_problems(100) where zeile = ${p!.id}::text`).toEqual([{ befund: "Inhalt passt nicht zum Siegel" }]);
  });

  it("schreibt nicht fest, solange Angaben für die Entgeltbescheinigung fehlen", async () => {
    const id = await lohn.saveEmployee(actor, null, { ...GGF, steuerId: "", strasse: "" });
    await lohn.abrechnen(actor, oktober);
    const [p] = await payslipsOf(id);
    await expect(lohn.festschreiben(actor, { id: p!.id }, heute)).rejects.toThrow("Für die Entgeltbescheinigung fehlt: Anschrift, Steuer-ID.");
  });

  it("verlangt einen neu gerechneten Entwurf, wenn sich die Stammdaten geändert haben", async () => {
    const id = await lohn.saveEmployee(actor, null, GGF);
    await lohn.abrechnen(actor, oktober);
    await lohn.saveEmployee(actor, id, { ...GGF, monatsgehalt: 6500_00 });
    const [p] = await payslipsOf(id);
    await expect(lohn.festschreiben(actor, { id: p!.id }, heute)).rejects.toThrow(/seit dem Entwurf geändert/);
    await lohn.entwurfNeuBerechnen(actor, { id: p!.id });
    await lohn.festschreiben(actor, { id: p!.id }, heute);
    expect((await payslipsOf(id))[0]?.brutto).toBe(6500_00);
  });

  it("rechnet einen Entwurf mit anderem Entgelt des Monats und löscht Entwürfe", async () => {
    const id = await lohn.saveEmployee(actor, null, GGF);
    await lohn.abrechnen(actor, oktober);
    const [p] = await payslipsOf(id);
    await lohn.entwurfNeuBerechnen(actor, { id: p!.id, entgelt: 7000_00 });
    expect((await payslipsOf(id))[0]?.brutto).toBe(7000_00);
    await lohn.entwurfLoeschen(actor, p!.id);
    expect(await payslipsOf(id)).toEqual([]);
  });

  it("Stufe C: festschreiben erst, wenn als gegengeprüft bestätigt", async () => {
    const id = await lohn.saveEmployee(actor, null, ANGESTELLT);
    await lohn.abrechnen(actor, oktober);
    const [p] = await payslipsOf(id);
    await expect(lohn.festschreiben(actor, { id: p!.id }, heute)).rejects.toThrow(/gegengeprüft/);
    await expect(sql`update payslips set locked_at = now(), pdf = '\\x00', sha256 = 'x' where id = ${p!.id}`).rejects.toThrow(/payslips_gegengeprueft/);
    await lohn.festschreiben(actor, { id: p!.id, gegengeprueft: true }, heute);
    const [row] = await sql`select gegenpruefen, gegengeprueft, sv_arbeitnehmer from payslips where id = ${p!.id}`;
    expect(row).toEqual({ gegenpruefen: true, gegengeprueft: true, sv_arbeitnehmer: 846_00 + 0 });
  });

  it("Storno: eigene, versiegelte Zeile, die Abrechnung bleibt unverändert, neue Abrechnung verweist auf die stornierte", async () => {
    const id = await lohn.saveEmployee(actor, null, GGF);
    await lohn.abrechnen(actor, oktober);
    const [p] = await payslipsOf(id);
    await expect(lohn.stornieren(actor, { id: p!.id }, heute)).rejects.toThrow(/Entwurf wird nicht storniert/);
    await lohn.festschreiben(actor, { id: p!.id }, heute);
    // Vor dem Storno lässt die Datenbank keine zweite Abrechnung desselben Monats zu
    await expect(
      sql`insert into payslips (run_id, employee_id, year, month, zahltag, mitarbeiter, bestandteile, brutto, steuer_brutto, sv_brutto,
            pauschal_brutto, lohnsteuer, soli, kirchensteuer, sv_arbeitnehmer, sv_arbeitgeber, pauschsteuer, sv, netto, auszahlung,
            steuertage, sv_tage, stufe, gegenpruefen)
          select run_id, employee_id, year, month, zahltag, mitarbeiter, bestandteile, brutto, steuer_brutto, sv_brutto, pauschal_brutto,
            lohnsteuer, soli, kirchensteuer, sv_arbeitnehmer, sv_arbeitgeber, pauschsteuer, sv, netto, auszahlung, steuertage, sv_tage,
            stufe, gegenpruefen from payslips where id = ${p!.id}`,
    ).rejects.toThrow(/schon eine Abrechnung/);

    await lohn.saveEmployee(actor, id, { ...GGF, steuerklasse: 3 });
    const r = await lohn.stornieren(actor, { id: p!.id, grund: "Steuerklasse rückwirkend geändert" }, "2026-11-03");
    expect(r.meldung).toBeNull();
    const [alt, neu] = await payslipsOf(id);
    expect(alt!.locked_at).not.toBeNull();
    expect(neu).toMatchObject({ id: r.entwurf, locked_at: null, replaces_id: p!.id });
    expect(neu!.lohnsteuer).toBeLessThan(alt!.lohnsteuer);

    const [storno] = await sql`select id, date, reason from payslip_cancellations where payslip_id = ${p!.id}`;
    expect(storno).toMatchObject({ reason: "Steuerklasse rückwirkend geändert" });
    expect(await sql`select count(*)::int as n from seals where table_name = 'payslip_cancellations' and row_id = ${storno!.id}`).toEqual([{ n: 1 }]);
    await expect(sql`update payslip_cancellations set reason = 'x' where id = ${storno!.id}`).rejects.toThrow(/nur ergänzt/);
    await expect(sql`delete from payslip_cancellations where id = ${storno!.id}`).rejects.toThrow(/nur ergänzt/);
    await expect(lohn.stornieren(actor, { id: p!.id }, heute)).rejects.toThrow(/schon storniert/);
    // Nur festgeschriebene Abrechnungen lassen sich stornieren, auch an der App vorbei
    await expect(sql`insert into payslip_cancellations (payslip_id, date) values (${neu!.id}, '2026-11-03')`).rejects.toThrow(/nicht festgeschrieben/);
    expect(await sql`select table_name from audit_log where table_name = 'payslip_cancellations'`).toHaveLength(1);

    // Lohnkonto: Abrechnung, Storno am Tag des Stornos, neue Abrechnung; die Summe zählt nur die neue
    await lohn.festschreiben(actor, { id: neu!.id }, "2026-11-03");
    const konto = await lohn.lohnkontoDesJahres(id, 2026);
    expect(konto!.konto.zeilen.map((z) => [z.zahltag, z.storno, z.lohnsteuer])).toEqual([
      ["2026-10-28", false, alt!.lohnsteuer],
      ["2026-10-28", false, neu!.lohnsteuer],
      ["2026-11-03", true, -alt!.lohnsteuer],
    ]);
    expect(konto!.konto.summe.lohnsteuer).toBe(neu!.lohnsteuer);
    expect(konto!.konto.summe.brutto).toBe(6000_00);
    const csv = await lohn.lohnkontoDatei(id, 2026, "csv", heute);
    expect(csv?.format === "csv" && csv.csv).toContain("03.11.2026;10/2026;Storno;StKl I, Kfb 0, ev;-6000,00");
    const pdf = await lohn.lohnkontoDatei(id, 2026, "pdf", heute);
    expect(pdf?.format === "pdf" && Buffer.from(pdf.pdf).toString("latin1").slice(0, 5)).toBe("%PDF-");
    expect(pdf!.filename).toBe("Lohnkonto-2026-Muster-Erika.pdf");
  });

  it("lässt auch per UPDATE an der App vorbei keine zweite aktive Abrechnung im Monat zu", async () => {
    const id = await lohn.saveEmployee(actor, null, GGF);
    await lohn.abrechnen(actor, oktober);
    await lohn.abrechnen(actor, { year: 2026, month: 9, zahltag: "2026-09-28" });
    const [september, oktoberEntwurf] = await sql<{ id: string }[]>`select id from payslips where employee_id = ${id} order by month`;
    await expect(sql`update payslips set month = 10 where id = ${september!.id}`).rejects.toThrow(/schon eine Abrechnung/);
    await expect(sql`update payslips set replaces_id = ${september!.id} where id = ${oktoberEntwurf!.id}`).rejects.toThrow(/keine stornierte Abrechnung/);
  });

  it("schreibt keinen Entwurf fest, der mit einem anderen Bundesland gerechnet ist", async () => {
    const id = await lohn.saveEmployee(actor, null, GGF);
    await sql`update company set bundesland = 'BY'`;
    await lohn.abrechnen(actor, oktober);
    await sql`update company set bundesland = 'HB'`;
    const [p] = await payslipsOf(id);
    await expect(lohn.festschreiben(actor, { id: p!.id }, heute)).rejects.toThrow(/neu berechnen/);
    await lohn.entwurfNeuBerechnen(actor, { id: p!.id });
    await lohn.festschreiben(actor, { id: p!.id }, heute);
  });

  it("Lohnkonto: die Pauschsteuer steht nur in ihrer Spalte, nicht auch in den Beiträgen des Arbeitgebers", async () => {
    const id = await lohn.saveEmployee(actor, null, {
      ...ANGESTELLT,
      art: "minijob",
      monatsgehalt: 600_00,
      personengruppe: "109",
      beitragsgruppen: "6500",
      u1Satz: 80,
      u2Satz: 22,
      kinderUnter25: 0,
    });
    await lohn.abrechnen(actor, oktober);
    const [p] = await payslipsOf(id);
    await lohn.festschreiben(actor, { id: p!.id }, heute);
    const [zeile] = (await lohn.lohnkontoDesJahres(id, 2026))!.konto.zeilen;
    // 13 % KV + 15 % RV + U1 0,8 % + U2 0,22 % + Insolvenzgeldumlage 0,15 % von 600 €; Pauschsteuer 2 % eigens
    expect(zeile).toMatchObject({ pauschsteuer: 12_00, svArbeitgeber: 78_00 + 90_00 + 4_80 + 1_32 + 90 });
  });

  it("rechnet einen Geschäftsführer mit festgestellter Versicherungspflicht nicht ohne SV", async () => {
    await lohn.saveEmployee(actor, null, { ...GGF, statusfeststellung: "versicherungspflichtig" });
    const r = await lohn.abrechnen(actor, oktober);
    expect(r.fehler[0]?.meldung).toMatch(/Versicherungspflicht ergeben/);
  });

  it("prüft Stammdaten: Steuer-ID, IBAN, Faktor nur in Klasse IV, Austritt nach Eintritt", async () => {
    await expect(lohn.saveEmployee(actor, null, { ...GGF, steuerId: "12345678901" })).rejects.toThrow(/Steuer-ID ist ungültig/);
    await expect(lohn.saveEmployee(actor, null, { ...GGF, iban: "DE00 1234" })).rejects.toThrow(/IBAN ist ungültig/);
    await expect(lohn.saveEmployee(actor, null, { ...GGF, faktor: 900 })).rejects.toThrow(/Steuerklasse IV/);
    await expect(lohn.saveEmployee(actor, null, { ...GGF, austritt: "2023-12-31" })).rejects.toThrow(/vor dem Eintritt/);
    const a = await lohn.saveEmployee(actor, null, GGF);
    const b = await lohn.saveEmployee(actor, null, ANGESTELLT);
    expect((await lohn.listEmployees()).map((e) => [e.id, e.personalnummer])).toEqual([
      [a, 1],
      [b, 2],
    ]);
    expect((await lohn.getEmployee(b))?.svNummer).toBe("12120480M123");
  });
});
