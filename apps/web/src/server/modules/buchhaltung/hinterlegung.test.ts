import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

describe.skipIf(!testDatabaseUrl)("Bilanz zur Hinterlegung beim Unternehmensregister (Postgres)", () => {
  let sql: postgres.Sql;
  let hinterlegung: typeof import("./hinterlegung.ts");
  let manual: typeof import("./manual.ts");
  let ledger: typeof import("./ledger.ts");
  const actor = "test-user";
  const today = "2027-02-10";
  const KEINE = { haftungsverhaeltnisse: "", organkredite: "", festgestelltAm: "2027-02-01" };

  beforeAll(async () => {
    sql = await setupTestDb();
    hinterlegung = await import("./hinterlegung.ts");
    manual = await import("./manual.ts");
    ledger = await import("./ledger.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(
    rechtsform: "einzelunternehmen" | "gmbh",
    kontenrahmen: "SKR03" | "SKR04",
    versteuerung: "ist" | "soll",
    register = { sitz: "", registergericht: "Amtsgericht Bremen", registernummer: "HRB 12345 HB" },
  ) {
    await sql`truncate journal_lines, journal_entries, document_amounts, documents, asset_depreciations, assets, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform,
                                   sitz, registergericht, registernummer)
      values (1, 'Nordlicht GmbH', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB',
              ${kontenrahmen}, ${versteuerung}, ${rechtsform}, ${register.sitz}, ${register.registergericht}, ${register.registernummer})`;
  }

  async function book(date: string, lines: [string, number, number][]) {
    const { withActor } = await import("../../db/actor.ts");
    return withActor(actor, async (tx) =>
      ledger.post(tx, await ledger.openBooks(tx), {
        date,
        description: "Test",
        sourceType: "document",
        sourceId: crypto.randomUUID(),
        lines: lines.map(([account, debit, credit]) => ({ account, debit, credit, taxCode: null })),
      }),
    );
  }

  async function eroeffnung(bank: string, kapital: string) {
    await manual.createManualEntry(
      actor,
      {
        kind: "eroeffnung",
        date: "2026-01-01",
        description: "Eröffnungsbilanz",
        lines: [
          { account: bank, debit: 2_500_000, credit: 0 },
          { account: kapital, debit: 0, credit: 2_500_000 },
        ],
      },
      today,
    );
  }

  describe.each([
    ["SKR03", { bank: "1200", kapital: "0800", erloes: "8400", ust: "1776" }],
    ["SKR04", { bank: "1800", kapital: "2900", erloes: "4400", ust: "3806" }],
  ] as const)("%s", (kontenrahmen, k) => {
    it.each(["ist", "soll"] as const)("%s: Vorjahr aus der Eröffnung, Sitz aus dem Ort, PDF", async (versteuerung) => {
      await setup("gmbh", kontenrahmen, versteuerung);
      await eroeffnung(k.bank, k.kapital);
      await book("2026-03-01", [
        [k.bank, 1_190_000, 0],
        [k.erloes, 0, 1_000_000],
        [k.ust, 0, 190_000],
      ]);

      const stand = await hinterlegung.hinterlegungStand(2026, today);
      expect(stand).toEqual({ frist: "2027-12-31", fristAbgelaufen: false, maengel: [], vorjahr: true });

      const bilanz = await hinterlegung.hinterlegungBilanzFuer(2026, KEINE, today);
      expect(bilanz.firma).toEqual({ name: "Nordlicht GmbH", sitz: "Bremen", registergericht: "Amtsgericht Bremen", registernummer: "HRB 12345 HB" });
      expect(bilanz.vorjahresstichtag).toBe("2025-12-31");
      expect(bilanz.aktiva).toEqual([{ label: "B. Umlaufvermögen", betrag: 3_690_000, vorjahr: 2_500_000 }]);
      expect(bilanz.passiva).toEqual([
        { label: "A. Eigenkapital", betrag: 3_500_000, vorjahr: 2_500_000 },
        { label: "C. Verbindlichkeiten", betrag: 190_000, vorjahr: 0 },
      ]);
      expect(bilanz.summeAktiva.betrag).toBe(bilanz.summePassiva.betrag);

      const { filename, pdf } = await hinterlegung.hinterlegungPdf(2026, KEINE, today);
      expect(filename).toBe("Bilanz-2026-Hinterlegung.pdf");
      expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    });

    it("Vorjahr aus dem Saldenvortrag, wenn schon im Vorjahr gebucht ist", async () => {
      await setup("gmbh", kontenrahmen, "ist");
      await book("2025-02-01", [
        [k.bank, 2_500_000, 0],
        [k.kapital, 0, 2_500_000],
      ]);
      await book("2025-06-01", [
        [k.bank, 500_000, 0],
        [k.erloes, 0, 500_000],
      ]);
      const bilanz = await hinterlegung.hinterlegungBilanzFuer(2026, KEINE, today);
      expect(bilanz.aktiva).toEqual([{ label: "B. Umlaufvermögen", betrag: 3_000_000, vorjahr: 3_000_000 }]);
      expect(bilanz.passiva).toEqual([{ label: "A. Eigenkapital", betrag: 3_000_000, vorjahr: 3_000_000 }]);
    });

    it("ohne Registerangaben keine Datei; im ersten Jahr ohne Vorjahresspalte", async () => {
      await setup("gmbh", kontenrahmen, "soll", { sitz: "", registergericht: "", registernummer: "" });
      await book("2026-02-01", [
        [k.bank, 2_500_000, 0],
        [k.kapital, 0, 2_500_000],
      ]);
      const stand = await hinterlegung.hinterlegungStand(2026, today);
      expect(stand?.vorjahr).toBe(false);
      expect(stand?.maengel).toEqual(["Das Registergericht fehlt in den Firmendaten.", "Die Handelsregisternummer fehlt in den Firmendaten."]);
      await expect(hinterlegung.hinterlegungPdf(2026, KEINE, today)).rejects.toThrow("Das Registergericht fehlt");
    });
  });

  it("nur GmbH und UG, nur vergangene Jahre, Feststellung nach dem Stichtag", async () => {
    await setup("gmbh", "SKR04", "ist");
    expect(await hinterlegung.hinterlegungStand(2027, today)).toBeNull();
    await expect(hinterlegung.hinterlegungPdf(2027, { ...KEINE, festgestelltAm: "2027-02-01" }, today)).rejects.toThrow("Das Jahr 2027 ist noch nicht vorbei.");
    await expect(hinterlegung.hinterlegungPdf(2026, { ...KEINE, festgestelltAm: "2026-12-31" }, today)).rejects.toThrow("nach dem Bilanzstichtag");
    // Frist abgelaufen: 2024 hätte bis Ende 2025 hinterlegt werden müssen
    expect((await hinterlegung.hinterlegungStand(2024, today))?.fristAbgelaufen).toBe(true);

    await setup("einzelunternehmen", "SKR04", "ist");
    expect(await hinterlegung.hinterlegungStand(2026, today)).toBeNull();
    await expect(hinterlegung.hinterlegungPdf(2026, KEINE, today)).rejects.toThrow("nur für GmbH und UG");
  });
});
