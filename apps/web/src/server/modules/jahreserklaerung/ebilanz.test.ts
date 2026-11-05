import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { EricGeprueftClient, ericKennt } from "../../test-eric.ts";

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
  let documents: typeof import("../belege/documents.ts");
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
    documents = await import("../belege/documents.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await sql`truncate journal_lines, journal_entries, document_amounts, documents, asset_depreciations, assets, annual_submissions, elster_certificates, residual_terms, company cascade`;
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

        const ohneRestlaufzeit = "Ohne bestätigte Restlaufzeiten fehlen die Davon-Positionen zu Restlaufzeiten bis und über einem Jahr.";
        expect((await ebilanz.ebilanzOverview(2026, today))?.issues).toEqual([
          { tone: "hinweis", text: "Echt senden lässt sich die E-Bilanz erst, wenn 2026 abgeschlossen ist." },
          { tone: "hinweis", text: ohneRestlaufzeit },
        ]);
        expect(Object.keys(daten.werte).some((p) => p.endsWith("1year"))).toBe(false);
        // Restlaufzeiten bestätigt: 1.000 € des Gesellschafters laufen länger als ein Jahr (§ 268 Abs. 5 HGB)
        const { saveRestlaufzeiten } = await import("../buchhaltung/restlaufzeiten.ts");
        await saveRestlaufzeiten(actor, 2026, {
          jahr: [
            { account: k.gesellschafter, ueber1Jahr: 100_000 },
            { account: k.ust, ueber1Jahr: 0 },
          ],
          vorjahr: [],
        });
        expect((await ebilanz.ebilanzDaten(2026, company)).daten.werte).toMatchObject({
          "bs.eqLiab.liab.shareholders.upTo1year": 200_000,
          "bs.eqLiab.liab.shareholders.above1year": 100_000,
          "bs.eqLiab.liab.other.upTo1year": 190_000,
          "bs.eqLiab.liab.upTo1year": 390_000,
          "bs.eqLiab.liab.above1year": 100_000,
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
        // 2026: Taxonomie 6.9, mit Kontennachweis je Konto statt der Begründung NoKS
        expect(daten.taxonomie).toBe("6.9");
        expect(row!.request_xml).toContain("de-gaap-ci-2025-04-01");
        expect(row!.request_xml).toContain(`<de-gaap-ci:detailedInformation.accountbalances.accountNumber contextRef="D-AKTJAHR">${k.bank}<`);
        expect(row!.request_xml).not.toContain(">NoKS<");

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

    // Mit einem ERiC ohne Plugin für 6.10 lehnt Haben ab (ebilanz-eric44.test.ts)
    it.skipIf(!ericKennt("Bilanz_6.10")).each(["ist", "soll"] as const)(
      "%s: 2027 in Taxonomie 6.10 mit Kontennachweis je Konto (BMF-Schreiben vom 8. Juni 2026)",
      async (versteuerung) => {
        await setup(kontenrahmen, versteuerung);
        await manual.createManualEntry(
          actor,
          {
            kind: "eroeffnung",
            date: "2027-01-01",
            description: "Eröffnungsbilanz",
            lines: [
              { account: k.bank, debit: 2_500_000, credit: 0 },
              { account: k.kapital, debit: 0, credit: 2_500_000 },
            ],
          },
          "2028-02-10",
        );
        await book("2027-03-01", [
          [k.bank, 1_190_000, 0],
          [k.erloes, 0, 1_000_000],
          [k.ust, 0, 190_000],
        ]);
        await book("2027-04-01", [
          [k.aufwand, 300_000, 0],
          [k.gesellschafter, 0, 300_000],
        ]);
        const company = await stammdaten.loadCompany();
        const { daten, issues } = await ebilanz.ebilanzDaten(2027, company);
        expect(issues).toEqual([]);
        expect(daten.taxonomie).toBe("6.10");
        // Saldo im Vorzeichen der Position: Erlöse und Verbindlichkeiten positiv
        expect(daten.konten).toEqual(
          expect.arrayContaining([
            { account: k.bank, name: expect.any(String), position: "bs.ass.currAss.cashEquiv.bank", betrag: 3_690_000 },
            { account: k.erloes, name: expect.any(String), position: expect.stringContaining("netSales.grossSales.generalRateVAT"), betrag: 1_000_000 },
            { account: k.gesellschafter, name: expect.any(String), position: "bs.eqLiab.liab.shareholders.gmbh", betrag: 300_000 },
          ]),
        );
        expect((await ebilanz.ebilanzOverview(2027, "2028-02-10"))?.taxonomie).toBe("6.10");

        const validated = await ebilanz.submitEbilanz(actor, 2027, new EricGeprueftClient(), { kind: "validate", today: "2028-02-10" });
        expect(validated.ok).toBe(true);
        const [row] = await sql`select request_xml from annual_submissions where year = 2027`;
        const xml: string = row!.request_xml;
        expect(xml).toContain("de-gaap-ci-2026-04-01");
        expect(xml).not.toContain("transmissionNotYetPossible");
        // Je Konto mit Saldo ein Eintrag, der Jahresüberschuss ohne Konto: 7.000 € = 10.000 − 3.000
        for (const konto of [k.bank, k.kapital, k.erloes, k.ust, k.aufwand, k.gesellschafter]) {
          expect(xml).toContain(`<de-gaap-ci:detailedInformation.accountbalances.accountNumber contextRef="D-AKTJAHR">${konto}<`);
        }
        expect(xml.match(/<de-gaap-ci:detailedInformation\.accountBalances>/g)).toHaveLength(7);
        expect(xml).toContain(
          '<de-gaap-ci:detailedInformation.accountbalances.amount contextRef="D-AKTJAHR" unitRef="EUR" decimals="2">7000.00</de-gaap-ci:detailedInformation.accountbalances.amount><de-gaap-ci:detailedInformation.accountbalances.notPossible contextRef="D-AKTJAHR">true<',
        );
      },
      60_000,
    );

    // Anlagenspiegel 6.10 aus dem Anlagenverzeichnis: Pkw mit Buchwert, GWG und Sammelposten im Jahr gekauft
    it.skipIf(!ericKennt("Bilanz_6.10")).each(["ist", "soll"] as const)(
      "%s: 2027 mit Pkw, GWG und Sammelposten im Anlagenspiegel 6.10",
      async (versteuerung) => {
        await setup(kontenrahmen, versteuerung);
        await assets.createAsset(actor, {
          name: "VW Passat",
          kind: "kfz",
          method: "linear",
          acquisitionDate: "2024-01-10",
          cost: 3_600_000,
          usefulLifeMonths: 72,
          openingDate: "2027-01-01",
          openingBookValue: 1_800_000,
          disposalDate: null,
          note: "",
        });
        await manual.createManualEntry(
          actor,
          {
            kind: "eroeffnung",
            date: "2027-01-01",
            description: "Eröffnungsbilanz",
            lines: [
              { account: k.bank, debit: 2_500_000, credit: 0 },
              { account: "9000", debit: 1_800_000, credit: 0 },
              { account: k.kapital, debit: 0, credit: 2_500_000 },
              { account: k.vortrag, debit: 0, credit: 1_800_000 },
            ],
          },
          "2028-02-10",
        );
        // GWG und Sammelposten als Beleg im Jahr gekauft, privat bezahlt (an den Gesellschafter)
        for (const [n, datum, net, asset] of [
          [1, "2027-02-01", 79_900, { name: "Monitor", kind: "edv", method: "gwg", usefulLifeMonths: null }],
          [2, "2027-03-01", 90_000, { name: "Schreibtisch", kind: "buero", method: "sammelposten", usefulLifeMonths: null }],
        ] as const) {
          const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n]), filename: `anlage-${n}.jpg` });
          await documents.updateDocument(actor, id, {
            supplierName: "Händler",
            supplierUstId: "",
            invoiceNumber: `A-${n}`,
            documentDate: datum,
            dueDate: null,
            category: "anlage",
            payment: "privat",
            note: "",
            amounts: [{ taxRate: 1900, net, tax: Math.round(net * 0.19) }],
            asset,
          });
          await documents.bookDocument(actor, id);
        }
        await book("2027-03-15", [
          [k.bank, 1_190_000, 0],
          [k.erloes, 0, 1_000_000],
          [k.ust, 0, 190_000],
        ]);
        await assets.bookDepreciation(actor, 2027, "2027-12-05");

        const company = await stammdaten.loadCompany();
        const { daten, issues } = await ebilanz.ebilanzDaten(2027, company);
        expect(issues).toEqual([]);
        expect(daten.taxonomie).toBe("6.10");
        expect(daten.anlagen.map((z) => [z.position, z.zugaenge])).toEqual(
          expect.arrayContaining([
            ["bs.ass.fixAss.tan.otherEquipm.gwg", 79_900],
            [expect.stringContaining("bs.ass.fixAss.tan.otherEquipm"), 90_000],
          ]),
        );
        const validated = await ebilanz.submitEbilanz(actor, 2027, new EricGeprueftClient(), { kind: "validate", today: "2028-02-10" });
        expect(validated.ok, validated.message).toBe(true);
        // Jedes Anlagekonto mit Saldo steht im Kontennachweis
        const [row] = await sql`select request_xml from annual_submissions where year = 2027`;
        for (const konto of daten.konten.filter((kt) => kt.betrag !== 0)) {
          expect(row!.request_xml).toContain(`<de-gaap-ci:detailedInformation.accountbalances.accountNumber contextRef="D-AKTJAHR">${konto.account}<`);
        }
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
