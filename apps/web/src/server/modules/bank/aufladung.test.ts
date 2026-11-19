import { kategorieMitKonto } from "@haben/core";
import { parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Aufladung eines Guthabens (#1356) mit Postgres: Eine Bankzahlung ohne Beleg, bei der das Geld beim Anbieter als
 * Guthaben liegt und erst über eine spätere Rechnung verbraucht wird. Sie ist im Monat der Zahlung Betriebsausgabe
 * (§ 11 Abs. 2 EStG). Sie selbst trägt keine Umsatzsteuer (§ 3 Abs. 15 UStG, Mehrzweck-Gutschein), Vorsteuer entsteht
 * erst mit der Rechnung über die Leistung (§ 15 Abs. 1 Satz 1 Nr. 1 Satz 2 UStG). Geprüft wird die Buchung selbst (Konten, Betrag, keine Vorsteuerzeile), die Ablehnung einer
 * Einnahme und eines erfundenen Steuersatzes, EÜR und Voranmeldung, der DATEV-Stapel und dass die übrigen
 * Zuordnungsarten und der Abgleich der DATEV-Buchungen unverändert bleiben.
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

describe.skipIf(!testDatabaseUrl)("Aufladung eines Guthabens (Postgres)", () => {
  let bank: typeof import("./index.ts");
  let archive: typeof import("../archiv/archive.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let datev: typeof import("../auswertungen/datev-export.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    archive = await import("../archiv/archive.ts");
    reports = await import("../auswertungen/reports.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
    datev = await import("../auswertungen/datev-export.ts");
    figures = await import("../umsatzsteuer/vat-figures.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", rechtsform: "einzelunternehmen" | "gmbh" | "ug" = "einzelunternehmen") {
    await leeren(sql)`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      archive_files, datev_bookings, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform,
                                   kleinunternehmer, datev_berater_nr, datev_mandant_nr)
      values (1, 'Nordlicht Software', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB',
              ${kontenrahmen}, ${versteuerung}, ${rechtsform}, false, '29098', '55003')`;
  }

  const umsatz = async (amount: number) => (await sql<{ id: string }[]>`select id from bank_transactions where amount = ${amount}`)[0]!.id;

  /** Zeilen der Buchungen aus Zuordnungen, je Konto Soll − Haben */
  async function salden() {
    const rows = await sql<{ account: string; saldo: number }[]>`
      select l.account, sum(l.debit - l.credit)::int as saldo from journal_lines l join journal_entries e on e.id = l.entry_id
       where e.source_type = 'allocation' group by l.account having sum(l.debit - l.credit) <> 0 order by l.account`;
    return Object.fromEntries(rows.map((r) => [r.account, r.saldo]));
  }

  /** Zeilen einer Buchung mit Steuerschlüssel, wie sie im Journal stehen */
  async function buchungszeilen() {
    return sql<{ account: string; debit: number; credit: number; tax_code: string | null }[]>`
      select l.account, l.debit, l.credit, l.tax_code from journal_lines l join journal_entries e on e.id = l.entry_id
       where e.source_type = 'allocation' order by l.account`;
  }

  const keineAbweichung = async (year: number, month: number) => {
    expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year, month })).zeilen)).toEqual([]);
    expect(abgleich.abweichungen((await abgleich.euerAbgleich(year)).zeilen)).toEqual([]);
  };

  it.each([
    ["SKR03", "ist", { bank: "1200", aufwand: "4900" }],
    ["SKR04", "soll", { bank: "1800", aufwand: "6300" }],
  ] as const)("%s, %s: 90,00 € Aufladung in einem Schritt, Bank gegen Aufwandskonto ohne Vorsteuer", async (kr, versteuerung, konten) => {
    await firma(kr, versteuerung);
    await bank.importStatement(actor, dkbCsv([["07.10.26", "Funknetz Mobil", "Guthaben aufladen", "-90,00"]]), null);
    const transactionId = await umsatz(-90_00);

    // Ein Schritt: kein Steuersatz, Pflicht-Kostenkategorie
    await bank.allocate(actor, {
      kind: "aufladung",
      transactionId,
      amount: -90_00,
      kategorie: { kategorie: "sonstiges", steuersatz: 0 },
    });

    expect(await salden()).toEqual({ [konten.bank]: -90_00, [konten.aufwand]: 90_00 });
    // Zwei Zeilen, keine Vorsteuerzeile: der Aufwand trägt den Schlüssel „keine Vorsteuer“
    const zeilen = await buchungszeilen();
    expect(zeilen.map((z) => `${z.account}/${z.debit}/${z.credit}/${z.tax_code ?? ""}`).sort()).toEqual(
      [`${konten.aufwand}/9000/0/keineVSt`, `${konten.bank}/0/9000/`].sort(),
    );

    const [allocation] = await sql`select kind, category, tax_rate, amount from allocations`;
    expect(allocation).toMatchObject({ kind: "aufladung", category: "sonstiges", tax_rate: 0, amount: -90_00 });
    const [entry] = await sql`select description from journal_entries where source_type = 'allocation'`;
    expect(entry!.description).toBe("Aufladung Guthaben: Sonstiger Aufwand · Funknetz Mobil");
    expect((await bank.transactionDetail(transactionId))?.allocations[0]).toMatchObject({
      kind: "aufladung",
      kategorieLabel: kategorieMitKonto(kr, "sonstiges"),
    });

    // Keine Umsatzsteuer: Kz 81 und Kz 66 bleiben leer
    const oktober = await figures.computeVatFigures({ year: 2026, month: 10 });
    expect([oktober.kz81, oktober.kz66]).toEqual([0, 0]);
    // EÜR: Aufwand im Monat der Zahlung (§ 11 Abs. 2 EStG), keine Vorsteuer
    const euer = await reports.euerForYear(2026);
    expect(euer.ausgaben.find((l) => l.key === "ausgabe:sonstiges")?.amount).toBe(90_00);
    expect(euer.ausgaben.find((l) => l.key === "vorsteuer")?.amount).toBe(0);
    expect(euer.monthly.ausgaben[9]).toBe(90_00);
    await keineAbweichung(2026, 10);
  });

  it("lehnt eine Einnahmekategorie und einen mitgegebenen Steuersatz ab", async () => {
    await firma("SKR03", "ist");
    await bank.importStatement(actor, dkbCsv([["07.10.26", "Funknetz Mobil", "Guthaben aufladen", "-90,00"]]), null);
    const transactionId = await umsatz(-90_00);

    await expect(
      bank.allocate(actor, { kind: "aufladung", transactionId, amount: -90_00, kategorie: { kategorie: "erloese", steuersatz: 0 } }),
    ).rejects.toThrow(/Eine Aufladung ist eine Ausgabe/);
    await expect(
      bank.allocate(actor, { kind: "aufladung", transactionId, amount: -90_00, kategorie: { kategorie: "sonstiges", steuersatz: 1900 } }),
    ).rejects.toThrow(/keine Vorsteuer/);
    // Eine Kategorie, die einen Beleg verlangt, bleibt auch hier gesperrt
    await expect(bank.allocate(actor, { kind: "aufladung", transactionId, amount: -90_00, kategorie: { kategorie: "anlage", steuersatz: 0 } })).rejects.toThrow(
      /nur mit Beleg/,
    );
    expect(await salden()).toEqual({});
    expect(await sql`select count(*)::int as n from allocations`).toEqual([{ n: 0 }]);
  });

  it("bucht wie „Direkt auf eine Kategorie“, ohne die bestehende Art zu verändern", async () => {
    await firma("SKR03", "ist");
    await bank.importStatement(
      actor,
      dkbCsv([
        ["07.10.26", "Funknetz Mobil", "Guthaben aufladen", "-90,00"],
        ["08.10.26", "Kiosk am Markt", "Zubehör", "-15,00"],
      ]),
      null,
    );
    await bank.allocate(actor, { kind: "aufladung", transactionId: await umsatz(-90_00), amount: -90_00, kategorie: { kategorie: "telefon", steuersatz: 0 } });
    await bank.allocate(actor, { kind: "kategorie", transactionId: await umsatz(-15_00), amount: -15_00, kategorie: { kategorie: "telefon", steuersatz: 0 } });

    // Dieselben Konten wie eine Direktbuchung auf die Kategorie: 4920 mit Vorsteuer 0
    expect(await salden()).toEqual({ "1200": -105_00, "4920": 105_00 });
    const [aufladung] = await sql`select tax_code from journal_lines where debit = 9000`;
    const [kategorie] = await sql`select tax_code from journal_lines where debit = 1500`;
    expect(aufladung!.tax_code).toBe(kategorie!.tax_code);
    expect(await sql`select count(*)::int as n from allocations where kind = 'kategorie'`).toEqual([{ n: 1 }]);
  });

  it("bietet die Aufladung in GmbH und UG nicht an und bucht sie dort nicht", async () => {
    await firma("SKR03", "ist", "gmbh");
    await bank.importStatement(
      actor,
      dkbCsv([
        ["07.10.26", "Funknetz Mobil", "Guthaben aufladen", "-90,00"],
        ["08.10.26", "Kiosk am Markt", "Zubehör", "-15,00"],
      ]),
      null,
    );

    // In der Bilanz ist die Zahlung vor der Leistung eine Forderung (§ 246 Abs. 1 HGB), kein Aufwand
    await expect(
      bank.allocate(actor, { kind: "aufladung", transactionId: await umsatz(-90_00), amount: -90_00, kategorie: { kategorie: "sonstiges", steuersatz: 0 } }),
    ).rejects.toThrow(/kein Aufwand, sondern eine Forderung/);
    expect(await salden()).toEqual({});
    expect(await sql`select count(*)::int as n from allocations`).toEqual([{ n: 0 }]);

    // Gesperrt ist nur die Aufladung: Eine Direktbuchung auf eine Kategorie geht in der GmbH weiter
    await bank.allocate(actor, { kind: "kategorie", transactionId: await umsatz(-15_00), amount: -15_00, kategorie: { kategorie: "telefon", steuersatz: 0 } });
    expect(await salden()).toEqual({ "1200": -15_00, "4920": 15_00 });
  });

  it("schlägt eine Aufladung aus früheren Buchungen in der GmbH nicht vor", async () => {
    await firma("SKR03", "ist", "gmbh");
    await bank.importStatement(
      actor,
      dkbCsv([
        ["07.09.26", "Funknetz Mobil", "Guthaben aufladen", "-90,00"],
        ["07.10.26", "Funknetz Mobil", "Guthaben aufladen", "-80,00"],
        ["07.11.26", "Funknetz Mobil", "Guthaben aufladen", "-20,00"],
      ]),
      null,
    );
    // Bestand aus der Zeit vor der Sperre: zwei Aufladungen, wie sie damals entstanden sind
    for (const amount of [-90_00, -80_00]) {
      const [zeile] = await sql<{ id: string }[]>`select id from bank_transactions where amount = ${amount}`;
      await sql`insert into allocations (transaction_id, kind, amount, category, tax_rate)
                values (${zeile!.id}, 'aufladung', ${amount}, 'telefon', 0)`;
    }

    const dritte = (await bank.transactionDetail(await umsatz(-20_00)))!.transaction;
    expect((await bank.learnedDirectSuggestions([dritte])).size).toBe(0);
    // Auch die Detailansicht schlägt sie dort nicht vor
    expect((await bank.transactionDetail(dritte.id))?.direct).toBeNull();
  });

  it("lernt die Aufladung im Einzelunternehmen wie die anderen freien Buchungsarten", async () => {
    await firma("SKR03", "ist");
    await bank.importStatement(
      actor,
      dkbCsv([
        ["07.10.26", "Funknetz Mobil", "Guthaben aufladen", "-90,00"],
        ["07.11.26", "Funknetz Mobil", "Guthaben aufladen", "-20,00"],
        ["07.12.26", "Funknetz Mobil", "Guthaben aufladen", "-30,00"],
      ]),
      null,
    );
    await bank.allocate(actor, { kind: "aufladung", transactionId: await umsatz(-90_00), amount: -90_00, kategorie: { kategorie: "telefon", steuersatz: 0 } });
    await bank.allocate(actor, { kind: "aufladung", transactionId: await umsatz(-20_00), amount: -20_00, kategorie: { kategorie: "telefon", steuersatz: 0 } });

    const dritte = (await bank.transactionDetail(await umsatz(-30_00)))!.transaction;
    expect((await bank.learnedDirectSuggestions([dritte])).get(dritte.id)).toMatchObject({
      kind: "aufladung",
      kategorie: { kategorie: "telefon", steuersatz: 0 },
    });
  });

  it("steht im Abgleich als eigene Gruppe „Aufladung ohne Bezug“, nicht als offener Punkt", async () => {
    await firma("SKR03", "ist");
    await bank.importStatement(actor, dkbCsv([["07.10.26", "Funknetz Mobil", "Guthaben aufladen", "-90,00"]]), null);
    await bank.allocate(actor, {
      kind: "aufladung",
      transactionId: await umsatz(-90_00),
      amount: -90_00,
      kategorie: { kategorie: "sonstiges", steuersatz: 0 },
    });

    // Die Ausgabe selbst: Bank gegen Aufwandskonto, kein Beleg, kein Steuerschlüssel
    const bytes = (await datev.datevExport(2026)).bytes;
    const stack = parseDatevBuchungsstapel(bytes);
    expect(stack.bookings).toHaveLength(1);
    const [zeile] = stack.bookings;
    expect([zeile!.account, zeile!.contraAccount].sort()).toEqual(["1200", "4900"]);
    expect(zeile).toMatchObject({ amount: 90_00, voucherField1: "", buKey: "" });

    // Der Stapel kommt zurück ins Archiv: Die Zeile ist da und trägt keine erfundene Belegnummer
    await archive.addArchiveFile(actor, { bytes, filename: "EXTF_Buchungsstapel_2026.csv", kind: "datev", year: 2026 });
    const alle = await archive.listDatevBookings({ year: 2026, search: "Aufladung", unmatched: false, page: 0 });
    expect(alle.total).toBe(stack.bookings.length);
    expect(alle.rows.every((r) => r.voucherField1 === "")).toBe(true);
    expect(alle.rows.every((r) => r.buKey === "")).toBe(true);

    // Eigene Gruppe: nicht in den offenen Punkten, nicht als erledigt, aber auch nicht verschwunden
    expect((await archive.listDatevBookings({ year: 2026, search: "", unmatched: true, page: 0 })).rows).toEqual([]);
    const gruppe = await archive.listDatevBookings({ year: 2026, search: "", unmatched: false, aufladung: true, page: 0 });
    expect(gruppe.total).toBe(stack.bookings.length);
    expect(gruppe.rows.every((r) => r.aufladung && !r.matched)).toBe(true);
  });
});
