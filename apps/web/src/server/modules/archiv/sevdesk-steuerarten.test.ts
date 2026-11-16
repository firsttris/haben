import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import belege from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/belege-credit-debit.json";
import steuerarten from "../../../../../../packages/import/test-fixtures/sevdesk/buchhaltung-1.0/tax-set.json";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Eigene Steuerarten aus sevDesk (#472): Der Abruf speichert GET /TaxSet je Lauf unverändert; der Abgleich der Umsatzsteuer
 * je Monat nimmt für Belege mit taxType custom die Kennzahlen daraus (Reverse Charge: Kz 46, Steuer und Vorsteuer Kz 47 und
 * 67), auch für Belege aus einem früheren Lauf. Belege wie belege-credit-debit.json, Steuerarten wie tax-set.json.
 */

const TOKEN = "0123456789abcdef0123456789abcdef";
type Fixture = { voucher: Record<string, unknown>; positions: Record<string, unknown>[] };
const RC = belege[1] as unknown as Fixture;

/** Beleg mit eigener Steuerart, Netto in Euro ohne Steuer (wie sevDesk Reverse Charge speichert) */
function customVoucher(id: string, date: string, net: string, taxSet: string): Fixture {
  const voucher = {
    ...RC.voucher,
    id,
    description: `B-${id}`,
    voucherDate: `${date}T00:00:00+02:00`,
    payDate: `${date}T00:00:00+02:00`,
    deliveryDate: `${date}T00:00:00+02:00`,
  };
  Object.assign(voucher, {
    sumNet: net,
    sumTax: "0",
    sumGross: net,
    sumNetAccounting: net,
    sumTaxAccounting: "0",
    sumGrossAccounting: net,
    paidAmount: Number(net),
  });
  Object.assign(voucher, { taxSet: { id: taxSet, objectName: "TaxSet" } });
  const position = {
    ...RC.positions[0]!,
    id: `${id}1`,
    voucher: { id, objectName: "Voucher" },
    sumNet: net,
    sumTax: "0",
    sumGross: net,
    sumNetAccounting: net,
    sumTaxAccounting: "0",
    sumGrossAccounting: net,
  };
  return { voucher, positions: [position] };
}

describe.skipIf(!testDatabaseUrl)("Eigene Steuerarten aus sevDesk im Abgleich (Postgres)", { timeout: 30_000 }, () => {
  let sql: postgres.Sql;
  let sevdesk: typeof import("./sevdesk.ts");
  let lexoffice: typeof import("./lexoffice.ts");
  let importPkg: typeof import("@haben/import");
  let vouchers: Fixture[] = [];
  let taxSets: unknown[] | "fehler" = [];
  const calls: string[] = [];

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  beforeAll(async () => {
    sql = await setupTestDb();
    sevdesk = await import("./sevdesk.ts");
    lexoffice = await import("./lexoffice.ts");
    importPkg = await import("@haben/import");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04") {
    await leeren(
      sql,
    )`truncate sevdesk_tax_sets, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, sevdesk_connection, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, 'einzelunternehmen')`;
    sevdesk.setSevdeskClientFactory(
      (o) =>
        new importPkg.SevdeskClient({
          ...o,
          minIntervalMs: 0,
          maxRetries: 0,
          sleep: async () => {},
          fetch: (async (input: RequestInfo | URL) => {
            const url = new URL(String(input));
            const path = url.pathname.replace(/^\/api\/v1/, "");
            calls.push(path);
            const list = (objects: unknown[]) => json({ objects: url.searchParams.get("offset") === "0" ? objects : [] });
            if (path === "/Tools/bookkeepingSystemVersion") return json({ objects: { version: "1.0" } });
            if (path === "/Voucher") return list(vouchers.map((v) => v.voucher));
            if (path === "/VoucherPos") return list(vouchers.find((v) => v.voucher.id === url.searchParams.get("voucher[id]"))?.positions ?? []);
            if (path === "/TaxSet") return taxSets === "fehler" ? json({ error: { message: "kaputt" } }, 500) : list(taxSets);
            // Kontostamm der Positionen (Kategorie, #1182): ein Aufwandskonto, damit er die Steuerart nicht berührt
            const konto = /^\/AccountingType\/(.+)$/.exec(path);
            if (konto) return json({ objects: [{ id: konto[1], objectName: "AccountingType", skr03: "3100", skr04: "5900" }] });
            if (!path.slice(1).includes("/")) return list([]);
            return json({ error: { message: `unbekannt ${path}` } }, 404);
          }) as typeof fetch,
        }),
    );
    await sevdesk.saveSevdeskKey("test-user", TOKEN);
  }

  async function abruf() {
    calls.length = 0;
    await sevdesk.startSevdeskImport("test-user", { wait: true });
    return (await sevdesk.latestSevdeskImport())!;
  }

  const month = async (year: number, m: string) =>
    (await lexoffice.reconciliation()).years.find((y) => y.year === year)!.vat.find((v) => v.month === `${year}-${m}`)!;

  it("speichert GET /TaxSet je Abruf unverändert und bucht Reverse Charge in Kz 46, 47 und 67 (SKR03, Ist)", async () => {
    await reset("ist", "SKR03");
    taxSets = steuerarten.objects;
    vouchers = [
      customVoucher("2001", "2026-04-03", "21.50", "1032"),
      customVoucher("2002", "2026-04-17", "13.37", "1032"),
      customVoucher("2003", "2026-05-08", "100.00", "1033"),
    ];
    const run = await abruf();
    expect(run.status).toBe("fertig");
    expect(run.progress.failed).toEqual([]);
    expect(calls.filter((c) => c === "/TaxSet")).toHaveLength(1);

    const stored = await sql`select import_id, raw from sevdesk_tax_sets`;
    expect(stored).toEqual([{ import_id: run.id, raw: steuerarten.objects }]);
    expect((await sql`select count(*)::int as n from audit_log where table_name = 'sevdesk_tax_sets'`)[0]!.n).toBe(1);

    // Steuer je Beleg gerundet: 21,50 × 19 % = 4,085 → 4,09; 13,37 × 19 % = 2,5403 → 2,54
    expect(await month(2026, "04")).toMatchObject({ kz46: 3_487, kz47: 663, kz67: 663, kz66: 0, otherPurchases: 0 });
    expect(await month(2026, "05")).toMatchObject({ kz89: 10_000, kz61: 1_900, kz66: 0 });
  });

  it("nutzt den jüngsten Abruf auch für Belege aus einem früheren Lauf ohne Steuerarten (SKR04, Soll)", async () => {
    await reset("soll", "SKR04");
    taxSets = "fehler";
    vouchers = [customVoucher("2101", "2026-06-12", "50.00", "1032")];
    const erster = await abruf();
    expect(erster.progress.failed).toEqual([{ lexofficeId: "taxset", number: "Steuerarten", message: expect.any(String) }]);
    expect((await sql`select count(*)::int as n from sevdesk_tax_sets`)[0]!.n).toBe(0);
    // Ohne Steuerart: sichtbar unter „Andere Bezüge“, nicht in Kz 46
    expect(await month(2026, "06")).toMatchObject({ kz46: 0, kz47: 0, otherPurchases: 5_000 });

    taxSets = steuerarten.objects;
    vouchers = [];
    const zweiter = await abruf();
    expect(zweiter.progress.failed).toEqual([]);
    expect(await month(2026, "06")).toMatchObject({ kz46: 5_000, kz47: 950, kz67: 950, otherPurchases: 0 });

    // Ein späterer Abruf mit geänderter Steuerart ist eine neue Zeile; es gilt der jüngste
    taxSets = steuerarten.objects.map((t) => (t.id === "1032" ? { ...t, vatReportFieldNet: "84", vatReportFieldTax: "85,67" } : t));
    await abruf();
    expect((await sql`select count(*)::int as n from sevdesk_tax_sets`)[0]!.n).toBe(2);
    expect(await month(2026, "06")).toMatchObject({ kz46: 0, kz84: 5_000, kz85: 950, kz67: 950 });
  });

  it("gespeicherte Steuerarten lassen sich nicht ändern oder löschen", async () => {
    await reset("soll", "SKR03");
    taxSets = steuerarten.objects;
    vouchers = [];
    await abruf();
    await expect(sql`update sevdesk_tax_sets set raw = '[]'`).rejects.toThrow();
    await expect(sql`delete from sevdesk_tax_sets`).rejects.toThrow();
    await expect(sql`truncate sevdesk_tax_sets`).rejects.toThrow();
  });
});
