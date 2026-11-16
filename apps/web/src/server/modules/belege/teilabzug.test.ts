import type postgres from "postgres";
import { parseDatevBuchungsstapel } from "@haben/import";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// § 15 Abs. 4 UStG: wirtschaftlich zugeordneter Teil der ausgewiesenen Steuer; erfundene Belege.
describe.skipIf(!testDatabaseUrl)("Teilabzug der Vorsteuer (Postgres, #433)", () => {
  let sql: postgres.Sql;
  let documents: typeof import("./documents.ts");
  let cancellation: typeof import("./cancellation.ts");
  let vat: typeof import("../umsatzsteuer/vat-figures.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let bank: typeof import("../bank/bank.ts");
  const actor = "teilabzug-test";
  let seq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
    cancellation = await import("./cancellation.ts");
    vat = await import("../umsatzsteuer/vat-figures.ts");
    reports = await import("../auswertungen/reports.ts");
    bank = await import("../bank/bank.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kr: "SKR03" | "SKR04" = "SKR03", art: "ist" | "soll" = "ist") {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, write_offs, allocations,
      bank_transactions, bank_imports, bank_accounts, cash_entries, asset_depreciations, assets,
      journal_lines, journal_entries, document_splits, document_amounts, documents, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Testweg 1', '93047', 'Regensburg', 'test@example.com', '198/113/10010', 'BY', ${art}, ${kr})`;
  }

  type Amount = { taxRate: 1900 | 700 | 0; net: number; tax: number; vorsteuerAnteil?: number | null };
  async function draft(
    options: {
      vorsteuerAnteil?: number | null;
      amounts?: Amount[];
      privateShare?: number;
      payment?: "bank" | "privat";
      reverseCharge?: "eu" | "drittland" | "ig_erwerb";
      erstattetBezahltes?: boolean;
      anlage?: boolean;
    } = {},
  ) {
    seq++;
    const { id } = await documents.uploadDocument(actor, {
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, seq % 256, Math.floor(seq / 256)]),
      filename: `teilabzug-${seq}.jpg`,
    });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant GmbH",
      supplierUstId: options.reverseCharge === "ig_erwerb" ? "ATU12345675" : "",
      invoiceNumber: `T-${seq}`,
      documentDate: "2026-09-15",
      dueDate: null,
      category: options.anlage ? "anlage" : "software",
      payment: options.payment ?? "bank",
      note: "",
      vorsteuerAnteil: options.vorsteuerAnteil ?? null,
      privateShare: options.privateShare ?? 0,
      reverseCharge: options.reverseCharge ?? null,
      erstattetBezahltes: options.erstattetBezahltes ?? false,
      amounts: options.amounts ?? [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
      asset: options.anlage ? { name: "Testrechner", kind: "edv", method: "digital", usefulLifeMonths: null } : null,
    });
    return id;
  }

  async function lines(id: string) {
    return sql`select l.account, sum(l.debit-l.credit)::int as saldo from journal_lines l
      join journal_entries e on e.id=l.entry_id where e.source_type='document' and e.source_id=${id}
      and e.reverses_id is null group by l.account order by l.account`;
  }
  const expense = (e: Awaited<ReturnType<typeof reports.euerForYear>>, key: string) => e.ausgaben.find((l) => l.key === key)?.amount ?? 0;

  async function pay(id: string, amount: number, date: string) {
    const [existing] = await sql`select id from bank_accounts where iban='DE89370400440532013000'`;
    const [account] = existing ? [existing] : await sql`insert into bank_accounts(name,iban) values('Testkonto','DE89370400440532013000') returning id`;
    const [imported] = await sql`insert into bank_imports(bank_account_id,filename,sha256,format,added,skipped)
      values(${account!.id},'synthetisch.csv',${`synthetisch-${++seq}`},'csv',1,0) returning id`;
    const [transaction] = await sql`insert into bank_transactions(bank_account_id,import_id,booking_date,amount,purpose,dedup_hash)
      values(${account!.id},${imported!.id},${date},${amount},'Testausgleich',${`zahlung-${seq}`}) returning id`;
    await bank.allocate(actor, { kind: "document", transactionId: transaction!.id as string, documentId: id, amount });
  }

  it.each([
    ["SKR03", "ist", "4964", "1576", "1600"],
    ["SKR04", "soll", "6837", "1406", "3300"],
  ] as const)("%s %s: 50 %% erhält Originalsteuer und bucht 9,50 € Vorsteuer, 109,50 € Aufwand", async (kr, art, aufwand, vst, verb) => {
    await reset(kr, art);
    const id = await draft({ vorsteuerAnteil: 5_000, payment: "privat" });
    await documents.bookDocument(actor, id);
    expect(await lines(id)).toEqual(
      expect.arrayContaining([
        { account: aufwand, saldo: 10_950 },
        { account: vst, saldo: 950 },
      ]),
    );
    expect((await lines(id)).some((l) => l.account === verb)).toBe(false);
    const saved = (await documents.getDocument(id))!;
    expect(saved.document).toMatchObject({ tax: 1_900, gross: 11_900, vorsteuerAnteil: 5_000 });
    expect(saved.amounts[0]).toMatchObject({ tax: 1_900, vorsteuerAnteil: 5_000 });
    expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(950);
    const euer = await reports.euerForYear(2026);
    expect([expense(euer, "ausgabe:software"), expense(euer, "vorsteuer")]).toEqual([10_950, 950]);
  });

  it("Satzoverride vor Beleg und Firmenvorgabe, KU-Sperre auch dagegen", async () => {
    await reset();
    await sql`update company set ohne_vorsteuerabzug=true`;
    const amounts: Amount[] = [
      { taxRate: 1900, net: 10_000, tax: 1_900, vorsteuerAnteil: 5_000 },
      { taxRate: 700, net: 10_000, tax: 700 },
    ];
    const id = await draft({ amounts });
    await documents.bookDocument(actor, id);
    expect((await documents.getDocument(id))!.amounts.map((a) => a.vorsteuerAnteil)).toEqual([5_000, 0]);
    expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(950);
    await reset();
    const ku = await draft({ vorsteuerAnteil: 5_000, amounts });
    await sql`update company set kleinunternehmer=true`;
    await documents.bookDocument(actor, ku);
    expect((await documents.getDocument(ku))!.amounts.map((a) => a.vorsteuerAnteil)).toEqual([0, 0]);
    expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(0);
  });

  it("Privatanteil bleibt getrennt: 20 % privat und 50 % Abzug ergeben 760 Cent Vorsteuer", async () => {
    await reset();
    const id = await draft({ vorsteuerAnteil: 5_000, privateShare: 20, payment: "privat" });
    await documents.bookDocument(actor, id);
    expect(await lines(id)).toEqual(
      expect.arrayContaining([
        { account: "4964", saldo: 8_760 },
        { account: "1576", saldo: 760 },
        { account: "1800", saldo: 2_380 },
      ]),
    );
    const euer = await reports.euerForYear(2026);
    expect([expense(euer, "ausgabe:software"), expense(euer, "vorsteuer")]).toEqual([8_760, 760]);
  });

  it.each(["eu", "ig_erwerb"] as const)("%s: selbst geschuldete Steuer bleibt voll", async (reverseCharge) => {
    await reset("SKR04", "soll");
    // Anlagen ohne vollständigen Erwerbsvorsteuerabzug bleiben gesperrt; Gegenproben stehen in teilabzug-anlagen.test.ts.
    const id = await draft({ vorsteuerAnteil: 5_000, reverseCharge });
    await documents.bookDocument(actor, id);
    const f = await vat.computeVatFigures({ year: 2026, month: 9 });
    expect(reverseCharge === "eu" ? [f.kz47, f.kz67] : [f.kz89, f.kz61]).toEqual(reverseCharge === "eu" ? [1_900, 950] : [10_000, 950]);
  });

  it("Storno und Neuerfassung übernehmen den festgehaltenen Satz statt heutiger Firma", async () => {
    await reset();
    const id = await draft({ vorsteuerAnteil: 5_000, amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900, vorsteuerAnteil: 2_500 }] });
    await documents.bookDocument(actor, id);
    await sql`update company set ohne_vorsteuerabzug=true`;
    await sql`insert into vat_returns (year, month, status, source, sent_at, locked_at) values (2026, 9, 'sent', 'manuell', now(), now())`;
    await cancellation.cancelDocument(actor, id, { reason: "Korrektur" }, "2026-10-05");
    expect((await vat.computeVatFigures({ year: 2026, month: 10 })).kz66).toBe(-475);
    const neu = await cancellation.reenterDocument(actor, id);
    expect((await documents.getDocument(neu))!.amounts[0]!.vorsteuerAnteil).toBe(2_500);
  });

  it("Skonto mindert nur den abgezogenen Teil und bleibt bei Teilrundung centgenau", async () => {
    await reset();
    const id = await draft({ vorsteuerAnteil: 5_000 });
    await documents.bookDocument(actor, id);
    await bank.writeOff(actor, { kind: "skontoErhalten", documentId: id, date: "2026-10-05", amount: -1_190 });
    expect((await vat.computeVatFigures({ year: 2026, month: 10 })).kz66).toBe(-95);
    expect(
      await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id=l.entry_id
      where e.source_type='ausbuchung' and l.account='1576'`,
    ).toEqual([{ account: "1576", debit: 0, credit: 95 }]);
  });

  it("drei kleine Skonti berichtigen zusammen exakt den abgezogenen Betrag; Aufhebung nimmt dieselben Cents zurück", async () => {
    await reset();
    const id = await draft({ vorsteuerAnteil: 5_000, amounts: [{ taxRate: 1900, net: 10, tax: 3 }] });
    await documents.bookDocument(actor, id);
    for (const amount of [-4, -4, -5]) await bank.writeOff(actor, { kind: "skontoErhalten", documentId: id, date: "2026-10-05", amount });
    const before = await vat.computeVatFigures({ year: 2026, month: 10 });
    expect(before.kz66).toBe(-2);
    expect(before.nebenbuecher?.kz66).toBe(-2);
    const [last] = await sql`select id from write_offs where document_id=${id} order by created_at desc limit 1`;
    await bank.reverseWriteOff(actor, last!.id as string, "2026-11-05");
    expect((await vat.computeVatFigures({ year: 2026, month: 11 })).kz66).toBe(1);
  });

  it("Gutschrift mit drei Teilerstattungen zieht genau die gespeicherte Teilvorsteuer vom Zwischenkonto", async () => {
    await reset("SKR04", "soll");
    const id = await draft({ vorsteuerAnteil: 5_000, erstattetBezahltes: true, amounts: [{ taxRate: 1900, net: -10, tax: -3 }] });
    await documents.bookDocument(actor, id);
    expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(0);
    for (const [i, amount] of [4, 4, 5].entries()) await pay(id, amount, `2026-${10 + i}-05`);
    const figures = await Promise.all([10, 11, 12].map((month) => vat.computeVatFigures({ year: 2026, month })));
    expect(figures.map((f) => f.kz66)).toEqual([-1, 0, -1]);
    expect(figures.map((f) => f.nebenbuecher?.kz66)).toEqual([-1, 0, -1]);
    expect(await sql`select coalesce(sum(debit-credit),0)::int as rest from journal_lines where account='1434'`).toEqual([{ rest: 0 }]);
  });

  it("DATEV exportiert Teilsteuer als eigene Journalbeträge ohne erneute Steuerautomatik", async () => {
    await reset();
    await sql`update company set datev_berater_nr='29098',datev_mandant_nr='55003'`;
    const id = await draft({ vorsteuerAnteil: 5_000 });
    await documents.bookDocument(actor, id);
    const datev = await import("../auswertungen/datev-export.ts");
    const stack = parseDatevBuchungsstapel((await datev.datevExport(2026, new Date(2026, 9, 5))).bytes);
    expect(stack.bookings.filter((b) => b.account === "1576" || b.contraAccount === "1576")).toEqual([expect.objectContaining({ amount: 950, buKey: "" })]);
    expect(stack.bookings.filter((b) => b.account === "4964" || b.contraAccount === "4964").reduce((sum, b) => sum + b.amount, 0)).toBe(10_950);
  });

  it("REST-Detail zeigt Originalsteuer und festgehaltene Anteile am Beleg und je Satz", async () => {
    await reset();
    const id = await draft({ vorsteuerAnteil: 5_000, amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900, vorsteuerAnteil: 2_500 }] });
    await documents.bookDocument(actor, id);
    const api = await import("../api/documents.ts");
    const schema = await import("../api/schemas.ts");
    const response = await api.getDocumentHandler({ actor, params: { id }, query: {}, body: null, baseUrl: "http://localhost:3000", today: "2026-10-05" });
    expect(response.status).toBe(200);
    expect(schema.documentSchema.parse(response.body)).toMatchObject({
      tax: 1_900,
      vorsteuerAnteil: 5_000,
      vorsteuerAbzug: true,
      amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900, vorsteuerAnteil: 2_500 }],
    });
  });

  it("Neuerfassung eines alten gemischten Belegs behält den Boolean-Rückfall statt der heutigen Firmenvorgabe", async () => {
    await reset();
    const id = await draft({
      amounts: [
        { taxRate: 1900, net: 10_000, tax: 1_900 },
        { taxRate: 700, net: 10_000, tax: 700 },
      ],
    });
    // Synthetischer Altbestand vor gespeicherten Anteilen, mit regulär aktiven Sperren und Audit.
    await sql.begin(async (tx) => {
      await tx`select set_config('haben.actor','test:altbestand',true)`;
      const [entry] = await tx`insert into journal_entries(date,description,source_type,source_id,kontenrahmen)
        values('2026-09-15','Alter Beleg','document',${id},'SKR03') returning id`;
      await tx`insert into journal_lines(entry_id,account,debit,credit,tax_code) values
        (${entry!.id},'4964',22600,0,'keineVSt'),(${entry!.id},'1600',0,22600,null)`;
      await tx`update journal_entries set locked_at=now() where id=${entry!.id}`;
      await tx`update documents set vorsteuer_abzug=false,vorsteuer_anteil=null,status='gebucht',locked_at=now() where id=${id}`;
    });
    expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(0);
    await cancellation.cancelDocument(actor, id, { reason: "Neuerfassung" }, "2026-10-05");
    const neu = await cancellation.reenterDocument(actor, id);
    expect((await documents.getDocument(neu))!.document.vorsteuerAnteil).toBe(0);
    await documents.bookDocument(actor, neu);
    expect((await documents.getDocument(neu))!.amounts.map((a) => a.vorsteuerAnteil)).toEqual([0, 0]);
  });

  it("Skonto-Nebenbuch erfasst den kumulierten Steuercent auch wenn der Einzelbetrag für sich steuerfrei rundet", async () => {
    await reset();
    const id = await draft({ vorsteuerAnteil: 5_000, amounts: [{ taxRate: 1900, net: 10, tax: 1 }] });
    await documents.bookDocument(actor, id);
    for (const amount of [-3, -3, -5]) await bank.writeOff(actor, { kind: "skontoErhalten", documentId: id, date: "2026-10-05", amount });
    const figures = await vat.computeVatFigures({ year: 2026, month: 10 });
    expect([figures.kz66, figures.nebenbuecher?.kz66]).toEqual([-1, -1]);
  });
});
