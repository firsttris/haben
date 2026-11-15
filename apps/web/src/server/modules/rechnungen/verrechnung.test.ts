import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Verrechnung einer Ausgangsrechnung mit ihrer Kundenkorrektur ohne Zahlung (#877, zweite Stufe aus #274).
 * Anlass: Rechnung 159,00 EUR, Teilgutschrift -17,50 EUR — der offene Posten blieb bei 159,00 EUR stehen.
 * Die Rechnung behält ihren Betrag, ihr offener Rest sinkt auf 141,50 EUR, und die Korrektur gilt als erledigt.
 */
describe.skipIf(!testDatabaseUrl)("Verrechnung von Ausgangsrechnung und Kundenkorrektur (Postgres)", () => {
  let invoices: typeof import("./invoices.ts");
  let verrechnung: typeof import("./verrechnung.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let bank: typeof import("../bank/bank.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    verrechnung = await import("./verrechnung.ts");
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

  /** Buchungen einer Verrechnung: Quelle, Tag, Konto, Soll, Haben */
  async function buchungen() {
    const rows = await sql<
      { source_id: string; date: string; account: string; debit: number; credit: number; reverses_id: string | null }[]
    >`select je.source_id, je.date, jl.account, jl.debit, jl.credit, je.reverses_id
        from journal_entries je join journal_lines jl on jl.entry_id = je.id
       where je.source_type = 'verrechnung'
       order by je.date, jl.account, jl.credit`;
    return [...rows];
  }

  /** Saldo je Konto aus den Verrechnungsbuchungen: Soll minus Haben */
  async function salden() {
    const rows = await sql<{ account: string; saldo: string }[]>`select jl.account, sum(jl.debit) - sum(jl.credit) as saldo
        from journal_entries je join journal_lines jl on jl.entry_id = je.id
       where je.source_type = 'verrechnung' group by 1 order by 1`;
    return new Map([...rows].map((r) => [r.account, Number(r.saldo)]));
  }

  async function offen(id: string): Promise<number> {
    const [row] = await invoices.listInvoices("2026-11-20", id);
    return row!.open;
  }

  beforeEach(async () => {
    await leeren(sql)`truncate invoice_settlements, dunnings, journal_lines, journal_entries, allocations, write_offs,
      cash_entries, invoice_taxes, invoice_lines, invoices, invoice_number_counters, bank_transactions, bank_imports,
      bank_accounts, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'soll', 'SKR03', 14)`;
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

  it("verrechnet die Korrektur gegen die Rechnung: Rest 141,50 EUR, Verrechnungskonto auf null", async () => {
    const { rechnung, korrektur } = await paar();
    expect(await offen(rechnung)).toBe(15_900);
    expect(await offen(korrektur)).toBe(-1_750);

    const { ids } = await verrechnung.settleInvoices(actor, {
      invoiceId: rechnung,
      counterInvoiceId: korrektur,
      amount: 1_750,
      date: "2026-11-12",
      note: "Rechnungskorrektur 2026-002",
    });

    // Der Belegbetrag bleibt stehen, nur der offene Rest sinkt; die Korrektur ist erledigt
    const [liste] = await invoices.listInvoices("2026-11-20", rechnung);
    expect(liste).toMatchObject({ gross: 15_900, open: 14_150 });
    expect(await offen(korrektur)).toBe(0);

    const zeilen = await verrechnung.listInvoiceSettlements(rechnung);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]).toMatchObject({ amount: 1_750, counterInvoiceId: korrektur, counterKind: "korrektur" });

    // Zwei Buchungen, je Seite eine: Forderungen gegen Verrechnungskonto, zusammen auf null
    const gebucht = await buchungen();
    expect(gebucht).toHaveLength(4);
    expect(new Set(gebucht.map((b) => b.source_id))).toEqual(new Set(ids));
    expect(gebucht.every((b) => b.date === "2026-11-12" && b.reverses_id === null)).toBe(true);
    expect(gebucht.filter((b) => b.account === "1400").map((b) => [b.debit, b.credit])).toEqual(
      expect.arrayContaining([
        [0, 1_750],
        [1_750, 0],
      ]),
    );
    expect(gebucht.filter((b) => b.account === "1590").map((b) => [b.debit, b.credit])).toEqual(
      expect.arrayContaining([
        [1_750, 0],
        [0, 1_750],
      ]),
    );
    // Keine Steuerzeile: Die Aufrechnung ist umsatzsteuerlich neutral
    expect(gebucht.filter((b) => b.account !== "1400" && b.account !== "1590")).toHaveLength(0);
    expect((await salden()).get("1590")).toBe(0);
  }, 60_000);

  it("verrechnet auch, wenn die Korrektur der geöffnete Beleg ist", async () => {
    const { rechnung, korrektur } = await paar();
    await verrechnung.settleInvoices(actor, {
      invoiceId: korrektur,
      counterInvoiceId: rechnung,
      amount: 1_750,
      date: "2026-11-12",
      note: "Rechnungskorrektur 2026-002",
    });

    // Vorzeichen aus dem offenen Rest, nicht aus der Rolle des geöffneten Belegs
    expect(await offen(rechnung)).toBe(14_150);
    expect(await offen(korrektur)).toBe(0);
    const zeilen = await verrechnung.listInvoiceSettlements(korrektur);
    expect(zeilen[0]).toMatchObject({ amount: -1_750 });
  }, 60_000);

  it("hebt auf und stellt den Rest am Tag der Aufhebung wieder her", async () => {
    const { rechnung, korrektur } = await paar();
    const { ids } = await verrechnung.settleInvoices(actor, {
      invoiceId: rechnung,
      counterInvoiceId: korrektur,
      amount: 1_750,
      date: "2026-11-12",
      note: "Rechnungskorrektur 2026-002",
    });

    await verrechnung.reverseInvoiceSettlement(actor, ids[0]!, "2026-11-13", "Korrektur war falsch erfasst");

    expect(await offen(rechnung)).toBe(15_900);
    expect(await offen(korrektur)).toBe(-1_750);
    // Zwei Zeilen plus zwei Gegenzeilen; nur die Gegenzeilen tragen reverses_id
    const zeilen = await verrechnung.listInvoiceSettlements(rechnung);
    expect(zeilen).toHaveLength(2);
    expect(zeilen.filter((z) => z.reversesId !== null)).toHaveLength(1);

    // Die Gegenbuchungen stehen am Tag der Aufhebung, nicht rückwirkend
    const gebucht = await buchungen();
    const gegen = gebucht.filter((b) => b.reverses_id !== null);
    expect(gegen).toHaveLength(4);
    expect(gegen.every((b) => b.date === "2026-11-13")).toBe(true);
    expect((await salden()).get("1590")).toBe(0);
    expect((await salden()).get("1400")).toBe(0);
    await expect(verrechnung.reverseInvoiceSettlement(actor, ids[0]!, "2026-11-14")).rejects.toThrow(/bereits aufgehoben/);
  }, 60_000);

  it("verrechnet höchstens bis zum offenen Rest der Rechnung; der Überschuss bleibt Guthaben", async () => {
    // 100,00 EUR sind schon bezahlt: Auf der Rechnung stehen noch 59,00 EUR, die Korrektur über -150,00 EUR ist größer
    const rechnung = await beleg("rechnung", 13_361, "2026-09-01");
    await zahle(rechnung, 10_000, "2026-11-11");
    expect(await offen(rechnung)).toBe(5_900);
    const grosseKorrektur = await beleg("korrektur", -12_605, "2026-11-11", rechnung); // -150,00 EUR brutto
    expect(await offen(grosseKorrektur)).toBe(-15_000);

    await expect(
      verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: grosseKorrektur, amount: 6_000, date: "2026-11-12", note: "zu viel" }),
    ).rejects.toThrow(/Mehr als 59,00/);

    await verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: grosseKorrektur, amount: 5_900, date: "2026-11-12", note: "Rest" });
    expect(await offen(rechnung)).toBe(0);
    // 150,00 EUR Korrektur minus 59,00 EUR verrechnet: 91,00 EUR bleiben als Guthaben des Kunden stehen
    expect(await offen(grosseKorrektur)).toBe(-9_100);
  }, 60_000);

  it("lehnt ab, was keine Verrechnung ist: voller Betrag, falsches Paar, eigenes Datum, Zukunft", async () => {
    const { rechnung, korrektur } = await paar();
    // Eine Korrektur über den ganzen, noch unbezahlten Rechnungsbetrag ist ein Storno — eigene Rechnung, damit die
    // Korrekturen zusammen die Rechnung nicht unter 0 mindern
    const eigene = await beleg("rechnung", 13_361, "2026-09-05");
    const volleKorrektur = await beleg("korrektur", -13_361, "2026-11-11", eigene);
    await expect(
      verrechnung.settleInvoices(actor, { invoiceId: eigene, counterInvoiceId: volleKorrektur, amount: 15_900, date: "2026-11-12", note: "voll" }),
    ).rejects.toThrow(/ist ein Storno/);

    // Zwei Rechnungen ohne Korrektur sind kein Paar
    const zweite = await beleg("rechnung", 1_000, "2026-09-02");
    await expect(
      verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: zweite, amount: 1_000, date: "2026-11-12", note: "falsch" }),
    ).rejects.toThrow(/eigene Kundenkorrektur/);
    await expect(
      verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: rechnung, amount: 1_000, date: "2026-11-12", note: "selbst" }),
    ).rejects.toThrow(/nicht mit sich selbst/);

    // Keine Rückwirkung vor den jüngeren Beleg, keine Zukunft
    await expect(
      verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: korrektur, amount: 1_000, date: "2026-10-01", note: "zu früh" }),
    ).rejects.toThrow(/vor dem jüngeren/);
    await expect(
      verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: korrektur, amount: 1_000, date: "2099-01-01", note: "Zukunft" }),
    ).rejects.toThrow(/in der Zukunft/);
  }, 60_000);

  it("ist nur anhängbar: Ändern und Löschen lehnt die Datenbank ab", async () => {
    const { rechnung, korrektur } = await paar();
    await verrechnung.settleInvoices(actor, { invoiceId: rechnung, counterInvoiceId: korrektur, amount: 1_750, date: "2026-11-12", note: "Korrektur" });
    await expect(sql`update invoice_settlements set amount = 1`).rejects.toThrow(/darf nur ergänzt werden/);
    await expect(sql`delete from invoice_settlements`).rejects.toThrow(/darf nur ergänzt werden/);
  }, 60_000);
});
