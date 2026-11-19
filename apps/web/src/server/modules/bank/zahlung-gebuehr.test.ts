import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

describe.skipIf(!testDatabaseUrl)("Zahlung und Gebühr eines Zahlungsdienstleisters zusammen zuordnen (Postgres)", () => {
  let bank: typeof import("./index.ts");
  let gebuehr: typeof import("./zahlung-gebuehr.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let vat: typeof import("../umsatzsteuer/vat-figures.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    gebuehr = await import("./zahlung-gebuehr.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    vat = await import("../umsatzsteuer/vat-figures.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate vat_returns, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, documents, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
  });

  async function finalInvoice(net: number) {
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "buchhaltung@nordwerk.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate: "2026-09-05",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Leistungen August", quantity: 1000, unit: "Psch.", unitPrice: net, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
  }

  async function stripeKonto(rows: string[]) {
    const stripe = await bank.createProviderAccount(actor, { name: "Stripe", provider: "stripe" });
    const csv = [`balance_transaction_id,created_utc,available_on_utc,currency,gross,fee,net,reporting_category,description`, ...rows].join("\n");
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: "stripe.csv" }, stripe.id);
    const id = async (amount: number) => ((await sql`select id from bank_transactions where amount = ${amount}`)[0] as { id: string }).id;
    return { stripe, id };
  }

  it("ordnet die Zahlung der Rechnung zu und bucht die Gebühr, beides in einem Schritt", async () => {
    const invoice = await finalInvoice(5_000);
    const total = 5_950;
    const { id } = await stripeKonto([`txn_1,2026-10-01 10:00:00,2026-10-08 00:00:00,eur,59.50,1.50,58.00,charge,Rechnung`]);
    const payment = await id(total);
    const fee = await id(-150);

    await gebuehr.allocatePaymentWithFee(actor, { transactionId: payment, target: { kind: "invoice", invoiceId: invoice.id }, amount: total });

    const rows = await sql`select transaction_id, kind, amount from allocations order by amount desc`;
    expect(rows.map((r) => [r.transaction_id, r.kind, r.amount])).toEqual([
      [payment, "invoice", total],
      [fee, "gebuehren", -150],
    ]);
    const balances = Object.fromEntries(
      (await sql`select account, sum(debit - credit)::int as saldo from journal_lines group by account having sum(debit - credit) <> 0 order by 1`).map((r) => [
        r.account,
        r.saldo,
      ]),
    );
    // Voller Erlös, Gebühr als Aufwand, auf dem Verrechnungskonto des Dienstleisters bleibt der Nettozufluss
    expect(balances).toMatchObject({ "4970": 150, "8400": -5_000, "1776": -950 });
    expect(Object.values(balances as Record<string, number>).reduce((s, v) => s + v, 0)).toBe(0);
  }, 30_000);

  it("ordnet die Gebühr auf Wunsch dem gebuchten Beleg des Dienstleisters zu, damit Vorsteuer bzw. § 13b über ihn laufen", async () => {
    const invoice = await finalInvoice(5_000);
    const { id } = await stripeKonto([`txn_1,2026-10-01 10:00:00,2026-10-08 00:00:00,eur,59.50,1.50,58.00,charge,Rechnung`]);
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7]);
    const beleg = await documents.uploadDocument(actor, { bytes, filename: "stripe-gebuehren.jpg" });
    await documents.updateDocument(actor, beleg.id, {
      supplierName: "Stripe Payments Europe Ltd",
      supplierUstId: "",
      invoiceNumber: "STR-2026-10",
      documentDate: "2026-10-31",
      dueDate: null,
      category: "geldverkehr",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 0, net: 150, tax: 0 }],
    });
    await documents.bookDocument(actor, beleg.id);

    await gebuehr.allocatePaymentWithFee(actor, {
      transactionId: await id(5_950),
      target: { kind: "invoice", invoiceId: invoice.id },
      amount: 5_950,
      gebuehrBelegId: beleg.id,
    });

    const rows = await sql`select transaction_id, kind, document_id from allocations order by amount desc`;
    expect(rows.map((r) => [r.kind, r.document_id])).toEqual([
      ["invoice", null],
      ["document", beleg.id],
    ]);
    // Der Aufwand entsteht einmal, mit dem Beleg; die Zuordnung der Gebühr bucht ihn nicht noch einmal
    expect((await sql`select sum(debit - credit)::int as s from journal_lines where account = ${"4970"}`)[0]?.s).toBe(150);
  }, 30_000);

  it("bucht nichts, wenn der Beleg der Gebühr zu klein ist: Die Zuordnung der Zahlung wird mit zurückgenommen", async () => {
    const invoice = await finalInvoice(5_000);
    const { id } = await stripeKonto([`txn_1,2026-10-01 10:00:00,2026-10-08 00:00:00,eur,59.50,1.50,58.00,charge,Rechnung`]);
    const klein = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 8]), filename: "klein.jpg" });
    await documents.updateDocument(actor, klein.id, {
      supplierName: "Stripe Payments Europe Ltd",
      supplierUstId: "",
      invoiceNumber: "STR-KLEIN",
      documentDate: "2026-10-31",
      dueDate: null,
      category: "geldverkehr",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 0, net: 100, tax: 0 }],
    });
    await documents.bookDocument(actor, klein.id);

    await expect(
      gebuehr.allocatePaymentWithFee(actor, {
        transactionId: await id(5_950),
        target: { kind: "invoice", invoiceId: invoice.id },
        amount: 5_950,
        gebuehrBelegId: klein.id,
      }),
    ).rejects.toThrow();
    expect(await sql`select 1 from allocations`).toHaveLength(0);
  }, 30_000);

  it("gilt auch für SKR04 und Soll-Versteuerung: Erlös voll, Gebühr als Nebenkosten des Geldverkehrs, Buchungen gehen auf", async () => {
    await sql`update company set kontenrahmen = ${"SKR04"}, versteuerung = ${"soll"} where id = 1`;
    const invoice = await finalInvoice(5_000);
    const { id } = await stripeKonto([`txn_1,2026-10-01 10:00:00,2026-10-08 00:00:00,eur,59.50,1.50,58.00,charge,Rechnung`]);

    await gebuehr.allocatePaymentWithFee(actor, { transactionId: await id(5_950), target: { kind: "invoice", invoiceId: invoice.id }, amount: 5_950 });

    expect((await sql`select kind from allocations order by amount desc`).map((r) => r.kind)).toEqual(["invoice", "gebuehren"]);
    expect((await sql`select sum(debit - credit)::int as s from journal_lines`)[0]?.s).toBe(0);
    expect((await sql`select sum(debit - credit)::int as s from journal_lines where account = ${"6855"}`)[0]?.s).toBe(150);
  }, 30_000);

  it("ordnet die Gebühr einem Beleg mit 19 % Vorsteuer zu: Aufwand netto und Vorsteuer entstehen einmal, die Buchungen gehen auf", async () => {
    const invoice = await finalInvoice(5_000);
    const { id } = await stripeKonto([`txn_1,2026-10-01 10:00:00,2026-10-08 00:00:00,eur,59.50,1.50,58.00,charge,Rechnung`]);
    const beleg = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]), filename: "gebuehr-19.jpg" });
    await documents.updateDocument(actor, beleg.id, {
      supplierName: "Zahlungsdienst GmbH",
      supplierUstId: "",
      invoiceNumber: "ZD-2026-10",
      documentDate: "2026-10-31",
      dueDate: null,
      category: "geldverkehr",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: 126, tax: 24 }],
    });
    await documents.bookDocument(actor, beleg.id);

    await gebuehr.allocatePaymentWithFee(actor, {
      transactionId: await id(5_950),
      target: { kind: "invoice", invoiceId: invoice.id },
      amount: 5_950,
      gebuehrBelegId: beleg.id,
    });

    const saldo = async (konto: string) => (await sql`select coalesce(sum(debit - credit), 0)::int as s from journal_lines where account = ${konto}`)[0]?.s;
    expect(await saldo("4970")).toBe(126);
    expect(await saldo("1576")).toBe(24);
    expect(await saldo("1200")).toBe(0);
    expect((await sql`select sum(debit - credit)::int as s from journal_lines`)[0]?.s).toBe(0);
  }, 30_000);

  it("lehnt eine nur teilweise zugeordnete Zahlung ab, auch wenn der Rest dem Betrag entspricht", async () => {
    const invoice = await finalInvoice(5_000);
    const { id } = await stripeKonto([`txn_1,2026-10-01 10:00:00,2026-10-08 00:00:00,eur,59.50,1.50,58.00,charge,Rechnung`]);
    const zahlung = await id(5_950);
    await bank.allocate(actor, { kind: "invoice", transactionId: zahlung, invoiceId: invoice.id, amount: 1_000 });
    await expect(
      gebuehr.allocatePaymentWithFee(actor, { transactionId: zahlung, target: { kind: "invoice", invoiceId: invoice.id }, amount: 4_950 }),
    ).rejects.toThrow(/ganz offen/);
    expect(await sql`select 1 from allocations`).toHaveLength(1);
  }, 30_000);

  it("gilt nur im Konto eines Zahlungsdienstleisters: Auf einem Bankkonto ist eine Referenz mit Anhang keine Gebühr derselben Bewegung", async () => {
    const invoice = await finalInvoice(5_000);
    const konto = await bank.createAccount(actor, { name: "Girokonto", iban: "DE89 3704 0044 0532 0130 00" });
    const importId = (
      (
        await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped) values (${konto.id}, ${"x.csv"}, ${"x"}, ${"dkb-csv"}, 2, 0) returning id`
      )[0] as { id: string }
    ).id;
    const zeile = async (betrag: number, referenz: string, hash: string) =>
      (
        (
          await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, currency, counterparty_name, purpose, bank_reference, dedup_hash)
        values (${konto.id}, ${importId}, ${"2026-10-01"}, ${betrag}, ${"EUR"}, ${"Gegenpartei"}, ${referenz}, ${referenz}, ${hash}) returning id`
        )[0] as { id: string }
      ).id;
    const eingang = await zeile(5_950, "RE-1", "h1");
    await zeile(-150, "RE-1-gebuehr", "h2");

    await expect(
      gebuehr.allocatePaymentWithFee(actor, { transactionId: eingang, target: { kind: "invoice", invoiceId: invoice.id }, amount: 5_950 }),
    ).rejects.toThrow(/Konto eines Zahlungsdienstleisters/);
    expect(await sql`select 1 from allocations`).toHaveLength(0);
  }, 30_000);

  it("lehnt ab, wenn nicht die ganze Zahlung zugeordnet wird, die Gebühr fehlt oder schon zugeordnet ist, und bucht dann nichts", async () => {
    const invoice = await finalInvoice(5_000);
    const { id } = await stripeKonto([
      `txn_1,2026-10-01 10:00:00,2026-10-08 00:00:00,eur,59.50,1.50,58.00,charge,Rechnung`,
      `txn_2,2026-10-02 10:00:00,2026-10-09 00:00:00,eur,10.00,0.00,10.00,charge,ohne Gebühr`,
    ]);
    const payment = await id(5_950);
    const target = { kind: "invoice" as const, invoiceId: invoice.id };

    await expect(gebuehr.allocatePaymentWithFee(actor, { transactionId: payment, target, amount: 5_000 })).rejects.toThrow(/ganze Zahlung/);
    await expect(gebuehr.allocatePaymentWithFee(actor, { transactionId: await id(1_000), target, amount: 1_000 })).rejects.toThrow(/keine eindeutige Gebühr/);
    // Die Gebühr allein ist keine Zahlung
    await expect(gebuehr.allocatePaymentWithFee(actor, { transactionId: await id(-150), target, amount: -150 })).rejects.toThrow(/keine eindeutige Gebühr/);
    expect(await sql`select 1 from allocations`).toHaveLength(0);

    await bank.allocate(actor, { kind: "gebuehren", transactionId: await id(-150), amount: -150 });
    await expect(gebuehr.allocatePaymentWithFee(actor, { transactionId: payment, target, amount: 5_950 })).rejects.toThrow(/Gebühr ist schon zugeordnet/);
    expect(await sql`select 1 from allocations`).toHaveLength(1);
  }, 30_000);

  /** Gebührenrechnung von Stripe Payments Europe, § 13b (Leistung aus dem EU-Ausland), 19 %: 1,50 € netto, 0,29 € Steuer */
  async function gebuehrBeleg13b() {
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 13, 1]), filename: "stripe-13b.jpg" });
    await documents.updateDocument(actor, id, {
      supplierName: "Stripe Payments Europe Ltd",
      supplierUstId: "IE3206488LH",
      invoiceNumber: "STR-13B",
      documentDate: "2026-10-31",
      dueDate: null,
      category: "geldverkehr",
      payment: "bank",
      note: "",
      reverseCharge: "eu",
      amounts: [{ taxRate: 1900, net: 150, tax: 29 }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  for (const [kontenrahmen, versteuerung] of [
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const) {
    it(`${kontenrahmen}, ${versteuerung}: die Gebühr an einem § 13b-Beleg bringt Kz 46, 47 und 67 genau einmal`, async () => {
      await sql`update company set kontenrahmen = ${kontenrahmen}, versteuerung = ${versteuerung} where id = 1`;
      const invoice = await finalInvoice(5_000);
      const { id } = await stripeKonto([`txn_1,2026-10-01 10:00:00,2026-10-08 00:00:00,eur,59.50,1.50,58.00,charge,Rechnung`]);
      const belegId = await gebuehrBeleg13b();

      await gebuehr.allocatePaymentWithFee(actor, {
        transactionId: await id(5_950),
        target: { kind: "invoice", invoiceId: invoice.id },
        amount: 5_950,
        gebuehrBelegId: belegId,
      });

      const oktober = await vat.computeVatFigures({ year: 2026, month: 10 });
      expect([oktober.kz46, oktober.kz47, oktober.kz67]).toEqual([150, 29, 29]);
      expect((await sql`select sum(debit - credit)::int as s from journal_lines`)[0]?.s).toBe(0);
    }, 30_000);
  }

  it("ordnet die Zahlung auch einem Beleg zu, etwa einer Gutschrift des Lieferanten, und bucht die Gebühr mit", async () => {
    const { id } = await stripeKonto([`txn_1,2026-10-01 10:00:00,2026-10-08 00:00:00,eur,59.50,1.50,58.00,charge,Gutschrift`]);
    const gutschrift = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 14, 1]), filename: "gutschrift.jpg" });
    await documents.updateDocument(actor, gutschrift.id, {
      supplierName: "Lieferant GmbH",
      supplierUstId: "",
      invoiceNumber: "GS-1",
      documentDate: "2026-10-01",
      dueDate: null,
      category: "sonstiges",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: -5_000, tax: -950 }],
    });
    await documents.bookDocument(actor, gutschrift.id);

    await gebuehr.allocatePaymentWithFee(actor, {
      transactionId: await id(5_950),
      target: { kind: "document", documentId: gutschrift.id },
      amount: 5_950,
    });

    const rows = await sql`select kind, amount from allocations order by amount desc`;
    expect(rows.map((r) => [r.kind, r.amount])).toEqual([
      ["document", 5_950],
      ["gebuehren", -150],
    ]);
    expect((await sql`select sum(debit - credit)::int as s from journal_lines`)[0]?.s).toBe(0);
  }, 30_000);
  it("übersieht eine bestätigte Dublette der Gebühr mit derselben Referenz, wie Liste und Zähler (#865)", async () => {
    const invoice = await finalInvoice(5_000);
    const { stripe, id } = await stripeKonto([`txn_1,2026-10-01 10:00:00,2026-10-08 00:00:00,eur,59.50,1.50,58.00,charge,Rechnung`]);
    const payment = await id(5_950);
    const fee = await id(-150);
    // Dieselbe Bewegung aus einem späteren Abruf mit anderem Text: neue Umsätze mit denselben Referenzen, als Dubletten bestätigt
    const [later] = await sql`insert into bank_imports (bank_account_id, filename, sha256, format, added, skipped)
      values (${stripe.id}, 'stripe-2.csv', 'zweiter-abruf', 'stripe', 2, 0) returning id`;
    const { decideDuplicate } = await import("./duplicate-review.ts");
    for (const original of [payment, fee]) {
      const [copy] = await sql`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, purpose, bank_reference, dedup_hash)
        select bank_account_id, ${later!.id}, booking_date, amount, purpose || ' (erneut)', bank_reference, dedup_hash || '-2'
        from bank_transactions where id = ${original} returning id`;
      const [review] = await sql`insert into bank_duplicate_reviews (transaction_id, original_transaction_id) values (${copy!.id}, ${original}) returning id`;
      await decideDuplicate(actor, { id: String(review!.id), decision: "duplicate", requestId: crypto.randomUUID() });
    }
    expect((await bank.listAccounts()).find((a) => a.id === stripe.id)).toMatchObject({ openCount: 1 });

    await gebuehr.allocatePaymentWithFee(actor, { transactionId: payment, target: { kind: "invoice", invoiceId: invoice.id }, amount: 5_950 });

    const rows = await sql`select transaction_id, kind from allocations order by amount desc`;
    expect(rows.map((r) => [r.transaction_id, r.kind])).toEqual([
      [payment, "invoice"],
      [fee, "gebuehren"],
    ]);
  }, 30_000);
});
