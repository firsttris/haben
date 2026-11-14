import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Anzeige nach einer Verrechnung (#877, Etappe 2): Der offene Rest einer Ausgangsrechnung muss überall stimmen, nicht nur
 * in der Buchung. Anlass: Rechnung 159,00 €, Teilgutschrift −17,50 € — die Anzeige nannte weiter 159,00 €, erwartet sind
 * 141,50 €. Geprüft wird jede Lesestelle: Rechnungsliste und Belegseite (listInvoices), Mahnwesen (overdueInvoices und
 * Entwurf), offene Posten der Auswertungen und die Anzeige am Beleg selbst (invoiceSettlementView).
 */
describe.skipIf(!testDatabaseUrl)("Anzeige nach einer Verrechnung (Postgres)", () => {
  let invoices: typeof import("./invoices.ts");
  let verrechnung: typeof import("./verrechnung.ts");
  let dunning: typeof import("./dunning.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let bank: typeof import("../bank/bank.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    verrechnung = await import("./verrechnung.ts");
    dunning = await import("./dunning.ts");
    reports = await import("../auswertungen/reports.ts");
    contacts = await import("../stammdaten/contacts.ts");
    bank = await import("../bank/bank.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Festgeschriebene Rechnung mit einer Zeile, brutto = netto × 1,19; eine Korrektur hängt an `correctsFor` */
  async function beleg(art: "rechnung" | "korrektur", netto: number, issueDate: string, correctsFor?: string): Promise<string> {
    const draft = await invoices.createDraft(
      actor,
      {
        contactId,
        issueDate,
        serviceFrom: null,
        serviceTo: null,
        paymentTermDays: 14,
        format: "zugferd",
        note: "",
        lines: [{ description: "Beratung", quantity: 1000, unit: "Psch.", unitPrice: netto, taxRate: 1900 }],
      },
      art === "korrektur" ? { kind: "korrektur", correctsId: correctsFor! } : {},
    );
    return (await invoices.finalizeInvoice(actor, draft.id)).id;
  }

  /** Rechnung 159,00 EUR mit Korrektur -17,50 EUR: der Fall aus dem Issue */
  async function paar(): Promise<{ rechnung: string; korrektur: string }> {
    const rechnung = await beleg("rechnung", 13_361, "2026-09-01");
    const korrektur = await beleg("korrektur", -1_471, "2026-11-10", rechnung);
    return { rechnung, korrektur };
  }

  /** Zahlungseingang auf die Rechnung über die Bank, wie aus dem Kontoauszug */
  async function zahle(invoiceId: string, betrag: number, datum: string): Promise<void> {
    const [konto] = await sql`insert into bank_accounts (name, iban, purpose) values ('Geschäftskonto', 'DE89370400440532013000', 'geschaeft') returning id`;
    const [import_] = await sql`
      insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${(konto as { id: string }).id}, 'umsatz.csv', ${"a".repeat(64)}, 'swan', 1, 0) returning id`;
    const [umsatz] = await sql`
      insert into bank_transactions (bank_account_id, import_id, booking_date, amount, counterparty_name, dedup_hash)
      values (${(konto as { id: string }).id}, ${(import_ as { id: string }).id}, ${datum}, ${betrag}, 'Nordwerk Software GmbH', ${`h${datum}${betrag}`})
      returning id`;
    await bank.allocate(actor, { kind: "invoice", transactionId: (umsatz as { id: string }).id, invoiceId, amount: betrag });
  }

  /** Der offene Rest an jeder Lesestelle, die eine Rechnung anzeigt */
  async function anzeigen(invoiceId: string) {
    const [liste] = await invoices.listInvoices("2026-11-20", invoiceId);
    const mahnwesen = (await dunning.overdueInvoices("2026-11-20")).find((i) => i.id === invoiceId);
    const entwurf = await dunning.dunningDraft(invoiceId, "2026-11-20");
    const posten = (await reports.openPositions("2026-11-20")).receivables.find((p) => p.id === invoiceId);
    return { liste: liste!.open, mahnwesen: mahnwesen?.open ?? null, entwurf: entwurf?.invoice.open ?? null, posten: posten?.open ?? null };
  }

  beforeEach(async () => {
    await leeren(sql)`truncate invoice_settlements, dunnings, journal_lines, journal_entries, allocations, write_offs,
      cash_entries, invoice_taxes, invoice_lines, invoices, invoice_number_counters, bank_transactions, bank_imports,
      bank_accounts, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, payment_term_days, dunning)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'soll', 'SKR03', 14,
              '{"baseRate": 127, "fees": {"1": 0, "2": 500, "3": 1000}, "deadlineDays": 10}'::jsonb)`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "10001",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "rechnung@nordwerk.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = contact.id;
  }, 60_000);

  it("zeigt nach der Verrechnung überall 141,50 EUR offen statt 159,00 EUR", async () => {
    const { rechnung, korrektur } = await paar();
    // Vor der Verrechnung: Liste und offene Posten nennen 159,00 €, gemahnt werden schon 141,50 € — eine
    // festgeschriebene Korrektur mindert die Forderung, auch bevor jemand sie verrechnet (dunning.ts, owed())
    expect(await anzeigen(rechnung)).toEqual({ liste: 15_900, mahnwesen: 14_150, entwurf: 14_150, posten: 15_900 });

    await verrechnung.settleInvoices(actor, {
      invoiceId: rechnung,
      counterInvoiceId: korrektur,
      amount: 1_750,
      date: "2026-11-12",
      note: "Rechnungskorrektur 2026-002",
    });

    // Der Belegbetrag bleibt 159,00 EUR, der offene Rest sinkt an jeder Stelle auf 141,50 EUR
    expect((await invoices.listInvoices("2026-11-20", rechnung))[0]).toMatchObject({ gross: 15_900, open: 14_150 });
    expect(await anzeigen(rechnung)).toEqual({ liste: 14_150, mahnwesen: 14_150, entwurf: 14_150, posten: 14_150 });
    // Die Korrektur gilt als erledigt und wird nicht noch einmal als offen geführt
    expect((await invoices.listInvoices("2026-11-20", korrektur))[0]?.open).toBe(0);
    expect((await reports.openPositions("2026-11-20")).receivables.map((p) => p.id)).not.toContain(korrektur);
  }, 60_000);

  it("zeigt 41,50 EUR offen, wenn 100,00 EUR bezahlt und dann 17,50 EUR verrechnet sind", async () => {
    const { rechnung, korrektur } = await paar();
    await zahle(rechnung, 10_000, "2026-11-11");
    // 159,00 − 100,00 in der Liste, gemahnt abzüglich der offenen Korrektur: 59,00 − 17,50
    expect(await anzeigen(rechnung)).toEqual({ liste: 5_900, mahnwesen: 4_150, entwurf: 4_150, posten: 5_900 });

    await verrechnung.settleInvoices(actor, {
      invoiceId: rechnung,
      counterInvoiceId: korrektur,
      amount: 1_750,
      date: "2026-11-12",
      note: "Rechnungskorrektur 2026-002",
    });

    // Zahlung und Verrechnung stehen nebeneinander: 159,00 − 100,00 − 17,50
    expect(await anzeigen(rechnung)).toEqual({ liste: 4_150, mahnwesen: 4_150, entwurf: 4_150, posten: 4_150 });
    expect((await invoices.listInvoices("2026-11-20", rechnung))[0]?.paid).toBe(11_750);
  }, 60_000);

  it("bietet am Beleg die offene Korrektur an, nennt die Zeile der Verrechnung und nimmt beides beim Aufheben zurück", async () => {
    const { rechnung, korrektur } = await paar();

    // Vor der Verrechnung: die Korrektur ist der Gegenbeleg, mit ihrem Guthaben als Rest
    const vorher = await verrechnung.invoiceSettlementView(rechnung);
    expect(vorher).toMatchObject({ open: 15_900, kind: "rechnung", status: "final", currency: "EUR", settlements: [] });
    expect(vorher.candidates).toEqual([expect.objectContaining({ id: korrektur, kind: "korrektur", rest: -1_750, gross: -1_750 })]);

    const { ids } = await verrechnung.settleInvoices(actor, {
      invoiceId: rechnung,
      counterInvoiceId: korrektur,
      amount: 1_750,
      date: "2026-11-12",
      note: "Rechnungskorrektur 2026-002",
    });
    // Danach ist nichts mehr zu verrechnen: die Korrektur steht auf 0
    const nachher = await verrechnung.invoiceSettlementView(rechnung);
    expect(nachher.open).toBe(14_150);
    expect(nachher.candidates).toEqual([]);
    expect(nachher.settlements[0]).toMatchObject({ amount: 1_750, date: "2026-11-12", counterNumber: expect.any(String), counterKind: "korrektur" });

    // Auch von der Korrektur aus ist die Rechnung nach der Verrechnung kein Gegenbeleg mehr
    expect((await verrechnung.invoiceSettlementView(korrektur)).candidates).toEqual([]);

    await verrechnung.reverseInvoiceSettlement(actor, ids[0]!, "2026-11-13", "falsch erfasst");
    const zurueck = await verrechnung.invoiceSettlementView(rechnung);
    expect(zurueck.open).toBe(15_900);
    // Die Gegenzeile bleibt sichtbar, die aufgehobene Verrechnung nicht mehr als offener Gegenbeleg
    expect(zurueck.settlements.filter((s) => s.reversesId !== null)).toHaveLength(1);
    expect(zurueck.candidates).toEqual([expect.objectContaining({ id: korrektur, rest: -1_750 })]);
  }, 60_000);

  it("verrechnet eine Korrektur nicht doppelt: Mahnwesen mahnt den Rest nur einmal", async () => {
    const { rechnung, korrektur } = await paar();
    const teil = await beleg("korrektur", -1_471, "2026-11-11", rechnung);
    await verrechnung.settleInvoices(actor, {
      invoiceId: rechnung,
      counterInvoiceId: korrektur,
      amount: 1_750,
      date: "2026-11-12",
      note: "Rechnungskorrektur 2026-002",
    });
    // Eine zweite, noch offene Korrektur mindert den Rest zusätzlich — die verrechnete nicht noch einmal
    expect((await verrechnung.invoiceSettlementView(rechnung)).candidates).toEqual([expect.objectContaining({ id: teil, rest: -1_750 })]);
    // Die verrechnete Korrektur zählt nicht doppelt (sie steht selbst auf 0, die Rechnung kennt die 17,50 € bereits).
    // Die zweite, noch offene Korrektur mindert den gemahnten Betrag dagegen zusätzlich: gemahnt wird der Rest aus
    // Rechnung und offenen Korrekturen, wie in der Rechnungsliste getrennt ausgewiesen (14_150 − 1_750 = 12_400).
    expect((await anzeigen(rechnung)).mahnwesen).toBe(12_400);
  }, 60_000);
});
