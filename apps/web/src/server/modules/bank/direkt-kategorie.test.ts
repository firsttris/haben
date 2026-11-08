import { parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { today } from "../../today.ts";

/*
 * Direkt buchen mit Kategorie und Steuersatz im Bankabgleich mit Postgres (Roadmap Platz 1, #324): Buchung, Sperre und
 * Siegel, Voranmeldung bei Ist und Soll, EÜR und Anlage EÜR, Abgleich Journal gegen Nebenbücher, DATEV, Aufhebung und
 * Aufteilung. SKR03 und SKR04, Ist und Soll, dazu Kleinunternehmer.
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

/** Heute als TT.MM.JJ für den Kontoauszug: Den Kleinunternehmer-Stand liest Haben aus dem Änderungsprotokoll nach Tag */
const heute = today();
const heuteDkb = `${heute.slice(8, 10)}.${heute.slice(5, 7)}.${heute.slice(2, 4)}`;

describe.skipIf(!testDatabaseUrl)("Direkt buchen mit Kategorie und Steuersatz (Postgres)", () => {
  let bank: typeof import("./bank.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let datev: typeof import("../auswertungen/datev-export.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
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
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", kleinunternehmer = false, rechtsform = "einzelunternehmen") {
    await sql`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform,
                                   kleinunternehmer, datev_berater_nr, datev_mandant_nr)
      values (1, 'Nordlicht Software', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB',
              ${kontenrahmen}, ${versteuerung}, ${rechtsform}, ${kleinunternehmer}, '29098', '55003')`;
  }

  const umsatz = async (amount: number) => (await sql<{ id: string }[]>`select id from bank_transactions where amount = ${amount}`)[0]!.id;

  /** Zeilen der Buchungen aus Zuordnungen, je Konto Soll − Haben */
  async function salden() {
    const rows = await sql<{ account: string; saldo: number }[]>`
      select l.account, sum(l.debit - l.credit)::int as saldo from journal_lines l join journal_entries e on e.id = l.entry_id
       where e.source_type = 'allocation' group by l.account having sum(l.debit - l.credit) <> 0 order by l.account`;
    return Object.fromEntries(rows.map((r) => [r.account, r.saldo]));
  }

  const keineAbweichung = async (year: number, month: number) => {
    expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year, month })).zeilen)).toEqual([]);
    expect(abgleich.abweichungen((await abgleich.euerAbgleich(year)).zeilen)).toEqual([]);
    // Nur die Zeilen dieses Tests: Siegel früherer Tests zeigen nach dem Leeren der Tabellen ins Leere
    const zeilen = await sql`select id::text from allocations union all select id::text from journal_entries`;
    const ids = new Set(zeilen.map((z) => z.id));
    expect((await sql`select art, befund, zeile::text from haben_integrity_problems(1000)`).filter((p) => ids.has(p.zeile))).toEqual([]);
  };

  it.each([
    ["SKR03", "ist", { bank: "1200", erloese: "8400", ust: "1776" }],
    ["SKR03", "soll", { bank: "1200", erloese: "8400", ust: "1776" }],
    ["SKR04", "ist", { bank: "1800", erloese: "4400", ust: "3806" }],
    ["SKR04", "soll", { bank: "1800", erloese: "4400", ust: "3806" }],
  ] as const)("%s, %s: Zahlung eines Privatkunden mit 19 % (Beispiel aus #324)", async (kr, versteuerung, konten) => {
    await firma(kr, versteuerung);
    await bank.importStatement(actor, dkbCsv([["15.10.26", "Erika Beispiel", "Reparatur Notebook", "119,00"]]), null);
    const transactionId = await umsatz(119_00);
    await bank.allocate(actor, { kind: "kategorie", transactionId, amount: 119_00, kategorie: { kategorie: "erloese", steuersatz: 1900 } });

    // Die Umsatzsteuer ist mit der Zahlung fällig, auch bei Ist: kein Umweg über „nicht fällig“
    expect(await salden()).toEqual({ [konten.bank]: 119_00, [konten.erloese]: -100_00, [konten.ust]: -19_00 });
    const [entry] = await sql`select description, locked_at from journal_entries where source_type = 'allocation'`;
    expect(entry!.description).toBe("Erika Beispiel · Erlöse 19 %");
    expect(entry!.locked_at).not.toBeNull();
    // Kategorie und Steuersatz bleiben an der Zuordnung, gesperrt und versiegelt
    const [allocation] = await sql`select id, kind, category, tax_rate from allocations`;
    expect(allocation).toMatchObject({ kind: "kategorie", category: "erloese", tax_rate: 1900 });
    await expect(sql`update allocations set tax_rate = 700 where id = ${allocation!.id}`).rejects.toThrow();
    expect(await sql`select count(*)::int as n from seals where table_name = 'allocations' and row_id = ${allocation!.id}`).toEqual([{ n: 1 }]);
    expect((await bank.transactionDetail(transactionId))?.allocations[0]?.kategorieLabel).toBe("Erlöse 19 %");

    // Voranmeldung Oktober 2026: Kz 81 mit 100 € und 19 € Steuer, bei Ist wie bei Soll am Tag der Zahlung
    const oktober = await figures.computeVatFigures({ year: 2026, month: 10 });
    expect([oktober.kz81, oktober.tax81, oktober.kz66]).toEqual([100_00, 19_00, 0]);
    expect(oktober.revenue).toMatchObject([{ type: "direkt", transactionId, date: "2026-10-15", rate: 1900, base: 100_00, tax: 19_00 }]);
    expect((await figures.computeVatFigures({ year: 2026, month: 9 })).kz81).toBe(0);

    // EÜR: 100 € steuerpflichtige Einnahme, 19 € vereinnahmte Umsatzsteuer; in der Anlage EÜR ebenso
    const euer = await reports.euerForYear(2026);
    expect(euer.einnahmen.find((l) => l.key === "einnahmenSteuerpflichtig")?.amount).toBe(100_00);
    expect(euer.einnahmen.find((l) => l.key === "vereinnahmteUst")?.amount).toBe(19_00);
    const year = await annual.euerYear(2026);
    expect([year.figures.steuerpflichtig, year.figures.vereinnahmteUst]).toEqual([100_00, 19_00]);
    await keineAbweichung(2026, 10);

    // DATEV: Erlös auf dem Automatikkonto mit BU 40 (wie bei Rechnungen), die Steuer ohne Schlüssel
    const stack = parseDatevBuchungsstapel((await datev.datevExport(2026)).bytes);
    expect(stack.bookings.map((b) => `${b.account}/${b.contraAccount}/${b.buKey}/${b.amount}`).sort()).toEqual(
      [`${konten.bank}/${konten.erloese}/40/10000`, `${konten.bank}/${konten.ust}//1900`].sort(),
    );
  });

  it("SKR04, Soll: 7 % und Erstattung an den Kunden mindern Kz 86 im Monat der Erstattung; Aufheben stellt alles zurück", async () => {
    await firma("SKR04", "soll");
    await bank.importStatement(
      actor,
      dkbCsv([
        ["03.11.26", "Max Leser", "Buchverkauf", "107,00"],
        ["20.12.26", "Max Leser", "Rückgabe", "-21,40"],
      ]),
      null,
    );
    await bank.allocate(actor, {
      kind: "kategorie",
      transactionId: await umsatz(107_00),
      amount: 107_00,
      kategorie: { kategorie: "erloese", steuersatz: 700 },
    });
    await bank.allocate(actor, {
      kind: "kategorie",
      transactionId: await umsatz(-21_40),
      amount: -21_40,
      kategorie: { kategorie: "erloese", steuersatz: 700 },
    });
    expect(await salden()).toEqual({ "1800": 85_60, "3801": -5_60, "4300": -80_00 });
    const november = await figures.computeVatFigures({ year: 2026, month: 11 });
    expect([november.kz86, november.tax86]).toEqual([100_00, 7_00]);
    const dezember = await figures.computeVatFigures({ year: 2026, month: 12 });
    expect([dezember.kz86, dezember.tax86]).toEqual([-20_00, -1_40]);
    await keineAbweichung(2026, 11);
    await keineAbweichung(2026, 12);
    expect((await reports.euerForYear(2026)).einnahmen.find((l) => l.key === "einnahmenSteuerpflichtig")?.amount).toBe(80_00);

    const [first] = await sql`select id from allocations where amount = 10700`;
    await bank.reverseAllocation(actor, first!.id);
    expect(await salden()).toEqual({ "1800": -21_40, "3801": 1_40, "4300": 20_00 });
    const [reversal] = await sql`select category, tax_rate, amount from allocations where reverses_id = ${first!.id}`;
    expect(reversal).toMatchObject({ category: "erloese", tax_rate: 700, amount: -107_00 });
    expect((await figures.computeVatFigures({ year: 2026, month: 11 })).kz86).toBe(0);
    await keineAbweichung(2026, 11);
  });

  it.each([
    ["SKR03", "ist", { bank: "1200", aufwand: "4920" }],
    ["SKR04", "soll", { bank: "1800", aufwand: "6805" }],
  ] as const)("%s, %s: Ausgabe auf eine Kategorie brutto ohne Vorsteuer; mit Steuersatz abgelehnt", async (kr, versteuerung, konten) => {
    await firma(kr, versteuerung);
    await bank.importStatement(actor, dkbCsv([["05.05.26", "Funknetz Mobil", "Prepaid-Aufladung", "-35,70"]]), null);
    const transactionId = await umsatz(-35_70);
    await expect(
      bank.allocate(actor, { kind: "kategorie", transactionId, amount: -35_70, kategorie: { kategorie: "telefon", steuersatz: 1900 } }),
    ).rejects.toThrow(/keine Vorsteuer/);
    await expect(bank.allocate(actor, { kind: "kategorie", transactionId, amount: -35_70, kategorie: { kategorie: "anlage", steuersatz: 0 } })).rejects.toThrow(
      /nur mit Beleg/,
    );
    expect(await salden()).toEqual({});

    await bank.allocate(actor, { kind: "kategorie", transactionId, amount: -35_70, kategorie: { kategorie: "telefon", steuersatz: 0 } });
    expect(await salden()).toEqual({ [konten.bank]: -35_70, [konten.aufwand]: 35_70 });
    const mai = await figures.computeVatFigures({ year: 2026, month: 5 });
    expect([mai.kz66, mai.kz81]).toEqual([0, 0]);
    const euer = await reports.euerForYear(2026);
    expect(euer.ausgaben.find((l) => l.key === "ausgabe:telefon")?.amount).toBe(35_70);
    expect(euer.ausgaben.find((l) => l.key === "vorsteuer")?.amount).toBe(0);
    expect((await annual.euerYear(2026)).figures.telekommunikation).toBe(35_70);
    await keineAbweichung(2026, 5);
  });

  it("Aufteilung: Erlös und Privateinlage in einem Zahlungseingang", async () => {
    await firma("SKR03", "ist");
    await bank.importStatement(actor, dkbCsv([["12.08.26", "Erika Beispiel", "Reparatur und Rückzahlung", "150,00"]]), null);
    await bank.allocateSplit(actor, {
      transactionId: await umsatz(150_00),
      parts: [
        { kind: "kategorie", amount: 119_00, kategorie: { kategorie: "erloese", steuersatz: 1900 } },
        { kind: "privat", amount: 31_00 },
      ],
    });
    expect(await salden()).toEqual({ "1200": 150_00, "1776": -19_00, "1890": -31_00, "8400": -100_00 });
    expect((await figures.computeVatFigures({ year: 2026, month: 8 })).tax81).toBe(19_00);
    await keineAbweichung(2026, 8);
  });

  it("Aufteilung in zwei Erlöse zum selben Satz: EÜR rechnet die Steuer je Teil wie Journal und Voranmeldung", async () => {
    // 2 × 50 € brutto zu 19 %: je Teil 7,98 € Steuer (zusammen 15,96 €); aus 100 € gerechnet wären es 15,97 €
    await firma("SKR03", "ist");
    await bank.importStatement(actor, dkbCsv([["14.09.26", "Erika Beispiel", "Zwei Reparaturen", "100,00"]]), null);
    await bank.allocateSplit(actor, {
      transactionId: await umsatz(100_00),
      parts: [
        { kind: "kategorie", amount: 50_00, kategorie: { kategorie: "erloese", steuersatz: 1900 } },
        { kind: "kategorie", amount: 50_00, kategorie: { kategorie: "erloese", steuersatz: 1900 } },
      ],
    });
    expect(await salden()).toEqual({ "1200": 100_00, "1776": -15_96, "8400": -84_04 });
    expect((await figures.computeVatFigures({ year: 2026, month: 9 })).tax81).toBe(15_96);
    const euer = await reports.euerForYear(2026);
    expect(euer.einnahmen.find((l) => l.key === "einnahmenSteuerpflichtig")?.amount).toBe(84_04);
    expect(euer.einnahmen.find((l) => l.key === "vereinnahmteUst")?.amount).toBe(15_96);
  });

  it("Kleinunternehmer: Erlöse ohne Umsatzsteuer (§ 19 UStG), ein Steuersatz wird abgelehnt", async () => {
    await firma("SKR03", "ist", true);
    await bank.importStatement(actor, dkbCsv([[heuteDkb, "Erika Beispiel", "Reparatur", "50,00"]]), null);
    const transactionId = await umsatz(50_00);
    await expect(
      bank.allocate(actor, { kind: "kategorie", transactionId, amount: 50_00, kategorie: { kategorie: "erloese", steuersatz: 1900 } }),
    ).rejects.toThrow(/Kleinunternehmer/);
    await bank.allocate(actor, { kind: "kategorie", transactionId, amount: 50_00, kategorie: { kategorie: "erloese", steuersatz: 0 } });
    expect(await salden()).toEqual({ "1200": 50_00, "8195": -50_00 });
    const euer = await reports.euerForYear(Number(heute.slice(0, 4)));
    expect(euer.einnahmen.find((l) => l.key === "einnahmenKleinunternehmer")?.amount).toBe(50_00);
    expect(euer.einnahmen.find((l) => l.key === "vereinnahmteUst")?.amount).toBe(0);
  });

  it("Ohne Kleinunternehmer gehen 0 % nur über eine Rechnung", async () => {
    await firma("SKR03", "soll");
    await bank.importStatement(actor, dkbCsv([["12.08.26", "Erika Beispiel", "Reparatur", "50,00"]]), null);
    await expect(
      bank.allocate(actor, { kind: "kategorie", transactionId: await umsatz(50_00), amount: 50_00, kategorie: { kategorie: "erloese", steuersatz: 0 } }),
    ).rejects.toThrow(/über eine Rechnung/);
  });

  it("Die Datenbank lehnt eine Zuordnung „kategorie“ ohne Kategorie ab und Kategorie an anderen Arten", async () => {
    await firma("SKR03", "ist");
    await bank.importStatement(actor, dkbCsv([["12.08.26", "Erika Beispiel", "Reparatur", "50,00"]]), null);
    const transactionId = await umsatz(50_00);
    await expect(sql`insert into allocations (transaction_id, kind, amount) values (${transactionId}, 'kategorie', 5000)`).rejects.toThrow(
      /allocations_kategorie/,
    );
    await expect(
      sql`insert into allocations (transaction_id, kind, amount, category, tax_rate) values (${transactionId}, 'privat', 5000, 'erloese', 1900)`,
    ).rejects.toThrow(/allocations_kategorie/);
  });
});
