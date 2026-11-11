import { parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/**
 * Degressive AfA (§ 7 Abs. 2 und 3 EStG), Elektrofahrzeuge (§ 7 Abs. 2a EStG) und Erinnerungswert, gebucht in SKR03
 * und SKR04, Ist und Soll, Einzelunternehmen und GmbH (docs/anlagen.md).
 */
describe.skipIf(!testDatabaseUrl)("Weitere AfA-Methoden (Postgres)", () => {
  let sql: postgres.Sql;
  let assets: typeof import("./assets.ts");
  let documents: typeof import("../belege/documents.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let annual: typeof import("../jahreserklaerung/annual.ts");
  let datev: typeof import("../auswertungen/datev-export.ts");
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    assets = await import("./assets.ts");
    documents = await import("../belege/documents.ts");
    reports = await import("../auswertungen/reports.ts");
    annual = await import("../jahreserklaerung/annual.ts");
    datev = await import("../auswertungen/datev-export.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  const KONTEN = {
    SKR03: { bga: "0490", kfz: "0320", afa: "4830", afaKfz: "4832", restbuchwert: "2310", saldenvortrag: "9000" },
    SKR04: { bga: "0690", kfz: "0520", afa: "6220", afaKfz: "6222", restbuchwert: "6895", saldenvortrag: "9000" },
  } as const;

  type Fall = readonly ["SKR03" | "SKR04", "ist" | "soll", "einzelunternehmen" | "gmbh"];
  const FAELLE: Fall[] = (["SKR03", "SKR04"] as const).flatMap((kr) =>
    (["ist", "soll"] as const).flatMap((v) => (["einzelunternehmen", "gmbh"] as const).map((r) => [kr, v, r] as const)),
  );

  async function setup([kontenrahmen, versteuerung, rechtsform]: Fall) {
    await leeren(sql)`truncate asset_depreciations, assets, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, document_amounts, documents, company cascade`;
    await sql`insert into company (id, name, versteuerung, kontenrahmen, bundesland, rechtsform)
      values (1, 'Testfirma', ${versteuerung}, ${kontenrahmen}, 'BY', ${rechtsform})`;
  }

  let receipt = 10;
  async function buyByDocument(
    date: string,
    net: number,
    asset: { name: string; kind: "kfz" | "sonstiges"; method: "degressiv" | "elektro"; usefulLifeMonths: number | null },
  ) {
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, receipt++]), filename: `${asset.name}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Händler",
      supplierUstId: "",
      invoiceNumber: `R-${receipt}`,
      documentDate: date,
      dueDate: null,
      category: "anlage",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net, tax: Math.round(net * 0.19) }],
      asset,
    });
    await documents.bookDocument(actor, id);
    const [created] = await sql`select id from assets where document_id = ${id}`;
    return created!.id as string;
  }

  const linesOf = async (assetId: string, year: number) =>
    (
      await sql`select e.date::text as date, l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_id = ${assetId} and extract(year from e.date) = ${year} order by e.date, l.debit desc, l.credit desc`
    ).map((r) => ({ ...r }));

  it.each(FAELLE)("%s, %s, %s: degressiv und Elektrofahrzeug per Beleg, Wechsel zur linearen, Sperren", async (...fall) => {
    await setup(fall);
    const k = KONTEN[fall[0]];
    const maschine = await buyByDocument("2025-09-15", 10_000_000, { name: "Fräsmaschine", kind: "sonstiges", method: "degressiv", usefulLifeMonths: 120 });
    // § 7 Abs. 2a EStG nur im Einzelunternehmen; die GmbH-Fälle prüft der Test weiter unten
    const einzel = fall[2] === "einzelunternehmen";
    const auto = einzel
      ? await buyByDocument("2025-11-03", 6_000_000, { name: "Tesla Model 3", kind: "kfz", method: "elektro", usefulLifeMonths: null })
      : null;

    const list = await assets.listAssets(2025);
    expect(list.find((a) => a.id === maschine)).toMatchObject({
      degressiveRate: 3000,
      usefulLifeMonths: 120,
      account: k.bga,
      year: { depreciation: 1_000_000 },
    });
    if (auto)
      expect(list.find((a) => a.id === auto)).toMatchObject({ method: "elektro", account: k.kfz, year: { depreciation: 4_500_000, closing: 1_500_000 } });
    const euer = await reports.euerForYear(2025);
    expect(euer.ausgaben.find((l) => l.key === "afa")?.amount).toBe(einzel ? 5_500_000 : 1_000_000);

    await assets.bookDepreciation(actor, 2025, "2025-12-01");
    expect(await linesOf(maschine, 2025)).toEqual([
      { date: "2025-12-31", account: k.afa, debit: 1_000_000, credit: 0 },
      { date: "2025-12-31", account: k.bga, debit: 0, credit: 1_000_000 },
    ]);
    if (auto) {
      expect(await linesOf(auto, 2025)).toEqual([
        { date: "2025-12-31", account: k.afaKfz, debit: 4_500_000, credit: 0 },
        { date: "2025-12-31", account: k.kfz, debit: 0, credit: 4_500_000 },
      ]);
    }

    // DATEV-Export: AfA wie jede Buchung, gegen das Anlagekonto
    await datev.saveDatevNumbers(actor, { beraterNr: "29098", mandantNr: "55003" });
    const stack = parseDatevBuchungsstapel((await datev.datevExport(2025, new Date(2026, 0, 4))).bytes);
    const pairs = stack.bookings.map((b) => `${[b.account, b.contraAccount].sort().join("/")}:${b.amount}`);
    const expected = [`${[k.afa, k.bga].sort().join("/")}:1000000`, ...(auto ? [`${[k.afaKfz, k.kfz].sort().join("/")}:4500000`] : [])];
    expect(pairs).toEqual(expect.arrayContaining(expected));

    // Satz, Erinnerungswert und Methode sind nach der ersten Buchung fest, auch in der Datenbank
    await expect(sql`update assets set degressive_rate = 2000 where id = ${maschine}`).rejects.toThrow("unveränderlich");
    await expect(sql`update assets set memo_value = true where id = ${maschine}`).rejects.toThrow("unveränderlich");
    await expect(sql`update assets set method = 'linear', degressive_rate = null where id = ${maschine}`).rejects.toThrow("unveränderlich");

    // Wechsel zur linearen AfA (§ 7 Abs. 3 EStG): nur in ein noch nicht gebuchtes Jahr
    await expect(assets.updateAsset(actor, maschine, { name: "Fräsmaschine", linearFromYear: 2025 })).rejects.toThrow("frühestens 2026");
    await expect(sql`update assets set linear_from_year = 2025 where id = ${maschine}`).rejects.toThrow("Wechsel zur linearen AfA");
    if (auto) await expect(assets.updateAsset(actor, auto, { name: "Tesla Model 3", linearFromYear: 2026 })).rejects.toThrow("nur bei der degressiven");
    await assets.updateAsset(actor, maschine, { name: "Fräsmaschine", linearFromYear: 2026 });

    await assets.bookDepreciation(actor, 2026, "2026-12-01");
    // 90.000 € über die Restnutzungsdauer von 116 Monaten statt 27.000 € degressiv
    expect(await linesOf(maschine, 2026)).toEqual([
      { date: "2026-12-31", account: k.afa, debit: 931_034, credit: 0 },
      { date: "2026-12-31", account: k.bga, debit: 0, credit: 931_034 },
    ]);
    if (auto) {
      expect(await linesOf(auto, 2026)).toEqual([
        { date: "2026-12-31", account: k.afaKfz, debit: 600_000, credit: 0 },
        { date: "2026-12-31", account: k.kfz, debit: 0, credit: 600_000 },
      ]);
    }
    // zurück zur degressiven geht nicht (§ 7 Abs. 3 Satz 3 EStG)
    await expect(assets.updateAsset(actor, maschine, { name: "Fräsmaschine", linearFromYear: null })).rejects.toThrow("zurück zur degressiven");
    await expect(sql`update assets set linear_from_year = null where id = ${maschine}`).rejects.toThrow("Wechsel zur linearen AfA");
    await expect(sql`update assets set linear_from_year = 2027 where id = ${maschine}`).rejects.toThrow("Wechsel zur linearen AfA");

    if (fall[2] === "einzelunternehmen") {
      const year = await annual.euerYear(2026);
      expect(year.figures.afaBeweglich).toBe(1_531_034);
      expect(year.anlagen.find((a) => a.bezeichnung === "Tesla Model 3")).toMatchObject({ gruppe: "kfz", elektro: true, afa: 600_000, buchwertEnde: 900_000 });
    }
  });

  it.each(FAELLE)("%s, %s, %s: Erinnerungswert bleibt stehen, der Abgang bucht ihn aus", async (...fall) => {
    await setup(fall);
    const k = KONTEN[fall[0]];
    const asset = await assets.createAsset(actor, {
      name: "Transporter",
      kind: "kfz",
      method: "linear",
      acquisitionDate: "2020-01-10",
      cost: 1_200_000,
      usefulLifeMonths: 72,
      openingDate: "2025-01-01",
      openingBookValue: 200_000,
      disposalDate: null,
      memoValue: true,
      note: "",
    });
    await assets.bookDepreciation(actor, 2025, "2025-12-01");
    expect((await linesOf(asset.id, 2025)).slice(2)).toEqual([
      { date: "2025-12-31", account: k.afaKfz, debit: 199_900, credit: 0 },
      { date: "2025-12-31", account: k.kfz, debit: 0, credit: 199_900 },
    ]);
    const [in2026] = (await assets.listAssets(2026)).filter((a) => a.id === asset.id);
    expect(in2026).toMatchObject({ closing: 100, pending: false, year: { opening: 100, depreciation: 0, closing: 100 } });
    await expect(assets.bookDepreciation(actor, 2026, "2026-12-01")).rejects.toThrow("keine AfA");

    await assets.updateAsset(actor, asset.id, { name: "Transporter", disposalDate: "2027-03-31" });
    await assets.bookDepreciation(actor, 2027, "2028-01-10");
    expect(await linesOf(asset.id, 2027)).toEqual([
      { date: "2027-03-31", account: k.restbuchwert, debit: 100, credit: 0 },
      { date: "2027-03-31", account: k.kfz, debit: 0, credit: 100 },
    ]);
    if (fall[2] === "einzelunternehmen") {
      expect((await reports.euerForYear(2027)).ausgaben.find((l) => l.key === "restbuchwert")?.amount).toBe(100);
    }
  });

  it.each(FAELLE)("%s, %s, %s: degressive Übernahme nur mit rechnerischem Restbuchwert", async (...fall) => {
    await setup(fall);
    const k = KONTEN[fall[0]];
    const input = {
      name: "Drehbank",
      kind: "sonstiges" as const,
      method: "degressiv" as const,
      acquisitionDate: "2024-04-10",
      cost: 5_000_000,
      usefulLifeMonths: 120,
      openingDate: "2026-01-01",
      openingBookValue: 3_000_000,
      disposalDate: null,
      note: "",
    };
    await expect(assets.createAsset(actor, input)).rejects.toThrow("rechnerisch 34.000,00 €");
    const asset = await assets.createAsset(actor, { ...input, openingBookValue: 3_400_000 });
    expect(asset.degressiveRate).toBe(2000);
    await assets.bookDepreciation(actor, 2026, "2026-12-01");
    expect(await linesOf(asset.id, 2026)).toEqual([
      { date: "2026-01-01", account: k.bga, debit: 3_400_000, credit: 0 },
      { date: "2026-01-01", account: k.saldenvortrag, debit: 0, credit: 3_400_000 },
      { date: "2026-12-31", account: k.afa, debit: 680_000, credit: 0 },
      { date: "2026-12-31", account: k.bga, debit: 0, credit: 680_000 },
    ]);
  });

  it("Elektro-AfA nur für Fahrzeuge mit Elektroantrieb, degressiv nur im Zeitraum", async () => {
    await setup(["SKR03", "ist", "einzelunternehmen"]);
    const base = {
      name: "Auto",
      kind: "kfz" as const,
      method: "elektro" as const,
      acquisitionDate: "2025-08-01",
      cost: 4_000_000,
      usefulLifeMonths: null,
      openingDate: "2026-01-01",
      openingBookValue: 1_000_000,
      disposalDate: null,
      note: "",
    };
    await expect(assets.createAsset(actor, { ...base, kind: "sonstiges" })).rejects.toThrow("nur für Fahrzeuge");
    await expect(assets.createAsset(actor, { ...base, privateUse: { listPrice: 5_000_000, drive: "verbrenner", rate: 100, vat: true } })).rejects.toThrow(
      "reine Elektrofahrzeuge",
    );
    await expect(assets.createAsset(actor, { ...base, method: "degressiv", usefulLifeMonths: 72, acquisitionDate: "2025-03-01" })).rejects.toThrow(
      "Degressive AfA nur bei Anschaffung",
    );
    const car = await assets.createAsset(actor, { ...base, privateUse: { listPrice: 5_000_000, drive: "elektro", rate: 25, vat: true } });
    expect(car.method).toBe("elektro");
    // Ungebucht lässt sich die Methode noch wechseln; Satz und Wechsel fallen dann weg
    const linear = await assets.updateAsset(actor, car.id, { name: "Auto", method: "linear", usefulLifeMonths: 72, openingBookValue: 3_000_000 });
    expect(linear).toMatchObject({ method: "linear", degressiveRate: null, linearFromYear: null });
  });

  // GmbH und UG: Haben führt ein Buch für Handels- und Steuerbilanz ohne Überleitung. Die Staffel nach § 7 Abs. 2a EStG ist
  // keine planmäßige Abschreibung nach § 253 Abs. 3 Satz 1 HGB; seit dem BilMoG folgt die Handelsbilanz steuerlichen
  // Wahlrechten nicht mehr (§ 5 Abs. 1 Satz 1 Halbsatz 2 EStG), darum bietet Haben sie dort nicht an.
  it.each(["SKR03", "SKR04"] as const)("%s, GmbH: keine AfA nach § 7 Abs. 2a EStG, weder angelegt noch per Beleg", async (kontenrahmen) => {
    await setup([kontenrahmen, "soll", "gmbh"]);
    await expect(
      assets.createAsset(actor, {
        name: "E-Transporter",
        kind: "kfz",
        method: "elektro",
        acquisitionDate: "2025-08-01",
        cost: 4_000_000,
        usefulLifeMonths: null,
        openingDate: "2026-01-01",
        openingBookValue: 1_000_000,
        disposalDate: null,
        note: "",
      }),
    ).rejects.toThrow("§ 7 Abs. 2a EStG nur im Einzelunternehmen");
    await expect(buyByDocument("2025-11-03", 6_000_000, { name: "Tesla Model 3", kind: "kfz", method: "elektro", usefulLifeMonths: null })).rejects.toThrow(
      "§ 7 Abs. 2a EStG nur im Einzelunternehmen",
    );
    expect(await sql`select 1 from assets`).toHaveLength(0);
    // Degressiv bleibt: nach HGB eine anerkannte planmäßige Methode
    const maschine = await buyByDocument("2025-09-15", 10_000_000, { name: "Fräsmaschine", kind: "sonstiges", method: "degressiv", usefulLifeMonths: 120 });
    expect((await assets.listAssets(2025)).find((a) => a.id === maschine)).toMatchObject({ degressiveRate: 3000, year: { depreciation: 1_000_000 } });
  });
});
