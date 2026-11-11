import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import type { EmployeeInput } from "../lohn/employees.ts";

/*
 * Ausfüllliste für das SV-Meldeportal mit Postgres (docs/lohn-plan.md, PR 6): Beitragsnachweise aus festgeschriebenen
 * Abrechnungen, Meldungen, Vermerk „im Portal abgegeben“ mit Protokoll (nur anhängbar, Audit), Rücknahme, Erkennen
 * späterer Änderungen und die Fristen.
 */

const ANGESTELLT: EmployeeInput = {
  vorname: "Max",
  nachname: "Beispiel",
  strasse: "Lindenweg 1",
  plz: "28195",
  ort: "Bremen",
  geburtsdatum: "1980-04-12",
  steuerId: "47291830467",
  steuerklasse: 1,
  konfession: null,
  art: "beschaeftigt",
  monatsgehalt: 4000_00,
  krankenversicherung: "gesetzlich",
  krankenkasse: "Techniker Krankenkasse",
  krankenkasseBetriebsnummer: "15027365",
  zusatzbeitrag: 290,
  kinderUnter25: 1,
  u1Satz: 160,
  u2Satz: 44,
  personengruppe: "101",
  beitragsgruppen: "1111",
  taetigkeitsschluessel: "431143111",
  svNummer: "12120480m123",
  eintritt: "2026-10-01",
  iban: "DE89 3704 0044 0532 0130 00",
};

const MINIJOB: EmployeeInput = {
  ...ANGESTELLT,
  vorname: "Mia",
  nachname: "Aushilfe",
  steuerId: "86095742719",
  art: "minijob",
  monatsgehalt: 520_00,
  krankenkasse: "",
  krankenkasseBetriebsnummer: "",
  kinderUnter25: 0,
  u1Satz: null,
  u2Satz: 0,
  personengruppe: "109",
  beitragsgruppen: "6100",
  svNummer: "12120480m131",
};

const PDF = new TextEncoder().encode("%PDF-1.4\n% Protokoll SV-Meldeportal\n%%EOF\n");

describe.skipIf(!testDatabaseUrl)("SV-Meldeportal (Postgres)", () => {
  let lohn: typeof import("../lohn/index.ts");
  let sv: typeof import("./index.ts");
  let fristen: typeof import("../finanzamt/fristen.ts");
  let dateien: typeof import("../../db/file-in-use.ts");
  let db: typeof import("../../db/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const heute = "2026-10-27";

  beforeAll(async () => {
    sql = await setupTestDb();
    lohn = await import("../lohn/index.ts");
    sv = await import("./index.ts");
    fristen = await import("../finanzamt/fristen.ts");
    dateien = await import("../../db/file-in-use.ts");
    db = await import("../../db/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate sv_portal_filings, payslip_cancellations, payslips, payroll_runs, employees, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht Software GmbH', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', 'SKR04', 'soll', 'gmbh')`;
  });

  /** Beide abrechnen und festschreiben; gibt die ids der Mitarbeiter zurück */
  async function oktoberFestgeschrieben() {
    const angestellt = await lohn.saveEmployee(actor, null, ANGESTELLT);
    const minijob = await lohn.saveEmployee(actor, null, MINIJOB);
    await lohn.abrechnen(actor, { year: 2026, month: 10, zahltag: "2026-10-28" });
    const payslips = await sql<{ id: string; employee_id: string }[]>`select id, employee_id from payslips`;
    for (const p of payslips) await lohn.festschreiben(actor, { id: p.id, gegengeprueft: true }, heute);
    return { angestellt, minijob, payslips };
  }

  const tk = "beitragsnachweis:2026-10:15027365";

  it("baut je Einzugsstelle den Beitragsnachweis aus den festgeschriebenen Abrechnungen und die Anmeldungen des Monats", async () => {
    await oktoberFestgeschrieben();
    const liste = await sv.ausfuellliste(2026, 10, heute);
    expect(liste.beitragsnachweise.map((b) => b.gegenstand).sort()).toEqual(["beitragsnachweis:2026-10:15027365", "beitragsnachweis:2026-10:98000006"]);
    const summen = await sql<{ summe: number }[]>`select sum(sv_arbeitnehmer + sv_arbeitgeber)::int as summe from payslips`;
    expect(liste.beitragsnachweise.reduce((s, b) => s + b.summe, 0)).toBe(summen[0]!.summe);
    expect(liste.beitragsnachweise.every((b) => b.hinweise.length === 0 && !b.stand.abgegeben)).toBe(true);
    expect(liste.meldungen.map((m) => `${m.art} ${m.titel}`)).toEqual([
      "anmeldung Anmeldung Max Beispiel (Beginn 01.10.2026)",
      "sofortmeldung Sofortmeldung Max Beispiel (Beginn 01.10.2026)",
      "anmeldung Anmeldung Mia Aushilfe (Beginn 01.10.2026)",
      "sofortmeldung Sofortmeldung Mia Aushilfe (Beginn 01.10.2026)",
    ]);
    // Anmeldung mit dem Zahltag der ersten Abrechnung, vor Ablauf der sechs Wochen
    expect(liste.meldungen[0]!.frist).toBe("2026-10-28");
  });

  it("nennt Beschäftigte ohne festgeschriebene Abrechnung, statt sie still wegzulassen", async () => {
    await lohn.saveEmployee(actor, null, ANGESTELLT);
    await lohn.abrechnen(actor, { year: 2026, month: 10, zahltag: "2026-10-28" });
    const [b] = (await sv.ausfuellliste(2026, 10, heute)).beitragsnachweise;
    expect(b!.summe).toBe(0);
    expect(b!.hinweise[0]).toContain("Ohne festgeschriebene Abrechnung nicht enthalten: Max Beispiel");
  });

  it("legt nach einem Kassenwechsel keinen leeren Beitragsnachweis für die neue Kasse in abgerechneten Monaten an", async () => {
    // Die Abrechnung hält die Kasse fest, mit der sie gerechnet ist; die Stammdaten zeigen schon die neue Kasse
    const { angestellt } = await oktoberFestgeschrieben();
    await lohn.saveEmployee(actor, angestellt, { ...ANGESTELLT, krankenkasse: "AOK Bremen/Bremerhaven", krankenkasseBetriebsnummer: "20012084" });
    const liste = await sv.ausfuellliste(2026, 10, heute);
    expect(liste.beitragsnachweise.map((b) => b.gegenstand).sort()).toEqual([tk, "beitragsnachweis:2026-10:98000006"]);
    const ids = (await fristen.listFristen(heute)).map((f) => f.id);
    expect(ids).not.toContain("svbn-2026-10-20012084");
  });

  it("vermerkt die Abgabe mit Protokoll, nur anhängbar und im Audit-Log; Werte und Titel bildet der Server", async () => {
    await oktoberFestgeschrieben();
    const id = await sv.vermerken(actor, { gegenstand: tk, datum: "2026-10-24", notiz: "Ticket 123" }, heute, { bytes: PDF, filename: "../protokoll.pdf" });
    const [v] = await sql`select titel, art, datum::text, protokoll_dateiname, protokoll_sha256, werte from sv_portal_filings where id = ${id}`;
    expect(v).toMatchObject({
      titel: "Beitragsnachweis Oktober 2026 · Techniker Krankenkasse",
      art: "beitragsnachweis",
      datum: "2026-10-24",
      protokoll_dateiname: "protokoll.pdf",
    });
    expect((v!.werte as { name: string }[]).some((w) => w.name === "Gesamtsumme")).toBe(true);
    const liste = await sv.ausfuellliste(2026, 10, heute);
    expect(liste.beitragsnachweise.find((b) => b.gegenstand === tk)!.stand).toMatchObject({ abgegeben: true, geaendert: false });
    expect(Buffer.from((await sv.loadProtokoll(id))!.bytes).toString()).toBe(Buffer.from(PDF).toString());
    expect(await db.db.transaction((tx) => dateien.fileInUse(tx, v!.protokoll_sha256 as string))).toBe(true);
    const audit = await sql`select action from audit_log where table_name = 'sv_portal_filings'`;
    expect(audit.map((a) => a.action)).toEqual(["INSERT"]);
    await expect(sql`update sv_portal_filings set datum = '2026-10-25' where id = ${id}`).rejects.toThrow();
    await expect(sql`delete from sv_portal_filings where id = ${id}`).rejects.toThrow();
  });

  it("lehnt unbekannte Gegenstände, Abgaben in der Zukunft und fremde Dateitypen ab", async () => {
    await oktoberFestgeschrieben();
    await expect(sv.vermerken(actor, { gegenstand: "beitragsnachweis:2026-10:99999999", datum: heute }, heute)).rejects.toThrow("gibt es in der Liste nicht");
    await expect(sv.vermerken(actor, { gegenstand: tk, datum: "2026-10-28" }, heute)).rejects.toThrow("Zukunft");
    await expect(sv.vermerken(actor, { gegenstand: tk, datum: heute }, heute, { bytes: new TextEncoder().encode("hallo"), filename: "a.txt" })).rejects.toThrow(
      "PDF, PNG oder JPEG",
    );
  });

  it("erkennt eine Änderung nach dem Vermerk (Storno) und nimmt Vermerke nur einmal zurück", async () => {
    const { angestellt, payslips } = await oktoberFestgeschrieben();
    const id = await sv.vermerken(actor, { gegenstand: tk, datum: heute }, heute);
    await lohn.stornieren(actor, { id: payslips.find((p) => p.employee_id === angestellt)!.id, grund: "Gehalt falsch" }, heute);
    const geaendert = (await sv.ausfuellliste(2026, 10, heute)).beitragsnachweise.find((b) => b.gegenstand === tk)!;
    expect(geaendert.stand).toMatchObject({ abgegeben: true, geaendert: true });
    await sv.zuruecknehmen(actor, { id, grund: "versehentlich" }, heute);
    const stand = (await sv.ausfuellliste(2026, 10, heute)).beitragsnachweise.find((b) => b.gegenstand === tk)!.stand;
    expect(stand).toMatchObject({ abgegeben: false, zurueckgenommen: [{ grund: "versehentlich", abgegebenAm: heute }] });
    await expect(sv.zuruecknehmen(actor, { id, grund: "noch mal" }, heute)).rejects.toThrow("schon zurückgenommen");
    // Die Datenbank lässt weder eine Rücknahme einer Rücknahme noch eine zu einem anderen Gegenstand zu
    const [r] = await sql<{ id: string }[]>`select id from sv_portal_filings where revokes_id = ${id}`;
    await expect(
      sql`insert into sv_portal_filings (gegenstand, art, titel, datum, werte, revokes_id) values (${tk}, 'beitragsnachweis', 'x', ${heute}, '[]', ${r!.id})`,
    ).rejects.toThrow();
  });

  it("führt Beitragsnachweise und Meldungen als Fristen, erledigt mit dem Vermerk", async () => {
    await oktoberFestgeschrieben();
    await sv.vermerken(actor, { gegenstand: tk, datum: heute }, heute);
    const liste = await fristen.listFristen(heute);
    const sv_ = liste.filter((f) => f.art === "sv");
    // Oktober 2026: fünftletzter Bankarbeitstag Montag, 26.; übermitteln bis Sonntag, 25.
    expect(sv_.find((f) => f.id === "svbn-2026-10-15027365")).toMatchObject({
      datum: "2026-10-25",
      status: "erledigt",
      link: "/sv-meldeportal?jahr=2026&monat=10",
    });
    expect(sv_.find((f) => f.id === "svbn-2026-10-98000006")).toMatchObject({ datum: "2026-10-25", status: "offen" });
    expect(sv_.find((f) => f.titel === "Anmeldung Mia Aushilfe (Beginn 01.10.2026)")).toMatchObject({ datum: "2026-10-28", status: "offen" });
    // Jahresmeldung 2026 mit Frist am 15. Februar, keine Frist für die Sofortmeldung
    expect(sv_.find((f) => f.titel === "Jahresmeldung 2026 Max Beispiel")).toMatchObject({ datum: "2027-02-15" });
    expect(sv_.some((f) => f.titel.startsWith("Sofortmeldung"))).toBe(false);
  });

  it("meldet den Gesellschafter-Geschäftsführer ohne SV-Pflicht nicht", async () => {
    await lohn.saveEmployee(actor, null, { ...ANGESTELLT, art: "ggf", statusfeststellung: "versicherungsfrei" });
    const liste = await sv.ausfuellliste(2026, 10, heute);
    expect(liste.beitragsnachweise).toEqual([]);
    expect(liste.meldungen).toEqual([]);
    expect(liste.ohneSv).toEqual(["Max Beispiel"]);
    expect((await fristen.listFristen(heute)).filter((f) => f.art === "sv")).toEqual([]);
  });
});
