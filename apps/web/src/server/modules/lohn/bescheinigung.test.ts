import type { ElsterClient } from "@haben/elster";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { EricGeprueftClient } from "../../test-eric.ts";
import type { EmployeeInput } from "./employees.ts";

/*
 * Lohnsteuerbescheinigung mit Postgres (docs/lohn-plan.md, PR 7): Werte aus den festgeschriebenen Abrechnungen, Vermerk
 * einer Übermittlung im ELSTER-Portal (ab 2026), Korrektur nach Storno einer Abrechnung, Stornierung, Übermittlung über
 * ERiC bis 2025, Sperre der Historie, Audit, Frist und Ausdruck. SKR03 und SKR04, Ist und Soll: Die Bescheinigung hängt
 * weder vom Kontenrahmen noch von der Versteuerung ab.
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
  austritt: "2026-03-31",
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

const MINIJOB: EmployeeInput = {
  ...ANGESTELLT,
  vorname: "Mia",
  nachname: "Aushilfe",
  steuerId: "57549285017",
  art: "minijob",
  monatsgehalt: 603_00,
  personengruppe: "109",
  beitragsgruppen: "6500",
  u1Satz: 80,
  u2Satz: 22,
  kinderUnter25: 0,
};

describe.skipIf(!testDatabaseUrl)("Lohnsteuerbescheinigung (Postgres)", () => {
  let lohn: typeof import("./index.ts");
  let fristen: typeof import("../finanzamt/fristen.ts");
  let crypto: typeof import("../../crypto.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const heute = "2026-04-15";

  beforeAll(async () => {
    sql = await setupTestDb();
    lohn = await import("./index.ts");
    fristen = await import("../finanzamt/fristen.ts");
    crypto = await import("../../crypto.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", finanzamt = "Finanzamt Bremen") {
    await sql`truncate lstb_submissions, elster_certificates, journal_lines, journal_entries, year_closings, payslip_cancellations, payslips,
      payroll_runs, employees, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, finanzamt, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht Software GmbH', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${finanzamt},
              ${kontenrahmen}, ${versteuerung}, 'gmbh')`;
    await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(Buffer.from("pfx"))})`;
  }

  /** Rechnet den Monat für alle Mitarbeiter und schreibt jede Abrechnung fest */
  async function abrechnen(year: number, month: number) {
    const zahltag = `${year}-${String(month).padStart(2, "0")}-28`;
    await lohn.abrechnen(actor, { year, month, zahltag });
    const drafts = await sql<{ id: string }[]>`select id from payslips where year = ${year} and month = ${month} and locked_at is null`;
    for (const d of drafts) await lohn.festschreiben(actor, { id: d.id, gegengeprueft: true }, zahltag);
  }

  const stand = async (name: string, year = 2026, tag = heute) => {
    const m = (await lohn.lstbUebersicht(year, tag)).mitarbeiter.find((x) => x.name === name);
    if (!m) throw new Error(`${name} fehlt`);
    return m;
  };

  let lastXml = "";
  const client = (): ElsterClient => {
    const fake = new EricGeprueftClient();
    return {
      validate: (xml) => {
        lastXml = xml;
        return fake.validate(xml);
      },
      send: (xml, ...rest) => {
        lastXml = xml;
        return fake.send(xml, ...rest);
      },
      fetchPostfach: (...args) => fake.fetchPostfach(...args),
      fetchBelege: (...args) => fake.fetchBelege(...args),
    };
  };

  it.each([
    ["SKR03", "soll"],
    ["SKR03", "ist"],
    ["SKR04", "soll"],
    ["SKR04", "ist"],
  ] as const)(
    "%s, %s: Werte aus den Abrechnungen; Minijob mit Pauschsteuer ohne Bescheinigung; bis zum Austritt offen",
    async (kontenrahmen, versteuerung) => {
      await firma(kontenrahmen, versteuerung);
      for (const e of [GGF, { ...ANGESTELLT, austritt: null }, { ...MINIJOB, austritt: null }]) await lohn.saveEmployee(actor, null, e);
      for (const m of [1, 2, 3]) await abrechnen(2026, m);

      const ggf = await stand("Erika Muster");
      expect(ggf.status).toBe("bereit");
      expect(ggf.naechste).toBe("neu");
      expect(ggf.ausdruck).toBe("entwurf");
      const p = await sql<{ lohnsteuer: number; soli: number; kirchensteuer: number }[]>`
        select sum(p.lohnsteuer)::int as lohnsteuer, sum(p.soli)::int as soli, sum(p.kirchensteuer)::int as kirchensteuer
        from payslips p join employees e on e.id = p.employee_id where e.nachname = 'Muster'`;
      expect(ggf.ergebnis).toMatchObject({
        status: "bereit",
        werte: { jahr: 2026, von: "2026-01-01", bis: "2026-03-31", bruttoarbeitslohn: 18_000_00, ...p[0], rvArbeitnehmer: 0, kvArbeitnehmer: 0 },
      });

      const max = await stand("Max Beispiel");
      expect(max.status).toBe("offen");
      expect(max.ergebnis).toMatchObject({ meldung: expect.stringContaining("31.12.2026") });
      // Am Jahresende fehlen ihm die Monate ab April
      expect((await stand("Max Beispiel", 2026, "2027-01-10")).ergebnis).toMatchObject({ status: "offen", meldung: expect.stringContaining("April") });
      expect((await stand("Mia Aushilfe")).status).toBe("keine");

      // Die Frist: 28.2.2027 ist ein Sonntag
      const frist = (await fristen.listFristen(heute)).find((f) => f.id === "lstb-2026");
      expect(frist).toMatchObject({ datum: "2027-03-01", status: "offen", link: "/lohn/bescheinigung/2026" });
    },
    120_000,
  );

  it("ab 2026 nicht über ERiC, sondern Vermerk aus dem ELSTER-Portal; Korrektur nach Storno einer Abrechnung, dann Stornierung", async () => {
    await firma("SKR04", "soll");
    const id = await lohn.saveEmployee(actor, null, GGF);
    for (const m of [1, 2, 3]) await abrechnen(2026, m);

    await expect(lohn.submitLstb(actor, client(), { kind: "validate", employeeId: id, year: 2026, heute, herstellerId: "12345" })).rejects.toThrow(
      /LSTMitteilung über ElsterKMV/,
    );
    await expect(lohn.vermerkeLstb(actor, { employeeId: id, year: 2026, art: "korrektur", datum: heute, transferTicket: "et1" }, heute)).rejects.toThrow(
      /keine übermittelte Bescheinigung/,
    );
    await expect(lohn.vermerkeLstb(actor, { employeeId: id, year: 2026, art: "neu", datum: "2026-04-16", transferTicket: "et1" }, heute)).rejects.toThrow(
      /Zukunft/,
    );
    await lohn.vermerkeLstb(actor, { employeeId: id, year: 2026, art: "neu", datum: heute, transferTicket: "et-neu-1" }, heute);
    let m = await stand("Erika Muster");
    expect([m.status, m.naechste, m.ausdruck]).toEqual(["uebermittelt", null, "uebermittelt"]);
    expect((await fristen.listFristen(heute)).find((f) => f.id === "lstb-2026")?.status).toBe("erledigt");
    await expect(lohn.vermerkeLstb(actor, { employeeId: id, year: 2026, art: "neu", datum: heute, transferTicket: "et2" }, heute)).rejects.toThrow(
      /schon eine Bescheinigung/,
    );

    // Der Ausdruck nennt das Transferticket
    const pdf = await lohn.lstbAusdruck(id, 2026, heute);
    expect(pdf?.filename).toBe("Lohnsteuerbescheinigung-2026-Erika-Muster.pdf");
    expect(Buffer.from(pdf!.pdf).subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // Historie nur anhängbar, mit Audit-Log
    await expect(sql`update lstb_submissions set transfer_ticket = 'x'`).rejects.toThrow();
    await expect(sql`delete from lstb_submissions`).rejects.toThrow();
    const [audit] = await sql<{ n: number }[]>`select count(*)::int as n from audit_log where table_name = 'lstb_submissions'`;
    expect(audit!.n).toBe(1);

    // Storno der März-Abrechnung und neue mit anderem Gehalt: Die Werte weichen ab, eine Korrektur ist fällig
    await lohn.saveEmployee(actor, id, { ...GGF, monatsgehalt: 6500_00 });
    const [maerz] = await sql<{ id: string }[]>`select id from payslips where month = 3 and locked_at is not null`;
    await lohn.stornieren(actor, { id: maerz!.id, grund: "Gehalt korrigiert" }, heute);
    // Mit dem Entwurf steht noch nicht fest, was zu korrigieren ist
    expect((await stand("Erika Muster")).ergebnis.status).toBe("offen");
    const [neu] = await sql<{ id: string }[]>`select id from payslips where month = 3 and locked_at is null`;
    await lohn.festschreiben(actor, { id: neu!.id, gegengeprueft: true }, heute);
    m = await stand("Erika Muster");
    expect([m.status, m.naechste]).toEqual(["abweichend", "korrektur"]);
    expect((await fristen.listFristen(heute)).find((f) => f.id === "lstb-2026")?.status).toBe("offen");
    await lohn.vermerkeLstb(actor, { employeeId: id, year: 2026, art: "korrektur", datum: heute, transferTicket: "et-kor-2" }, heute);
    m = await stand("Erika Muster");
    expect(m.status).toBe("uebermittelt");
    expect(m.ergebnis.status === "bereit" && m.ergebnis.werte.bruttoarbeitslohn).toBe(18_500_00);

    await lohn.vermerkeLstb(
      actor,
      { employeeId: id, year: 2026, art: "storno", datum: heute, transferTicket: "et-sto-3", grund: "falscher Arbeitnehmer" },
      heute,
    );
    m = await stand("Erika Muster");
    expect([m.status, m.naechste, m.ausdruck]).toEqual(["storniert", "neu", "uebermittelt"]);
    expect(m.verlauf.map((s) => [s.art, s.kind, s.refKmId])).toEqual([
      ["neu", "portal", null],
      ["korrektur", "portal", null],
      ["storno", "portal", null],
    ]);
  }, 120_000);

  it("ohne Finanzamt in den Firmendaten kein Vermerk; nicht unterstützte Fälle ohne Werte vermerkbar", async () => {
    await firma("SKR03", "ist", "");
    const id = await lohn.saveEmployee(actor, null, GGF);
    for (const m of [1, 2, 3]) await abrechnen(2026, m);
    expect((await lohn.lstbUebersicht(2026, heute)).firmenfehler).toContain("Name des Finanzamts fehlt");
    await expect(lohn.vermerkeLstb(actor, { employeeId: id, year: 2026, art: "neu", datum: heute, transferTicket: "et1" }, heute)).rejects.toThrow(
      /Finanzamts/,
    );
  }, 120_000);

  it.each([
    // R 39b.2 Abs. 1 Nr. 7 LStR: Lohn für Dezember, der bis drei Wochen nach Jahresende zufließt, ist laufender Arbeitslohn des Jahres
    [1, "2026-01-28", 12, "2027-01-21", "bereit"],
    // R 39b.2 Abs. 2 Satz 2 Nr. 8 LStR: später gezahlt ist er ein sonstiger Bezug des Zahlungsjahres (§ 38a Abs. 1 Satz 3 EStG)
    [1, "2026-01-28", 12, "2027-02-10", "nicht-unterstuetzt"],
    // Im Voraus im Vorjahr gezahlt: sonstiger Bezug des Vorjahres
    [1, "2025-12-20", 12, "2026-12-28", "nicht-unterstuetzt"],
  ] as const)("Lohn über den Jahreswechsel: %i mit Zahltag %s, %i mit Zahltag %s → %s", async (erster, zahltagErster, letzter, zahltagLetzter, status) => {
    await firma("SKR03", "ist");
    await lohn.saveEmployee(actor, null, { ...GGF, austritt: null });
    for (let m = 1; m <= 12; m++) {
      const zahltag = m === erster ? zahltagErster : m === letzter ? zahltagLetzter : `2026-${String(m).padStart(2, "0")}-28`;
      await lohn.abrechnen(actor, { year: 2026, month: m, zahltag });
      const drafts = await sql<{ id: string }[]>`select id from payslips where year = 2026 and month = ${m} and locked_at is null`;
      for (const d of drafts) await lohn.festschreiben(actor, { id: d.id, gegengeprueft: true }, zahltag);
    }
    expect((await stand("Erika Muster", 2026, "2027-03-01")).ergebnis.status).toBe(status);
  }, 120_000);

  it("bis 2025 über ERiC: neu, Korrektur mit RefKmId, Storno; ohne Abweichung nichts zu senden", async () => {
    await firma("SKR03", "soll");
    const id = await lohn.saveEmployee(actor, null, GGF);
    for (const m of [1, 2, 3]) await abrechnen(2026, m);
    // Abrechnungen 2025 rechnet Haben nicht (kein PAP 2025); für die Übermittlung bis 2025 dieselben Zeilen als 2025
    for (const m of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const [run] = await sql<
        { id: string }[]
      >`insert into payroll_runs (year, month, zahltag) values (2025, ${m}, ${`2025-${String(m).padStart(2, "0")}-28`}) returning id`;
      await sql`insert into payslips (run_id, employee_id, year, month, zahltag, mitarbeiter, bestandteile, brutto, steuer_brutto, sv_brutto, pauschal_brutto,
          lohnsteuer, soli, kirchensteuer, sv_arbeitnehmer, sv_arbeitgeber, pauschsteuer, sv, netto, auszahlung, steuertage, sv_tage, stufe, gegenpruefen,
          gegengeprueft, hinweise, pdf, sha256, locked_at)
        select ${run!.id}, employee_id, 2025, ${m}, ${`2025-${String(m).padStart(2, "0")}-28`}, mitarbeiter, bestandteile, brutto, steuer_brutto, sv_brutto,
          pauschal_brutto, lohnsteuer, soli, kirchensteuer, sv_arbeitnehmer, sv_arbeitgeber, pauschsteuer, sv, netto, auszahlung, steuertage, sv_tage, stufe,
          gegenpruefen, gegengeprueft, hinweise, pdf, sha256, locked_at
        from payslips where year = 2026 and month = 1`;
    }
    const tag = "2026-02-10";
    const senden = (kind: "validate" | "test" | "send") =>
      lohn.submitLstb(actor, client(), { kind, employeeId: id, year: 2025, heute: tag, herstellerId: "12345", pin: "1234" });

    expect((await senden("validate")).ok).toBe(true);
    expect(lastXml).toContain("<Testmerker>220000000</Testmerker>");
    expect(lastXml).toContain(`<Anweisung art="Neu"><KmId>2025-LST-86095742719-01013112-2460014512345-1-NEU-001</KmId></Anweisung>`);
    expect(lastXml).toContain("<ArbGFAName>Finanzamt Bremen</ArbGFAName>");
    const r = await senden("send");
    expect(r.ok).toBe(true);
    expect(lastXml).not.toContain("<Testmerker>");
    expect((await stand("Erika Muster", 2025, tag)).status).toBe("uebermittelt");
    await expect(senden("send")).rejects.toThrow(/nichts zu korrigieren/);

    // Eine Abrechnung 2025 storniert und neu: Korrektur der zuletzt übermittelten, Grund erst ab 1. März des Folgejahres
    const [dez] = await sql<{ id: string }[]>`select id from payslips where year = 2025 and month = 12`;
    await sql`insert into payslip_cancellations (payslip_id, date, reason) values (${dez!.id}, ${tag}, 'Test')`;
    await sql`insert into payslips (run_id, employee_id, year, month, zahltag, mitarbeiter, bestandteile, brutto, steuer_brutto, sv_brutto, pauschal_brutto,
        lohnsteuer, soli, kirchensteuer, sv_arbeitnehmer, sv_arbeitgeber, pauschsteuer, sv, netto, auszahlung, steuertage, sv_tage, stufe, gegenpruefen,
        gegengeprueft, hinweise, pdf, sha256, locked_at, replaces_id)
      select run_id, employee_id, year, month, zahltag, mitarbeiter, bestandteile, brutto, steuer_brutto + 100, sv_brutto, pauschal_brutto,
        lohnsteuer + 30, soli, kirchensteuer, sv_arbeitnehmer, sv_arbeitgeber, pauschsteuer, sv, netto, auszahlung, steuertage, sv_tage, stufe,
        gegenpruefen, gegengeprueft, hinweise, pdf, sha256, locked_at, id
      from payslips where id = ${dez!.id}`;
    expect((await stand("Erika Muster", 2025, tag)).naechste).toBe("korrektur");
    await senden("send");
    expect(lastXml).toContain(
      `<Anweisung art="Korrektur"><KmId>2025-LST-86095742719-01013112-2460014512345-1-KOR-002</KmId><RefKmId>2025-LST-86095742719-01013112-2460014512345-1-NEU-001</RefKmId></Anweisung>`,
    );

    await lohn.stornoLstb(actor, client(), { kind: "send", employeeId: id, year: 2025, heute: "2026-03-02", herstellerId: "12345", pin: "1234", grund: "" });
    expect(lastXml).toContain(`<RefKmId>2025-LST-86095742719-01013112-2460014512345-1-KOR-002</RefKmId></Anweisung><Zuflussjahr>2025</Zuflussjahr>`);
    const m = await stand("Erika Muster", 2025, "2026-03-02");
    expect([m.status, m.naechste]).toEqual(["storniert", "neu"]);
    // Nach dem Storno wieder neu; nach dem 1. März mit eigener KmId
    await lohn.submitLstb(actor, client(), { kind: "send", employeeId: id, year: 2025, heute: "2026-03-02", herstellerId: "12345", pin: "1234" });
    expect(lastXml).toContain("-1-NEU-004</KmId>");
    // Die Prüfungen und Tests stehen im Verlauf, zählen aber nicht als übermittelt
    expect(m.verlauf.filter((s) => s.kind === "validate")).toHaveLength(1);
  }, 120_000);
});
