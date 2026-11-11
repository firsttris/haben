import { mapSevVoucher, type SevVoucher } from "@haben/import";
import { unzipSync } from "fflate";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import belege from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/belege-credit-debit.json";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/* sevDesk liefert bei den meisten Belegen nur den Verweis `supplier`, `supplierName` ist leer (#472). */

describe.skipIf(!testDatabaseUrl)("sevDesk-Beleg ohne supplierName (Postgres)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let legacy: typeof import("./legacy-open.ts");
  let exporter: typeof import("./export.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    legacy = await import("./legacy-open.ts");
    exporter = await import("./export.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await leeren(sql)`truncate journal_lines, journal_entries, document_amounts, documents, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports,
      contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', '{}'::jsonb, 'sevdesk')`;
  }

  /** Echter Belegaufbau, nur offen gestellt: `supplierName` null, `supplier` verweist auf den Kontakt */
  async function openVoucher(contactName: string | null, stored = "", atSave: string | null = null) {
    const raw = { ...belege[0]!.voucher, supplierNameAtSave: atSave, status: "100", paidAmount: 0, payDate: null };
    const mapped = mapSevVoucher(raw as SevVoucher, belege[0]!.positions as never[]);
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    const [contact] = contactName ? await sql`insert into contacts (name) values (${contactName}) returning id` : [];
    const v = mapped.voucher;
    const [row] =
      await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, contact_id, contact_name, net, tax, gross, taxes, categories, payment, raw)
      values (${v.lexofficeId}, 'sevdesk', ${importId}, ${v.type}, ${v.direction}, ${v.number}, ${v.date}, ${v.status}, ${contact?.id ?? null}, ${stored}, ${v.net}, ${v.tax}, ${v.gross}, ${JSON.stringify(v.taxes)}::jsonb, '[]'::jsonb, ${JSON.stringify(mapped.payment)}::jsonb, ${JSON.stringify(raw)}::jsonb)
      returning id, date`;
    await sql`insert into lexoffice_voucher_files (voucher_id, role, filename, mime_type, sha256, size) values (${row!.id}, 'anhang', 'b.pdf', 'application/pdf', ${"a".repeat(64)}, 4)`;
    return { id: row!.id as string, year: Number(String(row!.date).slice(0, 4)) };
  }

  describe.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("%s, %s", (kontenrahmen, versteuerung) => {
    beforeEach(() => setup(kontenrahmen, versteuerung));

    it("nennt in den offenen Posten den verknüpften Kontakt und übernimmt ihn als Lieferant", async () => {
      const { id } = await openVoucher("Bürohaus GmbH");
      expect((await legacy.openLegacyItems()).map((i) => i.contactName)).toEqual(["Bürohaus GmbH"]);
      await legacy.takeOverLegacyItem("test-user", id);
      const [document] = await sql`select supplier_name from documents where lexoffice_voucher_id = ${id}`;
      expect(document!.supplier_name).toBe("Bürohaus GmbH");
    });

    it("übernimmt den Namen vom Zeitpunkt des Belegs, auch nach Umbenennen des Kontakts", async () => {
      const { id } = await openVoucher("Bürohaus Neu AG", "", "Bürohaus GmbH");
      expect((await legacy.openLegacyItems()).map((i) => i.contactName)).toEqual(["Bürohaus GmbH"]);
      await legacy.takeOverLegacyItem("test-user", id);
      const [document] = await sql`select supplier_name from documents where lexoffice_voucher_id = ${id}`;
      expect(document!.supplier_name).toBe("Bürohaus GmbH");
    });
  });

  describe("Lesepfade", () => {
    beforeEach(() => setup("SKR03", "ist"));

    it("zeigt und findet den Kontakt in Liste, Detail und Zeitraumabfrage", async () => {
      const { id, year } = await openVoucher("Bürohaus GmbH");
      const liste = await lexoffice.listLegacyVouchers({ year, direction: "alle", search: "Bürohaus", ohneDatei: false });
      expect(liste.map((v) => v.contactName)).toEqual(["Bürohaus GmbH"]);
      expect((await lexoffice.legacyVoucherDetail(id))!.voucher.contactName).toBe("Bürohaus GmbH");
      const zeitraum = await lexoffice.legacyVouchersForPeriod({ period: String(year), direction: "alle", search: "Bürohaus", withPayments: false, limit: 10 });
      expect(zeitraum.vouchers.map((v) => v.contactName)).toEqual(["Bürohaus GmbH"]);
    });

    it("schreibt den Kontakt in den Jahresexport", async () => {
      const { year } = await openVoucher("Bürohaus GmbH");
      const chunks: Uint8Array[] = [];
      for await (const chunk of exporter.exportYear(year)) chunks.push(chunk);
      const belegeCsv = new TextDecoder().decode(unzipSync(Buffer.concat(chunks))["lexoffice/belege.csv"]!);
      expect(belegeCsv).toContain("Bürohaus GmbH");
    });

    it("lässt Belege aus Lexoffice unverändert", async () => {
      const { id } = await openVoucher("Bürohaus GmbH");
      await sql`set session_replication_role = replica`;
      await sql`update lexoffice_vouchers set source = 'lexoffice' where id = ${id}`;
      await sql`set session_replication_role = default`;
      expect((await lexoffice.legacyVoucherDetail(id))!.voucher.contactName).toBe("");
    });

    it("zeigt, findet und exportiert den Namen vom Zeitpunkt des Belegs statt des umbenannten Kontakts", async () => {
      const { id, year } = await openVoucher("Bürohaus Neu AG", "", "Bürohaus GmbH");
      expect((await lexoffice.legacyVoucherDetail(id))!.voucher.contactName).toBe("Bürohaus GmbH");
      const liste = await lexoffice.listLegacyVouchers({ year, direction: "alle", search: "Bürohaus GmbH", ohneDatei: false });
      expect(liste.map((v) => v.contactName)).toEqual(["Bürohaus GmbH"]);
      const chunks: Uint8Array[] = [];
      for await (const chunk of exporter.exportYear(year)) chunks.push(chunk);
      const belegeCsv = new TextDecoder().decode(unzipSync(Buffer.concat(chunks))["lexoffice/belege.csv"]!);
      expect(belegeCsv).toContain("Bürohaus GmbH");
      expect(belegeCsv).not.toContain("Bürohaus Neu AG");
    });

    it("nimmt den Kontakt, wenn der Name vom Zeitpunkt des Belegs nur aus Leerzeichen besteht", async () => {
      const { id } = await openVoucher("Bürohaus GmbH", "", "   ");
      expect((await lexoffice.legacyVoucherDetail(id))!.voucher.contactName).toBe("Bürohaus GmbH");
    });

    it("behält einen gespeicherten Namen vor dem Namen vom Zeitpunkt des Belegs", async () => {
      const { id } = await openVoucher("Bürohaus GmbH", "Name aus sevDesk", "Name beim Speichern");
      expect((await lexoffice.legacyVoucherDetail(id))!.voucher.contactName).toBe("Name aus sevDesk");
    });

    it("behält einen von sevDesk gelieferten Namen", async () => {
      const { id } = await openVoucher("Bürohaus GmbH", "Name aus sevDesk");
      expect((await lexoffice.legacyVoucherDetail(id))!.voucher.contactName).toBe("Name aus sevDesk");
    });

    it("bleibt leer ohne verknüpften Kontakt", async () => {
      const { id } = await openVoucher(null);
      expect((await lexoffice.legacyVoucherDetail(id))!.voucher.contactName).toBe("");
    });
  });
});
