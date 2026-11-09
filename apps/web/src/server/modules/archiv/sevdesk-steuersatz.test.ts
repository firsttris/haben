import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * sevDesk liefert Rechnungen auch ohne Positionen, der Kopf nennt Netto und Steuer (#472). Frühere Abrufe haben dafür Satz 0
 * gespeichert; das Archiv ist nur anhängbar, die Korrektur greift beim Lesen.
 */

const PDF = new TextEncoder().encode("%PDF-1.4\n% Rechnung ohne Positionen\n%%EOF\n");

describe.skipIf(!testDatabaseUrl)("sevDesk-Rechnung ohne Positionen (Postgres)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let legacy: typeof import("./legacy-open.ts");
  let storage: typeof import("../../storage.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    legacy = await import("./legacy-open.ts");
    storage = await import("../../storage.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function setup(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await sql`truncate journal_lines, journal_entries, invoice_lines, invoices, document_amounts, documents, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, 'einzelunternehmen')`;
    await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', '{}'::jsonb, 'sevdesk')`;
  }

  /** So hat ein früherer Abruf die Rechnung gespeichert: ein Satz 0 mit dem Netto und der Steuer des Kopfs */
  async function archived(values: { net: number; tax: number; positions?: unknown[]; source?: string; open?: boolean; rate?: number }) {
    const { net, tax, positions = [], source = "sevdesk", open = true, rate = 0 } = values;
    const [{ id: importId }] = (await sql`select id from lexoffice_imports limit 1`) as unknown as [{ id: string }];
    const payment = open
      ? { status: "open", openAmount: net + tax, paidDate: null, items: [] }
      : { status: "balanced", openAmount: 0, paidDate: null, items: [] };
    const [row] =
      await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, status, net, tax, gross, taxes, categories, payment, raw)
      values (${`invoice/${net}-${tax}-${source}`}, ${source}, ${importId}, 'invoice', 'einnahme', 'RE-2025-0001', '2025-03-10', ${open ? "open" : "paid"}, ${net}, ${tax}, ${net + tax},
        ${JSON.stringify([{ rate, net, tax }])}::jsonb, '[]'::jsonb, ${JSON.stringify(payment)}::jsonb, ${JSON.stringify({ invoiceType: "RE", positions })}::jsonb) returning id`;
    return row!.id as string;
  }

  const taxesOf = async (id: string) => (await lexoffice.legacyVoucherDetail(id))!.voucher.taxes;

  describe.each([
    ["SKR03", "ist"],
    ["SKR03", "soll"],
    ["SKR04", "ist"],
    ["SKR04", "soll"],
  ] as const)("%s, %s", (kontenrahmen, versteuerung) => {
    beforeEach(() => setup(kontenrahmen, versteuerung));

    it("übernimmt die offene Rechnung mit dem Satz aus dem Kopf", async () => {
      const id = await archived({ net: 11_900, tax: 2_261 });
      await storage.storeFile(PDF);
      await sql`insert into lexoffice_voucher_files (voucher_id, role, filename, mime_type, sha256, size) values (${id}, 'pdf', 'r.pdf', 'application/pdf', ${storage.sha256Of(PDF)}, ${PDF.byteLength})`;
      const [item] = await legacy.openLegacyItems();
      expect(item!.blocker).toBeNull();
      expect(await legacy.takeOverLegacyItem("test-user", id)).toMatchObject({ kind: "invoice" });
      const [invoice] = await sql`select net, tax, gross from invoices where lexoffice_voucher_id = ${id}`;
      expect(invoice).toMatchObject({ net: 11_900, tax: 2_261, gross: 14_161 });
      const [balance] = await sql`select sum(debit)::int as debit, sum(credit)::int as credit from journal_lines`;
      expect(balance!.debit).toBe(balance!.credit);
      expect(balance!.debit).toBeGreaterThan(0);
    });
  });

  describe("Abgleich und Grenzen", () => {
    beforeEach(() => setup("SKR03", "soll"));

    it("rechnet die Umsatzsteuer unter Kz 81 statt unter anderen Sätzen", async () => {
      await archived({ net: 11_900, tax: 2_261 });
      const year = (await lexoffice.reconciliation()).years.find((y) => y.year === 2025)!;
      expect(year.vat).toMatchObject([{ month: "2025-03", kz81: 11_900, tax81: 2_261, otherBase: 0 }]);
    });

    it("erkennt 7 % und eine Gutschrift mit negativen Beträgen", async () => {
      expect(await taxesOf(await archived({ net: 10_000, tax: 700 }))).toEqual([{ rate: 700, net: 10_000, tax: 700 }]);
      expect(await taxesOf(await archived({ net: -11_900, tax: -2_261 }))).toEqual([{ rate: 1900, net: -11_900, tax: -2_261 }]);
    });

    it("nimmt bei kleinen Beträgen den nächstliegenden Satz, nicht den ersten passenden", async () => {
      expect(await taxesOf(await archived({ net: 10, tax: 1 }))).toEqual([{ rate: 700, net: 10, tax: 1 }]);
      expect(await taxesOf(await archived({ net: 171, tax: 33 }))).toEqual([{ rate: 1900, net: 171, tax: 33 }]);
    });

    it("rechnet große Beträge ohne Überlauf", async () => {
      expect(await taxesOf(await archived({ net: 500_000_000, tax: 95_000_000 }))).toEqual([{ rate: 1900, net: 500_000_000, tax: 95_000_000 }]);
    });

    it("lässt einen Satz, den der Kopf nicht trägt, unverändert", async () => {
      expect(await taxesOf(await archived({ net: 10_000, tax: 1_234 }))).toEqual([{ rate: 0, net: 10_000, tax: 1_234 }]);
    });

    it("ändert nichts, wenn es Positionen gibt, keine Steuer anfällt oder der Beleg aus Lexoffice stammt", async () => {
      expect(await taxesOf(await archived({ net: 11_900, tax: 2_261, positions: [{ id: 1 }] }))).toEqual([{ rate: 0, net: 11_900, tax: 2_261 }]);
      expect(await taxesOf(await archived({ net: 10_000, tax: 0 }))).toEqual([{ rate: 0, net: 10_000, tax: 0 }]);
      expect(await taxesOf(await archived({ net: 20_000, tax: 3_800, source: "lexoffice" }))).toEqual([{ rate: 0, net: 20_000, tax: 3_800 }]);
    });
  });
});
