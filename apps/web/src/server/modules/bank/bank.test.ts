import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const IBAN = "DE12120300001234567890";

function dkbCsv(rows: string[][], balance = "23.418,72 €", date = "01.10.2026", iban = "DE12 1203 0000 1234 5678 90") {
  const header = `"Girokonto";"${iban}"\n""\n"Kontostand vom ${date}:";"${balance}"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
  return new TextEncoder().encode("﻿" + header + columns + body + "\n");
}

const incoming = (date: string, from: string, iban: string, purpose: string, amount: string) =>
  [date, date, "Gebucht", from, "Tristan Teufel", purpose, "Eingang", iban, amount, "", "", ""];
const outgoing = (date: string, to: string, iban: string, purpose: string, amount: string) =>
  [date, date, "Gebucht", "Tristan Teufel", to, purpose, "Ausgang", iban, amount, "", "", ""];

describe.skipIf(!testDatabaseUrl)("Bankabgleich (Postgres)", () => {
  let bank: typeof import("./bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./bank.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate write_offs, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
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
    return { invoice: await invoices.finalizeInvoice(actor, draft.id), contact };
  }

  it("legt das Konto aus der IBAN an, überspringt Dubletten und erkennt Lücken", async () => {
    const first = await bank.importStatement(
      actor,
      { bytes: dkbCsv([incoming("01.10.26", "Nordwerk Software GmbH", "DE89370400440532013000", "RE 2026-001", "4.760,00")], "4.760,00 €"), filename: "a.csv" },
      null,
    );
    expect(first).toMatchObject({ added: 1, skipped: 0, gap: null });
    const [account] = await sql`select iban from bank_accounts`;
    expect(account?.iban).toBe(IBAN);

    const again = await bank.importStatement(
      actor,
      {
        bytes: dkbCsv(
          [
            incoming("02.10.26", "Kunde B", "DE02100100100006820101", "Abschlag", "100,00"),
            incoming("01.10.26", "Nordwerk Software GmbH", "DE89370400440532013000", "RE 2026-001", "4.760,00"),
          ],
          "4.860,00 €",
          "02.10.2026",
        ),
        filename: "b.csv",
      },
      null,
    );
    expect(again).toMatchObject({ added: 1, skipped: 1 });
    await expect(sql`update bank_transactions set amount = 1`).rejects.toThrow(/nur ergänzt/);
  });

  it("benennt ein Konto um; spätere Importe landen über die IBAN weiter im selben Konto", async () => {
    const first = await bank.importStatement(
      actor,
      { bytes: dkbCsv([incoming("01.10.26", "Nordwerk Software GmbH", "DE89370400440532013000", "RE 2026-001", "4.760,00")], "4.760,00 €"), filename: "a.csv" },
      null,
    );
    expect(first.accountName).toBe("Girokonto");
    await bank.updateAccount(actor, { id: first.accountId, name: "Steuerkonto", purpose: "steuer" });

    const again = await bank.importStatement(
      actor,
      { bytes: dkbCsv([incoming("02.10.26", "Kunde B", "DE02100100100006820101", "Abschlag", "100,00")], "4.860,00 €", "02.10.2026"), filename: "b.csv" },
      null,
    );
    expect(again).toMatchObject({ accountId: first.accountId, accountName: "Steuerkonto", added: 1 });
    expect((await bank.listAccounts()).map((a) => a.name)).toEqual(["Steuerkonto"]);
    const [audit] = await sql`select actor from audit_log where table_name = 'bank_accounts' and action = 'UPDATE'`;
    expect(audit?.actor).toBe(actor);

    await expect(bank.updateAccount(actor, { id: "00000000-0000-4000-8000-000000000000", name: "X", purpose: "geschaeft" })).rejects.toThrow(/nicht gefunden/);
  });

  it("Zweck der Konten: Geldtransit aufs Steuerkonto mit Gegenbuchung, Finanzamt-Lastschrift als Umsatzsteuer", async () => {
    const TAX_IBAN = "DE02120300000000202051";
    const business = await bank.importStatement(
      actor,
      { bytes: dkbCsv([outgoing("01.10.26", "Steuerkonto", TAX_IBAN, "Rücklage USt", "-600,00")], "1.000,00 €"), filename: "a.csv" },
      null,
    );
    const tax = await bank.importStatement(
      actor,
      {
        bytes: dkbCsv(
          [
            incoming("02.10.26", "Tristan Teufel", IBAN, "Rücklage USt", "600,00"),
            outgoing("10.10.26", "Finanzamt Regensburg", "DE76750000000075001007", "USt 09/2026 StNr 244/123/45678", "-412,30"),
          ],
          "187,70 €",
          "10.10.2026",
          "DE02 1203 0000 0000 2020 51",
        ),
        filename: "b.csv",
      },
      null,
    );
    await bank.updateAccount(actor, { id: tax.accountId, name: "Steuerkonto", purpose: "steuer" });

    const [out] = await sql`select id from bank_transactions where amount = -60000`;
    const [into] = await sql`select id from bank_transactions where amount = 60000`;
    const [debit] = await sql`select id from bank_transactions where amount = -41230`;
    const outDetail = await bank.transactionDetail(out!.id);
    expect(outDetail?.direct).toEqual({
      kind: "geldtransit",
      reasons: ["Gegenkonto ist dein Konto Steuerkonto"],
      counterAccountId: tax.accountId,
      counterpart: { id: into!.id, bookingDate: "2026-10-02", amount: 60_000, counterpartyName: "Tristan Teufel" },
    });
    expect((await bank.transactionDetail(debit!.id))?.direct).toEqual({
      kind: "ustVorauszahlung",
      reasons: ["Lastschrift des Finanzamts auf dem Steuerkonto"],
      counterpart: null,
    });

    await expect(bank.allocateTransfer(actor, { transactionId: out!.id, counterpartId: debit!.id })).rejects.toThrow(/denselben Betrag/);
    await bank.allocateTransfer(actor, { transactionId: out!.id, counterpartId: into!.id });
    await expect(bank.allocateTransfer(actor, { transactionId: out!.id, counterpartId: into!.id })).rejects.toThrow(/ganz offen/);
    expect((await bank.transactionDetail(out!.id))?.transaction.open).toBe(0);
    expect((await bank.transactionDetail(into!.id))?.transaction.open).toBe(0);
    // Geldtransit hebt sich auf, auf dem einen Bankkonto bleibt nichts stehen
    const [sum] = await sql`select sum(case when account = '1360' then debit - credit else 0 end)::int as transit,
      sum(case when account = '1200' then debit - credit else 0 end)::int as bank
      from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_type = 'allocation'`;
    expect(sum).toEqual({ transit: 0, bank: 0 });
    // Ein Vorschlag gibt es nur für ganz offene Umsätze
    expect((await bank.transactionDetail(out!.id))?.direct).toBeNull();
    expect(business.accountId).not.toBe(tax.accountId);
  }, 30_000);

  it("Geldtransit: eine fremde Zahlung über denselben Betrag ist nie die Gegenbuchung; gezahlte Umsatzsteuer wird gezählt", async () => {
    const TAX_IBAN = "DE02120300000000202051";
    await bank.importStatement(
      actor,
      { bytes: dkbCsv([outgoing("03.10.26", "Steuerkonto", TAX_IBAN, "Rücklage", "-600,00")], "1.000,00 €", "03.10.2026"), filename: "a.csv" },
      null,
    );
    const tax = await bank.importStatement(
      actor,
      {
        bytes: dkbCsv(
          [
            incoming("03.10.26", "Finanzamt Regensburg", "DE76750000000075001007", "Erstattung USt 08/2026", "600,00"),
            incoming("04.10.26", "Tristan Teufel", IBAN, "Rücklage", "600,00"),
            outgoing("12.10.26", "Finanzamt Regensburg", "DE76750000000075001007", "USt 09/2026", "-412,30"),
          ],
          "787,70 €",
          "12.10.2026",
          "DE02 1203 0000 0000 2020 51",
        ),
        filename: "b.csv",
      },
      null,
    );
    await bank.updateAccount(actor, { id: tax.accountId, name: "Steuerkonto", purpose: "steuer" });
    const [out] = await sql`select id from bank_transactions where amount = -60000`;
    const [refund] = await sql`select id from bank_transactions where purpose like 'Erstattung%'`;
    const [transfer] = await sql`select id from bank_transactions where purpose = 'Rücklage' and amount = 60000`;
    // Die Erstattung liegt zeitlich näher, nennt aber nicht das Geschäftskonto
    expect((await bank.transactionDetail(out!.id))?.direct?.counterpart?.id).toBe(transfer!.id);
    await expect(bank.allocateTransfer(actor, { transactionId: out!.id, counterpartId: refund!.id })).rejects.toThrow(/Gegenkonto/);
    // Die Erstattung selbst ist Umsatzsteuer
    expect((await bank.transactionDetail(refund!.id))?.direct?.kind).toBe("ustVorauszahlung");

    const [debit] = await sql`select id from bank_transactions where amount = -41230`;
    expect(await bank.vatPaidAfter("2026-09-30")).toBe(0);
    await bank.allocate(actor, { kind: "ustVorauszahlung", transactionId: debit!.id, amount: -41_230 });
    await bank.allocate(actor, { kind: "ustVorauszahlung", transactionId: refund!.id, amount: 60_000 });
    // Gezahlt 412,30, erstattet 600,00: netto −187,70; für die Deckung zählt der Saldo
    expect(await bank.vatPaidAfter("2026-09-30")).toBe(-18_770);
    expect(await bank.vatPaidAfter("2026-10-12")).toBe(0);
  }, 30_000);

  it("Zahlungseingang: Vorschlag, Zuordnung, Ist-Buchung, bezahlt", async () => {
    const { invoice, contact } = await finalInvoice(400_000);
    await bank.importStatement(
      actor,
      { bytes: dkbCsv([incoming("01.10.26", "Nordwerk Software GmbH", "DE02100100100006820101", `RE ${invoice.number} Leistungen August`, "4.760,00")]), filename: "a.csv" },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    const detail = await bank.transactionDetail(tx!.id);
    expect(detail?.suggestions[0]).toMatchObject({ item: { id: invoice.id }, amount: 476_000 });
    expect(detail?.suggestions[0]?.reasons).toEqual(["Betrag stimmt exakt", "Rechnungsnummer im Verwendungszweck", "Name passt"]);

    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: invoice.id, amount: 476_000 });
    const lines = await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_type = 'allocation' order by l.account`;
    expect(lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ["1200", 476_000, 0],
      ["1400", 0, 476_000],
      ["1766", 76_000, 0],
      ["1776", 0, 76_000],
    ]);
    const list = await invoices.listInvoices("2026-10-02");
    expect(list.find((i) => i.id === invoice.id)).toMatchObject({ listStatus: "bezahlt", open: 0 });
    expect((await contacts.getContact(contact.id))?.contact.iban).toBe("DE02100100100006820101");
    expect((await invoices.invoiceSummary("2026-10-02")).openTotal).toBe(0);
  }, 30_000);

  it("Teilzahlung, Überzuordnung abgelehnt, Aufheben macht wieder offen", async () => {
    const { invoice } = await finalInvoice(400_000);
    await bank.importStatement(
      actor,
      { bytes: dkbCsv([incoming("01.10.26", "Nordwerk", "DE02100100100006820101", "Abschlag", "2.000,00")]), filename: "a.csv" },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    await expect(
      bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: invoice.id, amount: 300_000 }),
    ).rejects.toThrow(/größer als der noch offene Teil/);
    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: invoice.id, amount: 200_000 });
    // Liste und Filter rechnen den offenen Betrag gleich
    const [txRow] = await sql<{ bank_account_id: string }[]>`select bank_account_id from bank_transactions`;
    const accountId = txRow!.bank_account_id;
    expect((await bank.listTransactions(accountId, "alle", "")).map((t) => t.open)).toEqual([0]);
    expect(await bank.listTransactions(accountId, "offen", "")).toEqual([]);
    expect((await invoices.listInvoices("2026-09-10")).find((i) => i.id === invoice.id)).toMatchObject({
      listStatus: "teilbezahlt",
      open: 276_000,
    });

    const [allocation] = await sql`select id from allocations`;
    await bank.reverseAllocation(actor, allocation!.id);
    await expect(bank.reverseAllocation(actor, allocation!.id)).rejects.toThrow(/bereits aufgehoben/);
    const detail = await bank.transactionDetail(tx!.id);
    expect(detail?.transaction.open).toBe(200_000);
    expect(detail?.allocations[0]?.reversed).toBe(true);
    const [sum] = await sql`select sum(debit) - sum(credit) as diff, sum(case when account = '1776' then credit - debit else 0 end) as ust from journal_lines l
      join journal_entries e on e.id = l.entry_id where e.source_type = 'allocation'`;
    expect(Number(sum?.diff)).toBe(0);
    expect(Number(sum?.ust)).toBe(0);
  }, 30_000);

  it("Splitbuchung: Auszahlung abzüglich Gebühr bucht vollen Erlös und Gebühr; aufgehoben wird nur die ganze Aufteilung", async () => {
    const { invoice } = await finalInvoice(400_000);
    // PayPal zahlt 4.760,00 € aus und behält 60,00 € Gebühr ein
    await bank.importStatement(
      actor,
      { bytes: dkbCsv([incoming("01.10.26", "PayPal Europe", "LU89751000135104200E", `Auszahlung RE ${invoice.number}`, "4.700,00")]), filename: "a.csv" },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    const parts = [
      { kind: "invoice" as const, invoiceId: invoice.id, amount: 476_000 },
      { kind: "gebuehren" as const, amount: -6_000 },
    ];

    await expect(bank.allocateSplit(actor, { transactionId: tx!.id, parts: [parts[0]!, { kind: "gebuehren", amount: -5_000 }] })).rejects.toThrow(
      /ergeben 4710 €, offen sind 4700 €/,
    );
    await expect(bank.allocateSplit(actor, { transactionId: tx!.id, parts: [{ ...parts[0]!, amount: 486_000 }, { kind: "gebuehren", amount: -16_000 }] })).rejects.toThrow(
      /nur noch über 4760 € offen/,
    );
    expect(Number((await sql`select count(*) as n from allocations`)[0]?.n)).toBe(0);

    await bank.allocateSplit(actor, { transactionId: tx!.id, parts });
    expect((await bank.transactionDetail(tx!.id))?.transaction.open).toBe(0);
    expect((await invoices.listInvoices("2026-10-02")).find((i) => i.id === invoice.id)).toMatchObject({ listStatus: "bezahlt", open: 0 });
    // Bruttoprinzip: Bank 4.760 an Forderung (Ist: Umsatzsteuer fällig), Gebühr 60 an Bank; auf der Bank netto 4.700
    const lines = await sql`select l.account, sum(l.debit)::int as debit, sum(l.credit)::int as credit from journal_lines l
      join journal_entries e on e.id = l.entry_id where e.source_type = 'allocation' group by l.account order by l.account`;
    expect(lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ["1200", 476_000, 6_000],
      ["1400", 0, 476_000],
      ["1766", 76_000, 0],
      ["1776", 0, 76_000],
      ["4970", 6_000, 0],
    ]);

    const [fee] = await sql`select id from allocations where kind = 'gebuehren'`;
    await bank.reverseAllocation(actor, fee!.id);
    const detail = await bank.transactionDetail(tx!.id);
    expect(detail?.transaction.open).toBe(470_000);
    expect(detail?.allocations.map((a) => [a.kind, a.reversed])).toEqual([
      ["invoice", true],
      ["gebuehren", true],
    ]);
    expect((await invoices.listInvoices("2026-10-02")).find((i) => i.id === invoice.id)).toMatchObject({ open: 476_000 });
    const [sum] = await sql`select sum(debit) - sum(credit) as diff, sum(case when account = '1200' then debit - credit else 0 end) as bank
      from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_type = 'allocation'`;
    expect(Number(sum?.diff)).toBe(0);
    expect(Number(sum?.bank)).toBe(0);
  }, 30_000);

  it("Datenbank: Teile dürfen einzeln den Umsatz übersteigen, zusammen nicht; ohne Aufteilung gilt das Vorzeichen", async () => {
    await bank.importStatement(
      actor,
      { bytes: dkbCsv([incoming("01.10.26", "Stripe", "IE29AIBK93115212345678", "Payout", "90,00")]), filename: "a.csv" },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    // Ohne Aufteilung: anderes Vorzeichen als der Umsatz
    await expect(sql`insert into allocations (transaction_id, kind, amount) values (${tx!.id}, 'gebuehren', -1000)`).rejects.toThrow(/anderes Vorzeichen/);
    // Ein Teil allein über dem Umsatz scheitert beim Abschluss der Transaktion
    const split = "00000000-0000-4000-8000-000000000001";
    await expect(sql`insert into allocations (transaction_id, kind, amount, split_id) values (${tx!.id}, 'privat', 10000, ${split})`).rejects.toThrow(
      /mindestens zwei Teile/,
    );
    // Zwei Teile, aber keiner mit dem Vorzeichen des Umsatzes
    await expect(
      sql.begin(async (q) => {
        await q`insert into allocations (transaction_id, kind, amount, split_id) values (${tx!.id}, 'privat', -500, ${split})`;
        await q`insert into allocations (transaction_id, kind, amount, split_id) values (${tx!.id}, 'gebuehren', -500, ${split})`;
      }),
    ).rejects.toThrow(/mindestens zwei Teile/);
    // Beide Teile in einer Transaktion: +100 und −10 ergeben 90
    await sql.begin(async (q) => {
      await q`insert into allocations (transaction_id, kind, amount, split_id) values (${tx!.id}, 'privat', 10000, ${split})`;
      await q`insert into allocations (transaction_id, kind, amount, split_id) values (${tx!.id}, 'gebuehren', -1000, ${split})`;
    });
    expect(Number((await sql`select sum(amount) as s from allocations`)[0]?.s)).toBe(9000);
    // Voll zugeordnet: ein einzelner Gegenteil mit neuer Aufteilungs-ID bleibt abgelehnt
    await expect(
      sql`insert into allocations (transaction_id, kind, amount, split_id) values (${tx!.id}, 'gebuehren', -1000, ${"00000000-0000-4000-8000-000000000002"})`,
    ).rejects.toThrow(/mindestens zwei Teile/);
    // Und über die App: Aufteilung auf einen schon ganz zugeordneten Umsatz
    await expect(
      bank.allocateSplit(actor, { transactionId: tx!.id, parts: [{ kind: "privat", amount: 1000 }, { kind: "gebuehren", amount: -1000 }] }),
    ).rejects.toThrow(/schon ganz zugeordnet/);
  });

  it("Skonto gewährt (Ist): Rest mit der Zahlung ausbuchen, nicht fällige Umsatzsteuer auf 0; Aufheben nimmt beides zurück", async () => {
    const { invoice } = await finalInvoice(400_000);
    // 2 % Skonto: 4.760,00 − 95,20 = 4.664,80
    await bank.importStatement(
      actor,
      { bytes: dkbCsv([incoming("01.10.26", "Nordwerk Software GmbH", "DE02100100100006820101", `RE ${invoice.number} abzgl. 2 % Skonto`, "4.664,80")]), filename: "a.csv" },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    await expect(
      bank.allocateWithRest(actor, { transactionId: tx!.id, target: { kind: "invoice", invoiceId: invoice.id }, rest: "skontoErhalten" }),
    ).rejects.toThrow(/Skonto erhalten gilt für Belege/);
    await bank.allocateWithRest(actor, { transactionId: tx!.id, target: { kind: "invoice", invoiceId: invoice.id }, rest: "skonto" });
    expect((await invoices.listInvoices("2026-10-02")).find((i) => i.id === invoice.id)).toMatchObject({ listStatus: "bezahlt", open: 0 });
    const balances = async () =>
      Object.fromEntries(
        (await sql`select l.account, sum(l.debit - l.credit)::int as saldo from journal_lines l group by l.account having sum(l.debit - l.credit) <> 0 order by 1`).map((r) => [r.account, r.saldo]),
      );
    // Forderung 0, nicht fällige USt 0, fällig 744,80 = 19 % von 3.920,00
    expect(await balances()).toEqual({ "1200": 466_480, "1776": -74_480, "8400": -400_000, "8730": 8_000 });

    const [allocation] = await sql`select id from allocations`;
    await bank.reverseAllocation(actor, allocation!.id);
    expect((await invoices.listInvoices("2026-10-02")).find((i) => i.id === invoice.id)).toMatchObject({ open: 476_000 });
    expect(await balances()).toEqual({ "1400": 476_000, "1766": -76_000, "8400": -400_000 });
    expect((await bank.listWriteOffs({ invoiceId: invoice.id })).map((w) => [w.kind, w.amount, w.reversed])).toEqual([["skonto", 9_520, true]]);
  }, 30_000);

  it("Forderungsausfall (Soll): mindert die Umsatzsteuer im Monat der Ausbuchung, Abgleich ohne Abweichung", async () => {
    await sql`update company set versteuerung = 'soll'`;
    const { invoice } = await finalInvoice(400_000);
    await bank.writeOff(actor, { kind: "forderungsausfall", invoiceId: invoice.id, date: "2026-10-15", amount: 200_000 });
    await expect(bank.writeOff(actor, { kind: "forderungsausfall", invoiceId: invoice.id, date: "2026-10-15", amount: 300_000 })).rejects.toThrow(/nur noch über 2760 €/);
    expect((await invoices.listInvoices("2026-10-20")).find((i) => i.id === invoice.id)).toMatchObject({ listStatus: "ueberfaellig", open: 276_000 });
    await bank.writeOff(actor, { kind: "forderungsausfall", invoiceId: invoice.id, date: "2026-10-15" });
    expect((await invoices.listInvoices("2026-10-20")).find((i) => i.id === invoice.id)).toMatchObject({ listStatus: "ausgebucht", open: 0 });

    const vat = await import("../umsatzsteuer/index.ts");
    const auswertungen = await import("../auswertungen/index.ts");
    const october = await vat.computeVatFigures({ year: 2026, month: 10 });
    expect(october).toMatchObject({ kz81: -400_000, tax81: -76_000 });
    expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz81).toBe(400_000);
    const abgleich = await auswertungen.vatAbgleich({ year: 2026, month: 10 });
    expect(abgleich.zeilen.filter((z) => z.journal !== z.quelle)).toEqual([]);

    const [first] = await sql`select id from write_offs order by created_at limit 1`;
    await bank.reverseWriteOff(actor, first!.id);
    expect((await invoices.listInvoices("2026-10-20")).find((i) => i.id === invoice.id)).toMatchObject({ open: 200_000 });
    expect((await vat.computeVatFigures({ year: 2026, month: 10 })).tax81).toBe(-76_000 + Math.round(76_000 * 200_000 / 476_000));
  }, 30_000);

  it("Skonto erhalten: Beleg erledigt, Vorsteuer anteilig gemindert", async () => {
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]);
    const { id: docId } = await documents.uploadDocument(actor, { bytes: JPEG, filename: "material.jpg" });
    await documents.updateDocument(actor, docId, {
      supplierName: "Bürowelt Nord GmbH",
      supplierUstId: "",
      invoiceNumber: "BW-1",
      documentDate: "2026-09-27",
      dueDate: null,
      category: "buero",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
    });
    await documents.bookDocument(actor, docId);
    await bank.importStatement(
      actor,
      { bytes: dkbCsv([outgoing("02.10.26", "Bürowelt Nord GmbH", "DE11100100100000000001", "BW-1 abzgl. 2 % Skonto", "-116,62")]), filename: "a.csv" },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    await bank.allocateWithRest(actor, { transactionId: tx!.id, target: { kind: "document", documentId: docId }, rest: "skontoErhalten" });
    const auswertungen = await import("../auswertungen/index.ts");
    expect((await auswertungen.openPositions("2026-10-05")).payables).toEqual([]);
    const vat = await import("../umsatzsteuer/index.ts");
    expect((await vat.computeVatFigures({ year: 2026, month: 10 })).kz66).toBe(-38);
    expect((await auswertungen.vatAbgleich({ year: 2026, month: 10 })).zeilen.filter((z) => z.journal !== z.quelle)).toEqual([]);
  }, 30_000);

  it("Zahlungsdienstleister: PayPal-Export ins eigene Verrechnungskonto, Auszahlung als Geldtransit zur Bank", async () => {
    const { invoice } = await finalInvoice(400_000);
    const paypal = await bank.createProviderAccount(actor, { name: "PayPal", provider: "paypal" });
    expect(paypal).toMatchObject({ iban: null, purpose: "zahlungsdienstleister", ledgerIndex: 1 });
    const csv = [
      `"Datum","Uhrzeit","Zeitzone","Name","Typ","Status","Währung","Brutto","Gebühr","Netto","Transaktionscode","Rechnungsnummer"`,
      `"01.10.2026","10:00:00","CEST","Nordwerk Software GmbH","Website-Zahlung","Abgeschlossen","EUR","4.760,00","-95,50","4.664,50","1AB","${invoice.number}"`,
      `"05.10.2026","08:00:00","CEST","DKB","Allgemeine Abbuchung","Abgeschlossen","EUR","-4.664,50","0,00","-4.664,50","2CD",""`,
    ].join("\n");
    const file = { bytes: new TextEncoder().encode(csv), filename: "paypal.csv" };
    await expect(bank.importStatement(actor, file, null)).rejects.toThrow(/Konto des Dienstleisters wählen/);
    const dkb = await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([
          incoming("06.10.26", "PayPal Europe S.a.r.l. et Cie S.C.A", "LU89751000135104200E", "Auszahlung PayPal", "4.664,50"),
          outgoing("07.10.26", "PayPal Europe S.a.r.l. et Cie S.C.A", "LU89751000135104200E", "Einkauf Bürobedarf", "-39,90"),
        ]),
        filename: "dkb.csv",
      },
      null,
    );
    await expect(bank.importStatement(actor, file, dkb.accountId)).rejects.toThrow(/Export eines Zahlungsdienstleisters/);
    expect(await bank.importStatement(actor, file, paypal.id)).toMatchObject({ added: 3 });

    const [payment] = await sql`select id from bank_transactions where amount = 476000`;
    const [fee] = await sql`select id from bank_transactions where amount = -9550`;
    const [payout] = await sql`select id from bank_transactions where amount = -466450`;
    const [incomingPayout] = await sql`select id from bank_transactions where amount = 466450`;
    const [purchase] = await sql`select id from bank_transactions where amount = -3990`;

    await bank.allocate(actor, { kind: "invoice", transactionId: payment!.id, invoiceId: invoice.id, amount: 476_000 });
    await bank.allocate(actor, { kind: "gebuehren", transactionId: fee!.id, amount: -9_550 });
    // Auszahlung: von beiden Seiten als Geldtransit erkannt, mit der jeweils anderen als Gegenbuchung
    expect((await bank.transactionDetail(payout!.id))?.direct).toMatchObject({ kind: "geldtransit", counterpart: { id: incomingPayout!.id } });
    expect((await bank.transactionDetail(incomingPayout!.id))?.direct).toMatchObject({ kind: "geldtransit", counterpart: { id: payout!.id } });
    // Ein mit PayPal bezahlter Einkauf hat keine Auszahlung als Gegenstück: kein Geldtransit-Vorschlag
    expect((await bank.transactionDetail(purchase!.id))?.direct).toBeNull();
    await expect(bank.allocateTransfer(actor, { transactionId: purchase!.id, counterpartId: payout!.id })).rejects.toThrow(/denselben Betrag/);
    await bank.allocateTransfer(actor, { transactionId: incomingPayout!.id, counterpartId: payout!.id });

    const balances = Object.fromEntries(
      (await sql`select account, sum(debit - credit)::int as saldo from journal_lines group by account having sum(debit - credit) <> 0 order by 1`).map((r) => [r.account, r.saldo]),
    );
    // Erlös voll (4.760), Gebühr Aufwand, Verrechnungskonto 1361 ausgeglichen, auf der Bank die Auszahlung
    expect(balances).toEqual({ "1200": 466_450, "1776": -76_000, "4970": 9_550, "8400": -400_000 });
    expect((await bank.listAccounts()).find((a) => a.id === paypal.id)).toMatchObject({ providerBalance: 0, openCount: 0 });
  }, 30_000);

  it("Gebühren eines Monats der Sammelrechnung des Dienstleisters zuordnen", async () => {
    const stripe = await bank.createProviderAccount(actor, { name: "Stripe", provider: "stripe" });
    const csv = [
      `id,Type,Source,Amount,Fee,Net,Currency,Created (UTC),Available On (UTC),Description`,
      `txn_1,charge,ch_1,100.00,1.50,98.50,eur,2026-10-01 10:00:00,2026-10-08 00:00:00,A`,
      `txn_2,charge,ch_2,200.00,3.00,197.00,eur,2026-10-15 10:00:00,2026-10-22 00:00:00,B`,
      `txn_3,charge,ch_3,50.00,1.00,49.00,eur,2026-11-02 10:00:00,2026-11-09 00:00:00,C`,
    ].join("\n");
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: "stripe.csv" }, stripe.id);
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 11]);
    const { id: docId } = await documents.uploadDocument(actor, { bytes: JPEG, filename: "stripe-oktober.jpg" });
    await documents.updateDocument(actor, docId, {
      supplierName: "Stripe Payments Europe",
      supplierUstId: "IE3206488LH",
      invoiceNumber: "STR-2026-10",
      documentDate: "2026-10-31",
      dueDate: null,
      category: "sonstiges",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 0, net: 450, tax: 0 }],
    });
    await documents.bookDocument(actor, docId);
    const [firstFee] = await sql`select id from bank_transactions where amount = -150`;
    expect(await bank.allocateFeesToDocument(actor, { transactionId: firstFee!.id, documentId: docId })).toBe(2);
    // Oktober erledigt, November bleibt offen
    const open = await sql`select amount from bank_transactions t where amount < 0
      and amount - coalesce((select sum(a.amount) from allocations a where a.transaction_id = t.id), 0) <> 0`;
    expect(open.map((r) => r.amount)).toEqual([-100]);
    await expect(bank.allocateFeesToDocument(actor, { transactionId: firstFee!.id, documentId: docId })).rejects.toThrow(/Keine offene Gebühr/);
  }, 30_000);

  it("Belegzahlung und Privatentnahme", async () => {
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7]);
    const { id: docId } = await documents.uploadDocument(actor, { bytes: JPEG, filename: "telekom.jpg" });
    await documents.updateDocument(actor, docId, {
      supplierName: "Telekom Deutschland GmbH",
      supplierUstId: "",
      invoiceNumber: "MF-09",
      documentDate: "2026-09-27",
      dueDate: null,
      category: "telefon",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: 3857, tax: 733 }],
    });
    await documents.bookDocument(actor, docId);
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([
          outgoing("29.09.26", "Telekom Deutschland GmbH", "DE11100100100000000001", "Mobilfunk MF-09", "-45,90"),
          outgoing("24.09.26", "Eigene Überweisung", "DE33100100100000000002", "Umbuchung auf Privatkonto", "-3.000,00"),
        ]),
        filename: "a.csv",
      },
      null,
    );
    const txs = await sql`select id, amount from bank_transactions order by amount`;
    const privat = txs[0]!;
    const telekom = txs[1]!;

    const detail = await bank.transactionDetail(telekom.id);
    expect(detail?.suggestions[0]?.item).toMatchObject({ type: "document", id: docId, open: -4590 });
    await bank.allocate(actor, { kind: "document", transactionId: telekom.id, documentId: docId, amount: -4590 });
    await bank.allocate(actor, { kind: "privat", transactionId: privat.id, amount: -300_000 });

    const lines = await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_type = 'allocation' order by l.account, l.debit`;
    expect(lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ["1200", 0, 4590],
      ["1200", 0, 300_000],
      ["1600", 4590, 0],
      ["1800", 300_000, 0],
    ]);
    expect(await bank.openItems()).toEqual([]);
    const accounts = await bank.listAccounts();
    expect(accounts[0]?.openCount).toBe(0);
  }, 30_000);

  it("Storno einer bezahlten Rechnung: Erstattung wird der Stornorechnung zugeordnet und mindert die Umsatzsteuer (Ist)", async () => {
    const { invoice } = await finalInvoice(400_000);
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([
          outgoing("15.10.26", "Nordwerk Software GmbH", "DE02100100100006820101", "Erstattung RE 2026-001", "-4.760,00"),
          incoming("20.09.26", "Nordwerk Software GmbH", "DE02100100100006820101", "RE 2026-001", "4.760,00"),
        ]),
        filename: "a.csv",
      },
      null,
    );
    const [refundTx] = await sql`select id from bank_transactions where amount < 0`;
    const [paymentTx] = await sql`select id from bank_transactions where amount > 0`;
    await bank.allocate(actor, { kind: "invoice", transactionId: paymentTx!.id, invoiceId: invoice.id, amount: 476_000 });

    const storno = await invoices.cancelInvoice(actor, invoice.id, "2026-10-10");
    const items = await bank.openItems();
    expect(items.map((i) => [i.id, i.open])).toEqual([[storno.id, -476_000]]);
    expect((await invoices.listInvoices("2026-10-12")).find((i) => i.id === storno.id)).toMatchObject({ listStatus: "storno", open: -476_000 });
    // Die stornierte Rechnung selbst nimmt keine Erstattung an
    await expect(
      bank.allocate(actor, { kind: "invoice", transactionId: refundTx!.id, invoiceId: invoice.id, amount: -476_000 }),
    ).rejects.toThrow(/storniert/);

    await bank.allocate(actor, { kind: "invoice", transactionId: refundTx!.id, invoiceId: storno.id, amount: -476_000 });
    expect(await bank.openItems()).toEqual([]);
    const balances = await sql`select account, sum(debit) - sum(credit) as saldo from journal_lines group by account order by account`;
    const saldo = Object.fromEntries(balances.map((b) => [b.account, Number(b.saldo)]));
    // Forderung und noch nicht fällige Steuer sind ausgeglichen, die fällige Umsatzsteuer ist wieder 0
    expect(saldo).toMatchObject({ "1400": 0, "1766": 0, "1776": 0, "1200": 0 });
    const figures = await import("../umsatzsteuer/vat-figures.ts");
    expect((await figures.computeVatFigures({ year: 2026, month: 10 })).kz81).toBe(-400_000);
  }, 30_000);

  it("Datei ohne IBAN braucht ein gewähltes Konto", async () => {
    const n26 = new TextEncoder().encode(
      '"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"\n' +
        '2026-09-28,2026-09-28,"JetBrains s.r.o.",,Presentment,"WebStorm","Main Account",-24.90,,,\n',
    );
    await expect(bank.importStatement(actor, { bytes: n26, filename: "n26.csv" }, null)).rejects.toThrow(/keine IBAN/);
    const account = await bank.createAccount(actor, { name: "N26 Business", iban: "DE55100110012620000000" });
    const result = await bank.importStatement(actor, { bytes: n26, filename: "n26.csv" }, account.id);
    expect(result).toMatchObject({ added: 1, accountName: "N26 Business" });
  });
});
