import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { today as heute } from "../../today.ts";
import { addDays } from "@haben/core";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

const PDF = new TextEncoder().encode("%PDF-1.4\n% RE1019 aus Lexoffice\n%%EOF\n");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);

describe.skipIf(!testDatabaseUrl)("Offene Posten aus Lexoffice (Postgres)", () => {
  let legacy: typeof import("./legacy-open.ts");
  let bank: typeof import("../bank/bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let figures: typeof import("../umsatzsteuer/vat-figures.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let storage: typeof import("../../storage.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    legacy = await import("./legacy-open.ts");
    bank = await import("../bank/bank.ts");
    invoices = await import("../rechnungen/invoices.ts");
    figures = await import("../umsatzsteuer/vat-figures.ts");
    reports = await import("../auswertungen/reports.ts");
    storage = await import("../../storage.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function legacyVoucher(values: {
    type: string;
    direction: "einnahme" | "ausgabe";
    number: string;
    date: string;
    net: number;
    tax: number;
    rate?: number;
    status?: string;
    openAmount?: number | null;
    /** Zahlungen laut Lexoffice; mit Zahlungen ist der Beleg heute so weit bezahlt */
    payments?: { date: string; amount: number; type?: string }[];
    file?: Uint8Array;
    mime?: string;
    contact?: string;
    category?: string;
  }) {
    const rate = values.rate ?? 1900;
    const gross = values.net + values.tax;
    const items = (values.payments ?? []).map((p) => ({ type: p.type ?? "partPaymentFinancialTransaction", date: p.date, amount: p.amount }));
    const paid = items.reduce((s, i) => s + Math.abs(i.amount), 0);
    const payment =
      values.openAmount === null
        ? null
        : { status: paid >= gross ? "balanced" : "openRevenue", openAmount: values.openAmount ?? gross - paid, paidDate: null, items };
    const [contact] = values.contact ? await sql`select id from contacts where name = ${values.contact}` : [];
    const [row] = await sql`insert into lexoffice_vouchers (lexoffice_id, import_id, type, direction, number, date, due_date, status, contact_id,
        contact_name, net, tax, gross, taxes, categories, payment, raw)
      values (${crypto.randomUUID()}, (select id from lexoffice_imports limit 1), ${values.type}, ${values.direction}, ${values.number},
        ${values.date}, ${values.date}, ${values.status ?? "open"}, ${contact?.id ?? null}, ${values.contact ?? "Bürobedarf Schmidt KG"},
        ${values.net}, ${values.tax}, ${gross}, ${JSON.stringify([{ rate, net: values.net, tax: values.tax }])}::jsonb,
        ${JSON.stringify(values.direction === "ausgabe" ? [{ categoryId: "x", name: values.category ?? "Bürobedarf", rate, net: values.net, tax: values.tax }] : [])}::jsonb,
        ${payment ? JSON.stringify(payment) : null}::jsonb, ${JSON.stringify({ address: { name: values.contact ?? "" } })}::jsonb)
      returning id`;
    if (values.file) {
      const sha = await storage.storeFile(values.file);
      await sql`insert into lexoffice_voucher_files (voucher_id, role, filename, mime_type, sha256, size)
        values (${row!.id}, ${values.mime === "application/pdf" ? "pdf" : "anhang"}, ${values.number + (values.mime === "application/pdf" ? ".pdf" : ".jpg")},
          ${values.mime ?? "application/pdf"}, ${sha}, ${values.file.byteLength})`;
    }
    return row!.id as string;
  }

  beforeEach(async () => {
    await sql`truncate allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, document_amounts, documents,
      invoice_lines, invoices, lexoffice_voucher_files, lexoffice_vouchers, lexoffice_imports, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
    await sql`insert into contacts (name, strasse, plz, ort) values ('Nordwerk Software GmbH', 'Hafenstraße 5', '20457', 'Hamburg')`;
    await sql`insert into lexoffice_imports (status, progress) values ('fertig', ${JSON.stringify({ phase: "fertig" })}::jsonb)`;
  });

  it("listet offene Posten mit Gründen, wenn etwas nicht geht", async () => {
    await legacyVoucher({
      type: "invoice",
      direction: "einnahme",
      number: "RE1019",
      date: "2026-09-20",
      net: 400_000,
      tax: 76_000,
      file: PDF,
      contact: "Nordwerk Software GmbH",
    });
    await legacyVoucher({
      type: "invoice",
      direction: "einnahme",
      number: "RE1020",
      date: "2026-09-21",
      net: 100_000,
      tax: 19_000,
      openAmount: 50_000,
      file: PDF,
    });
    await legacyVoucher({
      type: "invoice",
      direction: "einnahme",
      number: "RE1018",
      date: "2026-08-01",
      net: 100_000,
      tax: 19_000,
      status: "paid",
      openAmount: 0,
      file: PDF,
    });
    await legacyVoucher({ type: "invoice", direction: "einnahme", number: "RE1021", date: "2026-09-22", net: 100_000, tax: 16_000, rate: 1600, file: PDF });
    await legacyVoucher({ type: "purchaseinvoice", direction: "ausgabe", number: "B-77", date: "2026-09-25", net: 10_000, tax: 1_900, openAmount: null });
    const items = await legacy.openLegacyItems();
    expect(items.map((i) => [i.number, i.open, i.blocker])).toEqual([
      ["RE1019", 476_000, null],
      ["RE1020", 50_000, expect.stringMatching(/teilweise bezahlt/)],
      ["RE1021", 116_000, "Steuersatz, den Haben nicht kennt"],
      ["B-77", 11_900, "keine Datei aus Lexoffice"],
    ]);
  });

  it("übernimmt eine offene Rechnung; Zahlung im Bankabgleich macht die Umsatzsteuer fällig (Ist)", async () => {
    const id = await legacyVoucher({
      type: "invoice",
      direction: "einnahme",
      number: "RE1019",
      date: "2026-09-20",
      net: 400_000,
      tax: 76_000,
      file: PDF,
      contact: "Nordwerk Software GmbH",
    });
    const result = await legacy.takeOverLegacyItem(actor, id);
    expect(result.kind).toBe("invoice");
    await expect(legacy.takeOverLegacyItem(actor, id)).rejects.toThrow(/Schon übernommen/);

    const [invoice] = await sql`select number, status, gross, pdf, locked_at, lexoffice_voucher_id from invoices where id = ${result.id}`;
    expect(invoice).toMatchObject({ number: "RE1019", status: "final", gross: 476_000, lexoffice_voucher_id: id });
    expect(Buffer.from(invoice!.pdf as Uint8Array).toString()).toContain("RE1019 aus Lexoffice");
    const lines =
      await sql`select account, debit, credit from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_id = ${result.id} order by account`;
    expect(lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ["1400", 476_000, 0],
      ["1766", 0, 76_000],
      ["9000", 0, 400_000],
    ]);
    expect((await invoices.listInvoices("2026-10-05")).find((i) => i.id === result.id)).toMatchObject({ listStatus: "ueberfaellig", open: 476_000 });

    // Die Zahlung im Oktober wird vorgeschlagen und macht die Steuer im Oktober fällig
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([
          ["05.10.26", "05.10.26", "Gebucht", "Nordwerk Software GmbH", "Testfirma", "RE1019", "Eingang", "DE02100100100006820101", "4.760,00", "", "", ""],
        ]),
        filename: "a.csv",
      },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    const detail = await bank.transactionDetail(tx!.id);
    expect(detail?.suggestions[0]?.item).toMatchObject({ type: "invoice", id: result.id });
    await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId: result.id, amount: 476_000 });
    const october = await figures.computeVatFigures({ year: 2026, month: 10 });
    expect(october).toMatchObject({ kz81: 400_000, tax81: 76_000 });
    const september = await figures.computeVatFigures({ year: 2026, month: 9 });
    expect(september.kz81).toBe(0);
  });

  it("Storno einer übernommenen Rechnung hebt die Eröffnungsbuchung auf, ohne Erlöse zu buchen", async () => {
    const id = await legacyVoucher({
      type: "invoice",
      direction: "einnahme",
      number: "RE1019",
      date: "2026-09-20",
      net: 400_000,
      tax: 76_000,
      file: PDF,
      contact: "Nordwerk Software GmbH",
    });
    const { id: invoiceId } = await legacy.takeOverLegacyItem(actor, id);
    await invoices.cancelInvoice(actor, invoiceId, "2026-10-10");
    const balances = await sql`select account, sum(debit) - sum(credit) as saldo from journal_lines group by account order by account`;
    expect(balances.map((b) => [b.account, Number(b.saldo)])).toEqual([
      ["1400", 0],
      ["1766", 0],
      ["9000", 0],
    ]);
    expect(await bank.openItems()).toEqual([]);
  });

  it("übernimmt eine in Lexoffice brutto gerechnete Rechnung centgenau, das Storno hebt sie exakt auf", async () => {
    // 9,80 € brutto: 8,24 € netto, 1,56 € Steuer; netto nachgerechnet wären es 1,57 €
    const id = await legacyVoucher({
      type: "invoice",
      direction: "einnahme",
      number: "RE1022",
      date: "2026-09-20",
      net: 824,
      tax: 156,
      file: PDF,
      contact: "Nordwerk Software GmbH",
    });
    const { id: invoiceId } = await legacy.takeOverLegacyItem(actor, id);
    const [invoice] = await sql`select price_mode, net, tax, gross from invoices where id = ${invoiceId}`;
    expect({ ...invoice }).toEqual({ price_mode: "brutto", net: 824, tax: 156, gross: 980 });
    const storno = await invoices.cancelInvoice(actor, invoiceId, "2026-10-10");
    expect(storno).toMatchObject({ priceMode: "brutto", net: -824, tax: -156, gross: -980 });
    const taxes = await sql`select base, tax from invoice_taxes where invoice_id = ${storno.id}`;
    expect(taxes.map((t) => ({ ...t }))).toEqual([{ base: -824, tax: -156 }]);
  });

  it("Soll: Storno einer übernommenen Rechnung mindert die in Lexoffice angemeldete Umsatzsteuer", async () => {
    await sql`update company set versteuerung = 'soll'`;
    const id = await legacyVoucher({
      type: "invoice",
      direction: "einnahme",
      number: "RE1019",
      date: "2026-09-20",
      net: 400_000,
      tax: 76_000,
      file: PDF,
      contact: "Nordwerk Software GmbH",
    });
    const { id: invoiceId } = await legacy.takeOverLegacyItem(actor, id);
    await invoices.cancelInvoice(actor, invoiceId, "2026-10-10");
    const balances = await sql`select account, sum(debit) - sum(credit) as saldo from journal_lines group by account order by account`;
    expect(balances.map((b) => [b.account, Number(b.saldo)])).toEqual([
      ["1400", 0],
      ["1776", 76_000],
      ["9000", -76_000],
    ]);
    expect(await figures.computeVatFigures({ year: 2026, month: 10 })).toMatchObject({ kz81: -400_000, tax81: -76_000 });
  });

  it("Soll: Storno einer übernommenen Rechnung zu 0 % meldet im Abgleich keine Abweichung (Review #547)", async () => {
    await sql`update company set versteuerung = 'soll'`;
    // In Lexoffice ohne Umsatzsteuer gestellt (etwa an einen Kunden im EU-Ausland), übernommen als 0 %
    const id = await legacyVoucher({
      type: "invoice",
      direction: "einnahme",
      number: "RE1030",
      date: "2026-09-20",
      net: 400_000,
      tax: 0,
      rate: 0,
      file: PDF,
      contact: "Nordwerk Software GmbH",
    });
    const { id: invoiceId } = await legacy.takeOverLegacyItem(actor, id);
    await invoices.cancelInvoice(actor, invoiceId, "2026-10-10");
    const abgleich = await import("../auswertungen/abgleich.ts");
    const found = abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2026, month: 10 })).zeilen);
    expect(found).toEqual([]);
  });

  it("Soll: die Rechnung zählt nicht noch einmal in der Voranmeldung", async () => {
    await sql`update company set versteuerung = 'soll'`;
    const id = await legacyVoucher({ type: "invoice", direction: "einnahme", number: "RE1019", date: "2026-09-20", net: 400_000, tax: 76_000, file: PDF });
    const result = await legacy.takeOverLegacyItem(actor, id);
    const lines =
      await sql`select account, debit, credit from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_id = ${result.id} order by account`;
    expect(lines.map((l) => [l.account, l.debit, l.credit])).toEqual([
      ["1400", 476_000, 0],
      ["9000", 0, 476_000],
    ]);
    expect((await figures.computeVatFigures({ year: 2026, month: 9 })).kz81).toBe(0);
    const [contact] = await sql`select name from contacts c join invoices i on i.contact_id = c.id where i.id = ${result.id}`;
    expect(contact!.name).toBe("Bürobedarf Schmidt KG");
  });

  it.each([
    ["Wareneingang 19 %", "wareneinkauf"],
    ["Waren, Roh- und Hilfsstoffe", "wareneinkauf"],
    ["Fremdleistungen", "fremdleistung"],
  ])("leitet aus der Kategorie „%s“ die Kategorie %s ab", async (category, expected) => {
    const id = await legacyVoucher({
      type: "purchaseinvoice",
      direction: "ausgabe",
      number: "B-78",
      date: "2026-09-25",
      net: 10_000,
      tax: 1_900,
      category,
      file: JPEG,
      mime: "image/jpeg",
    });
    await legacy.takeOverAll(actor);
    const [doc] = await sql`select category from documents where lexoffice_voucher_id = ${id}`;
    expect(doc!.category).toBe(expected);
  });

  it("übernimmt einen offenen Eingangsbeleg; die Vorsteuer zählt nicht doppelt", async () => {
    const id = await legacyVoucher({
      type: "purchaseinvoice",
      direction: "ausgabe",
      number: "B-77",
      date: "2026-09-25",
      net: 10_000,
      tax: 1_900,
      file: JPEG,
      mime: "image/jpeg",
    });
    const results = await legacy.takeOverAll(actor);
    expect(results).toEqual([{ number: "B-77" }]);
    const [doc] = await sql`select id, status, category, gross, locked_at from documents where lexoffice_voucher_id = ${id}`;
    expect(doc).toMatchObject({ status: "gebucht", category: "buero", gross: 11_900 });
    expect(doc!.locked_at).not.toBeNull();
    expect((await figures.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(0);
    expect((await bank.openItems()).map((i) => [i.type, i.id])).toEqual([["document", doc!.id]]);

    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([
          ["30.09.26", "30.09.26", "Gebucht", "Testfirma", "Bürobedarf Schmidt KG", "B-77", "Ausgang", "DE02100100100006820101", "-119,00", "", "", ""],
        ]),
        filename: "b.csv",
      },
      null,
    );
    const [tx] = await sql`select id from bank_transactions`;
    await bank.allocate(actor, { kind: "document", transactionId: tx!.id, documentId: doc!.id, amount: -11_900 });
    expect(await bank.openItems()).toEqual([]);
    const [balance] = await sql`select sum(debit) - sum(credit) as saldo from journal_lines where account = '1600'`;
    expect(Number(balance!.saldo)).toBe(0);
  });

  describe("zum Stichtag: offen am Ende der alten Buchhaltung, gebucht am ersten Tag in Haben", () => {
    // Echte Daten: Die alte Buchhaltung endet am 31.12. des Vorjahres, Haben beginnt am 1.1.
    const year = Number(heute().slice(0, 4));
    const alt = year - 1;
    const K = {
      SKR03: { forderung: "1400", nichtFaellig: "1766", verbindlichkeit: "1600", ustVorauszahlung: "1780" },
      SKR04: { forderung: "1200", nichtFaellig: "3816", verbindlichkeit: "3300", ustVorauszahlung: "3820" },
    } as const;
    const ddmmyy = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(2, 4)}`;

    async function lines(sourceId: string) {
      const rows = await sql`select e.date::text as date, l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
        where e.source_id = ${sourceId} order by l.account`;
      return rows.map((r) => [r.date, r.account, r.debit, r.credit]);
    }

    async function payIn(date: string, reference: string, amount: string) {
      await bank.importStatement(
        actor,
        {
          bytes: dkbCsv([
            [ddmmyy(date), ddmmyy(date), "Gebucht", "Nordwerk Software GmbH", "Testfirma", reference, "Eingang", "DE02100100100006820101", amount, "", "", ""],
          ]),
          filename: `${reference}.csv`,
        },
        null,
      );
      const [tx] = await sql`select id from bank_transactions order by booking_date desc limit 1`;
      return tx!.id as string;
    }

    describe.each(["SKR03", "SKR04"] as const)("%s", (kontenrahmen) => {
      const k = K[kontenrahmen];

      it.each(["ist", "soll"] as const)(
        "%s: im Januar bezahlte Rechnung war am 31.12. offen; Übernahme zum 1.1., die Zahlung zählt im Januar",
        async (versteuerung) => {
          await sql`update company set kontenrahmen = ${kontenrahmen}, versteuerung = ${versteuerung}`;
          const id = await legacyVoucher({
            type: "invoice",
            direction: "einnahme",
            number: "RE-A",
            date: `${alt}-12-10`,
            net: 100_000,
            tax: 19_000,
            status: "paid",
            payments: [{ date: `${year}-01-15`, amount: 119_000 }],
            file: PDF,
            contact: "Nordwerk Software GmbH",
          });
          // Im Dezember bezahlt: in der alten Buchhaltung erledigt
          await legacyVoucher({
            type: "invoice",
            direction: "einnahme",
            number: "RE-B",
            date: `${alt}-12-01`,
            net: 100_000,
            tax: 19_000,
            status: "paid",
            payments: [{ date: `${alt}-12-20`, amount: 119_000 }],
            file: PDF,
          });
          expect((await legacy.openLegacyItems()).map((i) => [i.number, i.open, i.paidAfter, i.blocker])).toEqual([["RE-A", 119_000, 119_000, null]]);

          const { id: invoiceId } = await legacy.takeOverLegacyItem(actor, id);
          expect(await lines(invoiceId)).toEqual(
            versteuerung === "ist"
              ? [
                  [`${year}-01-01`, k.forderung, 119_000, 0],
                  [`${year}-01-01`, k.nichtFaellig, 0, 19_000],
                  [`${year}-01-01`, "9000", 0, 100_000],
                ]
              : [
                  [`${year}-01-01`, k.forderung, 119_000, 0],
                  [`${year}-01-01`, "9000", 0, 119_000],
                ],
          );

          const transactionId = await payIn(`${year}-01-15`, "RE-A", "1.190,00");
          await bank.allocate(actor, { kind: "invoice", transactionId, invoiceId, amount: 119_000 });
          expect(await bank.openItems()).toEqual([]);
          const [forderung] = await sql`select sum(debit) - sum(credit) as saldo from journal_lines where account = ${k.forderung}`;
          expect(Number(forderung!.saldo)).toBe(0);
          // Ist: Die Steuer war in der alten Buchhaltung nicht angemeldet und wird mit der Zahlung im Januar fällig; Soll: schon angemeldet
          expect(await figures.computeVatFigures({ year, month: 1 })).toMatchObject(
            versteuerung === "ist" ? { kz81: 100_000, tax81: 19_000 } : { kz81: 0, tax81: 0 },
          );
          // EÜR: Zufluss im Januar (§ 11 Abs. 1 Satz 1 EStG), also Einnahme im ersten Jahr in Haben
          const euer = await reports.euerForYear(year);
          expect(euer.totalEinnahmen).toBe(119_000);
        },
      );

      it.each(["ist", "soll"] as const)(
        "%s: Einzelunternehmen: nach der ersten Übernahme steht der Stichtag fest, ein anderer wird abgelehnt",
        async (versteuerung) => {
          await sql`update company set kontenrahmen = ${kontenrahmen}, versteuerung = ${versteuerung}`;
          const juni = await legacyVoucher({
            type: "invoice",
            direction: "einnahme",
            number: "RE-J",
            date: `${alt}-06-10`,
            net: 100_000,
            tax: 19_000,
            status: "paid",
            payments: [{ date: `${alt}-07-05`, amount: 119_000 }],
            file: PDF,
          });
          // Am 30.06. offen, im September bezahlt: Mit dem 31.12. als Stichtag fiele er aus der Liste, obwohl die Zahlung
          // nach dem ersten Tag in Haben liegt und dort ankommt
          const mai = await legacyVoucher({
            type: "invoice",
            direction: "einnahme",
            number: "RE-K",
            date: `${alt}-05-10`,
            net: 50_000,
            tax: 9_500,
            status: "paid",
            payments: [{ date: `${alt}-09-10`, amount: 59_500 }],
            file: PDF,
          });
          const a = `${alt}-06-30`;
          const b = `${alt}-12-31`;
          await legacy.takeOverLegacyItem(actor, juni, a);

          const fixed = { date: a, bookingDate: `${alt}-07-01`, fixed: expect.stringMatching(/übernommen/) };
          expect(await legacy.legacyTakeoverCutoff()).toEqual(fixed);
          expect(await legacy.legacyTakeoverCutoff(a)).toEqual(fixed);
          await expect(legacy.legacyTakeoverCutoff(b)).rejects.toThrow(/Stichtag/);
          await expect(legacy.takeOverLegacyItem(actor, mai, b)).rejects.toThrow(/Stichtag/);
          await expect(legacy.takeOverAll(actor, b)).rejects.toThrow(/Stichtag/);
          expect(await legacy.openItemsOverview(b)).toMatchObject({ cutoff: fixed, cutoffError: expect.stringMatching(/Stichtag/) });
          // Ohne gewählten Stichtag gilt der feste: Der zweite Posten kommt zum selben Tag dazu
          expect(await legacy.takeOverAll(actor)).toEqual([{ number: "RE-K" }]);
          const dates = await sql`select distinct e.date::text as date from journal_entries e join invoices i on i.id = e.source_id
            where i.lexoffice_voucher_id is not null`;
          expect(dates.map((d) => d.date)).toEqual([`${alt}-07-01`]);
        },
      );

      it("im Januar bezahlter Eingangsbeleg: Saldenvortrag an Verbindlichkeiten zum 1.1.", async () => {
        await sql`update company set kontenrahmen = ${kontenrahmen}`;
        const id = await legacyVoucher({
          type: "purchaseinvoice",
          direction: "ausgabe",
          number: "B-1",
          date: `${alt}-12-28`,
          net: 10_000,
          tax: 1_900,
          status: "paid",
          payments: [{ date: `${year}-01-05`, amount: -11_900 }],
          file: JPEG,
          mime: "image/jpeg",
        });
        expect(await legacy.takeOverAll(actor)).toEqual([{ number: "B-1" }]);
        const [doc] = await sql`select id from documents where lexoffice_voucher_id = ${id}`;
        expect(await lines(doc!.id)).toEqual([
          [`${year}-01-01`, k.verbindlichkeit, 0, 11_900],
          [`${year}-01-01`, "9000", 11_900, 0],
        ]);
      });

      // #269: Die Zahllast der letzten Voranmeldung ist in Lexware Office ein offener Posten des Finanzamts („UStVA-2026-10“)
      it.each(["ist", "soll"] as const)(
        "%s: offene Zahllast an das Finanzamt wird kein Ausgabebeleg; die Zahlung zählt als gezahlte Umsatzsteuer",
        async (versteuerung) => {
          await sql`update company set kontenrahmen = ${kontenrahmen}, versteuerung = ${versteuerung}`;
          const id = await legacyVoucher({
            type: "purchaseinvoice",
            direction: "ausgabe",
            number: `UStVA-${alt}-12`,
            date: `${alt}-12-31`,
            net: 775_494,
            tax: 0,
            rate: 0,
            status: "paid",
            payments: [{ date: `${year}-01-10`, amount: -775_494 }],
            file: PDF,
            contact: "Finanzamt Regensburg",
            category: "Sonstige Ausgaben",
          });
          const [item] = await legacy.openLegacyItems();
          expect(item).toMatchObject({ number: `UStVA-${alt}-12`, open: 775_494, blocker: expect.stringMatching(/Umsatzsteuer an das Finanzamt/) });
          await expect(legacy.takeOverLegacyItem(actor, id)).rejects.toThrow(/Umsatzsteuer an das Finanzamt/);
          expect(await legacy.takeOverAll(actor)).toEqual([]);
          expect(await sql`select id from documents`).toHaveLength(0);

          await bank.importStatement(
            actor,
            {
              bytes: dkbCsv([
                [
                  ddmmyy(`${year}-01-10`),
                  ddmmyy(`${year}-01-10`),
                  "Gebucht",
                  "Testfirma",
                  "Finanzamt Regensburg",
                  `St.-Nr. 198/113/10010 UStVA 12/${alt}`,
                  "Ausgang",
                  "DE21300500000001234567",
                  "-7.754,94",
                  "",
                  "",
                  "",
                ],
              ]),
              filename: "fa.csv",
            },
            null,
          );
          const [tx] = await sql`select id from bank_transactions`;
          await bank.allocate(actor, { kind: "ustVorauszahlung", transactionId: tx!.id, amount: -775_494 });
          const [vorauszahlung] = await sql`select sum(debit) - sum(credit) as saldo from journal_lines where account = ${k.ustVorauszahlung}`;
          expect(Number(vorauszahlung!.saldo)).toBe(775_494);
          const euer = await reports.euerForYear(year);
          expect(euer.ausgaben.find((l) => l.key === "gezahlteUst")?.amount).toBe(775_494);
          expect(euer.ausgaben.find((l) => l.key === "ausgabe:sonstiges")).toBeUndefined();
        },
      );
    });

    it("Teilzahlung vor dem Stichtag sperrt mit Grund, danach nicht; nach dem Stichtag ausgestellt gehört in Haben", async () => {
      await legacyVoucher({
        type: "invoice",
        direction: "einnahme",
        number: "RE-T1",
        date: `${alt}-11-10`,
        net: 100_000,
        tax: 19_000,
        payments: [{ date: `${alt}-12-15`, amount: 50_000 }],
        file: PDF,
      });
      await legacyVoucher({
        type: "invoice",
        direction: "einnahme",
        number: "RE-T2",
        date: `${alt}-11-11`,
        net: 100_000,
        tax: 19_000,
        payments: [{ date: `${year}-01-15`, amount: 50_000 }],
        file: PDF,
      });
      await legacyVoucher({ type: "invoice", direction: "einnahme", number: "RE-N", date: `${year}-01-10`, net: 100_000, tax: 19_000, file: PDF });
      // Reicht die alte Buchhaltung ins neue Jahr, schlägt Haben den Tag vor heute vor; hier endet sie am 31.12.
      expect((await legacy.legacyTakeoverCutoff()).date).toBe(addDays(heute(), -1));
      const cutoff = `${alt}-12-31`;
      expect((await legacy.openLegacyItems(cutoff)).map((i) => [i.number, i.open, i.paidAfter, i.blocker])).toEqual([
        ["RE-T1", 69_000, 0, expect.stringMatching(/^bis zum Stichtag teilweise bezahlt/)],
        ["RE-T2", 119_000, 50_000, null],
        ["RE-N", 119_000, 0, expect.stringMatching(/^nach dem Stichtag ausgestellt/)],
      ]);
      expect(await legacy.takeOverAll(actor, cutoff)).toEqual([{ number: "RE-T2" }]);
      const [invoice] = await sql`select gross from invoices where number = 'RE-T2'`;
      expect(invoice!.gross).toBe(119_000);
    });

    it("gewählter Stichtag unter dem Jahr: offen an diesem Tag, gebucht am Tag danach; ein Stichtag ab heute geht nicht", async () => {
      const id = await legacyVoucher({
        type: "invoice",
        direction: "einnahme",
        number: "RE-M",
        date: `${alt}-06-10`,
        net: 100_000,
        tax: 19_000,
        status: "paid",
        payments: [{ date: `${alt}-07-05`, amount: 119_000 }],
        file: PDF,
      });
      expect(await legacy.openLegacyItems()).toEqual([]);
      const cutoff = await legacy.legacyTakeoverCutoff(`${alt}-06-30`);
      expect(cutoff).toEqual({ date: `${alt}-06-30`, bookingDate: `${alt}-07-01`, fixed: null });
      expect((await legacy.openLegacyItems(`${alt}-06-30`)).map((i) => [i.number, i.blocker])).toEqual([["RE-M", null]]);
      await expect(legacy.openLegacyItems(heute())).rejects.toThrow(/vor heute/);
      expect(await legacy.openItemsOverview(heute())).toMatchObject({ cutoff: { date: `${alt}-12-31` }, cutoffError: expect.stringMatching(/vor heute/) });
      const { id: invoiceId } = await legacy.takeOverLegacyItem(actor, id, `${alt}-06-30`);
      expect((await lines(invoiceId)).map(([date]) => date)).toEqual([`${alt}-07-01`, `${alt}-07-01`, `${alt}-07-01`]);
      // Schon übernommen bleibt sichtbar; der Stichtag steht jetzt fest
      expect(await legacy.openLegacyItems()).toMatchObject([{ number: "RE-M", open: 119_000, takenOver: { kind: "invoice", id: invoiceId } }]);
    });

    it("GmbH: der Stichtag ist ein 31.12.; mit gebuchter Eröffnung steht er fest", async () => {
      await sql`update company set rechtsform = 'gmbh'`;
      await expect(legacy.legacyTakeoverCutoff(`${alt}-06-30`)).rejects.toThrow(/31\. Dezember/);
      const manual = await import("../buchhaltung/manual.ts");
      await manual.createManualEntry(
        actor,
        {
          kind: "eroeffnung",
          date: `${year}-01-01`,
          description: "Eröffnungsbilanz",
          lines: [
            { account: "1200", debit: 2_500_000, credit: 0 },
            { account: "9000", debit: 0, credit: 2_500_000 },
          ],
        },
        heute(),
      );
      expect(await legacy.legacyTakeoverCutoff(`${alt}-06-30`)).toEqual({
        date: `${alt}-12-31`,
        bookingDate: `${year}-01-01`,
        fixed: expect.stringMatching(/Eröffnung am 01\.01\./),
      });
    });

    it("legt eine Eröffnung den Stichtag nach der Anzeige fest, bricht die Übernahme mit dem angezeigten Stichtag ab", async () => {
      await sql`update company set rechtsform = 'gmbh'`;
      const vorjahr = alt - 1;
      const id = await legacyVoucher({
        type: "invoice",
        direction: "einnahme",
        number: "RE-R",
        date: `${vorjahr}-12-10`,
        net: 100_000,
        tax: 19_000,
        file: PDF,
      });
      // Angezeigt: Stichtag 31.12.alt, gebucht zum 1.1.
      expect((await legacy.openItemsOverview(`${alt}-12-31`)).cutoff).toEqual({ date: `${alt}-12-31`, bookingDate: `${year}-01-01`, fixed: null });
      // Inzwischen bucht jemand die Eröffnung zum 1.1.alt; der Stichtag ist jetzt der 31.12. davor
      const manual = await import("../buchhaltung/manual.ts");
      await manual.createManualEntry(
        actor,
        {
          kind: "eroeffnung",
          date: `${alt}-01-01`,
          description: "Eröffnungsbilanz",
          lines: [
            { account: "1200", debit: 2_500_000, credit: 0 },
            { account: "9000", debit: 0, credit: 2_500_000 },
          ],
        },
        heute(),
      );
      await expect(legacy.takeOverLegacyItem(actor, id, `${alt}-12-31`)).rejects.toThrow(/Stichtag hat sich inzwischen geändert/);
      await expect(legacy.takeOverAll(actor, `${alt}-12-31`)).rejects.toThrow(/Stichtag hat sich inzwischen geändert/);
      expect(await sql`select 1 from invoices where lexoffice_voucher_id = ${id}`).toHaveLength(0);
    });
  });
});
