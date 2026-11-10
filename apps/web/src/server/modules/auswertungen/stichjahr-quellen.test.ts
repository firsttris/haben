import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}
const eingang = (date: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Nordwerk",
  "Testfirma",
  "Zahlung",
  "Eingang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];

/* Review #586: „Der Abgleich zeigt keine Abweichung, die Zahlen bleiben dieselben“ */
describe.skipIf(!testDatabaseUrl)("Stichjahr vorziehen nur, wenn beide Quellen dasselbe ergeben (Postgres)", () => {
  let sql: postgres.Sql;
  let stichjahr: typeof import("./stichjahr.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let bank: typeof import("../bank/bank.ts");
  const actor = "test-user";
  const today = "2026-10-04";

  beforeAll(async () => {
    sql = await setupTestDb();
    stichjahr = await import("./stichjahr.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    figures = await import("../umsatzsteuer/vat-figures.ts");
    bank = await import("../bank/bank.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await sql`truncate vat_return_submissions, vat_returns, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, 2027)`;
  }

  async function invoice(issueDate: string) {
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "a@b.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: 10_000, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  const kennzahlen = (f: Awaited<ReturnType<typeof figures.computeVatFigures>>) => ({ kz81: f.kz81, tax81: f.tax81, kz66: f.kz66 });

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    it(`Ist: Zahlung im laufenden Jahr vor dem Update gebucht (ohne Bemessungsgrundlage); vorziehbar heißt: Kz 81 bleibt (${kontenrahmen})`, async () => {
      await reset(kontenrahmen, "ist");
      const inv = await invoice("2026-09-20");
      await bank.importStatement(actor, { bytes: dkbCsv([eingang("01.10.2026", "119,00")]), filename: `${crypto.randomUUID()}.csv` }, null);
      const [t] = await sql<{ id: string }[]>`select id from bank_transactions`;
      await bank.allocate(actor, { kind: "invoice", transactionId: t!.id, invoiceId: inv.id, amount: 11_900 });
      // Wie vor #552 gebucht (bestehende Instanz, Stichjahr per Migration 0192 auf 2027): Zahlung ohne Bemessungsgrundlage
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`update journal_lines set basis = null where entry_id in (select id from journal_entries where source_type = 'allocation')`;
      });
      const vorher = kennzahlen(await figures.computeVatFigures({ year: 2026, month: 10 }));
      expect(vorher.kz81).toBe(10_000);
      const stand = await stichjahr.stichjahrStand(today);
      if (stand.vorziehbar) {
        await stichjahr.stichjahrVorziehen(actor, today);
        const nachher = await figures.computeVatFigures({ year: 2026, month: 10 });
        expect(nachher.quelle).toBe("journal");
        expect(kennzahlen(nachher)).toEqual(vorher);
      }
    }, 60_000);
  }

  async function special(taxTreatment: "ausfuhr" | "steuerfrei", land: string, issueDate: string) {
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: `Kunde ${taxTreatment}`,
      strasse: "Ring 1",
      plz: "1010",
      ort: "Ort",
      land,
      email: "a@b.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      taxTreatment,
      exemptionReason: taxTreatment === "steuerfrei" ? "Steuerfrei nach § 4 Nr. 21 UStG" : "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: 50_000, taxRate: 0 }],
    } as never);
    return invoices.finalizeInvoice(actor, draft.id);
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    it(`Ist: Ausfuhr und steuerfrei, im laufenden Jahr bezahlt; vorziehbar heißt: alle Kennzahlen bleiben (${kontenrahmen})`, async () => {
      await reset(kontenrahmen, "ist");
      const a = await special("ausfuhr", "US", "2026-09-10");
      const b = await special("steuerfrei", "DE", "2026-09-11");
      await bank.importStatement(
        actor,
        { bytes: dkbCsv([eingang("01.10.2026", "500,00"), eingang("02.10.2026", "500,00")]), filename: `${crypto.randomUUID()}.csv` },
        null,
      );
      const ts = await sql<{ id: string }[]>`select id from bank_transactions order by booking_date`;
      await bank.allocate(actor, { kind: "invoice", transactionId: ts[0]!.id, invoiceId: a.id, amount: 50_000 });
      await bank.allocate(actor, { kind: "invoice", transactionId: ts[1]!.id, invoiceId: b.id, amount: 50_000 });
      const periode = { year: 2026, month: 10 };
      const vorher = await figures.computeVatFigures(periode);
      const stand = await stichjahr.stichjahrStand(today);
      expect(stand.vorziehbar).toBe(true);
      await stichjahr.stichjahrVorziehen(actor, today);
      const nachher = await figures.computeVatFigures(periode);
      const felder = Object.keys(nachher.nebenbuecher!) as (keyof typeof vorher)[];
      expect(Object.fromEntries(felder.map((f) => [f, nachher[f]]))).toEqual(Object.fromEntries(felder.map((f) => [f, vorher[f]])));
    }, 60_000);
  }
});
