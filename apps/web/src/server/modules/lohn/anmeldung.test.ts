import type { ElsterClient } from "@haben/elster";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { EricGeprueftClient } from "../../test-eric.ts";
import type { EmployeeInput } from "./employees.ts";

/*
 * Lohnsteuer-Anmeldung mit Postgres (docs/lohn-plan.md, PR 5): Kennzahlen aus den festgeschriebenen Abrechnungen nach
 * Zahltag, Anmeldungszeitraum, Prüfen und Senden, Sperre der Übermittlungen, Berichtigung nach Storno, Frist und der
 * Vorschlag im Bankabgleich. SKR03 und SKR04, Ist und Soll; die Anmeldung hängt vom Kontenrahmen nicht ab.
 */

const GGF: EmployeeInput = {
  vorname: "Erika",
  nachname: "Muster",
  strasse: "Lindenweg 1",
  plz: "93047",
  ort: "Regensburg",
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
  konfession: "rk",
  art: "beschaeftigt",
  monatsgehalt: 4000_00,
  zusatzbeitrag: 310,
  krankenkasse: "Techniker Krankenkasse",
  krankenkasseBetriebsnummer: "15027365",
  kinderlosenzuschlag: false,
  kinderUnter25: 4,
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
  konfession: null,
  art: "minijob",
  monatsgehalt: 603_00,
  personengruppe: "109",
  beitragsgruppen: "6500",
  u1Satz: 80,
  u2Satz: 22,
  kinderUnter25: 0,
};

describe.skipIf(!testDatabaseUrl)("Lohnsteuer-Anmeldung (Postgres)", () => {
  let lohn: typeof import("./index.ts");
  let bank: typeof import("../bank/bank.ts");
  let fristen: typeof import("../finanzamt/fristen.ts");
  let crypto: typeof import("../../crypto.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const oktober = { year: 2026, zeitraum: 10 };

  beforeAll(async () => {
    sql = await setupTestDb();
    lohn = await import("./index.ts");
    bank = await import("../bank/bank.ts");
    fristen = await import("../finanzamt/fristen.ts");
    crypto = await import("../../crypto.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", bundesland = "BY") {
    await leeren(sql)`truncate lsta_submissions, lsta_turnus, elster_certificates, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, year_closings, payslip_cancellations, payslips, payroll_runs, employees, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht Software GmbH', 'Hafenallee 3', '93047', 'Regensburg', 'rechnung@example.com',
              ${bundesland === "BY" ? "198/113/10010" : "201/123/12340"}, ${bundesland}, ${kontenrahmen}, ${versteuerung}, 'gmbh')`;
    await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(Buffer.from("pfx"))})`;
  }

  /** Rechnet den Monat für alle Mitarbeiter und schreibt jede Abrechnung fest */
  async function abrechnen(year: number, month: number, zahltag: string) {
    await lohn.abrechnen(actor, { year, month, zahltag });
    const drafts = await sql<{ id: string }[]>`select id from payslips where year = ${year} and month = ${month} and locked_at is null`;
    for (const d of drafts) await lohn.festschreiben(actor, { id: d.id, gegengeprueft: true }, zahltag);
  }

  let lastXml = "";
  /** Wie ERiC: kein simulierter Client, damit die Echtübermittlung durchgeht; jedes XML geht durch das echte Plugin, wenn da */
  const liveClient = (): ElsterClient => {
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
  const senden = (zeitraum = oktober, today = "2026-11-05") =>
    lohn.submitLsta(actor, liveClient(), { kind: "send", zeitraum, pin: "1234", herstellerId: "12345", today });

  const summe = async (spalte: "lohnsteuer" | "soli" | "kirchensteuer", where = sql`true`) =>
    (await sql`select coalesce(sum(${sql(spalte)}), 0)::int as n from payslips where locked_at is not null and ${where}`)[0]!.n as number;

  it.each([
    ["SKR03", "soll"],
    ["SKR03", "ist"],
    ["SKR04", "soll"],
    ["SKR04", "ist"],
  ] as const)(
    "%s, %s: Lohnsteuer, Soli und Kirchensteuer je Konfession aus den festgeschriebenen Abrechnungen, Minijob nur als Arbeitnehmer",
    async (kontenrahmen, versteuerung) => {
      await firma(kontenrahmen, versteuerung);
      for (const e of [GGF, ANGESTELLT, MINIJOB]) await lohn.saveEmployee(actor, null, e);
      await abrechnen(2026, 10, "2026-10-28");

      const o = await lohn.lstaOverview(oktober, "2026-11-05");
      const ggfKist = (await sql`select kirchensteuer from payslips where mitarbeiter->>'vorname' = 'Erika'`)[0]!.kirchensteuer as number;
      const rkKist = (await sql`select kirchensteuer from payslips where mitarbeiter->>'vorname' = 'Max'`)[0]!.kirchensteuer as number;
      const pausch = (await sql`select pauschsteuer from payslips where mitarbeiter->>'vorname' = 'Mia'`)[0]!.pauschsteuer as number;
      expect(pausch).toBeGreaterThan(0);
      expect(ggfKist).toBeGreaterThan(0);
      expect(rkKist).toBeGreaterThan(0);
      const lst = await summe("lohnsteuer");
      const soli = await summe("soli");
      expect(o.issues).toEqual([]);
      expect(o.frist).toBe("2026-11-10");
      expect(o.turnus).toMatchObject({ turnus: "monatlich", eigen: false });
      expect(o.kennzahlen).toEqual({
        kz42: { vorjahr: 0, lfdJahr: lst, folgejahr: 0 },
        kz49: { vorjahr: 0, lfdJahr: soli, folgejahr: 0 },
        kirche: {
          kz61: { vorjahr: 0, lfdJahr: ggfKist, folgejahr: 0 },
          kz62: { vorjahr: 0, lfdJahr: rkKist, folgejahr: 0 },
          kz63: { vorjahr: 0, lfdJahr: 0, folgejahr: 0 },
        },
        kz48: lst,
        // Die Pauschsteuer des Minijobs geht an die Minijob-Zentrale, nicht in die Anmeldung
        kz83: lst + soli + ggfKist + rkKist,
        kz86: 3,
      });
      expect(o.naechste).toEqual({ berichtigt: false, kennzahlen: o.kennzahlen });

      const result = await lohn.submitLsta(actor, liveClient(), { kind: "validate", zeitraum: oktober, today: "2026-11-05" });
      expect(result.ok, result.message).toBe(true);
      expect(lastXml).toContain("<DatenArt>LStA</DatenArt>");
      expect(lastXml).toContain("<Zeitraum>10</Zeitraum>");
      expect(lastXml).toContain("<Kz86>3</Kz86>");
      expect(lastXml).toContain(`<Kz83>${(o.kennzahlen!.kz83 / 100).toFixed(2)}</Kz83>`);
      // Ausfüllliste für Mein ELSTER aus denselben Werten
      const liste = await lohn.lstaAusfuelllisteFuer(oktober, "2026-11-05");
      expect(liste.felder.find((f) => f.kennung === "Kz86")?.eingabe).toBe("3");
    },
    90_000,
  );

  it("Echtübermittlung: erst nach Ablauf, Frist erledigt, Verlauf nur anhängbar; nach Storno berichtigte Anmeldung; Bankvorschlag", async () => {
    await firma("SKR04", "ist");
    await lohn.saveEmployee(actor, null, GGF);
    await abrechnen(2026, 10, "2026-10-28");
    expect((await fristen.listFristen("2026-11-01")).find((f) => f.id === "lsta-2026-10")).toMatchObject({
      art: "lsta",
      datum: "2026-11-10",
      status: "offen",
      link: "/lohn/anmeldung/2026-10",
    });

    await expect(senden(oktober, "2026-10-30")).rejects.toThrow("erst nach Ablauf");
    const [vorher] = await sql`select count(*)::int as n from audit_log where table_name = 'lsta_submissions'`;
    const sent = await senden();
    expect(sent.ok, sent.message).toBe(true);
    expect(lastXml).not.toContain("<Testmerker>");
    expect(lastXml).not.toContain("<Kz10>");
    const [nachher] = await sql`select count(*)::int as n from audit_log where table_name = 'lsta_submissions'`;
    expect(nachher!.n).toBe(vorher!.n + 1);
    expect((await fristen.listFristen("2026-11-01")).find((f) => f.id === "lsta-2026-10")?.status).toBe("erledigt");
    expect(await lohn.lstaOverview(oktober, "2026-11-05")).toMatchObject({ sent: true, abweichend: false, naechste: null });
    await expect(senden()).rejects.toThrow("nichts zu berichtigen");
    await expect(sql`update lsta_submissions set berichtigt = true`).rejects.toThrow();
    await expect(sql`delete from lsta_submissions`).rejects.toThrow();

    // Bankabgleich: Lastschrift des Finanzamts über Kz 83 ist die Lohnsteuer des Zeitraums
    const kz83 = (await lohn.lstaOverview(oktober, "2026-11-05")).kennzahlen!.kz83;
    const euro = (kz83 / 100).toFixed(2).replace(".", ",");
    const csv = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n"Kontostand vom 30.11.2026:";"10.000,00 €"\n""\n"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n"10.11.26";"10.11.26";"Gebucht";"Firma";"Finanzamt Regensburg";"StNr 198/113/10010";"Ausgang";"";"-${euro}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(`﻿${csv}`), filename: "auszug.csv" }, null);
    const [umsatz] = await sql`select id from bank_transactions where amount = ${-kz83}`;
    const detail = await bank.transactionDetail(umsatz!.id as string);
    expect(detail?.direct).toMatchObject({ kind: "lohnsteuer", reasons: ["Gesamtbetrag (Kz 83) der Lohnsteuer-Anmeldung Oktober 2026"] });
    await bank.allocate(actor, { kind: "lohnsteuer", transactionId: umsatz!.id as string, amount: -kz83 });

    // Storno nach dem Senden: die Anmeldung weicht ab, Frist wieder offen, bis die Berichtigung gesendet ist
    const [p] = await sql`select id from payslips where locked_at is not null`;
    await lohn.stornieren(actor, { id: p!.id as string, grund: "Gehalt falsch" }, "2026-11-12");
    const abweichend = await lohn.lstaOverview(oktober, "2026-11-12");
    expect(abweichend).toMatchObject({ sent: true, abweichend: true, naechste: { berichtigt: true } });
    expect(abweichend.kennzahlen).toMatchObject({ kz48: 0, kz83: 0, kz86: 0 });
    expect((await fristen.listFristen("2026-11-12")).find((f) => f.id === "lsta-2026-10")).toMatchObject({
      status: "offen",
      titel: "Lohnsteuer-Anmeldung Oktober 2026 (Berichtigung)",
    });

    // Die neue Abrechnung mit denselben Werten: wieder wie gemeldet, nichts zu berichtigen
    const [neu] = await sql`select id from payslips where locked_at is null`;
    await lohn.festschreiben(actor, { id: neu!.id as string }, "2026-11-12");
    expect(await lohn.lstaOverview(oktober, "2026-11-12")).toMatchObject({ abweichend: false, naechste: null });

    // Erneutes Storno ohne neue Abrechnung: berichtigte Anmeldung mit Kz 10 und allen Werten
    const [zweite] = await sql`select id from payslips where locked_at is not null and replaces_id is not null`;
    await lohn.stornieren(actor, { id: zweite!.id as string, grund: "Austritt rückwirkend" }, "2026-11-13");
    const [entwurf] = await sql`select id from payslips where locked_at is null`;
    await lohn.entwurfLoeschen(actor, entwurf!.id as string);
    const berichtigt = await senden(oktober, "2026-11-13");
    expect(berichtigt.ok, berichtigt.message).toBe(true);
    expect(lastXml).toContain("<Kz10>1</Kz10>");
    expect(lastXml).toContain("<Kz83>0.00</Kz83>");
    expect(await lohn.lstaOverview(oktober, "2026-11-13")).toMatchObject({ abweichend: false, naechste: null });
    expect((await lohn.lstaSubmissions(oktober)).map((s) => [s.kind, s.berichtigt])).toEqual([
      ["send", true],
      ["send", false],
    ]);
  }, 90_000);

  it("Dezember mit Zahltag im Januar: Anmeldung Januar mit Spalte Vorjahr", async () => {
    await firma("SKR03", "soll");
    await lohn.saveEmployee(actor, null, GGF);
    await abrechnen(2026, 12, "2027-01-05");
    const dezember = await lohn.lstaOverview({ year: 2026, zeitraum: 12 }, "2027-01-08");
    expect(dezember.abrechnungen).toEqual([]);
    const januar = await lohn.lstaOverview({ year: 2027, zeitraum: 1 }, "2027-02-02");
    const lst = await summe("lohnsteuer");
    expect(januar.kennzahlen?.kz42).toEqual({ vorjahr: lst, lfdJahr: 0, folgejahr: 0 });
    expect(januar.frist).toBe("2027-02-10");
    expect((await lohn.lstaZeitraeume("2027-02-02")).map((z) => z.key)).toEqual(["2027-01"]);
  }, 60_000);

  it("Anmeldungszeitraum: Vorschlag aus dem Vorjahr, Einstellung, kein Wechsel gegen eine gesendete Anmeldung", async () => {
    await firma("SKR04", "soll");
    await lohn.saveEmployee(actor, null, GGF);
    await abrechnen(2026, 10, "2026-10-28");
    // Erste Buchung am 31.10.2026: im ersten Jahr zählt der erste volle Monat (November), noch nicht abgerechnet
    expect(await lohn.turnusDesJahres(2026)).toMatchObject({ turnus: "monatlich", eigen: false, vorschlag: null });
    // 2027: die Lohnsteuer von November und Dezember 2026 (zwei volle Monate), auf ein Jahr umgerechnet
    const v2027 = await lohn.turnusDesJahres(2027);
    expect(v2027.vorschlag?.grund).toContain("aus 2 Monaten auf das Jahr umgerechnet");
    expect(v2027.turnus).toBe("monatlich");

    await lohn.saveLstaTurnus(actor, { year: 2026, turnus: "vierteljaehrlich" });
    const monat = await lohn.lstaOverview(oktober, "2027-01-05");
    expect(monat.issues).toContainEqual({ tone: "error", text: expect.stringContaining("passt nicht zum Anmeldungszeitraum 2026 (vierteljährlich)") });
    await expect(lohn.submitLsta(actor, liveClient(), { kind: "validate", zeitraum: oktober, today: "2027-01-05" })).rejects.toThrow("passt nicht");
    const q4 = { year: 2026, zeitraum: 44 };
    expect((await lohn.lstaOverview(q4, "2027-01-05")).kennzahlen?.kz86).toBe(1);
    expect((await lohn.lstaZeitraeume("2027-01-05")).map((z) => z.key)).toEqual(["2026-Q4"]);
    expect((await senden(q4, "2027-01-05")).ok).toBe(true);
    expect(lastXml).toContain("<Zeitraum>44</Zeitraum>");
    await expect(lohn.saveLstaTurnus(actor, { year: 2026, turnus: "monatlich" })).rejects.toThrow("4. Quartal 2026");
    expect((await lohn.turnusDesJahres(2026)).turnus).toBe("vierteljaehrlich");
    const audit = async () => (await sql`select count(*)::int as n from audit_log where table_name = 'lsta_turnus'`)[0]!.n as number;
    const vorher = await audit();
    await lohn.saveLstaTurnus(actor, { year: 2027, turnus: "jaehrlich" });
    expect(await audit()).toBe(vorher + 1);
  }, 60_000);

  it("nicht unterstützt: Vorjahreslohn später als drei Wochen nach Jahresende und Vorauszahlung fürs Folgejahr (sonstige Bezüge)", async () => {
    // R 39b.2 Abs. 1 Nr. 7, Abs. 2 Satz 2 Nr. 8 LStR, § 38a Abs. 1 Satz 3 EStG: nur bis drei Wochen nach Ablauf des Jahres
    // laufender Arbeitslohn des Vorjahres; später oder im Voraus fürs Folgejahr gezahlt ein sonstiger Bezug des Zahlungsjahres
    await firma("SKR03", "ist");
    await lohn.saveEmployee(actor, null, GGF);
    await abrechnen(2026, 12, "2027-01-22");
    const januar = await lohn.lstaOverview({ year: 2027, zeitraum: 1 }, "2027-02-02");
    expect(januar.kennzahlen).toBeNull();
    expect(januar.issues).toContainEqual({ tone: "error", text: expect.stringContaining("sonstiger Bezug") });

    await firma("SKR04", "soll");
    await lohn.saveEmployee(actor, null, GGF);
    await abrechnen(2026, 1, "2025-12-30");
    const dezember = await lohn.lstaOverview({ year: 2025, zeitraum: 12 }, "2026-01-05");
    expect(dezember.kennzahlen).toBeNull();
    expect(dezember.issues).toContainEqual({ tone: "error", text: expect.stringContaining("sonstiger Bezug") });
  }, 60_000);

  it("Anmeldungszeitraum bleibt nach einer Echtübermittlung, auch wenn sich der Vorschlag danach ändert", async () => {
    await firma("SKR03", "soll");
    await lohn.saveEmployee(actor, null, { ...ANGESTELLT, monatsgehalt: 2000_00 });
    await abrechnen(2026, 10, "2026-10-28");
    // Erste Buchung am 31.10.2026, November noch nicht abgerechnet: kein Vorschlag, monatlich
    expect(await lohn.turnusDesJahres(2026)).toMatchObject({ turnus: "monatlich", vorschlag: null });
    expect((await senden()).ok).toBe(true);
    // November abgerechnet: der Vorschlag wäre jetzt vierteljährlich oder jährlich, die Oktober-Anmeldung ist aber gesendet
    await abrechnen(2026, 11, "2026-11-27");
    expect((await lohn.turnusDesJahres(2026)).vorschlag?.turnus).not.toBe("monatlich");
    expect((await lohn.turnusDesJahres(2026)).turnus).toBe("monatlich");
    expect((await lohn.lstaOverview(oktober, "2026-12-05")).issues.filter((i) => i.tone === "error")).toEqual([]);
    // Sonst stünde die schon gemeldete Oktober-Lohnsteuer ein zweites Mal im Quartal oder Kalenderjahr
    expect((await lohn.lstaZeitraeume("2026-12-05")).map((z) => z.key)).toEqual(["2026-10", "2026-11"]);
  }, 60_000);

  it("nicht unterstützt: alt-katholische Kirchensteuer in Sachsen (keine Kz 63)", async () => {
    await firma("SKR03", "ist", "SN");
    await lohn.saveEmployee(actor, null, { ...GGF, konfession: "ak", plz: "01067", ort: "Dresden" });
    await abrechnen(2026, 10, "2026-10-28");
    const o = await lohn.lstaOverview(oktober, "2026-11-05");
    expect(o.kennzahlen).toBeNull();
    expect(o.issues).toContainEqual({ tone: "error", text: expect.stringContaining("Kz 63") });
    await expect(lohn.submitLsta(actor, liveClient(), { kind: "validate", zeitraum: oktober, today: "2026-11-05" })).rejects.toThrow("Kz 63");
  }, 60_000);
});
