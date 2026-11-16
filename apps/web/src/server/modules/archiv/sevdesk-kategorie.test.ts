import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * #472: Belege aus sevDesk bekommen ihre Kategorie je Position aus dem Kontostamm des Buchungskontos
 * (sevdesk_accounting_types), zur Laufzeit; die Archivkopie bleibt unverändert. Bei GmbH und UG ordnet der Abgleich damit
 * Gesellschafter, Kapital, Darlehen und Steuern vom Einkommen ein; die Übernahme offener Belege nimmt die Kategorie mit.
 * Kennungen, Nummern und Beträge erfunden.
 */

const pdf = (number: string) => new TextEncoder().encode(`%PDF-1.4\n% Beleg ${number} aus sevDesk\n%%EOF\n`);

/** Kontostamm je Konto: id → [skr03, skr04] */
const KONTEN: Record<string, [string | null, string | null]> = {
  kst: ["2200", "7600"],
  darlehen: ["0640", "3160"],
  gesellschafter: ["0730", "3510"],
  buero: ["4930", "6815"],
  tanken: ["4530", "6530"],
  widerspruch: ["4930", "6530"],
  ohneNummer: [null, null],
};

describe.skipIf(!testDatabaseUrl)("Kategorien aus dem Buchungskonto von sevDesk (Postgres)", () => {
  let sql: postgres.Sql;
  let lexoffice: typeof import("./lexoffice.ts");
  let legacy: typeof import("./legacy-open.ts");
  let storage: typeof import("../../storage.ts");
  let importId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
    legacy = await import("./legacy-open.ts");
    storage = await import("../../storage.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Beleg aus sevDesk wie vom Abruf gespeichert: Positionen mit Konto, Kategorien ohne Namen */
  async function voucher(values: {
    number: string;
    accounts: (string | null)[];
    net: number;
    tax?: number;
    date?: string;
    open?: boolean;
    file?: boolean;
    nets?: number[];
  }) {
    const tax = values.tax ?? 0;
    const each = values.net / values.accounts.length;
    const rate = tax === 0 ? 0 : 1900;
    const positions = values.accounts.map((a, i) => ({ id: `${values.number}-${i}`, accountingType: a ? { id: a, objectName: "AccountingType" } : null }));
    const categories = values.accounts.map((a, i) => ({
      categoryId: a ?? "",
      name: "",
      rate,
      net: values.nets?.[i] ?? each,
      tax: tax / values.accounts.length,
    }));
    const date = values.date ?? "2025-03-10";
    const payment = values.open
      ? { status: "open", openAmount: values.net + tax, paidDate: null, items: [] }
      : { status: "balanced", openAmount: 0, paidDate: date, items: [{ type: "partPaymentFinancialTransaction", date, amount: values.net + tax }] };
    const [row] =
      await sql`insert into lexoffice_vouchers (lexoffice_id, source, import_id, type, direction, number, date, due_date, status, contact_name, net, tax, gross,
        taxes, categories, payment, raw)
      values (${`voucher/${values.number}`}, 'sevdesk', ${importId}, 'purchaseinvoice', 'ausgabe', ${values.number}, ${date}, ${date}, ${values.open ? "open" : "paid"},
        'Lieferant', ${values.net}, ${tax}, ${values.net + tax}, ${JSON.stringify([{ rate, net: values.net, tax }])}::jsonb, ${JSON.stringify(categories)}::jsonb,
        ${JSON.stringify(payment)}::jsonb, ${JSON.stringify({ id: values.number, creditDebit: "C", positions })}::jsonb)
      returning id`;
    if (values.file) {
      const file = pdf(values.number);
      const sha = await storage.storeFile(file);
      await sql`insert into lexoffice_voucher_files (voucher_id, role, filename, mime_type, sha256, size)
        values (${row!.id}, 'pdf', ${`${values.number}.pdf`}, 'application/pdf', ${sha}, ${file.byteLength})`;
    }
    return row!.id as string;
  }

  async function setup(rechtsform: "einzelunternehmen" | "gmbh", kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from lexoffice_voucher_files`;
      await tx`delete from lexoffice_vouchers`;
      await tx`delete from sevdesk_accounting_types`;
      await tx`delete from lexoffice_imports`;
    });
    await leeren(sql)`truncate journal_lines, journal_entries, document_amounts, documents, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, ${rechtsform})`;
    const [run] = await sql`insert into lexoffice_imports (status, progress, source) values ('fertig', '{}'::jsonb, 'sevdesk') returning id`;
    importId = run!.id as string;
    for (const [id, [skr03, skr04]] of Object.entries(KONTEN)) {
      await sql`insert into sevdesk_accounting_types (import_id, accounting_type_id, raw)
        values (${importId}, ${id}, ${JSON.stringify({ id, objectName: "AccountingType", skr03, skr04 })}::jsonb)`;
    }
    await voucher({ number: "B-1", accounts: ["buero"], net: 10_000, tax: 1_900 });
    await voucher({ number: "B-2", accounts: ["kst"], net: 500_000 });
    await voucher({ number: "B-3", accounts: ["darlehen"], net: 300_000 });
    await voucher({ number: "B-4", accounts: ["gesellschafter"], net: 200_000 });
    // Gemischt: Steuer und Bürobedarf, damit kein neutraler Beleg
    await voucher({ number: "B-5", accounts: ["kst", "buero"], net: 40_000 });
    // Nicht erkannt: ohne Antwort, ohne Nummer, Widerspruch SKR03/SKR04
    await voucher({ number: "B-6", accounts: ["fehlt"], net: 1_000 });
    await voucher({ number: "B-7", accounts: ["ohneNummer"], net: 2_000 });
    await voucher({ number: "B-8", accounts: ["widerspruch"], net: 3_000 });
  }

  const neutralOf = (neutral: { kind: string; count: number; abfluss: number }[]) => neutral.map((n) => [n.kind, n.count, n.abfluss]);

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)(
    "GmbH, %s, %s: Steuern vom Einkommen, Darlehen und Gesellschafter zählen im Abgleich und je Zeitraum neutral",
    async (kontenrahmen, versteuerung) => {
      await setup("gmbh", kontenrahmen, versteuerung);
      const { years } = await lexoffice.reconciliation();
      const year = years.find((y) => y.year === 2025)!;
      expect(year.ausgaben).toEqual({ count: 5, net: 56_000, tax: 1_900, gross: 57_900 });
      expect(neutralOf(year.neutral)).toEqual([
        ["gesellschafter", 1, 200_000],
        ["kapital", 1, 300_000],
        ["ertragsteuern", 1, 500_000],
      ]);
      expect(year.vat.find((m) => m.month === "2025-03")).toMatchObject({ kz66: 1_900 });

      const period = await lexoffice.legacyVouchersForPeriod({ period: "2025", direction: "alle", search: "", withPayments: true, limit: 50 });
      expect(period.vouchers.map((v) => v.number)).toEqual(["B-1", "B-5", "B-6", "B-7", "B-8"]);
      expect(neutralOf(period.neutral)).toEqual(neutralOf(year.neutral));

      // Die Archivkopie bleibt, wie sie abgerufen wurde
      const [row] = await sql`select categories from lexoffice_vouchers where number = 'B-2'`;
      expect(row!.categories).toEqual([{ categoryId: "kst", name: "", rate: 0, net: 500_000, tax: 0 }]);
    },
  );

  it("Einzelunternehmen, SKR04, Ist: alles bleibt Ausgabe, wie vor #472", async () => {
    await setup("einzelunternehmen", "SKR04", "ist");
    const { years } = await lexoffice.reconciliation();
    const year = years.find((y) => y.year === 2025)!;
    expect(year.ausgaben.count).toBe(8);
    expect(year.neutral).toEqual([]);
  });

  it("zeigt in der Belegansicht die Kategorie je Position, nicht Erkanntes als Sonstiges mit dem Konto", async () => {
    await setup("einzelunternehmen", "SKR03", "soll");
    const names = async (number: string) => {
      const [{ id }] = (await sql`select id from lexoffice_vouchers where number = ${number}`) as unknown as [{ id: string }];
      return (await lexoffice.legacyVoucherDetail(id))!.voucher.categories.map((c) => c.name);
    };
    expect(await names("B-5")).toEqual(["Körperschaftsteuer", "Bürobedarf"]);
    expect(await names("B-3")).toEqual(["Darlehen"]);
    expect(await names("B-6")).toEqual(["Sonstiges (Buchungskonto fehlt nicht erkannt)"]);
    expect(await names("B-7")).toEqual(["Sonstiges (Buchungskonto ohneNummer nicht erkannt)"]);
    expect(await names("B-8")).toEqual(["Sonstiges (Buchungskonto widerspruch nicht erkannt)"]);
  });

  it("übernimmt einen offenen Ausgabebeleg mit der Kategorie seines Buchungskontos, nicht Erkanntes als Sonstiges", async () => {
    await setup("einzelunternehmen", "SKR03", "ist");
    // Die größere Position bestimmt die Kategorie
    const tanken = await voucher({
      number: "B-20",
      accounts: ["buero", "tanken"],
      nets: [1_000, 8_000],
      net: 9_000,
      tax: 1_710,
      date: "2025-12-01",
      open: true,
      file: true,
    });
    const unklar = await voucher({ number: "B-21", accounts: ["widerspruch"], net: 5_000, tax: 950, date: "2025-12-02", open: true, file: true });
    await legacy.takeOverAll("test-user", "2025-12-31");
    const category = async (id: string) => ((await sql`select category from documents where lexoffice_voucher_id = ${id}`)[0] as { category: string }).category;
    expect(await category(tanken)).toBe("kfzBetrieb");
    expect(await category(unklar)).toBe("sonstiges");
  });
});
