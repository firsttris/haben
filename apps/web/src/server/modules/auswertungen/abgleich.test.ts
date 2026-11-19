import { formatEuro } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "./test-umsatz-stand.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

const eingang = (date: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Nordwerk",
  "Testfirma",
  purpose,
  "Eingang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];
const ausgang = (date: string, name: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Testfirma",
  name,
  "Zahlung",
  "Ausgang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];

/*
 * Abgleich im Journal (#1116): Verprobung der Umsatzsteuer, gesendete Voranmeldungen, Beleg gegen Buchung, Bank, EÜR. Je
 * Prüfung ein Fall ohne Fehlalarm und einer, der eine Abweichung findet.
 */
describe.skipIf(!testDatabaseUrl)("Abgleich im Journal (Postgres)", () => {
  let abgleich: typeof import("./abgleich.ts");
  let bank: typeof import("../bank/index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let pauschalen: typeof import("../buchhaltung/pauschalen.ts");
  let assets: typeof import("../buchhaltung/assets.ts");
  let integrity: typeof import("./integrity.ts");
  let verrechnung: typeof import("../bank/verrechnung.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let contactId: string;
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    abgleich = await import("./abgleich.ts");
    bank = await import("../bank/index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    pauschalen = await import("../buchhaltung/pauschalen.ts");
    assets = await import("../buchhaltung/assets.ts");
    integrity = await import("./integrity.ts");
    verrechnung = await import("../bank/verrechnung.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04" = "SKR03") {
    await leeren(
      sql,
    )`truncate journal_umstellung, vat_return_submissions, vat_returns, asset_depreciations, assets, pauschalen, allocations, bank_transactions, bank_imports, bank_accounts,
      journal_lines, journal_entries, document_amounts, documents, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen})`;
    contactId = (
      await contacts.createContact(actor, {
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
      })
    ).id;
  }

  async function invoice(issueDate: string, lines: { net: number; rate: 1900 | 700 }[]) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: lines.map((l) => ({ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: l.net, taxRate: l.rate })),
    });
    return invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
  }

  async function bookedDocument(
    date: string,
    amounts: { taxRate: 1900 | 700 | 0; net: number; tax: number }[],
    extra: {
      payment?: "bank" | "privat";
      privateShare?: number;
      reverseCharge?: "eu" | "drittland" | null;
      category?: "edv" | "telefon" | "software" | "hardware";
    } = {},
  ) {
    docSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 7]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `b${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant",
      supplierUstId: "",
      invoiceNumber: `R${docSeq}`,
      documentDate: date,
      dueDate: null,
      category: extra.category ?? "edv",
      payment: extra.payment ?? "bank",
      note: "",
      amounts,
      privateShare: extra.privateShare ?? 0,
      reverseCharge: extra.reverseCharge ?? null,
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  async function transactions(rows: string[][]) {
    await bank.importStatement(actor, { bytes: dkbCsv(rows), filename: `${crypto.randomUUID()}.csv` }, null);
    return sql<
      { id: string; booking_date: string; amount: number }[]
    >`select id, booking_date::text, amount from bank_transactions order by booking_date, amount`;
  }

  /** Ein Jahr Betrieb über die echten Anwendungsfälle: Rechnungen, Teilzahlungen, Storno, Belege, Pauschalen, Finanzamt */
  async function geschaeftsjahr() {
    const a = await invoice("2026-01-15", [
      { net: 400_000, rate: 1900 },
      { net: 100_000, rate: 700 },
    ]);
    const b = await invoice("2026-02-10", [{ net: 33_333, rate: 1900 }]);
    const c = await invoice("2026-02-20", [{ net: 10_000, rate: 1900 }]);
    await invoices.cancelInvoice(actor, c.id, "2026-03-02");

    await bookedDocument("2026-01-20", [{ taxRate: 1900, net: 3_240, tax: 616 }]);
    await bookedDocument(
      "2026-02-05",
      [
        { taxRate: 1900, net: 10_000, tax: 1_900 },
        { taxRate: 700, net: 2_000, tax: 140 },
      ],
      { payment: "privat" },
    );
    // Handyvertrag mit 30 % Privatanteil, § 13b aus dem EU-Ausland
    await bookedDocument("2026-02-12", [{ taxRate: 1900, net: 5_001, tax: 950 }], { privateShare: 30, category: "telefon" });
    await bookedDocument("2026-03-03", [{ taxRate: 1900, net: 20_000, tax: 3_800 }], { reverseCharge: "eu", privateShare: 25 });

    await pauschalen.createPauschale(
      actor,
      { art: "fahrt", date: "2026-02-14", description: "Kunde Hamburg", km: 123, fahrzeug: "pkw", hinUndZurueck: true },
      "2026-03-31",
    );
    await pauschalen.createPauschale(actor, { art: "homeoffice", month: "2026-01", tage: 9, description: "" }, "2026-03-31");
    // Wege zur Betriebsstätte (#895): ein gebuchter und ein stornierter Eintrag, 15 Tage × 12 km × 0,38 € = 6.840
    await pauschalen.createPauschale(actor, { art: "entfernung", month: "2026-02", tage: 15, km: 12, betriebsstaette: "Praxisraum" }, "2026-03-31");
    const storniert = await pauschalen.createPauschale(actor, { art: "entfernung", month: "2026-03", tage: 5, km: 30, betriebsstaette: "Lager" }, "2026-03-31");
    await pauschalen.reversePauschale(actor, storniert.id);

    const txs = await transactions([
      eingang("01.02.26", `RE ${a.number} Teil 1`, "1.000,00"),
      eingang("15.02.26", `RE ${a.number} Teil 2`, "2.333,33"),
      eingang("03.03.26", `RE ${b.number}`, "396,66"),
      ausgang("10.02.26", "Finanzamt", "-1.234,56"),
    ]);
    const by = (amount: number) => txs.find((t) => t.amount === amount)!.id;
    await bank.allocate(actor, { kind: "invoice", transactionId: by(100_000), invoiceId: a.id, amount: 100_000 });
    await bank.allocate(actor, { kind: "invoice", transactionId: by(233_333), invoiceId: a.id, amount: 233_333 });
    await bank.allocate(actor, { kind: "invoice", transactionId: by(39_666), invoiceId: b.id, amount: 39_666 });
    await bank.allocate(actor, { kind: "ustVorauszahlung", transactionId: by(-123_456), amount: -123_456 });
    // Zugeordnet, aufgehoben und neu zugeordnet: Gegenbuchung und Gegenzeile heben sich auf
    const [wrong] = await sql`select id from allocations where amount = 233333`;
    await bank.reverseAllocation(actor, wrong!.id);
    await bank.allocate(actor, { kind: "invoice", transactionId: by(233_333), invoiceId: a.id, amount: 233_333 });
    return { a, b };
  }

  /** Ändert mit abgeschalteten Triggern, wie jemand mit vollem Datenbankzugriff */
  async function bypass(change: (tx: postgres.TransactionSql) => Promise<unknown>) {
    await sql.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await change(tx);
    });
  }
  const gefunden = async () => abgleich.abweichungen((await abgleich.abgleichAll("2026-03-31")).zeilen);

  for (const kontenrahmen of ["SKR03", "SKR04"] as const)
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`ein Geschäftsjahr ohne Fehlalarm (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await geschaeftsjahr();
        for (const month of [1, 2, 3, 41]) {
          const result = await abgleich.vatAbgleich({ year: 2026, month });
          expect(result.hinweise).toEqual([]);
          expect(abgleich.abweichungen(result.zeilen), `2026-${month}`).toEqual([]);
        }
        const euer = await abgleich.euerAbgleich(2026);
        expect(abgleich.abweichungen(euer.zeilen)).toEqual([]);
        const all = await abgleich.abgleichAll("2026-03-31");
        expect(abgleich.abweichungen(all.zeilen)).toEqual([]);
        expect(all.hinweise).toEqual([]);
      }, 60_000);
    }

  it("Verprobung: findet eine Steuer, die nicht zur Bemessungsgrundlage passt (Ist: Zahlung, Soll: Rechnung)", async () => {
    for (const versteuerung of ["ist", "soll"] as const) {
      await reset(versteuerung);
      await geschaeftsjahr();
      const quelle =
        versteuerung === "ist" ? sql`e.source_type = 'allocation' and e.date = '2026-02-01'` : sql`e.source_type = 'invoice' and e.date = '2026-01-15'`;
      const [line] = await sql`select l.id from journal_lines l join journal_entries e on e.id = l.entry_id where ${quelle} and l.account = '1776' limit 1`;
      await bypass((tx) => tx`update journal_lines set credit = credit - 100 where id = ${line!.id}`);
      const found = await gefunden();
      const zeitraum = versteuerung === "ist" ? "2026-02" : "2026-01";
      expect(
        found.filter((z) => z.bereich === "ustva"),
        versteuerung,
      ).toEqual([
        expect.objectContaining({
          zeitraum,
          posten: expect.stringMatching(/^Umsatzsteuer 19 % zur Bemessungsgrundlage .*: Buchung „.*“ vom /),
          gegen: "aus der Bemessungsgrundlage",
        }),
      ]);
      const [z] = found.filter((x) => x.bereich === "ustva");
      expect(z!.quelle - z!.journal).toBe(100);
      // Auch die Vorprüfung der Voranmeldung sieht es
      expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2026, month: Number(zeitraum.slice(5)) })).zeilen)).toHaveLength(1);
    }
  }, 120_000);

  it("Beleg gegen Buchung: findet geänderte Steuer einer Rechnung und Vorsteuer eines Belegs", async () => {
    await reset("soll");
    const { a } = await geschaeftsjahr();
    await bypass((tx) => tx`update invoice_taxes set tax = tax + 100 where invoice_id = ${a.id} and rate = 1900`);
    const [amount] = await sql`select a.id, a.tax from document_amounts a join documents d on d.id = a.document_id where d.document_date = '2026-01-20'`;
    await bypass((tx) => tx`update document_amounts set tax = 600 where id = ${amount!.id}`);
    expect((await gefunden()).filter((z) => z.bereich === "beleg")).toEqual([
      expect.objectContaining({
        zeitraum: "2026-01",
        posten: `Rechnung ${a.number}: Umsatzsteuer`,
        journal: 76_000 + 7_000,
        quelle: 76_000 + 7_000 + 100,
        gegen: "laut Rechnung",
      }),
      // Je Konto: Vorsteuer und Verbindlichkeit der Buchung gegen die Zeilen aus den Beträgen des Belegs
      expect.objectContaining({
        zeitraum: "2026-01",
        posten: expect.stringMatching(/^Beleg R\d+ \(Lieferant\): Konto 1576$/),
        journal: 616,
        quelle: 600,
        gegen: "laut Vorgang",
      }),
      expect.objectContaining({
        zeitraum: "2026-01",
        posten: expect.stringMatching(/^Beleg R\d+ \(Lieferant\): Konto 1600$/),
        journal: -3_856,
        quelle: -3_840,
        gegen: "laut Vorgang",
      }),
    ]);
  }, 60_000);

  it("Vorgang gegen Buchung: Zuordnung, Kassenbuch und Pauschale gegen ihre Buchung", async () => {
    await reset("ist");
    await geschaeftsjahr();
    const cash = await import("../bank/cash-income.ts");
    await leeren(sql)`truncate cash_entries cascade`;
    await cash.createCashIncome(
      actor,
      { date: "2026-02-11", amount: 11_900, text: "Markt", steuer: { behandlung: "regulaer", steuersatz: 1900 } },
      "2026-12-31",
    );
    expect((await gefunden()).filter((z) => z.bereich === "beleg")).toEqual([]);
    // An Haben vorbei: Betrag einer Zuordnung, einer Kassenzeile und einer Pauschale geändert
    const [zuordnung] = await sql`select id, amount from allocations where kind = 'ustVorauszahlung'`;
    await bypass((tx) => tx`update allocations set amount = amount - 100 where id = ${zuordnung!.id}`);
    await bypass((tx) => tx`update cash_entries set amount = amount + 100`);
    const [pauschale] = await sql`select id from pauschalen where art = 'homeoffice'`;
    await bypass((tx) => tx`update pauschalen set amount = amount + 100 where id = ${pauschale!.id}`);
    const found = (await gefunden()).filter((z) => z.bereich === "beleg");
    expect(found.map((z) => [z.zeitraum, z.posten.replace(/ \(.*\)/, ""), z.journal - z.quelle])).toEqual([
      ["2026-02", "Zuordnung vom 2026-02-10: Konto 1200", 100],
      ["2026-02", "Kassenbuch Nr. 1: Konto 1000", -100],
      ["2026-01", "Pauschale vom 2026-01-31: Aufwand", -100],
    ]);
  }, 60_000);

  it("Ist: Nach der letzten Zahlung bleibt keine Umsatzsteuer „nicht fällig“, auch nicht ein Cent", async () => {
    await reset("ist");
    const { b } = await geschaeftsjahr();
    expect((await gefunden()).filter((z) => z.bereich === "beleg")).toEqual([]);
    // An Haben vorbei: Die Umbuchung der Zahlung auf Rechnung b um einen Cent zu klein (die Verprobung lässt einen Cent zu)
    const [zeile] = await sql`select l.id from journal_lines l join journal_entries e on e.id = l.entry_id join allocations a on a.id = e.source_id
      where e.source_type = 'allocation' and a.invoice_id = ${b.id} and l.account = '1766' limit 1`;
    await bypass((tx) => tx`update journal_lines set debit = debit - 1 where id = ${zeile!.id}`);
    await bypass(
      (tx) =>
        tx`update journal_lines set credit = credit - 1 where entry_id = (select entry_id from journal_lines where id = ${zeile!.id}) and account = '1776'`,
    );
    const found = (await gefunden()).filter((z) => z.bereich === "beleg");
    expect(found).toEqual([
      expect.objectContaining({ posten: `Rechnung ${b.number} (Ist, ganz erledigt): Umsatzsteuer nicht fällig`, journal: -1, quelle: 0 }),
    ]);
    // Die Verprobung je Buchung sieht den einen Cent nicht
    expect((await gefunden()).filter((z) => z.bereich === "ustva")).toEqual([]);
  }, 60_000);

  it("gesendete Voranmeldung: findet eine Abweichung zur Rechnung aus dem Journal, mit Abweichung in der Integritätsprüfung", async () => {
    await reset("soll");
    await geschaeftsjahr();
    const vat = await import("../umsatzsteuer/index.ts");
    const werte = await vat.computedValues({ year: 2026, month: 1 });
    const sent = { year: 2026, month: 1, ...werte, status: "sent", source: "berechnet", sent_at: new Date().toISOString() };
    await sql`insert into vat_returns ${sql(sent as never)}`;
    expect((await gefunden()).filter((z) => z.bereich === "ustva")).toEqual([]);
    // Danach an Haben vorbei eine Buchung im gemeldeten Monat geändert: Steuerschlüssel 19 % → 7 % an der Erlöszeile
    const [line] = await sql`select l.id from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_type = 'invoice' and e.date = '2026-01-15' and l.account = '8400' limit 1`;
    await bypass((tx) => tx`update journal_lines set tax_code = 'USt7' where id = ${line!.id}`);
    const found = (await gefunden()).filter((z) => z.posten.startsWith("Gesendete Voranmeldung"));
    expect(found).toEqual([
      expect.objectContaining({ zeitraum: "2026-01", posten: "Gesendete Voranmeldung, Kz 81", journal: 0, quelle: 4_000_00, gegen: "gesendet" }),
      expect.objectContaining({ zeitraum: "2026-01", posten: "Gesendete Voranmeldung, Kz 86", journal: 5_000_00, quelle: 1_000_00, gegen: "gesendet" }),
      // Die Zahllast folgt: 400 € weniger zu 19 %, 400 € mehr zu 7 %
      expect.objectContaining({ zeitraum: "2026-01", posten: "Gesendete Voranmeldung, Kz 83", journal: 34_384, quelle: 82_384, gegen: "gesendet" }),
    ]);
    const report = await integrity.checkIntegrity("2026-03-31");
    expect(report.abgleich.abweichungen).toEqual(expect.arrayContaining(found));
  }, 60_000);

  it("Bank: Endsaldo des Kontoauszugs gegen gebuchte Zahlungen und offene Umsätze", async () => {
    await reset("ist");
    await geschaeftsjahr();
    const [konto] = await sql`select id from bank_accounts limit 1`;
    const [summe] = await sql`select sum(amount)::int as s from bank_transactions where bank_account_id = ${konto!.id}`;
    // Auszug mit Salden über den ganzen Zeitraum; ein offener Umsatz bleibt offen
    await transactions([eingang("20.03.26", "ohne Zuordnung", "50,00")]);
    const auszug = (closing: number) =>
      sql`insert into bank_imports (bank_account_id, filename, sha256, format, period_from, period_to, opening_balance, closing_balance, added, skipped)
        values (${konto!.id}, 'auszug.xml', ${crypto.randomUUID()}, 'camt', '2026-01-01', '2026-03-31', 1000, ${closing}, 0, 0)`;
    await auszug(1000 + Number(summe!.s) + 5_000);
    expect((await gefunden()).filter((z) => z.bereich === "bank")).toEqual([]);
    // Ein späterer Import ohne Salden mit einem Umsatz im Zeitraum des Auszugs (etwa eine einzelne Zahlung als CSV): Er
    // steckt nicht im Endsaldo des früheren Auszugs und zählt deshalb nicht mit, auch zugeordnet nicht (E2E app.spec.ts)
    await transactions([ausgang("15.03.26", "Hafen Immobilien", "-595,00")]);
    const [miete] = await sql`select id from bank_transactions where amount = -59500`;
    await bank.allocate(actor, { kind: "privat", transactionId: miete!.id, amount: -59_500 });
    expect((await gefunden()).filter((z) => z.bereich === "bank")).toEqual([]);
    // Ein neuer Auszug mit anderem Endsaldo (jetzt mit der Miete): Es fehlt ein Umsatz, oder eine Buchung passt nicht
    await auszug(1000 + Number(summe!.s) + 5_000 - 59_500 + 100);
    expect((await gefunden()).filter((z) => z.bereich === "bank")).toEqual([
      expect.objectContaining({
        zeitraum: "2026-03-31",
        journal: 1000 + Number(summe!.s) + 5_000 - 59_500,
        quelle: 1000 + Number(summe!.s) + 5_000 - 59_500 + 100,
        gegen: "laut Kontoauszug",
      }),
    ]);
  }, 60_000);

  it("Bank: Umsätze aus demselben Import wie der Auszug zählen mit (Zeitstempel in Mikrosekunden)", async () => {
    await reset("ist");
    // Auszug und Umsätze in einer Transaktion: gleicher Zeitstempel bis auf die Mikrosekunde, wie beim echten Import
    await sql.begin(async (tx) => {
      const [konto] = await tx`insert into bank_accounts (name, iban) values ('Zweitkonto', 'DE02120300000000202051') returning id`;
      const [auszug] =
        await tx`insert into bank_imports (bank_account_id, filename, sha256, format, period_from, period_to, opening_balance, closing_balance, added, skipped)
        values (${konto!.id}, 'auszug.csv', ${crypto.randomUUID()}, 'dkb-csv', '2026-02-01', '2026-02-28', 10000, 22345, 1, 0) returning id`;
      await tx`insert into bank_transactions (bank_account_id, import_id, booking_date, amount, dedup_hash)
        values (${konto!.id}, ${auszug!.id}, '2026-02-10', 12345, ${crypto.randomUUID()})`;
    });
    expect((await gefunden()).filter((z) => z.bereich === "bank")).toEqual([]);
  }, 60_000);

  it("EÜR: Gewinn nach der DATEV-Formel gegen den Gewinn der Zeilen", async () => {
    await reset("ist");
    await geschaeftsjahr();
    const euer = await abgleich.euerAbgleich(2026);
    expect(euer.zeilen.find((z) => z.posten === "EÜR: Gewinn nach der DATEV-Formel")).toMatchObject({ gegen: "aus den Zeilen der EÜR" });
    expect(abgleich.abweichungen(euer.zeilen)).toEqual([]);
  }, 60_000);

  // Wege zur Betriebsstätte (#895): das Aufwandskonto je Kontenrahmen (4678, 6688) füllt die EÜR
  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Wege zur Betriebsstätte in der EÜR aus dem Journal (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await pauschalen.createPauschale(actor, { art: "entfernung", month: "2026-02", tage: 15, km: 12, betriebsstaette: "Praxisraum" }, "2026-03-31");
        const storniert = await pauschalen.createPauschale(
          actor,
          { art: "entfernung", month: "2026-03", tage: 5, km: 30, betriebsstaette: "Lager" },
          "2026-03-31",
        );
        await pauschalen.reversePauschale(actor, storniert.id);
        const { euerForYear } = await import("./reports.ts");
        const euer = await euerForYear(2026);
        expect(euer.ausgaben.find((l) => l.key === "pauschale:entfernung")?.amount).toBe(6_840);
        expect(abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen)).toEqual([]);
      });
    }
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Sonderfälle ohne Steuer, Ausbuchungen, Storno, § 13b und Erwerb ohne Abweichung (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung);
        await leeren(sql)`truncate write_offs, cash_entries, document_cancellations cascade`;
        await sql`update company set kontenrahmen = ${kontenrahmen}`;
        const cash = await import("../bank/cash-income.ts");
        async function special(
          taxTreatment: "reverse_charge" | "drittland" | "steuerfrei" | "ausfuhr" | "ig_lieferung",
          land: string,
          ustId: string,
          issueDate: string,
        ) {
          const contact = await contacts.createContact(actor, {
            kundennummer: "",
            name: `Kunde ${taxTreatment}`,
            strasse: "Ring 1",
            plz: "1010",
            ort: "Wien",
            land,
            email: "a@b.example",
            ustId,
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
            lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: 500_000, taxRate: 0 }],
          });
          return invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
        }
        const rc = await special("reverse_charge", "AT", "ATU12345678", "2026-01-10");
        const ch = await special("drittland", "CH", "", "2026-01-12");
        await special("ausfuhr", "US", "", "2026-01-20");
        const sf = await special("steuerfrei", "DE", "", "2026-01-22");
        const igl = await special("ig_lieferung", "AT", "ATU12345678", "2026-01-25");
        await bank.writeOff(actor, { kind: "skonto", invoiceId: rc.id, date: "2026-02-05", amount: 10_000 });
        await bank.writeOff(actor, { kind: "forderungsausfall", invoiceId: rc.id, date: "2026-02-06" });
        await bank.writeOff(actor, { kind: "skonto", invoiceId: igl.id, date: "2026-02-07", amount: 15_000 });
        await bank.writeOff(actor, { kind: "forderungsausfall", invoiceId: sf.id, date: "2026-02-08", amount: 20_000 });
        await invoices.cancelInvoice(actor, ch.id, "2026-02-10");
        await cash.createCashIncome(
          actor,
          { date: "2026-02-11", amount: 12_345, text: "Kurs", steuer: { behandlung: "steuerfrei", steuersatz: 0 } },
          "2026-12-31",
        );
        await cash.createCashIncome(
          actor,
          { date: "2026-02-12", amount: 11_900, text: "Markt", steuer: { behandlung: "regulaer", steuersatz: 1900 } },
          "2026-12-31",
        );
        await bookedDocument("2026-01-14", [{ taxRate: 1900, net: 20_000, tax: 3_800 }], { reverseCharge: "eu" });
        await bookedDocument("2026-02-14", [{ taxRate: 1900, net: 30_000, tax: 5_700 }], { reverseCharge: "drittland" });
        for (const month of [1, 2, 3, 41]) {
          const result = await abgleich.vatAbgleich({ year: 2026, month });
          expect(abgleich.abweichungen(result.zeilen), `2026-${month}`).toEqual([]);
        }
        expect(abgleich.abweichungen((await abgleich.abgleichAll("2026-03-31")).zeilen)).toEqual([]);
      }, 60_000);
    }
  }

  it("AfA und Privatnutzung: Hinweis, solange das Jahr nicht gebucht ist, danach Abgleich", async () => {
    await reset("soll");
    await assets.createAsset(actor, {
      name: "Firmenwagen",
      kind: "kfz",
      method: "linear",
      acquisitionDate: "2023-01-10",
      cost: 3_600_000,
      usefulLifeMonths: 72,
      openingDate: "2025-01-01",
      openingBookValue: 2_400_000,
      disposalDate: null,
      privateUse: { listPrice: 4_000_000, drive: "verbrenner", rate: 100, vat: true },
      note: "",
    });
    await assets.createAsset(actor, {
      name: "Laptop",
      kind: "edv",
      method: "gwg",
      acquisitionDate: "2025-03-01",
      cost: 70_000,
      usefulLifeMonths: null,
      openingDate: "2025-03-01",
      openingBookValue: 70_000,
      disposalDate: null,
      note: "",
    });
    // Eine Buchung im Jahr, damit es im Abgleich vorkommt
    await invoice("2025-06-01", [{ net: 10_000, rate: 1900 }]);

    const before = await abgleich.euerAbgleich(2025);
    expect(before.hinweise).toEqual(["AfA 2025 ist für 2 Anlagen noch nicht gebucht; AfA und Privatnutzung werden danach abgeglichen."]);
    expect(before.zeilen.some((z) => z.posten === "AfA")).toBe(false);
    // Die Voranmeldung zählt die Privatnutzung schon monatlich; der Abgleich der Umsatzsteuer lässt sie aus
    expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2025, month: 6 })).zeilen)).toEqual([]);

    await assets.bookDepreciation(actor, 2025, "2025-12-15");
    const after = await abgleich.euerAbgleich(2025);
    expect(after.hinweise).toEqual([]);
    expect(abgleich.abweichungen(after.zeilen)).toEqual([]);
    const values = Object.fromEntries(after.zeilen.map((z) => [z.posten, z.journal]));
    expect(values.AfA).toBe(600_000);
    expect(values["Sofortabschreibung GWG"]).toBe(70_000);
    expect(values["Private Kfz-Nutzung"]).toBeGreaterThan(0);
    expect(values["Umsatzsteuer auf die private Kfz-Nutzung"]).toBeGreaterThan(0);
    for (const month of [1, 6, 12]) {
      expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2025, month })).zeilen)).toEqual([]);
    }
  }, 60_000);

  it("meldet keine Abweichung, nur weil während der Prüfung eine Rechnung festgeschrieben wird", async () => {
    // Soll: Rechnung und Buchung entstehen in einer Transaktion. Der Abgleich darf sie nicht nur halb sehen.
    await reset("soll");
    const { today } = await import("../../today.ts");
    const date = today();
    await invoice(date, [{ net: 10_000, rate: 1900 }]);
    // Je Runde eine Prüfung neben einigen Festschreibungen, wie wenn die wöchentliche Mail während der Arbeit läuft
    for (let round = 0; round < 5; round++) {
      const writes = (async () => {
        for (let i = 0; i < 5; i++) await invoice(date, [{ net: 10_000, rate: 1900 }]);
      })();
      const report = await integrity.checkIntegrity(date);
      await writes;
      expect(report.abgleich.abweichungen).toEqual([]);
    }
  }, 120_000);

  it("meldet keine Abweichung, nur weil während der Prüfung ein Beleg gebucht wird (Ist)", async () => {
    // Ist: Vorsteuer nach Belegdatum, Beleg und Buchung entstehen in einer Transaktion
    await reset("ist");
    const { today } = await import("../../today.ts");
    const date = today();
    await bookedDocument(date, [{ taxRate: 1900, net: 10_000, tax: 1_900 }]);
    for (let round = 0; round < 5; round++) {
      const writes = (async () => {
        for (let i = 0; i < 5; i++) await bookedDocument(date, [{ taxRate: 1900, net: 10_000, tax: 1_900 }]);
      })();
      const report = await integrity.checkIntegrity(date);
      await writes;
      expect(report.abgleich.abweichungen).toEqual([]);
    }
  }, 120_000);

  // Lieferant rundet die Steuer je Position (30 × 0,85 € mit je 0,16 € = 4,80 € statt 4,85 €; Beispiel von
  // thomas-baumeister in #1144): Haben bucht die Vorsteuer wie auf dem Beleg, „Vorgang gegen Buchung“ prüft das. Die
  // Verprobung prüft hier die Rechnung des Lieferanten; abziehbar ist nur die gesetzlich geschuldete Steuer (UStAE 15.2
  // Abs. 1). Deshalb ein Hinweis zum Prüfen, keine Abweichung: keine Warnung vor dem Senden, kein Halt beim Update.
  for (const kr of ["SKR03", "SKR04"] as const)
    for (const v of ["ist", "soll"] as const)
      it(`Beleg mit Vorsteuer abweichend von Netto mal Satz: Hinweis, keine Abweichung (${kr}, ${v})`, async () => {
        await reset(v, kr);
        await bookedDocument("2026-02-10", [{ taxRate: 1900, net: 25_50, tax: 4_80 }]);
        const jahr = await abgleich.abgleichJahr(2026, "2026-03-31");
        expect(abgleich.abweichungen(jahr.zeilen)).toEqual([]);
        const hinweis = expect.stringMatching(
          new RegExp(
            `^Bitte prüfen: Vorsteuer 19 % zur Bemessungsgrundlage ${formatEuro(25_50)}: Buchung .* vom 10\\.02\\.2026 trägt ${formatEuro(4_80)}, Netto mal Satz wären ${formatEuro(4_85)}\\.`,
          ),
        );
        expect(jahr.hinweise).toContainEqual(hinweis);
        // Weniger ausgewiesen als Netto mal Satz: kein Mehrbetrag nach § 14c, abziehbar ist der ausgewiesene Betrag
        expect(jahr.hinweise.join()).toMatch(/§ 15 Abs\. 1 Satz 1 Nr\. 1 UStG/);
        expect(jahr.hinweise.join()).not.toMatch(/§ 14c/);
        const februar = await abgleich.vatAbgleich({ year: 2026, month: 2 });
        expect(abgleich.abgleichIssues(februar)).toEqual([{ tone: "info", text: hinweis, link: "/konten" }]);
      }, 60_000);

  // #274: Eine Verrechnung zweier Belege wirkt in der EÜR wie eine Zahlung; der Gewinn nach der DATEV-Formel sieht dasselbe
  it("Verrechnung zweier Belege ohne Abweichung", async () => {
    await reset("ist");
    const software = await bookedDocument("2026-02-10", [{ taxRate: 1900, net: 10_000, tax: 1_900 }], { category: "software" });
    const hardware = await bookedDocument("2026-02-16", [{ taxRate: 1900, net: -3_000, tax: -570 }], { category: "hardware" });
    await verrechnung.settleDocuments(actor, {
      documentId: software,
      counterDocumentId: hardware,
      amount: 3_570,
      date: "2026-02-20",
      note: "Gutschrift verrechnet",
    });
    expect(abgleich.abweichungen((await abgleich.abgleichAll("2026-03-31")).zeilen)).toEqual([]);
    const { euerForYear } = await import("./reports.ts");
    const euer = await euerForYear(2026);
    // 30,00 Aufwand Software, 30,00 Ertrag aus der Hardware-Gutschrift
    expect(euer.ausgaben.find((l) => l.key === "ausgabe:software")?.amount).toBe(3_000);
    expect(euer.ausgaben.find((l) => l.key === "ausgabe:hardware")?.amount).toBe(-3_000);
  }, 60_000);

  it("Vorprüfung der Voranmeldung meldet Abweichungen mit Beträgen", () => {
    expect(
      abgleich.abgleichIssues({
        zeilen: [
          {
            bereich: "ustva",
            zeitraum: "2026-02",
            posten: "Vorsteuer 19 % zur Bemessungsgrundlage 32,40 €",
            journal: 600,
            quelle: 616,
            gegen: "aus der Bemessungsgrundlage",
          },
          { bereich: "ustva", zeitraum: "2026-02", posten: "Umsatzsteuer 7 %", journal: 0, quelle: 0, gegen: "aus der Bemessungsgrundlage" },
          { bereich: "beleg", zeitraum: "2026-02", posten: "Beleg R1: Vorsteuer", journal: 616, quelle: 600, gegen: "laut Beleg" },
        ],
        hinweise: ["Hinweis"],
      }),
    ).toEqual([
      {
        tone: "warn",
        text: `Im Journal passt etwas nicht: Vorsteuer 19 % zur Bemessungsgrundlage 32,40 €, gebucht ${formatEuro(600)}, aus der Bemessungsgrundlage ${formatEuro(616)}. Bitte vor dem Senden klären.`,
        link: "/konten",
      },
      { tone: "info", text: "Hinweis", link: "/konten" },
    ]);
  });
});
