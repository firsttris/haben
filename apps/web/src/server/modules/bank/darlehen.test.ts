import { ebilanzPosition, postenForSaldo } from "@haben/core";
import { parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Darlehen im Bankabgleich mit Postgres (Roadmap Platz 13, Prüffall 2 aus #312): Auszahlung, Rate aufgeteilt in Tilgung,
 * Zins und Gebühr, Bestand je Darlehen, EÜR und Anlage EÜR, Abgleich, DATEV, feste Grundlagen nach der ersten Zahlung,
 * GmbH mit Restlaufzeitvermerk und E-Bilanz. SKR03 und SKR04, Ist und Soll, Einzelunternehmen und GmbH.
 */

function dkbCsv(rows: [date: string, name: string, purpose: string, amount: string][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows
    .map(([date, name, purpose, amount]) =>
      [date, date, "Gebucht", amount.startsWith("-") ? "Nordlicht" : name, amount.startsWith("-") ? name : "Nordlicht", purpose, "", "", amount, "", "", ""]
        .map((c) => `"${c}"`)
        .join(";"),
    )
    .join("\n");
  return { bytes: new TextEncoder().encode(`﻿${header}${columns}${body}\n`), filename: "auszug.csv" };
}

describe.skipIf(!testDatabaseUrl)("Darlehen im Bankabgleich (Postgres)", () => {
  let bank: typeof import("./bank.ts");
  let darlehen: typeof import("./darlehen.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let datev: typeof import("../auswertungen/datev-export.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./bank.ts");
    darlehen = await import("./darlehen.ts");
    reports = await import("../auswertungen/reports.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
    datev = await import("../auswertungen/datev-export.ts");
    annual = await import("../jahreserklaerung/annual.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma(rechtsform: "gmbh" | "einzelunternehmen", kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await sql`truncate allocations, loans, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform,
                                   datev_berater_nr, datev_mandant_nr)
      values (1, 'Nordlicht Software', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB',
              ${kontenrahmen}, ${versteuerung}, ${rechtsform}, '29098', '55003')`;
  }

  const umsatz = async (amount: number) => (await sql<{ id: string }[]>`select id from bank_transactions where amount = ${amount}`)[0]!.id;

  async function salden() {
    const rows = await sql<{ account: string; saldo: number }[]>`
      select l.account, sum(l.debit - l.credit)::int as saldo from journal_lines l join journal_entries e on e.id = l.entry_id
       where e.source_type = 'allocation' group by l.account having sum(l.debit - l.credit) <> 0 order by l.account`;
    return Object.fromEntries(rows.map((r) => [r.account, r.saldo]));
  }

  const neu = { openingBalance: 0, openingDate: null };

  it("Prüffall 2, Einzelunternehmen, SKR03, Ist: Auszahlung, Rate aus 800 € Tilgung und 200 € Zinsen", async () => {
    await firma("einzelunternehmen", "SKR03", "ist");
    const loanId = await darlehen.createLoan(actor, { name: "Hausbank", lender: "bank", term: "ohne", purpose: "betrieb", ...neu });
    await bank.importStatement(
      actor,
      dkbCsv([
        ["02.01.26", "Hausbank", "Auszahlung Darlehen 4711", "20.000,00"],
        ["31.03.26", "Hausbank", "Rate Darlehen 4711", "-1.000,00"],
      ]),
      null,
    );
    await bank.allocate(actor, { kind: "darlehen", transactionId: await umsatz(20_000_00), amount: 20_000_00, darlehen: { loanId, part: "auszahlung" } });
    const rate = await umsatz(-1000_00);
    await bank.allocateSplit(actor, {
      transactionId: rate,
      parts: [
        { kind: "darlehen", amount: -800_00, darlehen: { loanId, part: "tilgung" } },
        { kind: "darlehen", amount: -200_00, darlehen: { loanId, part: "zins" } },
      ],
    });
    expect(await salden()).toEqual({ "0630": -19_200_00, "1200": 19_000_00, "2120": 200_00 });
    // Die Banktransaktion ist vollständig zugeordnet, der Bestand um die Tilgung gemindert
    expect((await bank.transactionDetail(rate))?.transaction.open).toBe(0);
    expect((await darlehen.listLoans()).map((l) => [l.name, l.account, l.balance])).toEqual([["Hausbank", "0630", 19_200_00]]);
    expect((await bank.transactionDetail(rate))?.allocations.map((a) => a.darlehenLabel).sort()).toEqual([
      "Darlehen Hausbank · Tilgung",
      "Darlehen Hausbank · Zinsen",
    ]);
    // EÜR: nur die Zinsen, nicht Auszahlung und Tilgung
    const euer = await reports.euerForYear(2026);
    expect(euer.ausgaben.find((l) => l.key === "schuldzinsen")?.amount).toBe(200_00);
    expect(euer.totalAusgaben).toBe(200_00);
    expect(euer.totalEinnahmen).toBe(0);
    expect((await annual.euerYear(2026)).figures.schuldzinsen).toBe(200_00);
    expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
    // DATEV mit der Kontierung
    const stack = parseDatevBuchungsstapel((await datev.datevExport(2026)).bytes);
    expect(stack.bookings.map((b) => [b.account, b.contraAccount, b.amount, b.side]).sort()).toEqual(
      [
        ["1200", "0630", 20_000_00, "S"],
        ["0630", "1200", 800_00, "S"],
        ["2120", "1200", 200_00, "S"],
      ].sort(),
    );
    // Nach der ersten Zahlung sind die Grundlagen fest, der Name nicht
    await expect(sql`update loans set term = 'bis1' where id = ${loanId}`).rejects.toThrow(/Geber, Restlaufzeit, Zweck und Restschuld sind fest/);
    await sql`update loans set name = 'Hausbank Investition' where id = ${loanId}`;
    expect(await sql`select art, befund from haben_integrity_problems(100)`).toEqual([]);
  });

  it("Einzelunternehmen, SKR04, Soll: übernommenes Darlehen mit Restschuld; Tilgung höchstens bis zum Bestand, Aufheben öffnet wieder", async () => {
    await firma("einzelunternehmen", "SKR04", "soll");
    await expect(
      darlehen.createLoan(actor, {
        name: "Tante Erna",
        lender: "sonstige",
        term: "bis5",
        purpose: "anlagevermoegen",
        openingBalance: 1_000_00,
        openingDate: null,
      }),
    ).rejects.toThrow(/Stichtag/);
    const loanId = await darlehen.createLoan(actor, {
      name: "Tante Erna",
      lender: "sonstige",
      term: "bis5",
      purpose: "anlagevermoegen",
      openingBalance: 1_000_00,
      openingDate: "2025-12-31",
    });
    await bank.importStatement(
      actor,
      dkbCsv([
        ["15.02.26", "Erna Muster", "Rate", "-1.200,00"],
        ["16.02.26", "Erna Muster", "Rückzahlung", "-50,00"],
      ]),
      null,
    );
    const rate = await umsatz(-1200_00);
    await expect(
      bank.allocateSplit(actor, {
        transactionId: rate,
        parts: [
          { kind: "darlehen", amount: -1100_00, darlehen: { loanId, part: "tilgung" } },
          { kind: "darlehen", amount: -100_00, darlehen: { loanId, part: "zins" } },
        ],
      }),
    ).rejects.toThrow(/höher als der Bestand des Darlehens \(1\.000,00\s€\)/);
    expect(await salden()).toEqual({});
    await bank.allocateSplit(actor, {
      transactionId: rate,
      parts: [
        { kind: "darlehen", amount: -1000_00, darlehen: { loanId, part: "tilgung" } },
        { kind: "darlehen", amount: -150_00, darlehen: { loanId, part: "zins" } },
        { kind: "darlehen", amount: -50_00, darlehen: { loanId, part: "gebuehr" } },
      ],
    });
    expect(await salden()).toEqual({ "1800": -1200_00, "3564": 1000_00, "7326": 150_00, "7355": 50_00 });
    expect((await darlehen.listLoans())[0]?.balance).toBe(0);
    // Abbezahlt: keine weitere Tilgung
    await expect(
      bank.allocate(actor, { kind: "darlehen", transactionId: await umsatz(-50_00), amount: -50_00, darlehen: { loanId, part: "tilgung" } }),
    ).rejects.toThrow(/höher als der Bestand/);
    expect((await reports.euerForYear(2026)).ausgaben.find((l) => l.key === "schuldzinsenAnlage")?.amount).toBe(200_00);
    // Aufheben gibt den Bestand zurück
    const [first] = await sql`select id from allocations where loan_part = 'tilgung'`;
    await bank.reverseAllocation(actor, first!.id);
    expect((await darlehen.listLoans())[0]?.balance).toBe(1000_00);
    expect(await salden()).toEqual({});
    expect((await reports.euerForYear(2026)).ausgaben.find((l) => l.key === "schuldzinsenAnlage")).toBeUndefined();
    const reversed = await sql`select loan_id, loan_part from allocations where reverses_id is not null order by loan_part`;
    expect(reversed.map((r) => r.loan_part)).toEqual(["gebuehr", "tilgung", "zins"]);
    expect(reversed.every((r) => r.loan_id === loanId)).toBe(true);
  });

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("%s, %s: Aufheben einer Auszahlung, deren Bestand schon getilgt ist, ergäbe einen negativen Bestand", async (kr, versteuerung) => {
    await firma("einzelunternehmen", kr, versteuerung);
    const loanId = await darlehen.createLoan(actor, { name: "Hausbank", lender: "bank", term: "ohne", purpose: "betrieb", ...neu });
    await bank.importStatement(
      actor,
      dkbCsv([
        ["02.01.26", "Hausbank", "Auszahlung", "5.000,00"],
        ["31.03.26", "Hausbank", "Tilgung", "-800,00"],
      ]),
      null,
    );
    await bank.allocate(actor, { kind: "darlehen", transactionId: await umsatz(5_000_00), amount: 5_000_00, darlehen: { loanId, part: "auszahlung" } });
    await bank.allocate(actor, { kind: "darlehen", transactionId: await umsatz(-800_00), amount: -800_00, darlehen: { loanId, part: "tilgung" } });
    const [auszahlung] = await sql`select id from allocations where loan_part = 'auszahlung'`;
    // Die Tilgung darf den Bestand nicht übersteigen; ohne die Auszahlung wäre sie höher als der Bestand
    await expect(bank.reverseAllocation(actor, auszahlung!.id)).rejects.toThrow(/Bestand/);
    expect((await darlehen.listLoans())[0]?.balance).toBe(4_200_00);
    // Erst die Tilgung aufheben, dann geht auch die Auszahlung
    const [tilgung] = await sql`select id from allocations where loan_part = 'tilgung'`;
    await bank.reverseAllocation(actor, tilgung!.id);
    await bank.reverseAllocation(actor, auszahlung!.id);
    expect((await darlehen.listLoans())[0]?.balance).toBe(0);
  });

  it("GmbH, SKR03, Soll und SKR04, Ist: Konten mit Restlaufzeitvermerk, Positionen in Bilanz und E-Bilanz", async () => {
    for (const [kr, versteuerung, konten] of [
      ["SKR03", "soll", { darlehen: "0640", zins: "2120", bank: "1200" }],
      ["SKR04", "ist", { darlehen: "3160", zins: "7320", bank: "1800" }],
    ] as const) {
      await firma("gmbh", kr, versteuerung);
      const loanId = await darlehen.createLoan(actor, { name: "KfW", lender: "bank", term: "bis5", purpose: "betrieb", ...neu });
      await bank.importStatement(
        actor,
        dkbCsv([
          ["01.04.26", "KfW", "Auszahlung", "50.000,00"],
          ["30.06.26", "KfW", "Rate", "-2.500,00"],
        ]),
        null,
      );
      await bank.allocate(actor, { kind: "darlehen", transactionId: await umsatz(50_000_00), amount: 50_000_00, darlehen: { loanId, part: "auszahlung" } });
      await bank.allocateSplit(actor, {
        transactionId: await umsatz(-2500_00),
        parts: [
          { kind: "darlehen", amount: -2000_00, darlehen: { loanId, part: "tilgung" } },
          { kind: "darlehen", amount: -500_00, darlehen: { loanId, part: "zins" } },
        ],
      });
      const s = await salden();
      expect(s).toEqual({ [konten.bank]: 47_500_00, [konten.darlehen]: -48_000_00, [konten.zins]: 500_00 });
      for (const [account, saldo] of Object.entries(s)) {
        expect(postenForSaldo(kr, account, saldo), account).not.toBeNull();
        expect(ebilanzPosition(kr, account, saldo), account).not.toBeNull();
      }
      expect(ebilanzPosition(kr, konten.darlehen, -1)).toBe("bs.eqLiab.liab.bank.other");
    }
  });
});
