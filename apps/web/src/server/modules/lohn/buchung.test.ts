import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import type { EmployeeInput } from "./employees.ts";

/*
 * Lohnbuchung mit Postgres (docs/lohn-plan.md, PR 4): Festschreiben bucht, Storno bucht gegen, Lohnzahlungen im
 * Bankabgleich, im Einzelunternehmen die Ausgaben für Personal in der EÜR. SKR03 und SKR04, Ist und Soll, GmbH und
 * Einzelunternehmen. Beträge wie in packages/core/src/lohn-buchung.test.ts.
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
  art: "minijob",
  monatsgehalt: 603_00,
  personengruppe: "109",
  beitragsgruppen: "6500",
  u1Satz: 80,
  u2Satz: 22,
  kinderUnter25: 0,
};

/** Kontoauszug im DKB-Format mit Ausgängen */
function dkbCsv(rows: [date: string, to: string, purpose: string, amount: string][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n"Kontostand vom 30.11.2026:";"10.000,00 €"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows
    .map(([date, to, purpose, amount]) =>
      [date, date, "Gebucht", "Firma", to, purpose, amount.startsWith("-") ? "Ausgang" : "Eingang", "", amount, "", "", ""].map((c) => `"${c}"`).join(";"),
    )
    .join("\n");
  return { bytes: new TextEncoder().encode(`﻿${header}${columns}${body}\n`), filename: "auszug.csv" };
}

describe.skipIf(!testDatabaseUrl)("Lohnbuchung (Postgres)", () => {
  let lohn: typeof import("./index.ts");
  let bank: typeof import("../bank/bank.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let manual: typeof import("../buchhaltung/manual.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const oktober = { year: 2026, month: 10, zahltag: "2026-10-28" };

  beforeAll(async () => {
    sql = await setupTestDb();
    lohn = await import("./index.ts");
    bank = await import("../bank/bank.ts");
    reports = await import("../auswertungen/reports.ts");
    manual = await import("../buchhaltung/manual.ts");
    annual = await import("../jahreserklaerung/annual.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma(rechtsform: "gmbh" | "einzelunternehmen", kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await sql`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, year_closings,
      payslip_cancellations, payslips, payroll_runs, employees, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht Software', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB',
              ${kontenrahmen}, ${versteuerung}, ${rechtsform})`;
  }

  /** Legt den Mitarbeiter an, rechnet Oktober und schreibt fest; gibt die Abrechnung zurück */
  async function festgeschrieben(input: EmployeeInput) {
    const id = await lohn.saveEmployee(actor, null, input);
    await lohn.abrechnen(actor, oktober);
    const [p] = await sql<{ id: string }[]>`select id from payslips where employee_id = ${id} and locked_at is null`;
    await lohn.festschreiben(actor, { id: p!.id, gegengeprueft: input.art === "beschaeftigt" }, "2026-10-27");
    return { employeeId: id, payslipId: p!.id };
  }

  async function buchungen(payslipId: string) {
    const entries = await sql<{ id: string; date: string; description: string; reverses_id: string | null; locked_at: Date | null }[]>`
      select id, date::text, description, reverses_id, locked_at from journal_entries where source_type = 'lohn' and source_id = ${payslipId}
      order by created_at`;
    return Promise.all(
      entries.map(async (e) => ({
        ...e,
        lines: (await sql`select account, debit, credit, tax_code from journal_lines where entry_id = ${e.id} order by debit desc, account`).map((l) => [
          l.account,
          l.debit,
          l.credit,
          l.tax_code,
        ]),
      })),
    );
  }

  it("GmbH, SKR04, Soll: Festschreiben bucht den Geschäftsführer am Monatsende, versiegelt; Storno bucht am selben Tag gegen", async () => {
    await firma("gmbh", "SKR04", "soll");
    const { employeeId, payslipId } = await festgeschrieben(GGF);
    const [entry] = await buchungen(payslipId);
    expect(entry).toMatchObject({ date: "2026-10-31", description: "Lohn Oktober 2026 · Erika Muster", reverses_id: null });
    expect(entry!.locked_at).not.toBeNull();
    expect(entry!.lines).toEqual([
      ["6024", 6000_00, 0, null],
      ["3720", 0, 4594_64, null],
      ["3730", 0, 1405_36, null],
    ]);
    expect(await sql`select count(*)::int as n from seals where table_name = 'journal_entries' and row_id = ${entry!.id}`).toEqual([{ n: 1 }]);
    expect((await lohn.monatsuebersicht(2026, 10)).zeilen[0]?.payslips[0]).toMatchObject({ gebucht: true });

    await lohn.saveEmployee(actor, employeeId, { ...GGF, steuerklasse: 3 });
    await lohn.stornieren(actor, { id: payslipId, grund: "Steuerklasse" }, "2026-11-03");
    const [, storno] = await buchungen(payslipId);
    expect(storno).toMatchObject({ date: "2026-10-31", description: "Storno vom 03.11.2026: Lohn Oktober 2026 · Erika Muster", reverses_id: entry!.id });
    expect(storno!.lines).toEqual([
      ["3720", 4594_64, 0, null],
      ["3730", 1405_36, 0, null],
      ["6024", 0, 6000_00, null],
    ]);
    // Die neue Abrechnung ist ein Entwurf ohne Buchung; erst festgeschrieben gebucht
    const [neu] = await sql<{ id: string }[]>`select id from payslips where replaces_id = ${payslipId}`;
    expect(await buchungen(neu!.id)).toEqual([]);
    await lohn.festschreiben(actor, { id: neu!.id }, "2026-11-03");
    expect((await buchungen(neu!.id))[0]?.lines[0]).toEqual(["6024", 6000_00, 0, null]);
    expect(await sql`select art, befund from haben_integrity_problems(100)`).toEqual([]);
  });

  it("GmbH, SKR03, Ist: Beschäftigter mit Arbeitgeberanteilen; Lohnkonten sind für manuelle Buchungen gesperrt", async () => {
    await firma("gmbh", "SKR03", "ist");
    const { payslipId } = await festgeschrieben(ANGESTELLT);
    expect((await buchungen(payslipId))[0]!.lines).toEqual([
      ["4120", 4000_00, 0, null],
      ["4130", 937_60, 0, null],
      ["1740", 0, 2640_17, null],
      ["1741", 0, 539_83, null],
      ["1742", 0, 1757_60, null],
    ]);
    await expect(
      manual.createManualEntry(
        actor,
        {
          date: "2026-10-31",
          description: "Gehalt von Hand",
          lines: [
            { account: "4120", debit: 100_00, credit: 0 },
            { account: "0730", debit: 0, credit: 100_00 },
          ],
        },
        "2026-11-05",
      ),
    ).rejects.toThrow(/Konto 4120 führt das Nebenbuch Lohn/);
  });

  it("schreibt nicht fest, wenn sich die Abrechnung nicht buchen lässt (abgeschlossenes Jahr)", async () => {
    await firma("gmbh", "SKR04", "soll");
    await sql`insert into year_closings (year) values (2026)`;
    const id = await lohn.saveEmployee(actor, null, GGF);
    await lohn.abrechnen(actor, oktober);
    const [p] = await sql<{ id: string }[]>`select id from payslips where employee_id = ${id}`;
    await expect(lohn.festschreiben(actor, { id: p!.id }, "2026-10-27")).rejects.toThrow(/abgeschlossen/);
    expect(await sql`select locked_at from payslips where id = ${p!.id}`).toEqual([{ locked_at: null }]);
  });

  it("Einzelunternehmen, SKR03, Ist: Gesellschafter-Geschäftsführer nicht buchbar, also nicht festgeschrieben", async () => {
    await firma("einzelunternehmen", "SKR03", "ist");
    const id = await lohn.saveEmployee(actor, null, GGF);
    await lohn.abrechnen(actor, oktober);
    const [p] = await sql<{ id: string }[]>`select id from payslips where employee_id = ${id}`;
    await expect(lohn.festschreiben(actor, { id: p!.id }, "2026-10-27")).rejects.toThrow(/nur in GmbH und UG/);
    expect(await sql`select locked_at from payslips where id = ${p!.id}`).toEqual([{ locked_at: null }]);
    expect(await sql`select id from journal_entries`).toEqual([]);
  });

  it("Einzelunternehmen, SKR03, Ist: Minijob gebucht, Lohnzahlungen im Bankabgleich, Ausgaben für Personal in der EÜR", async () => {
    await firma("einzelunternehmen", "SKR03", "ist");
    await bank.importStatement(
      actor,
      dkbCsv([
        ["28.10.26", "Mia Aushilfe", "Lohn 10/2026", "-581,29"],
        ["28.10.26", "Knappschaft-Bahn-See", "Beitragsnachweis 10/2026", "-209,66"],
        ["02.11.26", "Inhaber", "Privat", "-500,00"],
      ]),
      null,
    );
    const umsatz = async (amount: number) => (await sql`select id from bank_transactions where amount = ${amount}`)[0]!.id as string;
    // Ohne festgeschriebene Abrechnung keine Lohnzahlung, etwa für eine Entnahme des Inhabers
    await expect(bank.allocate(actor, { kind: "lohn", transactionId: await umsatz(-500_00), amount: -500_00 })).rejects.toThrow(
      /erst zuordnen, wenn eine Lohnabrechnung festgeschrieben ist/,
    );

    const { payslipId } = await festgeschrieben(MINIJOB);
    expect((await buchungen(payslipId))[0]!.lines).toEqual([
      ["4195", 603_00, 0, null],
      ["4144", 175_89, 0, null],
      ["4194", 12_06, 0, null],
      ["1740", 0, 581_29, null],
      ["1742", 0, 209_66, null],
    ]);
    await bank.allocate(actor, { kind: "lohn", transactionId: await umsatz(-581_29), amount: -581_29 });
    await bank.allocate(actor, { kind: "sozialversicherung", transactionId: await umsatz(-209_66), amount: -209_66 });
    // Bezahlt: die Lohnverbindlichkeiten sind ausgeglichen
    const salden = await sql`select l.account, sum(l.debit - l.credit)::int as saldo from journal_lines l
      join journal_entries e on e.id = l.entry_id where l.account in ('1740', '1742') group by l.account order by l.account`;
    expect(salden).toEqual([
      { account: "1740", saldo: 0 },
      { account: "1742", saldo: 0 },
    ]);
    const euer = await reports.euerForYear(2026);
    expect(euer.ausgaben.find((l) => l.key === "personal")?.amount).toBe(790_95);
    expect(euer.totalAusgaben).toBe(790_95);
  });

  it("Einzelunternehmen, SKR04, Soll: Beschäftigter; Lohnsteuer im Folgemonat, Aufheben einer Zuordnung mindert die EÜR wieder", async () => {
    await firma("einzelunternehmen", "SKR04", "soll");
    const { payslipId } = await festgeschrieben(ANGESTELLT);
    expect((await buchungen(payslipId))[0]!.lines).toEqual([
      ["6020", 4000_00, 0, null],
      ["6110", 937_60, 0, null],
      ["3720", 0, 2640_17, null],
      ["3730", 0, 539_83, null],
      ["3740", 0, 1757_60, null],
    ]);
    await bank.importStatement(
      actor,
      dkbCsv([
        ["28.10.26", "Max Beispiel", "Gehalt 10/2026", "-2.640,17"],
        ["28.10.26", "Techniker Krankenkasse", "Beitrag 10/2026", "-1.757,60"],
        ["10.11.26", "Finanzamt Bremen", "LSt 10/2026", "-539,83"],
      ]),
      null,
    );
    const umsatz = async (amount: number) => (await sql`select id from bank_transactions where amount = ${amount}`)[0]!.id as string;
    await bank.allocate(actor, { kind: "lohn", transactionId: await umsatz(-2640_17), amount: -2640_17 });
    await bank.allocate(actor, { kind: "sozialversicherung", transactionId: await umsatz(-1757_60), amount: -1757_60 });
    await bank.allocate(actor, { kind: "lohnsteuer", transactionId: await umsatz(-539_83), amount: -539_83 });
    const [lst] = await sql`select l.account, l.debit from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_type = 'allocation' and e.date = '2026-11-10' and l.debit > 0`;
    expect(lst).toEqual({ account: "3730", debit: 539_83 });
    const personal = async () => (await reports.euerForYear(2026)).ausgaben.find((l) => l.key === "personal")?.amount;
    expect(await personal()).toBe(4937_60);
    const [allocation] = await sql`select id from allocations where kind = 'lohnsteuer'`;
    await bank.reverseAllocation(actor, allocation!.id);
    expect(await personal()).toBe(4397_77);
  });

  it("Einzelunternehmen, SKR03, Soll: Lohnsteuer für Dezember im Januar bezahlt, Hinweis auf § 11 Abs. 2 Satz 2 EStG in beiden Jahren", async () => {
    await firma("einzelunternehmen", "SKR03", "soll");
    await festgeschrieben(ANGESTELLT);
    await bank.importStatement(actor, dkbCsv([["08.01.27", "Finanzamt Bremen", "LSt 12/2026", "-539,83"]]), null);
    const [t] = await sql`select id from bank_transactions`;
    await bank.allocate(actor, { kind: "lohnsteuer", transactionId: t!.id, amount: -539_83 });
    const hinweis = async (year: number) =>
      (await annual.annualOverview(year, "2027-02-01")).euer.issues.filter((i) => i.text.includes("§ 11 Abs. 2 Satz 2 EStG")).map((i) => i.tone);
    expect(await hinweis(2026)).toEqual(["hinweis"]);
    expect(await hinweis(2027)).toEqual(["hinweis"]);
    expect(await hinweis(2025)).toEqual([]);
    // Abfluss im Januar: Ausgabe 2027
    expect((await reports.euerForYear(2027)).ausgaben.find((l) => l.key === "personal")?.amount).toBe(539_83);
    const [allocation] = await sql`select id from allocations`;
    await bank.reverseAllocation(actor, allocation!.id);
    expect(await hinweis(2026)).toEqual([]);
  });

  it("bucht eine vor der Lohnbuchung festgeschriebene Abrechnung nach; ihr Storno hat dann nichts gegenzubuchen", async () => {
    await firma("gmbh", "SKR03", "soll");
    const id = await lohn.saveEmployee(actor, null, GGF);
    await lohn.abrechnen(actor, oktober);
    const [p] = await sql<{ id: string }[]>`select id from payslips where employee_id = ${id}`;
    // So hat PR 3 festgeschrieben: gesperrt, ohne Buchung
    await sql`update payslips set locked_at = now(), pdf = '\\x00', sha256 = 'x' where id = ${p!.id}`;
    expect((await lohn.monatsuebersicht(2026, 10)).zeilen[0]?.payslips[0]).toMatchObject({ gebucht: false });
    await lohn.nachbuchen(actor, p!.id);
    expect((await buchungen(p!.id))[0]?.lines[0]).toEqual(["4124", 6000_00, 0, null]);
    await expect(lohn.nachbuchen(actor, p!.id)).rejects.toThrow(/schon gebucht/);

    // Zweite Abrechnung desselben Stands, ohne Buchung storniert: keine Gegenbuchung
    await lohn.stornieren(actor, { id: p!.id }, "2026-11-03");
    const [neu] = await sql<{ id: string }[]>`select id from payslips where replaces_id = ${p!.id}`;
    await expect(lohn.nachbuchen(actor, neu!.id)).rejects.toThrow(/Entwurf/);
    await sql`update payslips set locked_at = now(), pdf = '\\x00', sha256 = 'x' where id = ${neu!.id}`;
    await lohn.stornieren(actor, { id: neu!.id }, "2026-11-04");
    expect(await buchungen(neu!.id)).toEqual([]);
    await expect(lohn.nachbuchen(actor, neu!.id)).rejects.toThrow(/storniert/);
  });
});
