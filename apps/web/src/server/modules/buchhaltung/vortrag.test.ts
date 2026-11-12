import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Saldenvortrag und Eröffnung (Postgres)", () => {
  let sql: postgres.Sql;
  let manual: typeof import("./manual.ts");
  let ledger: typeof import("./ledger.ts");
  let cash: typeof import("../bank/cash.ts");
  const actor = "test-user";
  const today = "2026-10-04";

  beforeAll(async () => {
    sql = await setupTestDb();
    manual = await import("./manual.ts");
    ledger = await import("./ledger.ts");
    cash = await import("../bank/cash.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(rechtsform: "einzelunternehmen" | "gmbh", kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll" = "ist") {
    await leeren(sql)`truncate cash_entries, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY',
              ${kontenrahmen}, ${versteuerung}, ${rechtsform})`;
  }

  /** Buchung direkt über das Hauptbuch, wie sie eine Rechnung oder ein Beleg erzeugte */
  async function book(date: string, lines: [string, number, number][], sourceType: "document" | "manuell" = "document") {
    const { withActor } = await import("../../db/actor.ts");
    await withActor(actor, async (tx) =>
      ledger.post(tx, await ledger.openBooks(tx), {
        date,
        description: "Test",
        sourceType,
        sourceId: crypto.randomUUID(),
        lines: lines.map(([account, debit, credit]) => ({ account, debit, credit, taxCode: null })),
      }),
    );
  }

  const row = (rows: Awaited<ReturnType<typeof ledger.saldenliste>>, account: string) => rows.find((r) => r.account === account);

  describe.each([
    ["SKR03", { bank: "1200", gesellschafter: "0730", aufwand: "4900", gewinn: "0860", verlust: "0868", kasse: "1000" }],
    ["SKR04", { bank: "1800", gesellschafter: "3510", aufwand: "6300", gewinn: "2970", verlust: "2978", kasse: "1600" }],
  ] as const)("%s", (kontenrahmen, k) => {
    it.each(["ist", "soll"] as const)(
      "GmbH, %s: Bestände laufen ins neue Jahr, das Ergebnis steht als Verlustvortrag",
      async (versteuerung) => {
        await setup("gmbh", kontenrahmen, versteuerung);
        // 2025: Gesellschafter legt 1.000 € in die Kasse, die GmbH gibt 300 € aus
        await cash.createCashEntry(actor, { kind: "einlage", date: "2025-03-01", amount: 100_000 }, today);
        await book("2025-04-01", [
          [k.aufwand, 30_000, 0],
          [k.gesellschafter, 0, 30_000],
        ]);
        // 2026: weitere 50 € Aufwand
        await book("2026-02-01", [
          [k.aufwand, 5_000, 0],
          [k.gesellschafter, 0, 5_000],
        ]);

        const rows = await ledger.saldenliste(ledger.ledgerRange(2026));
        expect(row(rows, k.kasse)).toMatchObject({ eroeffnung: 100_000, soll: 0, haben: 0, saldo: 100_000 });
        expect(row(rows, k.gesellschafter)).toMatchObject({ eroeffnung: -130_000, vortrag: -130_000, haben: 5_000, saldo: -135_000 });
        // Summen- und Saldenliste für März: EB-Wert aus dem Vorjahr, Verkehrszahlen ab Jahresbeginn
        expect(row(await ledger.saldenliste(ledger.ledgerRange(2026, "m3")), k.gesellschafter)).toMatchObject({
          vortrag: -130_000,
          eroeffnung: -135_000,
          soll: 0,
          haben: 0,
          sollJahr: 0,
          habenJahr: 5_000,
          saldo: -135_000,
        });
        // Erfolgskonten beginnen bei null, ihr Vorjahresergebnis (300 € Verlust) steht auf dem Verlustvortrag
        expect(row(rows, k.aufwand)).toMatchObject({ eroeffnung: 0, soll: 5_000, saldo: 5_000 });
        expect(row(rows, k.verlust)).toMatchObject({ eroeffnung: 30_000, soll: 0, haben: 0, saldo: 30_000, name: expect.any(String) });
        expect(row(rows, k.gewinn)).toBeUndefined();
        // Eröffnung, Soll und Haben gehen zusammen auf
        expect(rows.reduce((s, r) => s + r.saldo, 0)).toBe(0);

        const blatt = await ledger.kontenblatt(k.gesellschafter, ledger.ledgerRange(2026, "m3"));
        expect(blatt).toMatchObject({ eroeffnung: -135_000, saldo: -135_000, kontenrahmen });
        expect((await ledger.kontenblatt(k.verlust, ledger.ledgerRange(2026))).eroeffnung).toBe(30_000);
      },
      30_000,
    );

    it("Einzelunternehmen: jedes Jahr beginnt wie bisher bei null", async () => {
      await setup("einzelunternehmen", kontenrahmen);
      await cash.createCashEntry(actor, { kind: "einlage", date: "2025-03-01", amount: 100_000 }, today);
      const rows = await ledger.saldenliste(ledger.ledgerRange(2026));
      expect(rows).toEqual([]);
    });

    it("Eröffnung: am 1. Januar, als Eröffnung in der Saldenliste, danach nichts mehr davor", async () => {
      await setup("gmbh", kontenrahmen);
      const eroeffnung = (date: string, lines: { account: string; debit: number; credit: number }[]) =>
        manual.createManualEntry(actor, { kind: "eroeffnung", date, description: "Eröffnungsbilanz", lines }, today);
      const kapital = kontenrahmen === "SKR03" ? "0800" : "2900";
      const lines = [
        { account: k.bank, debit: 3_000_000, credit: 0 },
        { account: kapital, debit: 0, credit: 2_500_000 },
        { account: "9000", debit: 0, credit: 500_000 },
      ];
      await expect(eroeffnung("2026-02-01", lines)).rejects.toThrow("am 1. Januar");
      const id = await eroeffnung("2026-01-01", lines);
      expect((await sql`select source_type from journal_entries where id = ${id}`)[0]).toEqual({ source_type: "eroeffnung" });

      await book("2026-01-01", [
        [k.aufwand, 10_000, 0],
        [k.gesellschafter, 0, 10_000],
      ]);
      const rows = await ledger.saldenliste(ledger.ledgerRange(2026));
      expect(row(rows, k.bank)).toMatchObject({ eroeffnung: 3_000_000, vortrag: 3_000_000, soll: 0, haben: 0, sollJahr: 0 });
      expect(row(rows, kapital)).toMatchObject({ eroeffnung: -2_500_000, soll: 0, haben: 0 });
      expect(row(rows, k.aufwand)).toMatchObject({ eroeffnung: 0, soll: 10_000 });
      expect((await ledger.kontenblatt(k.bank, ledger.ledgerRange(2026))).zeilen).toEqual([]);

      // Vor der Eröffnung bucht nichts mehr, auch kein rückdatierter Beleg; eine zweite Eröffnung am selben Tag geht
      await expect(
        book("2025-12-31", [
          [k.aufwand, 100, 0],
          [k.gesellschafter, 0, 100],
        ]),
      ).rejects.toThrow("Die Bücher beginnen am 01.01.2026 mit der Eröffnung");
      await eroeffnung("2026-01-01", [
        { account: k.gesellschafter, debit: 0, credit: 1_000 },
        { account: "9000", debit: 1_000, credit: 0 },
      ]);
      // Storno wie bei Umbuchungen, ebenfalls als Eröffnung
      const storno = await manual.reverseManualEntry(actor, id);
      expect((await sql`select source_type, date from journal_entries where id = ${storno}`)[0]).toEqual({ source_type: "eroeffnung", date: "2026-01-01" });
      expect(row(await ledger.saldenliste(ledger.ledgerRange(2026)), k.bank)).toBeUndefined();

      // Gibt es schon Buchungen davor, trägt Haben die Salden selbst vor; eine Eröffnung zählte sie doppelt
      await setup("gmbh", kontenrahmen);
      await book("2025-06-01", [
        [k.aufwand, 100, 0],
        [k.gesellschafter, 0, 100],
      ]);
      await expect(eroeffnung("2026-01-01", lines)).rejects.toThrow("Vor dem 01.01.2026 gibt es schon Buchungen");
    }, 30_000);
  });

  it("Gewinn der Vorjahre auf dem Gewinnvortrag, über mehrere Jahre zusammen", async () => {
    await setup("gmbh", "SKR04");
    await book("2024-05-01", [
      ["3510", 50_000, 0],
      ["4200", 0, 50_000],
    ]);
    await book("2025-05-01", [
      ["6300", 20_000, 0],
      ["3510", 0, 20_000],
    ]);
    const rows = await ledger.saldenliste(ledger.ledgerRange(2026));
    expect(rows.map((r) => [r.account, r.eroeffnung])).toEqual([
      ["2970", -30_000],
      ["3510", 30_000],
    ]);
    // Im Jahr selbst zählt nur das Vorjahr davor
    expect((await ledger.saldenliste(ledger.ledgerRange(2025))).map((r) => [r.account, r.eroeffnung])).toEqual([
      ["2970", -50_000],
      ["3510", 50_000],
      ["6300", 0],
    ]);
  });
});
