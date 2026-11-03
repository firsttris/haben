import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Manuelle Buchungen (Postgres)", () => {
  let sql: postgres.Sql;
  let manual: typeof import("./manual.ts");
  let datev: typeof import("../auswertungen/datev-export.ts");
  const actor = "test-user";
  const today = "2026-10-04";

  beforeAll(async () => {
    sql = await setupTestDb();
    manual = await import("./manual.ts");
    datev = await import("../auswertungen/datev-export.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(rechtsform: "einzelunternehmen" | "gmbh" | "ug", kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll" = "ist") {
    await sql`truncate journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Testfirma GmbH', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY',
              ${kontenrahmen}, ${versteuerung}, ${rechtsform})`;
  }

  const linesOf = async (entryId: string) =>
    (await sql`select account, debit, credit, tax_code from journal_lines where entry_id = ${entryId} order by debit desc, account`).map((l) => ({ ...l }));

  describe.each([
    ["SKR03", "0730", "0800", "4900"],
    ["SKR04", "3510", "2900", "6300"],
  ] as const)("%s", (kontenrahmen, gesellschafter, kapital, aufwand) => {
    it.each(["ist", "soll"] as const)(
      "%s-Versteuerung: bucht, schreibt fest, versiegelt und storniert am selben Tag",
      async (versteuerung) => {
        await setup("gmbh", kontenrahmen, versteuerung);
        const id = await manual.createManualEntry(
          actor,
          {
            date: "2026-01-15",
            description: "Stammkapital, Einzahlung über den Gesellschafter",
            lines: [
              { account: gesellschafter, debit: 2_500_000, credit: 0 },
              { account: kapital, debit: 0, credit: 2_500_000 },
            ],
          },
          today,
        );
        const [entry] = await sql`select date, source_type, locked_at, reverses_id from journal_entries where id = ${id}`;
        expect(entry).toMatchObject({ date: "2026-01-15", source_type: "manuell", reverses_id: null });
        expect(entry!.locked_at).not.toBeNull();
        expect(await linesOf(id)).toEqual([
          { account: gesellschafter, debit: 2_500_000, credit: 0, tax_code: null },
          { account: kapital, debit: 0, credit: 2_500_000, tax_code: null },
        ]);
        expect(await sql`select 1 from seals where table_name = 'journal_entries' and row_id = ${id}`).toHaveLength(1);
        await expect(sql`update journal_lines set debit = 1 where entry_id = ${id}`).rejects.toThrow();

        const storno = await manual.reverseManualEntry(actor, id);
        const [reversal] = await sql`select date, description, reverses_id, source_type from journal_entries where id = ${storno}`;
        expect(reversal).toEqual({
          date: "2026-01-15",
          description: "Storno: Stammkapital, Einzahlung über den Gesellschafter",
          reverses_id: id,
          source_type: "manuell",
        });
        expect(await linesOf(storno)).toEqual([
          { account: kapital, debit: 2_500_000, credit: 0, tax_code: null },
          { account: gesellschafter, debit: 0, credit: 2_500_000, tax_code: null },
        ]);
        await expect(manual.reverseManualEntry(actor, id)).rejects.toThrow("bereits storniert");
        await expect(manual.reverseManualEntry(actor, storno)).rejects.toThrow("Gegenbuchung lässt sich nicht stornieren");
        // Siegel früherer Testfälle bleiben nach truncate stehen; geprüft werden die beiden Buchungen dieses Falls
        expect(await sql`select art, befund from haben_integrity_problems(100) where zeile in (${id}, ${storno})`).toEqual([]);
      },
      30_000,
    );

    it("lehnt Nebenbuch-, Privat- und Vortragskonten ab und bucht nichts", async () => {
      await setup("ug", kontenrahmen);
      const bank = kontenrahmen === "SKR03" ? "1200" : "1800";
      const privat = kontenrahmen === "SKR03" ? "1800" : "2100";
      const post = (account: string) =>
        manual.createManualEntry(
          actor,
          {
            date: "2026-10-01",
            description: "Test",
            lines: [
              { account, debit: 100, credit: 0 },
              { account: aufwand, debit: 0, credit: 100 },
            ],
          },
          today,
        );
      await expect(post(bank)).rejects.toThrow(`Konto ${bank} führt das Nebenbuch Bank`);
      await expect(post(privat)).rejects.toThrow(`Konto ${privat} ist ein Privatkonto`);
      await expect(post("9000")).rejects.toThrow("Vortrags- oder statistisches Konto");
      expect(await sql`select id from journal_entries`).toEqual([]);
    });
  });

  it("nur für GmbH und UG, nicht in der Zukunft, nur ausgeglichen", async () => {
    const input = (date: string, credit = 100) => ({
      date,
      description: "Umbuchung",
      lines: [
        { account: "4900", debit: 100, credit: 0 },
        { account: "0730", debit: 0, credit },
      ],
    });
    await setup("einzelunternehmen", "SKR03");
    await expect(manual.createManualEntry(actor, input("2026-10-01"), today)).rejects.toThrow("nur für GmbH und UG");
    await setup("gmbh", "SKR03");
    await expect(manual.createManualEntry(actor, input("2026-10-05"), today)).rejects.toThrow("Zukunft");
    await expect(manual.createManualEntry(actor, input("2026-10-01", 90), today)).rejects.toThrow("Soll und Haben sind nicht gleich");
    await expect(manual.createManualEntry(actor, { ...input("2026-10-01"), description: " x " }, today)).rejects.toThrow("Buchungstext fehlt");
    expect(await sql`select id from journal_entries`).toEqual([]);
    // Andere Buchungen lassen sich hier nicht stornieren
    await expect(manual.reverseManualEntry(actor, crypto.randomUUID())).rejects.toThrow("nicht gefunden");
  });

  it("zwei gleichzeitige Stornos ergeben genau eine Gegenbuchung", async () => {
    await setup("gmbh", "SKR04");
    const id = await manual.createManualEntry(
      actor,
      {
        date: "2026-03-01",
        description: "Darlehen des Gesellschafters umgebucht",
        lines: [
          { account: "3510", debit: 50_000, credit: 0 },
          { account: "3514", debit: 0, credit: 50_000 },
        ],
      },
      today,
    );
    const results = await Promise.allSettled([manual.reverseManualEntry(actor, id), manual.reverseManualEntry(actor, id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await sql`select id from journal_entries where reverses_id = ${id}`).toHaveLength(1);
  }, 30_000);

  it("steht im DATEV-Export", async () => {
    await setup("gmbh", "SKR03");
    await manual.createManualEntry(
      actor,
      {
        date: "2026-02-01",
        description: "Gesellschafterdarlehen",
        lines: [
          { account: "0730", debit: 1_000_000, credit: 0 },
          { account: "0740", debit: 0, credit: 1_000_000 },
        ],
      },
      today,
    );
    await sql`update company set datev_berater_nr = '29098', datev_mandant_nr = '55003'`;
    const { bookings, bytes } = await datev.datevExport(2026);
    expect(bookings).toBe(1);
    expect(new TextDecoder("windows-1252").decode(bytes)).toContain("Gesellschafterdarlehen");
  });
});
