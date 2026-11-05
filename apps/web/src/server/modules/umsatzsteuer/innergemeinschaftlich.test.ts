import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Innergemeinschaftlicher Erwerb (§ 1a UStG) am Eingangsbeleg, innergemeinschaftliche Lieferung (§ 4 Nr. 1 Buchst. b, § 6a
 * UStG) und Ausfuhr (§ 4 Nr. 1 Buchst. a, § 6 UStG) auf der Ausgangsrechnung: Journal, Voranmeldung, ZM, EÜR, Abgleich und
 * DATEV-Export in SKR03 und SKR04, bei Ist- und Soll-Versteuerung.
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

const eingang = (date: string, name: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  name,
  "Testfirma",
  purpose,
  "Eingang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];
const ausgang = (date: string, name: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Testfirma",
  name,
  purpose,
  "Ausgang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];

const byAccount = <T extends unknown[]>(rows: T[]) => [...rows].sort((a, b) => String(a[0]).localeCompare(String(b[0])));

const KONTEN = {
  SKR03: { waren: "3200", vorsteuer: "1574", erwerbsteuer: "1774", verbindlichkeiten: "1600", igl: "8125", ausfuhr: "8120" },
  SKR04: { waren: "5200", vorsteuer: "1404", erwerbsteuer: "3804", verbindlichkeiten: "3300", igl: "4125", ausfuhr: "4120" },
} as const;

describe.skipIf(!testDatabaseUrl)("Innergemeinschaftlicher Erwerb, Lieferung und Ausfuhr (Postgres)", () => {
  let documents: typeof import("../belege/documents.ts");
  let cancellation: typeof import("../belege/cancellation.ts");
  let figures: typeof import("./vat-figures.ts");
  let zm: typeof import("./zm.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let bank: typeof import("../bank/bank.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let datev: typeof import("../auswertungen/datev-export.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let fileSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("../belege/documents.ts");
    cancellation = await import("../belege/cancellation.ts");
    figures = await import("./vat-figures.ts");
    zm = await import("./zm.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    bank = await import("../bank/bank.ts");
    reports = await import("../auswertungen/reports.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
    datev = await import("../auswertungen/datev-export.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", kleinunternehmer = false) {
    await sql`truncate document_cancellations, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, cash_entries,
      asset_depreciations, assets, journal_lines, journal_entries, document_amounts, documents, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, vat_returns, zm_submissions, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen,
              kleinunternehmer, datev_berater_nr, datev_mandant_nr)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010', 'DE136695976', 'BY',
              'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, ${kleinunternehmer}, '1001', '10001')`;
  }

  async function erwerb(options: {
    date?: string;
    net?: number;
    rate?: 1900 | 700;
    supplierUstId?: string;
    category?: "wareneinkauf" | "buero" | "anlage";
    book?: boolean;
  }) {
    fileSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, fileSeq % 256, Math.floor(fileSeq / 256), 73]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `erwerb-${fileSeq}.jpg` });
    const net = options.net ?? 50_000;
    const rate = options.rate ?? 1900;
    await documents.updateDocument(actor, id, {
      supplierName: "Hollandse Hardware B.V.",
      supplierUstId: options.supplierUstId ?? "NL123456789B01",
      invoiceNumber: `NL-${fileSeq}`,
      documentDate: options.date ?? "2026-09-15",
      dueDate: null,
      category: options.category ?? "wareneinkauf",
      payment: "bank",
      note: "",
      reverseCharge: "ig_erwerb",
      asset: options.category === "anlage" ? { name: "Server", kind: "edv", method: "linear", usefulLifeMonths: 36 } : null,
      amounts: [{ taxRate: rate, net, tax: Math.round((net * rate) / 10_000) }],
    });
    if (options.book !== false) await documents.bookDocument(actor, id);
    return id;
  }

  async function invoice(options: { treatment: "ig_lieferung" | "ausfuhr"; issueDate: string; net: number }) {
    const nl = options.treatment === "ig_lieferung";
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: nl ? "Amsterdam Trading B.V." : "Matterhorn Data AG",
      strasse: nl ? "Damrak 1" : "Bahnhofstrasse 1",
      plz: nl ? "1012 LG" : "8001",
      ort: nl ? "Amsterdam" : "Zürich",
      land: nl ? "NL" : "CH",
      email: "einkauf@kunde.example",
      ustId: nl ? "NL987654321B01" : "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate: options.issueDate,
      serviceFrom: options.issueDate,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      taxTreatment: options.treatment,
      lines: [{ description: "Hardware", quantity: 1000, unit: "Stk." as const, unitPrice: options.net, taxRate: 0 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function lines(sourceId: string) {
    return sql`select l.account, l.debit, l.credit, l.tax_code from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_id = ${sourceId} order by l.account, l.debit`;
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`${kontenrahmen}, ${versteuerung}: Erwerb 500 € → 95 € Erwerbsteuer und 95 € Vorsteuer im Monat des Belegs, nicht der Zahlung`, async () => {
        await reset(kontenrahmen, versteuerung);
        const k = KONTEN[kontenrahmen];
        const id = await erwerb({});
        expect((await lines(id)).map((l) => [l.account, l.debit, l.credit, l.tax_code])).toEqual(
          byAccount([
            [k.waren, 50_000, 0, "IGE19"],
            [k.vorsteuer, 9_500, 0, "VStIGE"],
            [k.erwerbsteuer, 0, 9_500, "IGE19"],
            [k.verbindlichkeiten, 0, 50_000, null],
          ]),
        );
        const [doc] = await sql`select gross, net, tax from documents where id = ${id}`;
        expect(doc).toMatchObject({ gross: 50_000, net: 50_000, tax: 9_500 });

        // Bezahlt im Oktober: an den Lieferanten gehen 500 €
        await bank.importStatement(actor, { bytes: dkbCsv([ausgang("05.10.26", "Hollandse Hardware", "NL-1", "-500,00")]), filename: "a.csv" }, null);
        const [tx] = await sql`select id from bank_transactions`;
        await bank.allocate(actor, { kind: "document", transactionId: tx!.id, documentId: id, amount: -50_000 });

        const sep = await figures.computeVatFigures({ year: 2026, month: 9 });
        expect(sep).toMatchObject({ kz89: 50_000, tax89: 9_500, kz93: 0, kz61: 9_500, kz66: 0, kz46: 0, kz47: 0, kz67: 0 });
        expect(sep.igErwerb).toHaveLength(1);
        const oct = await figures.computeVatFigures({ year: 2026, month: 10 });
        expect(oct).toMatchObject({ kz89: 0, kz61: 0, kz66: 0 });

        // Journal und Voranmeldung stimmen überein
        const abgleichSep = await abgleich.vatAbgleich({ year: 2026, month: 9 });
        for (const zeile of abgleichSep.zeilen) expect(Math.abs(zeile.journal - zeile.quelle), zeile.posten).toBe(0);

        // EÜR: 500 € Ausgabe für Waren, keine Vorsteuer und keine Umsatzsteuer, die heben sich auf
        const euer = await reports.euerForYear(2026);
        const betrag = (key: string) => [...euer.einnahmen, ...euer.ausgaben].find((l) => l.key === key)?.amount ?? 0;
        expect(betrag("ausgabe:wareneinkauf")).toBe(50_000);
        expect(betrag("vorsteuer")).toBe(0);
        expect(betrag("vereinnahmteUst")).toBe(0);

        // DATEV: Erwerbsteuer und Vorsteuer als eigene Zeilen, kein BU-Schlüssel, kein Automatikkonto
        const { bytes } = await datev.datevExport(2026, new Date("2026-11-05T10:00:00Z"));
        const rows = new TextDecoder("latin1")
          .decode(bytes)
          .split("\r\n")
          .slice(2)
          .filter((r) => r.includes("Beleg NL-"));
        const parsed = rows.map((r) => r.split(";")).map((f) => ({ amount: f[0], account: f[6], contra: f[7], bu: f[8] }));
        expect(parsed.every((r) => r.bu === "" || r.bu === '""')).toBe(true);
        const accounts = parsed.flatMap((r) => [r.account, r.contra]);
        expect(accounts).toEqual(expect.arrayContaining([k.erwerbsteuer, k.vorsteuer, k.waren]));
        expect(accounts).not.toContain(kontenrahmen === "SKR03" ? "3425" : "5425");
      }, 60_000);

      it(`${kontenrahmen}, ${versteuerung}: innergemeinschaftliche Lieferung nach Rechnungsdatum in Kz 41 und der ZM, Ausfuhr in Kz 43`, async () => {
        await reset(kontenrahmen, versteuerung);
        const k = KONTEN[kontenrahmen];
        const igl = await invoice({ treatment: "ig_lieferung", issueDate: "2026-09-20", net: 300_000 });
        const ausfuhr = await invoice({ treatment: "ausfuhr", issueDate: "2026-09-25", net: 120_000 });
        expect((await lines(igl.id)).map((l) => [l.account, l.tax_code])).toEqual(
          byAccount([
            [kontenrahmen === "SKR03" ? "1400" : "1200", null],
            [k.igl, "IGL"],
          ]),
        );
        expect((await lines(ausfuhr.id)).find((l) => l.account === k.ausfuhr)).toMatchObject({ credit: 120_000, tax_code: "Ausfuhr" });

        // Beide im Oktober bezahlt
        await bank.importStatement(
          actor,
          {
            bytes: dkbCsv([eingang("02.10.26", "Amsterdam Trading", igl.number!, "3.000,00"), eingang("03.10.26", "Matterhorn", ausfuhr.number!, "1.200,00")]),
            filename: "b.csv",
          },
          null,
        );
        const txs = await sql`select id, amount from bank_transactions order by booking_date`;
        await bank.allocate(actor, { kind: "invoice", transactionId: txs[0]!.id, invoiceId: igl.id, amount: 300_000 });
        await bank.allocate(actor, { kind: "invoice", transactionId: txs[1]!.id, invoiceId: ausfuhr.id, amount: 120_000 });

        const sep = await figures.computeVatFigures({ year: 2026, month: 9 });
        const oct = await figures.computeVatFigures({ year: 2026, month: 10 });
        // § 18b UStG: die innergemeinschaftliche Lieferung im Monat der Rechnung, auch bei Ist
        expect(sep.kz41).toBe(300_000);
        expect(oct.kz41).toBe(0);
        // Ausfuhr wie die übrigen steuerfreien Umsätze: bei Ist mit der Zahlung, bei Soll mit der Rechnung
        expect(sep.kz43).toBe(versteuerung === "soll" ? 120_000 : 0);
        expect(oct.kz43).toBe(versteuerung === "ist" ? 120_000 : 0);
        expect(sep.kz81 + sep.kz86 + sep.kz21 + sep.kz45 + sep.kz48 + oct.kz81 + oct.kz45 + oct.kz48).toBe(0);

        const q3 = await zm.zmOverview({ year: 2026, month: 43 });
        expect(q3.zeilen).toEqual([{ ustId: "NL987654321B01", art: "L", betrag: 300_000 }]);
        expect(q3.quellen[0]).toMatchObject({ art: "L", invoiceId: igl.id });
        expect(q3.issues.filter((i) => i.tone === "error").map((i) => i.text)).toEqual([]);
        expect(q3.issues.some((i) => i.text.includes("§ 17a UStDV"))).toBe(true);
        expect(await zm.zmQuartale()).toEqual([{ year: 2026, month: 43, sent: false }]);

        // EÜR: steuerfreie Einnahmen ohne Umsatzsteuer
        const euer = await reports.euerForYear(2026);
        expect(euer.einnahmen.find((l) => l.key === "einnahmenSteuerfrei")?.amount).toBe(420_000);

        const abgleichSep = await abgleich.vatAbgleich({ year: 2026, month: 9 });
        for (const zeile of abgleichSep.zeilen) expect(Math.abs(zeile.journal - zeile.quelle), zeile.posten).toBe(0);
      }, 60_000);
    }
  }

  it("7 %, Anlagegut und Storno: Erwerbsteuer je Satz, Anlage mit dem Nettobetrag, Storno im Monat des Stornos", async () => {
    await reset("SKR03", "ist");
    const buch = await erwerb({ rate: 700, net: 10_000, category: "buero", date: "2026-09-02" });
    expect((await lines(buch)).map((l) => [l.account, l.debit - l.credit])).toEqual([
      ["1572", 700],
      ["1600", -10_000],
      ["1772", -700],
      ["4930", 10_000],
    ]);
    const anlage = await erwerb({ net: 200_000, category: "anlage", date: "2026-09-10" });
    const [asset] = await sql`select cost, account from assets where document_id = ${anlage}`;
    expect(asset!.cost).toBe(200_000);
    expect((await lines(anlage)).map((l) => l.account)).toEqual(["1574", "1600", "1774", asset!.account].sort());
    const sep = await figures.computeVatFigures({ year: 2026, month: 9 });
    expect(sep).toMatchObject({ kz89: 200_000, tax89: 38_000, kz93: 10_000, tax93: 700, kz61: 38_700 });

    await cancellation.cancelDocument(actor, buch, { reason: "Falsch erfasst" }, "2026-10-05");
    const oct = await figures.computeVatFigures({ year: 2026, month: 10 });
    expect(oct).toMatchObject({ kz93: -10_000, tax93: -700, kz61: -700 });
    const abgleichOkt = await abgleich.vatAbgleich({ year: 2026, month: 10 });
    for (const zeile of abgleichOkt.zeilen) expect(Math.abs(zeile.journal - zeile.quelle), zeile.posten).toBe(0);
  }, 60_000);

  it("Prüfungen: USt-IdNr. des Lieferanten aus einem anderen EU-Land, Kleinunternehmer und 0 % nicht unterstützt", async () => {
    await reset("SKR04", "soll");
    const ohne = await erwerb({ supplierUstId: "", book: false });
    await expect(documents.bookDocument(actor, ohne)).rejects.toThrow("USt-IdNr. des Lieferanten");
    const deutsch = await erwerb({ supplierUstId: "DE987654321", book: false });
    await expect(documents.bookDocument(actor, deutsch)).rejects.toThrow("deutscher USt-IdNr.");

    await reset("SKR03", "ist", true);
    const ku = await erwerb({ book: false });
    await expect(documents.bookDocument(actor, ku)).rejects.toThrow("Kleinunternehmer");
  }, 60_000);

  it("gewöhnlicher Einkauf mit deutscher Umsatzsteuer und § 13b bleiben eigene Fälle", async () => {
    await reset("SKR03", "soll");
    fileSeq++;
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, fileSeq, 99]), filename: "de.jpg" });
    await documents.updateDocument(actor, id, {
      supplierName: "Hollandse Hardware B.V.",
      supplierUstId: "NL123456789B01",
      invoiceNumber: "DE-1",
      documentDate: "2026-09-15",
      dueDate: null,
      category: "wareneinkauf",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: 50_000, tax: 9_500 }],
    });
    await documents.bookDocument(actor, id);
    const sep = await figures.computeVatFigures({ year: 2026, month: 9 });
    expect(sep).toMatchObject({ kz66: 9_500, kz89: 0, kz61: 0 });
    expect((await lines(id)).map((l) => l.account)).toEqual(["1576", "1600", "3200"]);
  }, 60_000);

  // § 18a Abs. 1 Satz 2 UStG: Maßgeblich ist die Summe der Bemessungsgrundlagen, nicht die je Zeile auf volle Euro
  // abgeschnittenen Beträge der Meldung; 50.001,20 € übersteigen 50.000 €
  it("Monatsmeldung: Grenze von 50.000 € nach der Summe der Bemessungsgrundlagen, nicht der abgeschnittenen Zeilen", () => {
    const issues = zm.zmIssues({
      company: { ustId: "DE136695976", name: "Testfirma", strasse: "Musterstraße 1", plz: "93047", ort: "Regensburg" },
      quellen: [],
      zeilen: [
        { ustId: "ATU12345678", art: "L", betrag: 2_500_060 },
        { ustId: "NL987654321B01", art: "L", betrag: 2_500_060 },
      ],
      kz21: null,
      voranmeldungen: 3,
    });
    expect(issues.some((i) => i.tone === "error" && i.text.includes("monatlich"))).toBe(true);
  });
});
