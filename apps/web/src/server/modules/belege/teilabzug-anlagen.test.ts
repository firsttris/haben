import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// § 9b Abs. 1 und § 4 Abs. 3 Satz 3 EStG: nicht abziehbare Erwerbsteuer darf nicht über AfA und Zahlung doppelt wirken.
describe.skipIf(!testDatabaseUrl)("Teilabzug bei Anlagen: bestehende Erwerbsgrenze (Postgres, #433)", () => {
  let sql: postgres.Sql;
  let documents: typeof import("./documents.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let bank: typeof import("../bank/bank.ts");
  let vat: typeof import("../umsatzsteuer/vat-figures.ts");
  const actor = "teilabzug-anlagen";
  let seq = 0;
  type Amount = { taxRate: 1900 | 700; net: number; tax: number; vorsteuerAnteil?: number | null };

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
    reports = await import("../auswertungen/reports.ts");
    bank = await import("../bank/bank.ts");
    vat = await import("../umsatzsteuer/vat-figures.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kr: "SKR03" | "SKR04", art: "ist" | "soll") {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, write_offs, allocations,
      bank_transactions, bank_imports, bank_accounts, cash_entries, asset_depreciations, assets, journal_lines,
      journal_entries, document_splits, document_amounts, documents, year_closings, company cascade`;
    await sql`insert into company(id,name,strasse,plz,ort,email,steuernummer,bundesland,versteuerung,kontenrahmen)
      values(1,'Testfirma','Testweg 1','93047','Regensburg','test@example.com','198/113/10010','BY',${art},${kr})`;
  }

  async function draft(anteil: number, amounts: Amount[], erwerb = true) {
    seq++;
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, seq, 71]), filename: `anlage-${seq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant",
      supplierUstId: erwerb ? "ATU12345675" : "",
      invoiceNumber: `A-${seq}`,
      documentDate: "2026-09-15",
      dueDate: null,
      category: "anlage",
      payment: "privat",
      note: "",
      reverseCharge: erwerb ? "ig_erwerb" : null,
      vorsteuerAnteil: anteil,
      amounts,
      asset: { name: "Testrechner", kind: "edv", method: "digital", usefulLifeMonths: null },
    });
    return id;
  }

  async function taxPayment(amount: number) {
    const [account] = await sql`insert into bank_accounts(name,iban) values('Testkonto','DE89370400440532013000') returning id`;
    const [imported] = await sql`insert into bank_imports(bank_account_id,filename,sha256,format,added,skipped)
      values(${account!.id},'test.csv',${`anlage-${seq}`},'csv',1,0) returning id`;
    const [transaction] = await sql`insert into bank_transactions(bank_account_id,import_id,booking_date,amount,purpose,dedup_hash)
      values(${account!.id},${imported!.id},'2026-10-05',${-amount},'synthetische Steuerzahlung',${`anlage-zahlung-${seq}`}) returning id`;
    await bank.allocate(actor, { kind: "ustVorauszahlung", transactionId: transaction!.id as string, amount: -amount });
  }

  it.each([
    { kr: "SKR03", art: "ist", anteil: 0, satz: null, name: "kein Abzug am Beleg" },
    { kr: "SKR04", art: "soll", anteil: 5_000, satz: null, name: "halber Abzug am Beleg" },
    { kr: "SKR03", art: "soll", anteil: 10_000, satz: 5_000, name: "voller Beleg mit halbem Satzoverride" },
    { kr: "SKR04", art: "ist", anteil: 10_000, satz: 0, name: "voller Beleg mit Satzoverride null Prozent" },
  ] as const)("$kr/$art: IGE-Anlage bleibt gesperrt: $name", async ({ kr, art, anteil, satz }) => {
    await reset(kr, art);
    const id = await draft(anteil, [{ taxRate: 1900, net: 10_000, tax: 1_900, vorsteuerAnteil: satz }]);
    const error: unknown = await documents.bookDocument(actor, id).catch((e: unknown) => e);
    // Gegenprobe auf dem alten Stand: Eine erlaubte Buchung würde den Steuerteil zweimal als Ausgabe ausweisen.
    if (!error) {
      const [asset] = await sql`select cost from assets where document_id=${id}`;
      const nonDeductible = Number(asset!.cost) - 10_000;
      await taxPayment(nonDeductible);
      const euer = await reports.euerForYear(2026);
      console.info("IGE-Anlage ohne Kompensation", { anteil, satz, acquisition: asset!.cost, taxPayment: nonDeductible, totalExpenses: euer.totalAusgaben });
    }
    expect(error).toBeInstanceOf(documents.DocumentError);
    expect((error as Error).message).toMatch(/Innergemeinschaftlicher Erwerb einer Anlage.*Vorsteuerabzug.*nicht unterstützt/);
    expect((await documents.getDocument(id))!.document).toMatchObject({ status: "neu", lockedAt: null });
    expect(await sql`select count(*)::int as n from assets`).toEqual([{ n: 0 }]);
    expect(await sql`select count(*)::int as n from journal_entries`).toEqual([{ n: 0 }]);
  });

  it("gemischte Sätze: ein ausgeschlossener Satz sperrt trotz positivem Belegboolean", async () => {
    await reset("SKR03", "ist");
    const id = await draft(10_000, [
      { taxRate: 1900, net: 10_000, tax: 1_900 },
      { taxRate: 700, net: 10_000, tax: 700, vorsteuerAnteil: 5_000 },
    ]);
    await expect(documents.bookDocument(actor, id)).rejects.toThrow(/Innergemeinschaftlicher Erwerb einer Anlage.*Vorsteuerabzug/);
    expect(await sql`select count(*)::int as n from journal_entries`).toEqual([{ n: 0 }]);
  });

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("%s/%s: Inlandsanlage mit 50 Prozent bleibt mit 109,50 Euro Anschaffungskosten unterstützt", async (kr, art) => {
    await reset(kr, art);
    const id = await draft(5_000, [{ taxRate: 1900, net: 10_000, tax: 1_900 }], false);
    await documents.bookDocument(actor, id);
    expect(await sql`select cost from assets where document_id=${id}`).toEqual([{ cost: 10_950 }]);
    expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(950);
    const euer = await reports.euerForYear(2026);
    expect(euer.totalAusgaben).toBe(11_900);
  });

  it("IGE-Anlage mit überall vollem wirksamen Abzug bleibt unterstützt, auch nach Belegoverride", async () => {
    await reset("SKR04", "ist");
    const id = await draft(5_000, [{ taxRate: 1900, net: 10_000, tax: 1_900, vorsteuerAnteil: 10_000 }]);
    await documents.bookDocument(actor, id);
    expect(await sql`select cost from assets where document_id=${id}`).toEqual([{ cost: 10_000 }]);
    const figures = await vat.computeVatFigures({ year: 2026, month: 9 });
    expect([figures.kz89, figures.tax89, figures.kz61]).toEqual([10_000, 1_900, 1_900]);
  });
});
