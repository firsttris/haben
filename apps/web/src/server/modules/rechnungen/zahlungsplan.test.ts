import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Angebot mit optionalen und alternativen Positionen, Rabatten und Zahlungsplan: Summe ohne die Wahlpositionen, Auswahl des
 * Kunden bei der Annahme, Abschläge per Klick je Zeile des Plans, anteilig je Steuersatz, Übersicht mit Status und
 * Fortschritt, Schlussrechnung über den Rest. Gebucht für SKR03 und SKR04, Soll und Ist.
 */
describe.skipIf(!testDatabaseUrl)("Angebot mit Wahlpositionen und Zahlungsplan (Postgres)", () => {
  let quotes: typeof import("./quotes.ts");
  let plan: typeof import("./quote-plan.ts");
  let orders: typeof import("./order-documents.ts");
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  const line = (description: string, unitPrice: number, taxRate: 1900 | 700, kind: "optional" | "alternative" | null = null) => ({
    description,
    quantity: 1000,
    unit: "Psch." as const,
    unitPrice,
    taxRate,
    kind,
  });

  /** 7.000 € zu 19 % (oder als Alternative 8.000 €), 3.000 € zu 7 %, optional 500 € Schulung; Plan 30 % / 2.000 € / Rest */
  const draft = (overrides: Record<string, unknown> = {}) => ({
    contactId,
    issueDate: "2026-10-01",
    validUntil: "2026-10-31",
    serviceFrom: null,
    serviceTo: null,
    note: "",
    lines: [
      line("Software", 700_000, 1900),
      line("Software mit Wartung", 800_000, 1900, "alternative"),
      line("Druckwerke", 300_000, 700),
      line("Schulung", 50_000, 1900, "optional"),
    ],
    paymentPlan: [
      { label: "Anzahlung", share: { kind: "prozent", value: 3000 }, due: "Auftragserteilung" },
      { label: "Abschlag", share: { kind: "betrag", value: 200_000 }, due: "Lieferung" },
      { label: "Schlussrechnung", share: { kind: "rest" }, due: "Abnahme" },
    ],
    paymentPlanInConfirmation: true,
    ...overrides,
  });

  const finalQuote = async (overrides: Record<string, unknown> = {}) =>
    quotes.finalizeQuote(actor, (await quotes.createQuoteDraft(actor, draft(overrides))).id);

  beforeAll(async () => {
    sql = await setupTestDb();
    quotes = await import("./quotes.ts");
    plan = await import("./quote-plan.ts");
    orders = await import("./order-documents.ts");
    invoices = await import("./invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  const setup = async (kontenrahmen: "SKR03" | "SKR04" = "SKR03", versteuerung: "soll" | "ist" = "soll") => {
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

  const invoiceLines = async (invoiceId: string) =>
    (await sql`select description, unit_price, tax_rate from invoice_lines where invoice_id = ${invoiceId} order by position`).map((l) => [
      l.description,
      l.unit_price,
      l.tax_rate,
    ]);

  describe("Wahlpositionen", () => {
    beforeEach(() => setup());

    it("optionale und alternative Positionen zählen nicht zur Angebotssumme und sind gekennzeichnet gespeichert", async () => {
      const quote = await finalQuote();
      expect(quote).toMatchObject({ net: 1_000_000, tax: 154_000, gross: 1_154_000 });
      const kinds = await sql`select position, kind from quote_lines where quote_id = ${quote.id} order by position`;
      expect(kinds.map((k) => k.kind)).toEqual([null, "alternative", null, "optional"]);
      await expect(sql`update quote_lines set kind = null where quote_id = ${quote.id}`).rejects.toThrow(/festgeschrieben/);
    }, 30_000);

    it("Auswahl bei der Annahme: Rechnung und Auftragsbestätigung nur mit den gewählten Positionen, danach fest", async () => {
      const quote = await finalQuote({ paymentPlan: [] });
      await expect(quotes.setQuoteDecision(actor, quote.id, "angenommen", [2, 3])).rejects.toThrow(/Position 3 ist weder optional noch Alternative/);
      await quotes.setQuoteDecision(actor, quote.id, "angenommen", [2, 4]);
      const confirmation = await orders.confirmationPdf(quote.id);
      expect(Buffer.from(confirmation.pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");

      const invoice = await quotes.quoteToInvoice(actor, quote.id, "2026-10-10");
      expect(await invoiceLines(invoice.id)).toEqual([
        ["Software mit Wartung", 800_000, 1900],
        ["Druckwerke", 300_000, 700],
        ["Schulung", 50_000, 1900],
      ]);
      await invoices.finalizeInvoice(actor, invoice.id);
      // Mit festgeschriebener Rechnung ist die Auswahl fest, auch direkt in der Datenbank
      await expect(sql`delete from quote_choices where quote_id = ${quote.id}`).rejects.toThrow(/Auswahl ist fest/);
      await expect(sql`insert into quote_choices (quote_id, position) values (${quote.id}, 2)`).rejects.toThrow(/Auswahl ist fest/);
    }, 30_000);

    it("ohne Auswahl gelten die Hauptpositionen", async () => {
      const quote = await finalQuote({ paymentPlan: [] });
      const invoice = await quotes.quoteToInvoice(actor, quote.id, "2026-10-10");
      expect((await invoiceLines(invoice.id)).map((l) => l[0])).toEqual(["Software", "Druckwerke"]);
    }, 30_000);

    it("Rabatte des Angebots gehen in die Rechnung über", async () => {
      const quote = await finalQuote({
        paymentPlan: [],
        lines: [{ ...line("Software", 700_000, 1900), discount: { kind: "prozent", value: 1000 } }, line("Druckwerke", 300_000, 700)],
        discount: { kind: "betrag", value: 10_000 },
      });
      // 6.300 € + 3.000 € = 9.300 €, abzüglich 100 € im Verhältnis 63 : 30
      expect(quote).toMatchObject({ net: 920_000, discountAmount: 10_000 });
      const invoice = await quotes.quoteToInvoice(actor, quote.id, "2026-10-10");
      expect(invoice).toMatchObject({ net: 920_000, gross: quote.gross, discountAmount: 10_000 });
    }, 30_000);
  });

  describe("Zahlungsplan prüfen", () => {
    beforeEach(() => setup());

    it("Summe des Plans über dem Angebotsbetrag wird nicht gespeichert", () => {
      const parsed = quotes.quoteDraftSchema.safeParse(
        draft({
          paymentPlan: [
            { label: "Anzahlung", share: { kind: "prozent", value: 9000 }, due: "" },
            { label: "Abschlag", share: { kind: "betrag", value: 100_001 }, due: "" },
            { label: "Rest", share: { kind: "rest" }, due: "" },
          ],
        }),
      );
      expect(parsed.error?.issues.map((i) => i.message)).toEqual(["Der Zahlungsplan übersteigt den Angebotsbetrag (10.000,01 € von 10.000,00 €)"]);
    });
  });

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["soll", "ist"] as const) {
      describe(`Abschläge aus dem Plan, ${kontenrahmen}, ${versteuerung === "soll" ? "Soll" : "Ist"}`, () => {
        beforeEach(() => setup(kontenrahmen, versteuerung));

        it("je Zeile eine Abschlagsrechnung anteilig je Steuersatz, Übersicht mit Status und Fortschritt, Schlussrechnung über den Rest", async () => {
          const quote = await finalQuote();
          let overview = await plan.quotePlanOverview(quote.id, "2026-10-10");
          expect(overview!.rows.map((r) => [r.net, r.gross, r.status])).toEqual([
            [300_000, 346_200, "offen"],
            [200_000, 230_800, "offen"],
            [500_000, 577_000, "offen"],
          ]);

          // 30 %: je Satz 30 % (2.100 € und 900 €); 2.000 € fest im Verhältnis 7.000 : 3.000
          const first = await plan.abschlagFromPlan(actor, quote.id, "2026-10-10", 0, null);
          expect(first).toMatchObject({ variant: "abschlag", quoteId: quote.id, paymentPlanRow: 0, net: 300_000, gross: 346_200 });
          expect(await invoiceLines(first.id)).toEqual([
            ["1. Anzahlung 30 % gemäß Angebot AN-2026-001 vom 01.10.2026", 210_000, 1900],
            ["1. Anzahlung 30 % gemäß Angebot AN-2026-001 vom 01.10.2026", 90_000, 700],
          ]);
          await expect(plan.abschlagFromPlan(actor, quote.id, "2026-10-10", 0, null)).rejects.toThrow(/Zu Zeile 1 gibt es schon einen Entwurf/);
          await expect(plan.abschlagFromPlan(actor, quote.id, "2026-10-10", 2, null)).rejects.toThrow(/Schlussrechnung/);
          overview = await plan.quotePlanOverview(quote.id, "2026-10-10");
          expect(overview!.rows[0]!.status).toBe("entwurf");

          await invoices.finalizeInvoice(actor, first.id);
          const second = await plan.abschlagFromPlan(actor, quote.id, "2026-11-10", 1, null);
          expect(await invoiceLines(second.id)).toEqual([
            ["2. Abschlag gemäß Angebot AN-2026-001 vom 01.10.2026", 140_000, 1900],
            ["2. Abschlag gemäß Angebot AN-2026-001 vom 01.10.2026", 60_000, 700],
          ]);
          await invoices.finalizeInvoice(actor, second.id);
          overview = await plan.quotePlanOverview(quote.id, "2026-11-10");
          expect(overview!.rows.map((r) => r.status)).toEqual(["festgeschrieben", "festgeschrieben", "offen"]);
          expect(overview!.progress).toEqual({ billed: 577_000, total: 1_154_000, open: 577_000, percent: 5000 });

          // Gebucht je Satz wie eine Rechnung
          const posted = await sql`select l.account, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
            where e.source_id = ${first.id} and l.credit > 0 order by l.account`;
          const erloese = kontenrahmen === "SKR03" ? ["8300", "8400"] : ["4300", "4400"];
          expect(posted.filter((p) => erloese.includes(p.account)).map((p) => [p.account, p.credit])).toEqual([
            [erloese[0], 90_000],
            [erloese[1], 210_000],
          ]);

          // Rest: die Schlussrechnung zieht die Abschläge dieses Angebots ab
          const schluss = await quotes.quoteToInvoice(actor, quote.id, "2026-12-01", "schluss");
          const final = await invoices.finalizeInvoice(actor, schluss.id);
          expect(final).toMatchObject({ net: 500_000, gross: 577_000 });
          overview = await plan.quotePlanOverview(quote.id, "2026-12-01");
          expect(overview!.rows[2]!.status).toBe("festgeschrieben");
          expect(overview!.progress).toMatchObject({ billed: 1_154_000, open: 0, percent: 10_000 });
        }, 60_000);
      });
    }
  }

  describe("Zahlungsplan mit Auswahl und Bruttopreisen", () => {
    beforeEach(() => setup());

    it("Plan auf den Auftrag nach der Auswahl; Bruttobeträge fest, Verhältnis nach Netto", async () => {
      const quote = await finalQuote({
        priceMode: "brutto",
        lines: [line("Software", 833_000, 1900), line("Druckwerke", 321_000, 700), line("Schulung", 59_500, 1900, "optional")],
        paymentPlan: [
          { label: "Anzahlung", share: { kind: "betrag", value: 100_000 }, due: "Auftragserteilung" },
          { label: "Schlussrechnung", share: { kind: "rest" }, due: "Abnahme" },
        ],
      });
      // Auswahl beim Erstellen des Abschlags: mit Schulung
      const first = await plan.abschlagFromPlan(actor, quote.id, "2026-10-10", 0, [3]);
      expect(await quotes.getQuote(quote.id).then((d) => d!.choices)).toEqual([3]);
      expect(first).toMatchObject({ priceMode: "brutto", gross: 100_000 });
      // Netto 7.500 € (Software und Schulung) : 3.000 € → 71.429 und 28.571 brutto
      expect((await invoiceLines(first.id)).map((l) => [l[1], l[2]])).toEqual([
        [71_429, 1900],
        [28_571, 700],
      ]);
      const overview = await plan.quotePlanOverview(quote.id, "2026-10-10");
      expect(overview!.progress.total).toBe(833_000 + 321_000 + 59_500);
    }, 30_000);
  });
});
