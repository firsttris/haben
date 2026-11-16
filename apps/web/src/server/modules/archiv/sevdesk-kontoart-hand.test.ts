import { mapSevCreditNote, type SevCreditNote } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import antworten from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/accounting-type.json";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * docs/sevdesk.md, #888: Klärt der Kontostamm aus sevDesk die Kontoart einer Gutschrift auf ein Buchungskonto nicht, legt man
 * sie in der Belegansicht von Hand fest. Danach rechnet Haben wie bei einem erkannten Konto. Ein Kontostamm mit erkannter Art
 * geht vor; widerspricht er, bleibt die Gutschrift unklar. Beträge erfunden, so gespeichert wie der Abruf sie speichert.
 */

const [dienstleister, erloese] = antworten as unknown as [Record<string, unknown>, Record<string, unknown>];

const ACTOR = "user-888";

const note = (accountingTypeId: string, extra: Record<string, unknown> = {}) =>
  ({
    id: "31",
    creditNoteDate: "2025-03-10",
    creditNoteNumber: "GS-31",
    status: "1000",
    payDate: "2025-04-02T00:00:00+02:00",
    bookingCategory: "ACCOUNTING_TYPE",
    accountingType: { id: accountingTypeId, objectName: "AccountingType" },
    sumNet: "100.00",
    sumTax: "19.00",
    sumGross: "119.00",
    ...extra,
  }) as unknown as SevCreditNote;

const positions = [{ sumNet: "100.00", sumTax: "19.00", sumGross: "119.00", taxRate: "19" }] as never[];

describe.skipIf(!testDatabaseUrl)("sevDesk-Gutschrift auf Buchungskonto: Kontoart von Hand (Postgres)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let kontoart: typeof import("./sevdesk-kontoart-hand.ts");
  let sql: postgres.Sql;
  let importId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    kontoart = await import("./sevdesk-kontoart-hand.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: string, versteuerung: string) {
    await leeren(
      sql,
    )`truncate sevdesk_accounting_type_decisions, sevdesk_accounting_types, legacy_voucher_payments, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, company, audit_log cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, 'einzelunternehmen')`;
    const [row] = await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', '{}'::jsonb, 'sevdesk') returning id`;
    importId = row!.id as string;
  }

  beforeEach(() => reset("SKR03", "soll"));

  async function insert(accountingTypeId = "ID_80", extra: Record<string, unknown> = {}) {
    const raw = note(accountingTypeId, extra);
    const { voucher: v, payment } = mapSevCreditNote(raw, positions);
    const [row] =
      await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${v.lexofficeId}, 'sevdesk', ${importId}, ${v.type}, ${v.direction}, ${v.number}, ${v.date}, ${v.status}, ${v.net}, ${v.tax}, ${v.gross}, ${JSON.stringify(v.taxes)}::jsonb, '[]'::jsonb, ${JSON.stringify(payment)}::jsonb, ${JSON.stringify({ ...raw, positions })}::jsonb)
      returning id`;
    const id = row!.id as string;
    // Auszahlung im April: bei Ist-Versteuerung der Monat der Umsatzsteuer
    await sql`insert into legacy_voucher_payments (voucher_id, import_id, source, external_id, transaction_id, account_id, account_name, date, amount, raw)
      values (${id}, ${importId}, 'sevdesk', ${`log-${v.lexofficeId}`}, 'tx-1', '501', 'Basiskonto', '2025-04-02', -11900, '{}'::jsonb)`;
    return id;
  }

  const answer = (raw: Record<string, unknown>, accountingTypeId = "ID_80") =>
    sql`insert into sevdesk_accounting_types (import_id, accounting_type_id, raw) values (${importId}, ${accountingTypeId}, ${JSON.stringify({ ...raw, id: accountingTypeId })}::jsonb)`;

  const year = async () => (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;
  const kontoCheck = (y: Awaited<ReturnType<typeof year>>) => y.checks.find((c) => c.label === "Buchungskonto jeder Gutschrift erkannt");
  const detail = async (id: string) => (await lexoffice.legacyVoucherDetail(id))!.voucher;

  async function expectUnclear(id: string) {
    const y = await year();
    expect(y.einnahmen).toEqual({ count: 1, net: -10_000, tax: -1_900, gross: -11_900 });
    expect(y.vatIssue).toMatch(/Buchungskonto nicht erkannt/);
    expect(y.vat).toEqual([]);
    expect(kontoCheck(y)).toMatchObject({ ok: false, detail: "1 Gutschrift aus sevDesk" });
    const [listed] = await lexoffice.listLegacyVouchers({ year: 2025, direction: "alle", search: "", ohneDatei: false });
    expect(listed).toMatchObject({ id, direction: "einnahme", accountingTypeUnclear: true });
  }

  describe("Aufwandskonto von Hand", () => {
    // Vorsteuer auch bei Ist-Versteuerung im Monat der Gutschrift (§ 15 Abs. 1 Satz 1 Nr. 1 UStG), wie mit erkanntem Konto
    it.each([
      ["SKR03", "soll"],
      ["SKR04", "ist"],
    ])("zählt bei %s und %s als Ausgabe-Gutschrift mit Vorsteuer in Kz 66; Punkt und Sperre fallen weg", async (kontenrahmen, versteuerung) => {
      await reset(kontenrahmen, versteuerung);
      const id = await insert();
      await expectUnclear(id);
      await kontoart.decideAccountingType(ACTOR, id, "aufwand");
      const y = await year();
      expect(y.ausgaben).toEqual({ count: 1, net: 10_000, tax: 1_900, gross: 11_900 });
      expect(y.einnahmen).toMatchObject({ count: 0, gross: 0 });
      expect(y.vatIssue).toBeNull();
      expect(kontoCheck(y)).toBeUndefined();
      expect(y.vat).toHaveLength(1);
      expect(y.vat[0]).toMatchObject({ month: "2025-03", kz66: 1_900, kz81: 0, tax81: 0 });
      expect(await detail(id)).toMatchObject({
        type: "purchasecreditnote",
        direction: "ausgabe",
        gross: 11_900,
        accountingType: { stamm: null, hand: "aufwand" },
        accountingTypeIssue: null,
        accountingTypeDecidable: true,
      });
      const [listed] = await lexoffice.listLegacyVouchers({ year: 2025, direction: "ausgabe", search: "", ohneDatei: false });
      expect(listed).toMatchObject({ id, accountingTypeUnclear: false });
    });
  });

  describe("Erlöskonto von Hand", () => {
    it.each([
      ["SKR03", "ist", "2025-04"],
      ["SKR04", "soll", "2025-03"],
    ])("mindert bei %s und %s die Einnahmen in Kz 81 im Monat %s", async (kontenrahmen, versteuerung, month) => {
      await reset(kontenrahmen, versteuerung);
      const id = await insert();
      await kontoart.decideAccountingType(ACTOR, id, "erloes");
      const y = await year();
      expect(y.einnahmen).toEqual({ count: 1, net: -10_000, tax: -1_900, gross: -11_900 });
      expect(y.ausgaben).toMatchObject({ count: 0 });
      expect(y.vatIssue).toBeNull();
      expect(kontoCheck(y)).toBeUndefined();
      expect(y.vat).toHaveLength(1);
      expect(y.vat[0]).toMatchObject({ month, kz66: 0, kz81: -10_000, tax81: -1_900 });
      expect(await detail(id)).toMatchObject({ type: "creditnote", direction: "einnahme", accountingTypeIssue: null });
    });
  });

  it("lässt die Archivkopie unverändert und schreibt die Entscheidung ins Audit-Log", async () => {
    const id = await insert();
    const [before] = await sql`select raw, direction, type, net, tax, gross from lexoffice_vouchers where id = ${id}`;
    await kontoart.decideAccountingType(ACTOR, id, "aufwand");
    const [after] = await sql`select raw, direction, type, net, tax, gross from lexoffice_vouchers where id = ${id}`;
    expect(after).toEqual(before);
    const audit = await sql`select actor, action from audit_log where table_name = 'sevdesk_accounting_type_decisions'`;
    expect(audit).toEqual([{ actor: ACTOR, action: "INSERT" }]);
    const [decision] = await sql`select voucher_id, kind, decided_by from sevdesk_accounting_type_decisions`;
    expect(decision).toEqual({ voucher_id: id, kind: "aufwand", decided_by: ACTOR });
  });

  it("nimmt Entscheidungen nur an: UPDATE, DELETE und TRUNCATE scheitern", async () => {
    const id = await insert();
    await kontoart.decideAccountingType(ACTOR, id, "aufwand");
    await expect(sql`update sevdesk_accounting_type_decisions set kind = 'erloes'`).rejects.toThrow();
    await expect(sql`delete from sevdesk_accounting_type_decisions`).rejects.toThrow();
    await expect(sql`truncate sevdesk_accounting_type_decisions`).rejects.toThrow(/TRUNCATE/);
    await expect(sql`insert into sevdesk_accounting_type_decisions (voucher_id, kind, decided_by) values (${id}, 'privat', ${ACTOR})`).rejects.toThrow();
  });

  it("die jüngste Entscheidung gilt; dieselbe noch einmal hängt nichts an", async () => {
    const id = await insert();
    await kontoart.decideAccountingType(ACTOR, id, "aufwand");
    await kontoart.decideAccountingType(ACTOR, id, "aufwand");
    await kontoart.decideAccountingType(ACTOR, id, "erloes");
    expect(await detail(id)).toMatchObject({ direction: "einnahme", accountingType: { stamm: null, hand: "erloes" }, accountingTypeIssue: null });
    const [{ count }] = (await sql`select count(*)::int as count from sevdesk_accounting_type_decisions`) as unknown as [{ count: number }];
    expect(count).toBe(2);
  });

  describe("Kontostamm aus einem späteren Abruf", () => {
    it("bestätigt er die Entscheidung, gilt seine Art und Festlegen geht nicht mehr", async () => {
      const id = await insert();
      await kontoart.decideAccountingType(ACTOR, id, "aufwand");
      await answer(dienstleister);
      expect(await detail(id)).toMatchObject({
        direction: "ausgabe",
        accountingType: { stamm: "aufwand", hand: "aufwand" },
        accountingTypeIssue: null,
        accountingTypeDecidable: false,
      });
      await expect(kontoart.decideAccountingType(ACTOR, id, "erloes")).rejects.toThrow("Die Kontoart steht schon im Kontostamm aus sevDesk fest.");
    });

    it("widerspricht er, bleibt die Gutschrift unklar und der Hinweis nennt beide; dieselbe Art von Hand klärt es", async () => {
      const id = await insert();
      await kontoart.decideAccountingType(ACTOR, id, "aufwand");
      await answer(erloese);
      await expectUnclear(id);
      const voucher = await detail(id);
      expect(voucher).toMatchObject({ direction: "einnahme", accountingType: { stamm: "erloes", hand: "aufwand" }, accountingTypeDecidable: true });
      expect(voucher.accountingTypeIssue).toMatch(
        /^Buchungskonto nicht erkannt: Der Kontostamm aus sevDesk nennt ein Erlöskonto, von Hand festgelegt ist ein Aufwandskonto\./,
      );
      const period = await lexoffice.legacyVouchersForPeriod({ period: "2025-03", direction: "alle", search: "", withPayments: false, limit: 10 });
      expect(period.vouchers[0]!.accountingTypeIssue).toBe(voucher.accountingTypeIssue);
      await kontoart.decideAccountingType(ACTOR, id, "erloes");
      expect(await detail(id)).toMatchObject({ accountingTypeIssue: null, accountingTypeDecidable: false });
      expect(kontoCheck(await year())).toBeUndefined();
    });

    it("ohne erkannte Art (Widerspruch der Nummern) entscheidet weiter die Hand", async () => {
      const id = await insert();
      await answer({ ...erloese, skr04: "5900" });
      await kontoart.decideAccountingType(ACTOR, id, "aufwand");
      expect(await detail(id)).toMatchObject({ direction: "ausgabe", accountingType: { stamm: "unklar", hand: "aufwand" }, accountingTypeIssue: null });
      expect(kontoCheck(await year())).toBeUndefined();
    });
  });

  it("lehnt ab, was keine Gutschrift auf ein Buchungskonto ist, und eine erkannte Kontoart", async () => {
    const other = await insert("ID_80", { id: "32", creditNoteNumber: "GS-32", bookingCategory: "UNDERACHIEVEMENT" });
    await expect(kontoart.decideAccountingType(ACTOR, other, "aufwand")).rejects.toThrow(/nur bei einer Gutschrift aus sevDesk auf ein Buchungskonto/);
    await answer(dienstleister, "ID_66");
    const known = await insert("ID_66", { id: "33", creditNoteNumber: "GS-33" });
    expect(await detail(known)).toMatchObject({ accountingType: { stamm: "aufwand", hand: null }, accountingTypeDecidable: false });
    await expect(kontoart.decideAccountingType(ACTOR, known, "erloes")).rejects.toThrow("Die Kontoart steht schon im Kontostamm aus sevDesk fest.");
    expect(await sql`select 1 from sevdesk_accounting_type_decisions`).toHaveLength(0);
  });

  it("liest Kontostamm und Entscheidung je Ausdruck nur einmal", async () => {
    // Der Abgleich setzt die Kontoart sieben Mal je Beleg ein (Richtung, Art, Beträge, Steuer, unklar). Las jeder Ausdruck
    // die beiden Tabellen mehrfach, stieg die Kostenschätzung über die Schwellen des JIT von Postgres: Übersetzen dauerte
    // mit 1000 Belegen über 7 s statt unter 0,5 s bei einer Ausführung von wenigen Millisekunden.
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const { accountingTypeExpense, accountingTypeUnclear } = await import("../auswertungen/altbestand-kontoart.ts");
    const unclear = new PgDialect().sqlToQuery(accountingTypeUnclear("v")).sql;
    const [row] = await sql.unsafe(`explain (format json) select ${unclear} as u, ${accountingTypeExpense("v")} as e from lexoffice_vouchers v`);
    const relations = JSON.stringify(row!["QUERY PLAN"]).match(/"Relation Name":"sevdesk_accounting_type[^"]*"/g) ?? [];
    const count = (name: string) => relations.filter((r) => r === `"Relation Name":"${name}"`).length;
    expect({ stamm: count("sevdesk_accounting_types"), hand: count("sevdesk_accounting_type_decisions") }).toEqual({ stamm: 2, hand: 2 });
  });
});
