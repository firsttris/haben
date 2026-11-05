import type { PaymentPlanRow } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Schlussrechnung mit Gesamtrabatt: Die Abzüge der Abschlagsrechnungen zählen nicht zur Grundlage des Gesamtrabatts
 * (rabatt.ts, discountBasis). Storno und Rechnungskorrektur müssen dieselbe Grundlage nehmen, sonst hebt das Storno die
 * Schlussrechnung nicht auf den Cent auf. Für SKR03 und SKR04, Soll und Ist.
 */
describe.skipIf(!testDatabaseUrl)("Schlussrechnung mit Gesamtrabatt (Postgres)", () => {
  let quotes: typeof import("./quotes.ts");
  let plan: typeof import("./quote-plan.ts");
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  const line = (description: string, unitPrice: number, taxRate: 1900 | 700) => ({ description, quantity: 1000, unit: "Psch." as const, unitPrice, taxRate });

  beforeAll(async () => {
    sql = await setupTestDb();
    quotes = await import("./quotes.ts");
    plan = await import("./quote-plan.ts");
    invoices = await import("./invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  const setup = async (kontenrahmen: "SKR03" | "SKR04", versteuerung: "soll" | "ist") => {
    await sql`truncate quote_choices, quote_lines, quotes, quote_number_counters, journal_lines, journal_entries, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, ust_id, bundesland, iban, bic, bank, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'DE123456789', 'BY',
              'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank', ${versteuerung}, ${kontenrahmen})`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Beispiel GmbH",
      strasse: "Hafenweg 3",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "buchhaltung@beispiel.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = contact.id;
  };

  const storedTaxes = async (invoiceId: string) =>
    (await sql`select rate, base, tax from invoice_taxes where invoice_id = ${invoiceId} order by rate desc`).map((r) => ({ ...r }));

  /** 7.000 € zu 19 %, 3.000 € zu 7 %, Gesamtrabatt 10 %; Plan 30 % / Rest; Anzahlung festgeschrieben, Schlussrechnung festgeschrieben */
  const finalSchluss = async () => {
    const quote = await quotes.finalizeQuote(
      actor,
      (
        await quotes.createQuoteDraft(actor, {
          contactId,
          issueDate: "2026-10-01",
          validUntil: "2026-10-31",
          serviceFrom: null,
          serviceTo: null,
          note: "",
          lines: [line("Software", 700_000, 1900), line("Druckwerke", 300_000, 700)],
          discount: { kind: "prozent", value: 1000 },
          paymentPlan: [
            { label: "Anzahlung", share: { kind: "prozent", value: 3000 }, due: "Auftragserteilung" },
            { label: "Schlussrechnung", share: { kind: "rest" }, due: "Abnahme" },
          ] as PaymentPlanRow[],
        })
      ).id,
    );
    await invoices.finalizeInvoice(actor, (await plan.abschlagFromPlan(actor, quote.id, "2026-10-10", 0, null)).id);
    const schluss = await invoices.finalizeInvoice(actor, (await quotes.quoteToInvoice(actor, quote.id, "2026-12-01", "schluss")).id);
    // 9.000 € nach 10 % Rabatt, davon 2.700 € als Anzahlung abgezogen: 6.300 € netto bleiben
    expect(schluss).toMatchObject({ net: 630_000, discountPercent: 1000 });
    return schluss;
  };

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["soll", "ist"] as const) {
      describe(`${kontenrahmen}, ${versteuerung === "soll" ? "Soll" : "Ist"}`, () => {
        beforeEach(() => setup(kontenrahmen, versteuerung));

        it("Storno einer Schlussrechnung mit Gesamtrabatt hebt sie auf den Cent auf", async () => {
          const schluss = await finalSchluss();
          const storno = await invoices.cancelInvoice(actor, schluss.id, "2026-12-05");
          expect(storno).toMatchObject({ net: -schluss.net, tax: -schluss.tax, gross: -schluss.gross });
          expect(await storedTaxes(storno.id)).toEqual((await storedTaxes(schluss.id)).map((t) => ({ ...t, base: -t.base, tax: -t.tax })));
          const balance = await sql`select l.account, sum(l.debit - l.credit)::int as saldo from journal_lines l join journal_entries e on e.id = l.entry_id
            where e.source_id in (${schluss.id}, ${storno.id}) group by l.account having sum(l.debit - l.credit) <> 0`;
          expect(balance).toEqual([]);
          // Nach dem Storno ist die Anzahlung wieder offen für eine neue Schlussrechnung
          expect((await invoices.openAbschlaege()).map((a) => a.net)).toEqual([270_000]);
        }, 60_000);
      });
    }
  }

  describe("Rechnungskorrektur", () => {
    beforeEach(() => setup("SKR03", "soll"));

    it("Korrektur einer Schlussrechnung mit Gesamtrabatt übernimmt sie zunächst genau negiert", async () => {
      const schluss = await finalSchluss();
      const correction = await invoices.createCorrection(actor, schluss.id, "2026-12-05");
      expect(correction).toMatchObject({ net: -schluss.net, tax: -schluss.tax, gross: -schluss.gross });

      // Speichern im Editor: Er schickt nur die eigenen Positionen, die übernommenen Abzüge bleiben
      const lines = await sql`select description, quantity, unit, unit_price, tax_rate from invoice_lines
        where invoice_id = ${correction.id} and deduction_of is null order by position`;
      const saved = await invoices.updateDraft(actor, correction.id, {
        contactId,
        issueDate: "2026-12-05",
        serviceFrom: null,
        serviceTo: null,
        paymentTermDays: 0,
        format: correction.format,
        note: "",
        discount: { kind: "prozent", value: 1000 },
        lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unit_price, taxRate: l.tax_rate })),
      });
      expect(saved).toMatchObject({ net: -schluss.net, gross: -schluss.gross });
      const final = await invoices.finalizeInvoice(actor, correction.id);
      expect(final).toMatchObject({ status: "final", net: -schluss.net });
      // Die Anzahlung bleibt in der Schlussrechnung abgezogen
      expect(await invoices.openAbschlaege()).toEqual([]);
    }, 60_000);
  });
});
