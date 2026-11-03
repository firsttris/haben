import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { EricGeprueftClient } from "../../test-eric.ts";

/*
 * E-Bilanz einer GmbH aus den Buchungen: Werte, Betriebsvermögensvergleich und Anlagenspiegel, Prüfen mit ERiC (wenn
 * vorhanden, test-eric.ts), Protokoll, und dass echt erst nach dem Abschluss des Jahres gesendet wird.
 */
describe.skipIf(!testDatabaseUrl)("E-Bilanz (Postgres)", () => {
  let sql: postgres.Sql;
  let ebilanz: typeof import("./ebilanz.ts");
  let manual: typeof import("../buchhaltung/manual.ts");
  let ledger: typeof import("../buchhaltung/ledger.ts");
  let assets: typeof import("../buchhaltung/assets.ts");
  let abschluss: typeof import("../buchhaltung/abschluss.ts");
  let stammdaten: typeof import("../stammdaten/index.ts");
  let crypto: typeof import("../../crypto.ts");
  const actor = "test-user";
  const today = "2027-02-10";

  beforeAll(async () => {
    sql = await setupTestDb();
    ebilanz = await import("./ebilanz.ts");
    manual = await import("../buchhaltung/manual.ts");
    ledger = await import("../buchhaltung/ledger.ts");
    assets = await import("../buchhaltung/assets.ts");
    abschluss = await import("../buchhaltung/abschluss.ts");
    stammdaten = await import("../stammdaten/index.ts");
    crypto = await import("../../crypto.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await sql`truncate journal_lines, journal_entries, document_amounts, documents, asset_depreciations, assets, annual_submissions, elster_certificates, company cascade`;
    await sql.begin(async (tx) => {
      for (const table of ["year_closings", "annual_submissions"]) {
        await tx.unsafe(`alter table ${table} disable trigger ${table}_append_only`);
        await tx.unsafe(`delete from ${table}`);
        await tx.unsafe(`alter table ${table} enable trigger ${table}_append_only`);
      }
    });
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht GmbH', 'Hafenallee 3', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY',
              ${kontenrahmen}, ${versteuerung}, 'gmbh')`;
  }

  async function book(date: string, lines: [string, number, number][]) {
    const { withActor } = await import("../../db/actor.ts");
    return withActor(actor, async (tx) =>
      ledger.post(tx, await ledger.openBooks(tx), {
        date,
        description: "Test",
        sourceType: "document",
        sourceId: globalThis.crypto.randomUUID(),
        lines: lines.map(([account, debit, credit]) => ({ account, debit, credit, taxCode: null })),
      }),
    );
  }

  describe.each([
    ["SKR03", { bank: "1200", kapital: "0800", vortrag: "0860", gesellschafter: "0730", erloes: "8400", ust: "1776", aufwand: "4900", fremd: "0010" }],
    ["SKR04", { bank: "1800", kapital: "2900", vortrag: "2970", gesellschafter: "3510", erloes: "4400", ust: "3806", aufwand: "6300", fremd: "0010" }],
  ] as const)("%s", (kontenrahmen, k) => {
    it.each(["ist", "soll"] as const)(
      "%s: Folgejahr mit übernommenem Pkw, prüfen, echt erst nach dem Abschluss",
      async (versteuerung) => {
        await setup(kontenrahmen, versteuerung);
        // Pkw aus 2024 (36.000 €, sechs Jahre) mit Buchwert 24.000 € übernommen: Anlage an Saldenvortrag
        await assets.createAsset(actor, {
          name: "VW Passat",
          kind: "kfz",
          method: "linear",
          acquisitionDate: "2024-01-10",
          cost: 3_600_000,
          usefulLifeMonths: 72,
          openingDate: "2026-01-01",
          openingBookValue: 2_400_000,
          disposalDate: null,
          note: "",
        });
        await manual.createManualEntry(
          actor,
          {
            kind: "eroeffnung",
            date: "2026-01-01",
            description: "Eröffnungsbilanz",
            lines: [
              { account: k.bank, debit: 2_500_000, credit: 0 },
              { account: "9000", debit: 2_400_000, credit: 0 },
              { account: k.kapital, debit: 0, credit: 2_500_000 },
              { account: k.vortrag, debit: 0, credit: 2_400_000 },
            ],
          },
          today,
        );
        await book("2026-03-01", [
          [k.bank, 1_190_000, 0],
          [k.erloes, 0, 1_000_000],
          [k.ust, 0, 190_000],
        ]);
        await book("2026-04-01", [
          [k.aufwand, 300_000, 0],
          [k.gesellschafter, 0, 300_000],
        ]);
        // Ausschüttung aus dem Gewinnvortrag
        await book("2026-06-30", [
          [k.vortrag, 100_000, 0],
          [k.bank, 0, 100_000],
        ]);
        await assets.bookDepreciation(actor, 2026, "2026-12-05");

        const company = await stammdaten.loadCompany();
        const { daten, issues } = await ebilanz.ebilanzDaten(2026, company);
        expect(issues).toEqual([]);
        expect(daten.bvv).toEqual({ eigenkapitalVorjahr: 4_900_000, einlagen: 0, ausschuettungen: 100_000 });
        expect(daten.anlagen).toEqual([
          {
            position: "bs.ass.fixAss.tan.otherEquipm.passengerCars",
            akAnfang: 3_600_000,
            zugaenge: 0,
            abgaenge: 0,
            afaAnfang: 1_200_000,
            afaJahr: 600_000,
            afaAbgaenge: 0,
          },
        ]);
        expect(daten.werte).toMatchObject({
          "bs.ass.fixAss.tan.otherEquipm.passengerCars": 1_800_000,
          "bs.ass.currAss.cashEquiv.bank": 3_590_000,
          "bs.eqLiab.equity.subscribed.corp": 2_500_000,
          "bs.eqLiab.equity.retainedEarnings": 2_300_000,
          // 10.000 Erlöse − 3.000 Aufwand − 6.000 AfA
          "bs.eqLiab.equity.netIncome": 100_000,
          "bs.eqLiab.liab.shareholders.gmbh": 300_000,
          "bs.eqLiab.liab.other.theroffTax.vat": 190_000,
        });

        const overview = await ebilanz.ebilanzOverview(2026, today);
        expect(overview?.issues).toEqual([{ tone: "hinweis", text: "Echt senden lässt sich die E-Bilanz erst, wenn 2026 abgeschlossen ist." }]);

        const client = new EricGeprueftClient();
        const validated = await ebilanz.submitEbilanz(actor, 2026, client, { kind: "validate", today });
        expect(validated.ok).toBe(true);
        const [row] = await sql`select form, kind, request_xml, figures from annual_submissions`;
        expect(row).toMatchObject({ form: "ebilanz", kind: "validate" });
        expect(row!.request_xml).toContain('<de-gaap-ci:bs.eqLiab.equity.netIncome contextRef="I-AKTJAHR" unitRef="EUR" decimals="2">1000.00<');
        expect(row!.request_xml).toContain("Nordlicht GmbH; Hafenallee; 3; ; ; 93047; Regensburg; Deutschland");
        expect(row!.figures.bvv).toEqual(daten.bvv);

        // Echt erst nach dem Abschluss; ein Client ohne Simulation, damit das Gateway bis zur Prüfung kommt
        await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(new Uint8Array([1, 2, 3]))})`;
        const realClient = {
          validate: client.validate.bind(client),
          send: client.send.bind(client),
          fetchPostfach: client.fetchPostfach.bind(client),
          fetchBelege: client.fetchBelege.bind(client),
        };
        const send = () => ebilanz.submitEbilanz(actor, 2026, realClient, { kind: "send", pin: "1234", herstellerId: "12345", today });
        await expect(send()).rejects.toThrow("Das Jahr 2026 ist noch nicht abgeschlossen.");
        await abschluss.closeYear(actor, 2026, today);
        expect((await ebilanz.ebilanzOverview(2026, today))?.issues).toEqual([]);
        expect((await send()).ok).toBe(true);
        await expect(send()).rejects.toThrow("schon übermittelt");
        expect((await ebilanz.ebilanzOverview(2026, today))?.sent).toMatchObject({ kind: "send", ok: true });
      },
      60_000,
    );

    it("Konten ohne Position hindern die E-Bilanz", async () => {
      await setup(kontenrahmen, "ist");
      await book("2026-02-01", [
        [k.fremd, 500_000, 0],
        [k.gesellschafter, 0, 500_000],
      ]);
      const overview = await ebilanz.ebilanzOverview(2026, today);
      expect(overview?.issues).toContainEqual({ tone: "fehler", text: expect.stringContaining(`Konto ${k.fremd}`) });
      await expect(ebilanz.submitEbilanz(actor, 2026, new EricGeprueftClient(), { kind: "validate", today })).rejects.toThrow(`Konto ${k.fremd}`);
    });
  });

  it("Einzelunternehmen haben keine E-Bilanz", async () => {
    await setup("SKR04", "ist");
    await sql`update company set rechtsform = 'einzelunternehmen'`;
    expect(await ebilanz.ebilanzOverview(2026, today)).toBeNull();
    await expect(ebilanz.submitEbilanz(actor, 2026, new EricGeprueftClient(), { kind: "validate", today })).rejects.toThrow("nur für GmbH und UG");
  });
});
