import { mapSevCreditNote, type SevCreditNote } from "@haben/import";
import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import antworten from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/accounting-type.json";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * docs/sevdesk.md: Eine Gutschrift mit `bookingCategory` ACCOUNTING_TYPE folgt dem Konto, das in sevDesk gewählt ist (#472).
 * Mit Aufwandskonto bucht sevDesk wie Honorar (DATEV: Soll 3100, BU 9), mit Erlöskonto als Erlösminderung (Soll 8200, BU 3).
 * Die Art kommt zur Laufzeit aus der gespeicherten Antwort von GET /AccountingType/{id}: skr03 nach SKR03, skr04 nach SKR04.
 * Beträge erfunden, so gespeichert wie der Abruf sie speichert.
 */

const [dienstleister, erloese] = antworten as unknown as [Record<string, unknown>, Record<string, unknown>];

const note = (accountingTypeId: string | null, extra: Record<string, unknown> = {}) =>
  ({
    id: "31",
    creditNoteDate: "2025-03-10",
    creditNoteNumber: "GS-31",
    status: "1000",
    payDate: "2025-04-02T00:00:00+02:00",
    bookingCategory: "ACCOUNTING_TYPE",
    ...(accountingTypeId ? { accountingType: { id: accountingTypeId, objectName: "AccountingType" } } : {}),
    sumNet: "100.00",
    sumTax: "19.00",
    sumGross: "119.00",
    ...extra,
  }) as unknown as SevCreditNote;

const positions = [{ sumNet: "100.00", sumTax: "19.00", sumGross: "119.00", taxRate: "19" }] as never[];

describe.skipIf(!testDatabaseUrl)("sevDesk-Gutschriften auf Buchungskonto nach Kontoart (Postgres)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let kontakt: typeof import("./kontakt-altbestand.ts");
  let legacy: typeof import("./legacy-open.ts");
  let exporter: typeof import("./export.ts");
  let sql: postgres.Sql;
  let importId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    kontakt = await import("./kontakt-altbestand.ts");
    legacy = await import("./legacy-open.ts");
    exporter = await import("./export.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: string, versteuerung: string) {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from datev_bookings`;
      await tx`delete from archive_files`;
    });
    await leeren(
      sql,
    )`truncate sevdesk_accounting_types, legacy_voucher_payments, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, 'einzelunternehmen')`;
    const [row] = await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', '{}'::jsonb, 'sevdesk') returning id`;
    importId = row!.id as string;
  }

  beforeEach(() => reset("SKR03", "soll"));

  async function insert(accountingTypeId: string | null, extra: Record<string, unknown> = {}) {
    const raw = note(accountingTypeId, extra);
    const { voucher: v, payment } = mapSevCreditNote(raw, positions);
    const [row] =
      await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${v.lexofficeId}, 'sevdesk', ${importId}, ${v.type}, ${v.direction}, ${v.number}, ${v.date}, ${v.status}, ${v.net}, ${v.tax}, ${v.gross}, ${JSON.stringify(v.taxes)}::jsonb, '[]'::jsonb, ${JSON.stringify(payment)}::jsonb, ${JSON.stringify({ ...raw, positions })}::jsonb)
      returning id`;
    const id = row!.id as string;
    // Auszahlung im April: bei Ist-Versteuerung der Monat der Steuer
    await sql`insert into legacy_voucher_payments (voucher_id, import_id, source, external_id, transaction_id, account_id, account_name, date, amount, raw)
      values (${id}, ${importId}, 'sevdesk', ${`log-${v.lexofficeId}`}, 'tx-1', '501', 'Basiskonto', '2025-04-02', -11900, '{}'::jsonb)`;
    return id;
  }

  const answer = (raw: Record<string, unknown>) =>
    sql`insert into sevdesk_accounting_types (import_id, accounting_type_id, raw) values (${importId}, ${String(raw.id)}, ${JSON.stringify(raw)}::jsonb)`;

  const year = async () => (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;
  const kontoCheck = (y: Awaited<ReturnType<typeof year>>) => y.checks.find((c) => c.label === "Buchungskonto jeder Gutschrift erkannt");

  describe("Aufwandskonto (3100/5900)", () => {
    // Vorsteuer auch bei Ist-Versteuerung im Monat der Gutschrift, nicht der Auszahlung (§ 15 Abs. 1 Satz 1 Nr. 1 UStG)
    it.each([
      ["SKR03", "soll", "2025-03"],
      ["SKR04", "ist", "2025-03"],
    ])("zählt bei %s und %s als Ausgabe-Gutschrift mit Vorsteuer in Kz 66 im Monat %s", async (kontenrahmen, versteuerung, month) => {
      await reset(kontenrahmen, versteuerung);
      await answer(dienstleister);
      await insert("ID_66");
      const y = await year();
      expect(y.ausgaben).toEqual({ count: 1, net: 10_000, tax: 1_900, gross: 11_900 });
      expect(y.einnahmen).toMatchObject({ count: 0, gross: 0 });
      expect(y.vatIssue).toBeNull();
      expect(kontoCheck(y)).toBeUndefined();
      expect(y.vat).toHaveLength(1);
      expect(y.vat[0]).toMatchObject({ month, kz66: 1_900, kz81: 0, tax81: 0 });
    });

    it("steht in Liste, Detail, Zeitraum und auf der Kontaktseite als Ausgabe-Gutschrift mit positiven Beträgen", async () => {
      await answer(dienstleister);
      const [contact] = await sql`insert into contacts (name, land, email) values ('Erfundene Agentur', 'DE', 'agentur@example.com') returning id`;
      const id = await insert("ID_66");
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`update lexoffice_vouchers set contact_id = ${contact!.id} where id = ${id}`;
      });
      const [listed] = await lexoffice.listLegacyVouchers({ year: 2025, direction: "ausgabe", search: "", ohneDatei: false });
      expect(listed).toMatchObject({ id, type: "purchasecreditnote", direction: "ausgabe", net: 10_000, gross: 11_900, accountingTypeUnclear: false });
      const detail = (await lexoffice.legacyVoucherDetail(id))!.voucher;
      expect(detail).toMatchObject({ type: "purchasecreditnote", direction: "ausgabe", gross: 11_900, accountingTypeIssue: null });
      expect(detail.taxes).toEqual([{ rate: 1900, net: 10_000, tax: 1_900 }]);
      const period = await lexoffice.legacyVouchersForPeriod({ period: "2025-03", direction: "ausgabe", search: "", withPayments: false, limit: 10 });
      expect(period.vouchers).toMatchObject([{ id, net: 10_000, tax: 1_900, gross: 11_900, accountingTypeIssue: null }]);
      expect(await kontakt.legacyVouchersForContact(contact!.id as string)).toMatchObject([{ id, direction: "ausgabe", net: 10_000, gross: 11_900 }]);
    });

    it("nennt im Jahresexport Ausgabe-Gutschrift und positiven Betrag", async () => {
      await answer(dienstleister);
      await insert("ID_66");
      const chunks: Uint8Array[] = [];
      for await (const chunk of exporter.exportYear(2025)) chunks.push(chunk);
      const lines = new TextDecoder().decode(unzipSync(Buffer.concat(chunks))["lexoffice/belege.csv"]!).split(/\r?\n/);
      const separator = lines[0]!.includes(";") ? ";" : ",";
      const header = lines[0]!
        .replace(/^﻿/, "")
        .split(separator)
        .map((c) => c.replaceAll('"', ""));
      const row = lines
        .find((l) => l.includes("GS-31"))!
        .split(separator)
        .map((c) => c.replaceAll('"', ""));
      expect(row[header.indexOf("Brutto")]).toMatch(/^119[.,]00$/);
      expect(row).toContain("Ausgabe-Gutschrift");
    });

    it("wird nicht als offener Posten angeboten", async () => {
      await answer(dienstleister);
      await insert("ID_66", { status: "200", payDate: null });
      expect(await legacy.openLegacyItems("2025-12-31")).toEqual([]);
    });

    it("ändert die gespeicherte Zeile nicht", async () => {
      await answer(dienstleister);
      const id = await insert("ID_66");
      await year();
      const [row] = await sql`select direction, type, net, tax, gross from lexoffice_vouchers where id = ${id}`;
      expect(row).toEqual({ direction: "einnahme", type: "creditnote", net: -10_000, tax: -1_900, gross: -11_900 });
    });
  });

  describe("Erlöskonto (8200/4200)", () => {
    it.each([
      ["SKR03", "ist", "2025-04"],
      ["SKR04", "soll", "2025-03"],
    ])("mindert bei %s und %s die Einnahmen in Kz 81 im Monat %s", async (kontenrahmen, versteuerung, month) => {
      await reset(kontenrahmen, versteuerung);
      await answer(erloese);
      const id = await insert("ID_63");
      const y = await year();
      expect(y.einnahmen).toEqual({ count: 1, net: -10_000, tax: -1_900, gross: -11_900 });
      expect(y.ausgaben).toMatchObject({ count: 0, gross: 0 });
      expect(y.vatIssue).toBeNull();
      expect(kontoCheck(y)).toBeUndefined();
      expect(y.vat).toHaveLength(1);
      expect(y.vat[0]).toMatchObject({ month, kz66: 0, kz81: -10_000, tax81: -1_900 });
      expect((await lexoffice.legacyVoucherDetail(id))!.voucher).toMatchObject({ type: "creditnote", direction: "einnahme", accountingTypeIssue: null });
    });
  });

  describe("Buchungskonto nicht erkannt", () => {
    it.each([
      ["Widerspruch (8200/5900)", [{ ...erloese, id: "ID_70", skr04: "5900" }], "ID_70"],
      ["keine Nummer", [{ ...dienstleister, id: "ID_71", skr03: null, skr04: "" }], "ID_71"],
      ["Konto ohne Nummer mit Elternkonto", [{ id: "ID_72", objectName: "AccountingType", parent: { id: "ID_66", objectName: "AccountingType" } }], "ID_72"],
      ["Nummer außerhalb von Erlös und Aufwand (1200)", [{ ...dienstleister, id: "ID_73", skr03: "1200", skr04: null }], "ID_73"],
      ["keine Antwort", [], "ID_66"],
      ["keine ID am Kopf", [], null],
      [
        "zwei Antworten mit verschiedener Art",
        [
          { ...dienstleister, id: "ID_74" },
          { ...erloese, id: "ID_74" },
        ],
        "ID_74",
      ],
    ] as [string, Record<string, unknown>[], string | null][])(
      "%s: bleibt negative Einnahme und sperrt den Monatsabgleich",
      async (_fall, stored, accountingTypeId) => {
        for (const raw of stored) await answer(raw);
        const id = await insert(accountingTypeId);
        const y = await year();
        expect(y.einnahmen).toEqual({ count: 1, net: -10_000, tax: -1_900, gross: -11_900 });
        expect(y.ausgaben).toMatchObject({ count: 0 });
        expect(y.vatIssue).toMatch(/Buchungskonto nicht erkannt/);
        expect(y.vat).toEqual([]);
        expect(kontoCheck(y)).toMatchObject({ ok: false, detail: "1 Gutschrift aus sevDesk" });
        expect(y.ready).toBe(false);
        const detail = (await lexoffice.legacyVoucherDetail(id))!.voucher;
        expect(detail).toMatchObject({ type: "creditnote", direction: "einnahme", gross: -11_900 });
        expect(detail.accountingTypeIssue).toMatch(/^Buchungskonto nicht erkannt/);
        const [listed] = await lexoffice.listLegacyVouchers({ year: 2025, direction: "alle", search: "", ohneDatei: false });
        expect(listed).toMatchObject({ id, direction: "einnahme", gross: -11_900, accountingTypeUnclear: true });
        const period = await lexoffice.legacyVouchersForPeriod({ period: "2025-03", direction: "alle", search: "", withPayments: false, limit: 10 });
        expect(period.vouchers[0]!.accountingTypeIssue).toMatch(/^Buchungskonto nicht erkannt/);
      },
    );

    it("nennt den Hinweis auch den Werkzeugen für KI-Assistenten", async () => {
      await insert("ID_66");
      const tools = await import("../mcp/tools.ts");
      const run = (name: string, args: Record<string, unknown>) =>
        tools.MCP_TOOLS.find((t) => t.name === name)!.run(args, tools.todayContext()) as Promise<Record<string, unknown>>;
      const { belege } = (await run("lexoffice_beleg", { beleg: "GS-31" })) as { belege: { buchungskontoHinweis: string | null }[] };
      expect(belege[0]!.buchungskontoHinweis).toMatch(/^Buchungskonto nicht erkannt/);
      const zeitraum = (await run("lexoffice_belege", { zeitraum: "2025-03", richtung: "alle", suche: "", limit: 10 })) as {
        belege: { buchungskontoHinweis: string | null }[];
      };
      expect(zeitraum.belege[0]!.buchungskontoHinweis).toMatch(/^Buchungskonto nicht erkannt/);
    });

    it.each([
      ["nur skr03", { ...dienstleister, id: "ID_75", skr04: null }, "ausgabe"],
      ["nur skr04", { ...erloese, id: "ID_76", skr03: "" }, "einnahme"],
    ])("%s: gilt die Art dieser Nummer", async (_fall, raw, direction) => {
      await answer(raw);
      const id = await insert(String(raw.id));
      expect((await lexoffice.legacyVoucherDetail(id))!.voucher).toMatchObject({ direction, accountingTypeIssue: null });
    });

    it("zwei Antworten mit derselben Art: gilt diese Art", async () => {
      await answer(dienstleister);
      await answer({ ...dienstleister, name: "Dienstleister (umbenannt)" });
      const id = await insert("ID_66");
      expect((await lexoffice.legacyVoucherDetail(id))!.voucher).toMatchObject({ direction: "ausgabe", accountingTypeIssue: null });
    });

    it("type und translationCode entscheiden nichts", async () => {
      await answer({ ...dienstleister, type: "E", translationCode: "ACCOUNTING_TYPE_REVENUE" });
      const id = await insert("ID_66");
      expect((await lexoffice.legacyVoucherDetail(id))!.voucher).toMatchObject({ direction: "ausgabe" });
    });

    it("trifft andere Buchungskategorien nicht", async () => {
      await answer(dienstleister);
      const id = await insert("ID_66", { bookingCategory: "UNDERACHIEVEMENT" });
      expect((await lexoffice.legacyVoucherDetail(id))!.voucher).toMatchObject({ direction: "einnahme", accountingTypeIssue: null });
      const y = await year();
      expect(kontoCheck(y)).toBeUndefined();
    });

    it("ordnet jede Kontonummer wie datevAccountKind ein", async () => {
      const { datevAccountKind } = await import("@haben/import");
      const { accountingTypeNumberKind } = await import("./sevdesk-kontoart.ts");
      const numbers = [
        "2999",
        "3000",
        "4999",
        "5000",
        "6999",
        "7000",
        "7999",
        "8000",
        "8999",
        "9000",
        "3999",
        "4000",
        "1576",
        "1776",
        "1406",
        "3806",
        "0",
        "12345",
        "84x0",
        "",
      ];
      for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
        const rows = await sql.unsafe<{ n: string; kind: string | null }[]>(
          `select n, ${accountingTypeNumberKind(kontenrahmen, "n")} as kind from unnest($1::text[]) as n`,
          [numbers] as never,
        );
        const expected = numbers.map((n) => {
          if (n === "") return null;
          const kind = datevAccountKind(kontenrahmen, n, 4);
          return kind === "erloese" ? "erloes" : kind === "aufwand" ? "aufwand" : "sonstig";
        });
        expect(rows.map((r) => r.kind)).toEqual(expected);
      }
    });
  });
});
