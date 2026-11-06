import { ebilanzPosition, postenForSaldo } from "@haben/core";
import { parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Steuerzahlungen und Zinserträge im Bankabgleich mit Postgres (Roadmap Platz 13, Prüffälle 1 und 3 aus #312): Buchung,
 * Sperre und Siegel, EÜR und Anlage EÜR, Voranmeldung unverändert, Abgleich, DATEV, GmbH mit Steuerrückstellung und
 * E-Bilanz. SKR03 und SKR04, Ist und Soll, Einzelunternehmen und GmbH.
 */

function dkbCsv(rows: [date: string, name: string, purpose: string, amount: string][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows
    .map(([date, name, purpose, amount]) =>
      [
        date,
        date,
        "Gebucht",
        amount.startsWith("-") ? "Nordlicht" : name,
        amount.startsWith("-") ? name : "Nordlicht",
        purpose,
        amount.startsWith("-") ? "Ausgang" : "Eingang",
        "",
        amount,
        "",
        "",
        "",
      ]
        .map((c) => `"${c}"`)
        .join(";"),
    )
    .join("\n");
  return { bytes: new TextEncoder().encode(`﻿${header}${columns}${body}\n`), filename: "auszug.csv" };
}

describe.skipIf(!testDatabaseUrl)("Steuerzahlungen im Bankabgleich (Postgres)", () => {
  let bank: typeof import("./bank.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let datev: typeof import("../auswertungen/datev-export.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let manual: typeof import("../buchhaltung/manual.ts");
  let ledger: typeof import("../buchhaltung/ledger.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./bank.ts");
    reports = await import("../auswertungen/reports.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
    datev = await import("../auswertungen/datev-export.ts");
    annual = await import("../jahreserklaerung/annual.ts");
    figures = await import("../umsatzsteuer/vat-figures.ts");
    manual = await import("../buchhaltung/manual.ts");
    ledger = await import("../buchhaltung/ledger.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma(rechtsform: "gmbh" | "einzelunternehmen", kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await sql`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform,
                                   datev_berater_nr, datev_mandant_nr)
      values (1, 'Nordlicht Software', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB',
              ${kontenrahmen}, ${versteuerung}, ${rechtsform}, '29098', '55003')`;
  }

  const umsatz = async (amount: number) => (await sql<{ id: string }[]>`select id from bank_transactions where amount = ${amount}`)[0]!.id;

  /** Zeilen der Buchungen aus Zuordnungen, je Konto Soll − Haben */
  async function salden() {
    const rows = await sql<{ account: string; saldo: number }[]>`
      select l.account, sum(l.debit - l.credit)::int as saldo from journal_lines l join journal_entries e on e.id = l.entry_id
       where e.source_type = 'allocation' group by l.account having sum(l.debit - l.credit) <> 0 order by l.account`;
    return Object.fromEntries(rows.map((r) => [r.account, r.saldo]));
  }

  it("Prüffall 1, Einzelunternehmen, SKR03, Ist: Umsatzsteuer 2024 im Oktober 2026 gezahlt", async () => {
    await firma("einzelunternehmen", "SKR03", "ist");
    await bank.importStatement(actor, dkbCsv([["15.10.26", "Finanzamt Bremen", "USt 2024 Bescheid vom 01.10.2026", "-1.000,00"]]), null);
    const vorher = await figures.computeVatFigures({ year: 2026, month: 10 });
    await bank.allocate(actor, {
      kind: "steuer",
      transactionId: await umsatz(-1000_00),
      amount: -1000_00,
      steuer: { art: "ust", jahr: 2024, posten: "steuer" },
    });

    expect(await salden()).toEqual({ "1200": -1000_00, "1791": 1000_00 });
    const [entry] = await sql`select description, locked_at from journal_entries where source_type = 'allocation'`;
    expect(entry!.description).toBe("Umsatzsteuer 2024 · Zahlung · Finanzamt Bremen");
    expect(entry!.locked_at).not.toBeNull();
    // Steuerart und Bezugsjahr bleiben am Vorgang, gesperrt und versiegelt
    const [allocation] = await sql`select id, tax_type, tax_year, tax_item from allocations`;
    expect(allocation).toMatchObject({ tax_type: "ust", tax_year: 2024, tax_item: "steuer" });
    await expect(sql`update allocations set tax_year = 2025 where id = ${allocation!.id}`).rejects.toThrow();
    expect(await sql`select count(*)::int as n from seals where table_name = 'allocations' and row_id = ${allocation!.id}`).toEqual([{ n: 1 }]);
    expect((await bank.transactionDetail(await umsatz(-1000_00)))?.allocations[0]?.steuerLabel).toBe("Umsatzsteuer 2024 · Zahlung");

    // Kein neuer Umsatz, keine Vorsteuer: die Voranmeldung Oktober 2026 bleibt, wie sie war
    expect(await figures.computeVatFigures({ year: 2026, month: 10 })).toEqual(vorher);
    // EÜR: Abfluss 2026 als gezahlte Umsatzsteuer, 2024 unberührt
    const euer = await reports.euerForYear(2026);
    expect(euer.ausgaben.find((l) => l.key === "gezahlteUst")?.amount).toBe(1000_00);
    expect((await reports.euerForYear(2024)).totalAusgaben).toBe(0);
    expect((await annual.euerYear(2026)).figures.gezahlteUst).toBe(1000_00);
    expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
    // DATEV: die Kontierung für frühere Jahre
    const stack = parseDatevBuchungsstapel((await datev.datevExport(2026)).bytes);
    expect(stack.bookings.map((b) => [b.account, b.contraAccount, b.amount, b.side, b.buKey])).toEqual([["1791", "1200", 1000_00, "S", ""]]);
    expect(await sql`select art, befund from haben_integrity_problems(100)`).toEqual([]);
  });

  it("Einzelunternehmen, SKR04, Soll: Erstattung Umsatzsteuer Vorjahr und Erstattungszinsen; Hinweis um den Jahreswechsel", async () => {
    await firma("einzelunternehmen", "SKR04", "soll");
    await bank.importStatement(actor, dkbCsv([["07.01.27", "Finanzamt Bremen", "Erstattung USt 2026 mit Zinsen", "512,00"]]), null);
    await bank.allocateSplit(actor, {
      transactionId: await umsatz(512_00),
      parts: [
        { kind: "steuer", amount: 500_00, steuer: { art: "ust", jahr: 2026, posten: "steuer" } },
        { kind: "steuer", amount: 12_00, steuer: { art: "ust", jahr: 2026, posten: "zinsen233a" } },
      ],
    });
    expect(await salden()).toEqual({ "1800": 512_00, "3841": -500_00, "7105": -12_00 });
    const euer = await reports.euerForYear(2027);
    expect(euer.einnahmen.find((l) => l.key === "erstatteteUst")?.amount).toBe(500_00);
    expect(euer.einnahmen.find((l) => l.key === "einnahmenSteuerfrei")?.amount).toBe(12_00);
    expect(abgleich.abweichungen((await abgleich.euerAbgleich(2027)).zeilen)).toEqual([]);
    // Zahlung zwischen 22.12. und 10.01.: Hinweis auf § 11 Abs. 2 Satz 2 EStG in beiden Jahren
    const hinweis = async (year: number) =>
      (await annual.annualOverview(year, "2027-02-01")).euer.issues.filter((i) => i.text.includes("Umsatzsteuer früherer Jahre")).map((i) => i.tone);
    expect(await hinweis(2027)).toEqual(["hinweis"]);
    expect(await hinweis(2026)).toEqual(["hinweis"]);
    expect(await hinweis(2025)).toEqual([]);
  });

  it("Prüffall 3, Einzelunternehmen, SKR03, Soll: Gewerbesteuerbescheid 2024 mit Zinsen und Zuschlag, eine Zahlung", async () => {
    await firma("einzelunternehmen", "SKR03", "soll");
    await bank.importStatement(actor, dkbCsv([["20.10.26", "Stadtkasse Bremen", "GewSt 2024 Bescheid", "-543,00"]]), null);
    const transactionId = await umsatz(-543_00);
    // Körperschaftsteuer gibt es im Einzelunternehmen nicht; nichts gebucht
    await expect(
      bank.allocate(actor, { kind: "steuer", transactionId, amount: -543_00, steuer: { art: "kst", jahr: 2024, posten: "steuer" } }),
    ).rejects.toThrow(/Körperschaftsteuer gibt es nur in GmbH und UG/);
    await bank.allocateSplit(actor, {
      transactionId,
      parts: [
        { kind: "steuer", amount: -500_00, steuer: { art: "gewst", jahr: 2024, posten: "steuer" } },
        { kind: "steuer", amount: -18_00, steuer: { art: "gewst", jahr: 2024, posten: "zinsen233a" } },
        { kind: "steuer", amount: -25_00, steuer: { art: "gewst", jahr: 2024, posten: "verspaetung" } },
      ],
    });
    expect(await salden()).toEqual({ "1200": -543_00, "2105": 18_00, "2281": 500_00, "4397": 25_00 });
    // Keine Betriebsausgabe, nicht wie 500 € Betriebsbedarf: Gewinn unverändert, die Anlage EÜR nennt sie nachrichtlich
    const euer = await reports.euerForYear(2026);
    expect(euer.totalAusgaben).toBe(0);
    expect(euer.gewerbesteuerNichtAbziehbar).toBe(543_00);
    const year = await annual.euerYear(2026);
    expect(year.figures.gewerbesteuerNichtAbziehbar).toBe(543_00);
    expect(year.ausgaben).toBe(0);
    expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
    // Nur zusammen aufzuheben; danach ist alles wieder offen und die EÜR leer
    const [first] = await sql`select id from allocations order by created_at limit 1`;
    await bank.reverseAllocation(actor, first!.id);
    expect(await salden()).toEqual({});
    expect((await reports.euerForYear(2026)).gewerbesteuerNichtAbziehbar).toBe(0);
    const reversed = await sql`select tax_type, tax_year, tax_item, amount from allocations where reverses_id is not null order by amount`;
    expect(reversed.map((r) => [r.tax_type, r.tax_year, r.tax_item, r.amount])).toEqual([
      ["gewst", 2024, "zinsen233a", 18_00],
      ["gewst", 2024, "verspaetung", 25_00],
      ["gewst", 2024, "steuer", 500_00],
    ]);
  });

  it.each([
    ["einzelunternehmen", "SKR03", "ist", { bank: "1200", gewst: "2281", zinsen: "2657" }],
    ["gmbh", "SKR04", "soll", { bank: "1800", gewst: "7641", zinsen: "7105" }],
  ] as const)(
    "%s, %s, %s: Erstattung der Gewerbesteuer mit Erstattungszinsen – die Zinsen sind Betriebseinnahmen (#312)",
    async (rechtsform, kr, versteuerung, konten) => {
      await firma(rechtsform, kr, versteuerung);
      await bank.importStatement(actor, dkbCsv([["20.06.26", "Stadtkasse Bremen", "Erstattung GewSt 2024 mit Zinsen", "350,00"]]), null);
      const transactionId = await umsatz(350_00);
      await bank.allocateSplit(actor, {
        transactionId,
        parts: [
          { kind: "steuer", amount: 300_00, steuer: { art: "gewst", jahr: 2024, posten: "steuer" } },
          { kind: "steuer", amount: 50_00, steuer: { art: "gewst", jahr: 2024, posten: "zinsen233a" } },
        ],
      });
      const s = await salden();
      expect(s).toEqual({ [konten.bank]: 350_00, [konten.gewst]: -300_00, [konten.zinsen]: -50_00 });
      if (rechtsform === "einzelunternehmen") {
        // Die Erstattung der Gewerbesteuer selbst bleibt außerhalb des Gewinns, die Zinsen zählen als Einnahme
        expect((await reports.euerForYear(2026)).einnahmen.find((l) => l.key === "einnahmenSteuerfrei")?.amount).toBe(50_00);
        expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
      } else {
        for (const [account, saldo] of Object.entries(s)) expect(ebilanzPosition(kr, account, saldo), account).not.toBeNull();
      }
    },
  );

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)(
    "Einzelunternehmen, %s, %s: Erstattungszinsen und Nachzahlungszinsen zur Gewerbesteuer in einem Umsatz – die EÜR verrechnet sie nicht",
    async (kr, versteuerung) => {
      await firma("einzelunternehmen", kr, versteuerung);
      // Ein Bescheid für zwei Jahre: Erstattung 2024 mit Erstattungszinsen, verrechnet mit Nachzahlungszinsen für 2023
      await bank.importStatement(actor, dkbCsv([["20.06.26", "Stadtkasse Bremen", "GewSt 2023 und 2024", "270,00"]]), null);
      const transactionId = await umsatz(270_00);
      await bank.allocateSplit(actor, {
        transactionId,
        parts: [
          { kind: "steuer", amount: 300_00, steuer: { art: "gewst", jahr: 2024, posten: "steuer" } },
          { kind: "steuer", amount: 50_00, steuer: { art: "gewst", jahr: 2024, posten: "zinsen233a" } },
          { kind: "steuer", amount: -80_00, steuer: { art: "gewst", jahr: 2023, posten: "zinsen233a" } },
        ],
      });
      const euer = await reports.euerForYear(2026);
      expect(euer.einnahmen.find((l) => l.key === "einnahmenSteuerfrei")?.amount).toBe(50_00);
      expect(euer.gewerbesteuerNichtAbziehbar).toBe(-300_00 + 80_00);
      expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
    },
  );

  it("Einzelunternehmen, SKR04, Ist: Zinsen zur Umsatzsteuer abziehbar; Einkommensteuer und Zinsen darauf als Entnahme", async () => {
    await firma("einzelunternehmen", "SKR04", "ist");
    await bank.importStatement(
      actor,
      dkbCsv([
        ["12.08.26", "Finanzamt Bremen", "USt Zinsen und Säumniszuschlag", "-60,00"],
        ["13.08.26", "Finanzamt Bremen", "ESt 2024 Nachzahlung mit Zinsen", "-2.040,00"],
      ]),
      null,
    );
    await bank.allocateSplit(actor, {
      transactionId: await umsatz(-60_00),
      parts: [
        { kind: "steuer", amount: -45_00, steuer: { art: "ust", jahr: 2025, posten: "zinsen233a" } },
        { kind: "steuer", amount: -15_00, steuer: { art: "ust", jahr: 2026, posten: "saeumnis" } },
      ],
    });
    await bank.allocateSplit(actor, {
      transactionId: await umsatz(-2040_00),
      parts: [
        { kind: "steuer", amount: -2000_00, steuer: { art: "est", jahr: 2024, posten: "steuer" } },
        { kind: "steuer", amount: -40_00, steuer: { art: "est", jahr: 2024, posten: "zinsen233a" } },
      ],
    });
    expect(await salden()).toEqual({ "1800": -2100_00, "2150": 2040_00, "7303": 15_00, "7305": 45_00 });
    const euer = await reports.euerForYear(2026);
    expect(euer.ausgaben.find((l) => l.key === "steuerNebenleistungen")?.amount).toBe(60_00);
    expect(euer.totalAusgaben).toBe(60_00 + 0);
    const year = await annual.euerYear(2026);
    expect(year.figures.uebrige).toBe(60_00);
    expect(year.figures.entnahmen).toBe(2040_00);
    expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
  });

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("Einzelunternehmen, %s, %s: Erstattung der Einkommensteuer ohne Entnahmen ist eine Einlage, keine negative Entnahme", async (kr, vst) => {
    await firma("einzelunternehmen", kr, vst);
    await bank.importStatement(actor, dkbCsv([["14.09.26", "Finanzamt Bremen", "Erstattung ESt 2024", "800,00"]]), null);
    await bank.allocate(actor, { kind: "steuer", transactionId: await umsatz(800_00), amount: 800_00, steuer: { art: "est", jahr: 2024, posten: "steuer" } });
    const year = await annual.euerYear(2026);
    // Anlage EÜR Zeilen 101 und 102: Entnahmen und Einlagen stehen je für sich, beide nicht negativ
    expect(year.figures.entnahmen).toBe(0);
    expect(year.figures.einlagen).toBe(800_00);
    expect(year.gewinn).toBe(0);
  });

  it("Einzelunternehmen, SKR03, Ist: Zinsgutschrift mit einbehaltener Kapitalertragsteuer", async () => {
    await firma("einzelunternehmen", "SKR03", "ist");
    await bank.importStatement(actor, dkbCsv([["30.06.26", "Nordbank", "Zinsen 2. Quartal", "73,63"]]), null);
    await bank.allocateSplit(actor, {
      transactionId: await umsatz(73_63),
      parts: [
        { kind: "zinsertrag", amount: 100_00 },
        { kind: "steuer", amount: -25_00, steuer: { art: "kapest", jahr: 2026, posten: "steuer" } },
        { kind: "steuer", amount: -1_37, steuer: { art: "kapestSoli", jahr: 2026, posten: "steuer" } },
      ],
    });
    expect(await salden()).toEqual({ "1200": 73_63, "1810": 26_37, "2650": -100_00 });
    const euer = await reports.euerForYear(2026);
    expect(euer.einnahmen.find((l) => l.key === "einnahmenSteuerfrei")?.amount).toBe(100_00);
    expect(euer.gewinn).toBe(100_00);
    expect((await annual.euerYear(2026)).figures.entnahmen).toBe(26_37);
    // Ein Zinsertrag ohne Steuer geht auch direkt
    await bank.importStatement(actor, dkbCsv([["30.09.26", "Nordbank", "Zinsen 3. Quartal", "4,10"]]), null);
    await bank.allocate(actor, { kind: "zinsertrag", transactionId: await umsatz(4_10), amount: 4_10 });
    expect((await reports.euerForYear(2026)).einnahmen.find((l) => l.key === "einnahmenSteuerfrei")?.amount).toBe(104_10);
  });

  it("GmbH, SKR03, Soll: Körperschaftsteuer-Nachzahlung verbraucht zuerst die Rückstellung, der Rest ist Aufwand für Vorjahre", async () => {
    await firma("gmbh", "SKR03", "soll");
    // Rückstellung aus dem Jahresabschluss 2025: 1.000 € Körperschaftsteuer (so bucht sie bookSteuerrueckstellungen)
    await manual.createManualEntry(
      actor,
      {
        kind: "umbuchung",
        date: "2025-12-31",
        description: "Steuerrückstellungen 2025",
        lines: [
          { account: "2200", debit: 1000_00, credit: 0 },
          { account: "0963", debit: 0, credit: 1000_00 },
        ],
      },
      "2026-01-15",
    );
    await bank.importStatement(
      actor,
      dkbCsv([
        ["10.03.26", "Finanzamt Bremen", "KSt VZ I/2026", "-800,00"],
        ["15.07.26", "Finanzamt Bremen", "KSt 2025 Bescheid", "-1.200,00"],
        ["16.07.26", "Finanzamt Bremen", "KSt 2025 Änderung", "-100,00"],
      ]),
      null,
    );
    await bank.allocate(actor, { kind: "steuer", transactionId: await umsatz(-800_00), amount: -800_00, steuer: { art: "kst", jahr: 2026, posten: "steuer" } });
    await bank.allocate(actor, {
      kind: "steuer",
      transactionId: await umsatz(-1200_00),
      amount: -1200_00,
      steuer: { art: "kst", jahr: 2025, posten: "steuer" },
    });
    await bank.allocate(actor, { kind: "steuer", transactionId: await umsatz(-100_00), amount: -100_00, steuer: { art: "kst", jahr: 2025, posten: "steuer" } });
    expect(await salden()).toEqual({ "0963": 1000_00, "1200": -2100_00, "2200": 800_00, "2203": 300_00 });
    // Aufheben gibt die Rückstellung wieder frei
    const [zweite] = await sql`select a.id from allocations a join bank_transactions t on t.id = a.transaction_id where t.amount = -120000`;
    await bank.reverseAllocation(actor, zweite!.id);
    const [dritte] = await sql`select a.id from allocations a join bank_transactions t on t.id = a.transaction_id where t.amount = -10000`;
    await bank.reverseAllocation(actor, dritte!.id);
    await bank.allocate(actor, { kind: "steuer", transactionId: await umsatz(-100_00), amount: -100_00, steuer: { art: "kst", jahr: 2025, posten: "steuer" } });
    expect(await salden()).toEqual({ "0963": 100_00, "1200": -900_00, "2200": 800_00 });
    // Einkommensteuer gibt es in der GmbH nicht
    await expect(
      bank.allocate(actor, { kind: "steuer", transactionId: await umsatz(-1200_00), amount: -1200_00, steuer: { art: "est", jahr: 2025, posten: "steuer" } }),
    ).rejects.toThrow(/nur im Einzelunternehmen/);
  });

  it("GmbH, SKR04, Ist: Gewerbesteuer, Säumniszuschlag und Erstattung; jedes Konto hat eine Position in Bilanz und E-Bilanz", async () => {
    await firma("gmbh", "SKR04", "ist");
    await bank.importStatement(
      actor,
      dkbCsv([
        ["15.05.26", "Stadtkasse Bremen", "GewSt VZ II/2026 mit Säumniszuschlag", "-505,00"],
        ["20.06.26", "Stadtkasse Bremen", "Erstattung GewSt 2024", "300,00"],
        ["21.06.26", "Finanzamt Bremen", "Verspätungszuschlag USt 2025", "-50,00"],
      ]),
      null,
    );
    await bank.allocateSplit(actor, {
      transactionId: await umsatz(-505_00),
      parts: [
        { kind: "steuer", amount: -500_00, steuer: { art: "gewst", jahr: 2026, posten: "steuer" } },
        { kind: "steuer", amount: -5_00, steuer: { art: "gewst", jahr: 2026, posten: "saeumnis" } },
      ],
    });
    await bank.allocate(actor, { kind: "steuer", transactionId: await umsatz(300_00), amount: 300_00, steuer: { art: "gewst", jahr: 2024, posten: "steuer" } });
    await bank.allocate(actor, {
      kind: "steuer",
      transactionId: await umsatz(-50_00),
      amount: -50_00,
      steuer: { art: "ust", jahr: 2025, posten: "verspaetung" },
    });
    const s = await salden();
    expect(s).toEqual({ "1800": -255_00, "6436": 50_00, "7302": 5_00, "7610": 500_00, "7641": -300_00 });
    for (const [account, saldo] of Object.entries(s)) {
      expect(postenForSaldo("SKR04", account, saldo), account).not.toBeNull();
      expect(ebilanzPosition("SKR04", account, saldo), account).not.toBeNull();
    }
    expect(ebilanzPosition("SKR04", "7302", 5_00)).toBe("is.netIncome.regular.fin.netInterest.expenses.regularInterest.relatedPayments.nondeduct");
    expect(ebilanzPosition("SKR04", "7641", -300_00)).toBe("is.netIncome.tax.prevPeriodReceived.gewst");
    const liste = await ledger.saldenliste(ledger.ledgerRange(2026));
    expect(liste.find((z) => z.account === "7302")?.name).toMatch(/§ 4 Abs. 5b EStG/);
  });
});
