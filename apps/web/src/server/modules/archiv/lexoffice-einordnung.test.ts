import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/**
 * Einordnung im Abgleich je Rechtsform: Was im Einzelunternehmen Einnahme oder Ausgabe ist, kann bei GmbH und UG
 * Gesellschafter-Verrechnung, Kapital, Darlehen oder Steuer vom Einkommen sein. Die archivierten Belege bleiben
 * unverändert; eingeordnet wird beim Lesen.
 */
describe.skipIf(!testDatabaseUrl)("Einordnung privater und neutraler Kategorien (Postgres)", () => {
  let lexoffice: typeof import("./lexoffice.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    lexoffice = await import("./lexoffice.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Beleg bzw. Buchung ohne Beleg aus der Sicherung der Web-Oberfläche, eine Kategorie */
  async function voucher(values: {
    direction: "einnahme" | "ausgabe";
    category: string;
    net: number;
    tax?: number;
    date?: string;
    paidOn?: string;
    ohneBeleg?: boolean;
    privat?: boolean;
  }) {
    const tax = values.tax ?? 0;
    const gross = values.net + tax;
    const rate = tax === 0 ? 0 : 1900;
    const date = values.date ?? "2025-03-10";
    const type = values.ohneBeleg ? "booking" : values.direction === "einnahme" ? "invoice" : "purchaseinvoice";
    const payment = values.paidOn
      ? { status: "balanced", openAmount: 0, paidDate: values.paidOn, items: [{ type: "partPaymentFinancialTransaction", date: values.paidOn, amount: gross }] }
      : null;
    await sql`insert into lexoffice_vouchers (lexoffice_id, import_id, type, direction, number, date, status, contact_name, net, tax, gross,
        taxes, categories, payment, raw)
      values (${crypto.randomUUID()}, (select id from lexoffice_imports limit 1), ${type}, ${values.direction}, '', ${date}, 'paid', 'Bank',
        ${values.net}, ${tax}, ${gross}, ${JSON.stringify([{ rate, net: values.net, tax }])}::jsonb,
        ${JSON.stringify([{ categoryId: values.category, name: values.category, rate, net: values.net, tax }])}::jsonb,
        ${payment ? JSON.stringify(payment) : null}::jsonb,
        ${JSON.stringify({ ohneBeleg: values.ohneBeleg ?? false, privat: values.privat ?? false })}::jsonb)`;
  }

  async function setup(rechtsform: "einzelunternehmen" | "gmbh" | "ug", kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    // Der Altbestand ist nur anhängbar; für jeden Fall leer beginnen
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from lexoffice_voucher_files`;
      await tx`delete from lexoffice_vouchers`;
      await tx`delete from lexoffice_imports`;
    });
    await sql`truncate company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung, rechtsform)
      values (1, 'Nordlicht', 'Hafenallee 3', '28217', 'Bremen', 'rechnung@example.com', '60/145/12345', 'HB', ${kontenrahmen}, ${versteuerung}, ${rechtsform})`;
    await sql`insert into lexoffice_imports (status, progress) values ('fertig', ${JSON.stringify({ phase: "fertig" })}::jsonb)`;
    await voucher({ direction: "einnahme", category: "Erlöse 19 %", net: 100_000, tax: 19_000, paidOn: "2025-04-05" });
    await voucher({ direction: "ausgabe", category: "Bürobedarf", net: 10_000, tax: 1_900 });
    await voucher({ direction: "ausgabe", category: "Körperschaftsteuer", net: 500_000, ohneBeleg: true });
    await voucher({ direction: "ausgabe", category: "Gewerbesteuer", net: 300_000, ohneBeleg: true });
    await voucher({ direction: "einnahme", category: "Gesellschafterdarlehen", net: 1_000_000, ohneBeleg: true });
    await voucher({ direction: "ausgabe", category: "Zinsen für Darlehen", net: 5_000, ohneBeleg: true });
    await voucher({ direction: "ausgabe", category: "Privatentnahme", net: 200_000, ohneBeleg: true, privat: true });
    // Ein Körperschaftsteuerbescheid als Beleg ohne Datei: neutral, braucht aber trotzdem seine Datei
    await voucher({ direction: "ausgabe", category: "Körperschaftsteuer", net: 20_000 });
  }

  describe.each(["SKR03", "SKR04"] as const)("%s", (kontenrahmen) => {
    describe.each(["ist", "soll"] as const)("%s", (versteuerung) => {
      const kz81Month = versteuerung === "ist" ? "2025-04" : "2025-03";

      it("Einzelunternehmen: unverändert, nur Privates ist weder Einnahme noch Ausgabe, und das steht sichtbar daneben", async () => {
        await setup("einzelunternehmen", kontenrahmen, versteuerung);
        const { rechtsform, years } = await lexoffice.reconciliation();
        expect(rechtsform).toBe("einzelunternehmen");
        const year = years.find((y) => y.year === 2025)!;
        expect(year.einnahmen).toEqual({ count: 2, net: 1_100_000, tax: 19_000, gross: 1_119_000 });
        expect(year.ausgaben).toEqual({ count: 5, net: 835_000, tax: 1_900, gross: 836_900 });
        expect(year.neutral).toEqual([{ kind: "privat", label: "Privat und Geldtransit", count: 1, zufluss: 0, abfluss: 200_000 }]);
        expect(year.withoutFile).toBe(3);
        expect(year.vat.find((m) => m.month === kz81Month)).toMatchObject({ kz81: 100_000 });
      });

      it.each(["gmbh", "ug"] as const)("%s: Gesellschafter, Kapital und Steuern vom Einkommen zählen nicht, stehen aber je Art da", async (rechtsform) => {
        await setup(rechtsform, kontenrahmen, versteuerung);
        const { years } = await lexoffice.reconciliation();
        const year = years.find((y) => y.year === 2025)!;
        expect(year.einnahmen).toEqual({ count: 1, net: 100_000, tax: 19_000, gross: 119_000 });
        expect(year.ausgaben).toEqual({ count: 2, net: 15_000, tax: 1_900, gross: 16_900 });
        expect(year.neutral).toEqual([
          { kind: "gesellschafter", label: expect.stringMatching(/^Gesellschafter/), count: 1, zufluss: 0, abfluss: 200_000 },
          { kind: "kapital", label: "Stammkapital und Darlehen", count: 1, zufluss: 1_000_000, abfluss: 0 },
          { kind: "ertragsteuern", label: "Körperschaft- und Gewerbesteuer", count: 3, zufluss: 0, abfluss: 820_000 },
        ]);
        // Auch der neutrale Bescheid ohne Datei fällt auf; Buchungen ohne Beleg brauchen keine
        expect(year.withoutFile).toBe(3);
        expect(year.checks[0]!.detail).toBe("3 Belege, 5 Buchungen ohne Beleg");
        expect(year.vat.find((m) => m.month === kz81Month)).toMatchObject({ kz81: 100_000 });
        expect(year.vat.find((m) => m.month === "2025-03")).toMatchObject({ kz66: 1_900 });

        // Für KI-Assistenten dieselbe Einordnung
        const period = await lexoffice.legacyVouchersForPeriod({ period: "2025", direction: "alle", search: "", withPayments: true, limit: 50 });
        expect(period.vouchers.map((v) => v.net).sort((a, b) => a - b)).toEqual([5_000, 10_000, 100_000]);
        expect(period.neutral.map((n) => [n.kind, n.count])).toEqual([
          ["gesellschafter", 1],
          ["kapital", 1],
          ["ertragsteuern", 3],
        ]);
        // Die Rohdaten bleiben, wie sie abgerufen wurden
        const [raw] = await sql`select count(*)::int as n from lexoffice_vouchers where raw->>'privat' = 'true'`;
        expect(raw!.n).toBe(1);
      });

      it("GmbH: ein Beleg mit Umsatzsteuer bleibt in der Umsatzsteuer je Monat, auch mit „privat“ im Namen", async () => {
        await setup("gmbh", kontenrahmen, versteuerung);
        await voucher({ direction: "einnahme", category: "Private Kfz-Nutzung", net: 50_000, tax: 9_500, paidOn: "2025-04-05" });
        const { years } = await lexoffice.reconciliation();
        const year = years.find((y) => y.year === 2025)!;
        expect(year.einnahmen).toEqual({ count: 2, net: 150_000, tax: 28_500, gross: 178_500 });
        expect(year.vat.find((m) => m.month === kz81Month)).toMatchObject({ kz81: 150_000 });
        const period = await lexoffice.legacyVouchersForPeriod({ period: "2025", direction: "einnahme", search: "", withPayments: true, limit: 50 });
        expect(period.vouchers.map((v) => v.net).sort((a, b) => a - b)).toEqual([50_000, 100_000]);
      });
    });
  });
});
