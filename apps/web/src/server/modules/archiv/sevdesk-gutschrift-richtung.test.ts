import { mapSevCreditNote, type SevCreditNote } from "@haben/import";
import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * docs/sevdesk.md: Die Gutschrift folgt der Buchung von sevDesk. Belegt am DATEV-Export von sevDesk (#472): Honorar und
 * Provision stehen im Soll eines Aufwandskontos mit BU 9, Minderleistung und Buchungskonto mit Erlöskonto mindern den Umsatz.
 * Beträge erfunden, so gespeichert wie der Abruf sie speichert.
 */

const note = (bookingCategory: string, status = "1000") =>
  ({
    id: "21",
    creditNoteDate: "2025-03-10",
    creditNoteNumber: "GS-1",
    status,
    bookingCategory,
    sumNet: "100.00",
    sumTax: "19.00",
    sumGross: "119.00",
  }) as unknown as SevCreditNote;

const positions = [{ sumNet: "100.00", sumTax: "19.00", sumGross: "119.00", taxRate: "19" }] as never[];

describe.skipIf(!testDatabaseUrl)("sevDesk-Gutschriften je Buchungskategorie (Postgres)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let kontakt: typeof import("./kontakt-altbestand.ts");
  let legacy: typeof import("./legacy-open.ts");
  let exporter: typeof import("./export.ts");
  let sql: postgres.Sql;

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
    await leeren(sql)`truncate lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', '{}'::jsonb, 'sevdesk')`;
  }

  beforeEach(() => reset("SKR03", "soll"));

  async function insert(category: string, status?: string) {
    const raw = note(category, status);
    const { voucher: v, payment } = mapSevCreditNote(raw, positions);
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    const [row] =
      await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${v.lexofficeId}, 'sevdesk', ${importId}, ${v.type}, ${v.direction}, ${v.number}, ${v.date}, ${v.status}, ${v.net}, ${v.tax}, ${v.gross}, ${JSON.stringify(v.taxes)}::jsonb, '[]'::jsonb, ${JSON.stringify(payment)}::jsonb, ${JSON.stringify({ ...raw, positions })}::jsonb)
      returning id`;
    return row!.id as string;
  }

  const year = async () => (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;

  describe.each([["ROYALTY_ASSIGNED"], ["ROYALTY_UNASSIGNED"], ["PROVISION"]])("%s", (category) => {
    it.each([
      ["SKR03", "soll"],
      ["SKR03", "ist"],
      ["SKR04", "soll"],
      ["SKR04", "ist"],
    ])("zählt bei %s und %s als Ausgabe mit Vorsteuer", async (kontenrahmen, versteuerung) => {
      await reset(kontenrahmen, versteuerung);
      await insert(category);
      const y = await year();
      expect(y.ausgaben).toEqual({ count: 1, net: 10_000, tax: 1_900, gross: 11_900 });
      expect(y.einnahmen).toMatchObject({ count: 0, gross: 0 });
      expect(y.vat).toHaveLength(1);
      expect(y.vat[0]).toMatchObject({ kz66: 1_900, kz81: 0, tax81: 0 });
    });

    it("steht in Liste, Detail und Zeitraum als Ausgabe-Gutschrift mit positiven Beträgen", async () => {
      const id = await insert(category);
      const [listed] = await lexoffice.listLegacyVouchers({ year: 2025, direction: "ausgabe", search: "", ohneDatei: false });
      expect(listed).toMatchObject({ id, type: "purchasecreditnote", direction: "ausgabe", net: 10_000, tax: 1_900, gross: 11_900 });
      const detail = (await lexoffice.legacyVoucherDetail(id))!.voucher;
      expect(detail).toMatchObject({ direction: "ausgabe", net: 10_000, tax: 1_900, gross: 11_900, taxes: [{ rate: 1900, net: 10_000, tax: 1_900 }] });
      const period = await lexoffice.legacyVouchersForPeriod({ period: "2025-03", direction: "ausgabe", search: "", withPayments: false, limit: 10 });
      expect(period.vouchers[0]).toMatchObject({ direction: "ausgabe", net: 10_000, tax: 1_900, gross: 11_900 });
      expect(period.vouchers[0]!.taxes).toEqual([{ rate: 1900, net: 10_000, tax: 1_900 }]);
    });

    it("wird nicht als offener Posten zur Übernahme angeboten", async () => {
      await insert(category, "200");
      expect(await legacy.openLegacyItems("2025-12-31")).toEqual([]);
    });
  });

  it("UNDERACHIEVEMENT bleibt eine Minderung der Einnahmen", async () => {
    const id = await insert("UNDERACHIEVEMENT");
    const y = await year();
    expect(y.einnahmen).toEqual({ count: 1, net: -10_000, tax: -1_900, gross: -11_900 });
    expect(y.ausgaben).toMatchObject({ count: 0, gross: 0 });
    expect(y.vat[0]).toMatchObject({ kz66: 0, kz81: -10_000, tax81: -1_900 });
    expect((await lexoffice.legacyVoucherDetail(id))!.voucher).toMatchObject({ type: "creditnote", direction: "einnahme", gross: -11_900 });
  });

  // Die Art folgt dem Kontostamm aus GET /AccountingType (sevdesk-kontoart.test.ts); ohne gespeicherte Antwort ist sie unklar
  it("ACCOUNTING_TYPE ohne Antwort zum Buchungskonto bleibt negative Einnahme und ist unklar", async () => {
    const id = await insert("ACCOUNTING_TYPE");
    const y = await year();
    expect(y.einnahmen).toEqual({ count: 1, net: -10_000, tax: -1_900, gross: -11_900 });
    expect(y.vatIssue).toMatch(/Buchungskonto nicht erkannt/);
    expect(y.vat).toEqual([]);
    const detail = (await lexoffice.legacyVoucherDetail(id))!.voucher;
    expect(detail).toMatchObject({ type: "creditnote", direction: "einnahme", gross: -11_900 });
    expect(detail.accountingTypeIssue).toMatch(/^Buchungskonto nicht erkannt/);
  });

  it("nennt im Jahresexport Ausgabe-Gutschrift und positiven Betrag", async () => {
    await insert("PROVISION");
    const chunks: Uint8Array[] = [];
    for await (const chunk of exporter.exportYear(2025)) chunks.push(chunk);
    const lines = new TextDecoder().decode(unzipSync(Buffer.concat(chunks))["lexoffice/belege.csv"]!).split(/\r?\n/);
    const separator = lines[0]!.includes(";") ? ";" : ",";
    const header = lines[0]!
      .replace(/^\uFEFF/, "")
      .split(separator)
      .map((c) => c.replaceAll('"', ""));
    const row = lines
      .find((l) => l.includes("GS-1"))!
      .split(separator)
      .map((c) => c.replaceAll('"', ""));
    expect(row[header.indexOf("Brutto")]).toMatch(/^119[.,]00$/);
    expect(row).toContain("Ausgabe-Gutschrift");
  });

  it.each([["ROYALTY_ASSIGNED"], ["PROVISION"]])("zeigt %s auf der Kontaktseite als Ausgabe mit positivem Betrag", async (category) => {
    const [contact] = await sql`insert into contacts (name, land, email) values ('Erfundener Dienstleister', 'DE', 'dienst@example.com') returning id`;
    const id = await insert(category);
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`update lexoffice_vouchers set contact_id = ${contact!.id} where id = ${id}`;
    });
    expect(await kontakt.legacyVouchersForContact(contact!.id as string)).toMatchObject([{ id, direction: "ausgabe", net: 10_000, gross: 11_900 }]);
  });

  it("ändert die gespeicherte Zeile nicht", async () => {
    const id = await insert("PROVISION");
    await year();
    const [row] = await sql`select direction, type, gross from lexoffice_vouchers where id = ${id}`;
    expect(row).toMatchObject({ direction: "einnahme", type: "creditnote", gross: -11_900 });
  });
});
