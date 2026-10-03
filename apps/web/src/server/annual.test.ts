import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "./test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n"Kontostand vom 31.12.2025:";"10.000,00 €"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
  return new TextEncoder().encode("﻿" + header + columns + body + "\n");
}

const row = (date: string, party: string, purpose: string, amount: string) =>
  [date, date, "Gebucht", party, party, purpose, amount.startsWith("-") ? "Ausgang" : "Eingang", "DE02100100100006820101", amount, "", "", ""];

const TODAY = "2026-10-02";

describe.skipIf(!testDatabaseUrl)("Jahreserklärungen (Postgres)", () => {
  let annual: typeof import("./annual.ts");
  let assets: typeof import("./assets.ts");
  let bank: typeof import("./bank.ts");
  let invoices: typeof import("./invoices.ts");
  let contacts: typeof import("./contacts.ts");
  let documents: typeof import("./documents.ts");
  let reports: typeof import("./reports.ts");
  let elster: typeof import("@haben/elster");
  let crypto: typeof import("./crypto.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    annual = await import("./annual.ts");
    assets = await import("./assets.ts");
    bank = await import("./bank.ts");
    invoices = await import("./invoices.ts");
    contacts = await import("./contacts.ts");
    documents = await import("./documents.ts");
    reports = await import("./reports.ts");
    elster = await import("@haben/elster");
    crypto = await import("./crypto.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate asset_depreciations, assets, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, documents, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, vat_return_submissions,
      vat_returns, elster_certificates, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen,
              einkunftsart, taetigkeit)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03', 'selbstaendig', 'Softwareentwicklung')`;
  });

  async function bookedDocument(marker: number, fields: { supplierName: string; documentDate: string; category: "telefon" | "buero" | "software"; payment: "bank" | "privat"; net: number; tax: number }) {
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, marker]), filename: `beleg-${marker}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: fields.supplierName,
      supplierUstId: "",
      invoiceNumber: `B-${marker}`,
      documentDate: fields.documentDate,
      dueDate: null,
      category: fields.category,
      payment: fields.payment,
      note: "",
      amounts: [{ taxRate: 1900, net: fields.net, tax: fields.tax }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  /** Ein Jahr 2025: Rechnung, Telefon über die Bank, Bürobedarf privat bezahlt, Umsatzsteuer, Gebühren, Privatentnahme, Elektroauto */
  async function year2025() {
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
      issueDate: "2025-09-05",
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Leistungen August", quantity: 1000, unit: "Psch.", unitPrice: 400_000, taxRate: 1900 }],
    });
    const invoice = await invoices.finalizeInvoice(actor, draft.id);
    const telekom = await bookedDocument(1, { supplierName: "Telekom", documentDate: "2025-09-27", category: "telefon", payment: "bank", net: 3857, tax: 733 });
    await bookedDocument(2, { supplierName: "Bürohaus", documentDate: "2025-08-15", category: "buero", payment: "privat", net: 1_000, tax: 190 });
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([
          row("01.10.25", "Nordwerk Software GmbH", `RE ${invoice.number}`, "4.760,00"),
          row("29.09.25", "Telekom", "MF B-1", "-45,90"),
          row("10.09.25", "Finanzamt Regensburg", "USt 08/2025", "-500,00"),
          row("30.09.25", "DKB", "Kontoführung", "-9,90"),
          row("24.09.25", "Eigene Überweisung", "Privat", "-3.000,00"),
        ]),
        filename: "a.csv",
      },
      null,
    );
    const txs = await sql`select id, amount from bank_transactions`;
    const tx = (amount: number) => txs.find((t) => t.amount === amount)!.id as string;
    await bank.allocate(actor, { kind: "invoice", transactionId: tx(476_000), invoiceId: invoice.id, amount: 476_000 });
    await bank.allocate(actor, { kind: "document", transactionId: tx(-4590), documentId: telekom, amount: -4590 });
    await bank.allocate(actor, { kind: "ustVorauszahlung", transactionId: tx(-50_000), amount: -50_000 });
    await bank.allocate(actor, { kind: "gebuehren", transactionId: tx(-990), amount: -990 });
    await bank.allocate(actor, { kind: "privat", transactionId: tx(-300_000), amount: -300_000 });
    const car = await assets.createAsset(actor, {
      name: "Tesla Model Y",
      kind: "kfz",
      method: "linear",
      acquisitionDate: "2024-01-10",
      cost: 3_600_000,
      usefulLifeMonths: 72,
      openingDate: "2025-01-01",
      openingBookValue: 3_000_000,
      disposalDate: null,
      note: "",
      privateUse: { listPrice: 5_890_000, drive: "elektro", rate: 25, vat: true },
    });
    return { invoice, car };
  }

  it("Umsatzsteuererklärung: Summe der Monate, Vorauszahlungen aus den gesendeten Voranmeldungen", async () => {
    await year2025();
    let ust = await annual.ustYear(2025);
    // 4.000 € Rechnung (Ist: bezahlt im Oktober) und 12 × 471,20 € Privatnutzung, auf volle Euro
    expect(ust.figures.base19).toBe(400_000 + 565_400);
    expect(ust.figures.tax19).toBe(183_426);
    expect(ust.figures.vorsteuer).toBe(733 + 190);
    expect(ust.figures.vorauszahlungen).toBe(0);
    expect(ust.missingMonths).toHaveLength(12);
    expect(ust.steuer).toBe(183_426 - 923);

    // Je Monat zählt die zuletzt gesendete Anmeldung
    await sql`insert into vat_returns (year, month, kz81, kz66, kz83, status, sent_at)
      values (2025, 10, 400000, 0, 70000, 'sent', '2025-11-10'), (2025, 10, 400000, 0, 76000, 'sent', '2025-11-20'), (2025, 9, 0, 0, 1000, 'sent', '2025-10-10')`;
    ust = await annual.ustYear(2025);
    expect(ust.figures.vorauszahlungen).toBe(77_000);
    expect(ust.missingMonths).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 11, 12]);
    expect(ust.abschluss).toBe(183_426 - 923 - 77_000);

    const overview = await annual.annualOverview(2025, TODAY);
    expect(overview.ust.issues.map((i) => i.tone)).toEqual(["hinweis"]);
    expect((await annual.annualOverview(2026, TODAY)).ust.issues[0]!.text).toMatch(/nach Ablauf des Jahres/);

    await sql`update company set kleinunternehmer = true`;
    expect((await annual.annualOverview(2025, TODAY)).ust.issues.some((i) => i.tone === "fehler" && /Kleinunternehmer/.test(i.text))).toBe(true);
  });

  it("Anlage EÜR: Zeilen, Gewinn wie in den Auswertungen, Entnahmen, Einlagen und Anlagenverzeichnis", async () => {
    const { car } = await year2025();
    let euer = await annual.euerYear(2025);
    expect(euer.pendingAssets).toBe(1);
    expect((await annual.annualOverview(2025, TODAY)).euer.issues.some((i) => i.link === "/anlagen")).toBe(true);

    await assets.bookDepreciation(actor, 2025, TODAY);
    euer = await annual.euerYear(2025);
    expect(euer.pendingAssets).toBe(0);
    const report = await reports.euerForYear(2025);
    expect(euer.einnahmen).toBe(report.totalEinnahmen);
    expect(euer.ausgaben).toBe(report.totalAusgaben);
    expect(euer.gewinn).toBe(report.gewinn);
    expect(euer.figures).toMatchObject({
      steuerpflichtig: 400_000,
      vereinnahmteUst: 76_000 + 12 * 8_953,
      privateKfz: 12 * 14_725,
      telekommunikation: 3857,
      arbeitsmittel: 1000,
      uebrige: 990,
      afaBeweglich: 600_000,
      vorsteuer: 923,
      gezahlteUst: 50_000,
      // Privatüberweisung, Privatnutzung mit Umsatzsteuer; Einlage: privat bezahlter Beleg
      entnahmen: 300_000 + 12 * (14_725 + 8_953),
      einlagen: 1_190,
    });
    expect(euer.anlagen).toEqual([
      { gruppe: "kfz", bezeichnung: "Tesla Model Y", anschaffung: "2024-01-10", anschaffungskosten: 3_600_000, buchwertBeginn: 3_000_000, afa: 600_000, abgang: 0, buchwertEnde: 2_400_000 },
    ]);
    expect((await annual.annualOverview(2025, TODAY)).euer.issues).toEqual([]);
    expect(car.id).toBeTruthy();

    await sql`update company set einkunftsart = null`;
    expect((await annual.annualOverview(2025, TODAY)).euer.issues[0]!.link).toBe("/einstellungen");
  });

  it("prüft und übermittelt testweise, speichert Werte und XML, sperrt eine zweite Echtübermittlung", async () => {
    await year2025();
    await assets.bookDepreciation(actor, 2025, TODAY);
    const client = new elster.FakeElsterClient();

    const validated = await annual.submitAnnual(actor, "euer", 2025, client, { kind: "validate", today: TODAY });
    expect(validated.ok).toBe(true);
    await expect(annual.submitAnnual(actor, "euer", 2025, client, { kind: "test", today: TODAY })).rejects.toThrow(/PIN/);
    await expect(annual.submitAnnual(actor, "euer", 2025, client, { kind: "test", pin: "1234", today: TODAY })).rejects.toThrow(/Zertifikat/);
    await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(new Uint8Array([1, 2, 3]))})`;
    const tested = await annual.submitAnnual(actor, "euer", 2025, client, { kind: "test", pin: "1234", today: TODAY });
    expect(tested.ok).toBe(true);
    expect(tested.transferTicket).toMatch(/^fake-/);
    await expect(annual.submitAnnual(actor, "euer", 2025, client, { kind: "send", pin: "1234", herstellerId: "12345", today: TODAY })).rejects.toThrow(/Ohne ERiC/);
    await expect(annual.submitAnnual(actor, "euer", 2026, client, { kind: "validate", today: TODAY })).rejects.toThrow(/nach Ablauf/);

    const ust = await annual.submitAnnual(actor, "ust", 2025, client, { kind: "validate", today: TODAY });
    expect(ust.ok).toBe(true);

    const rows = await sql`select form, kind, ok, figures, request_xml from annual_submissions order by created_at`;
    expect(rows.map((r) => [r.form, r.kind, r.ok])).toEqual([
      ["euer", "validate", true],
      ["euer", "test", true],
      ["ust", "validate", true],
    ]);
    const euer = await annual.euerYear(2025);
    expect(rows[0]!.figures.gewinn).toBe(euer.gewinn);
    expect(rows[0]!.request_xml).toContain(`<E6007202>${elster.elsterDecimal(euer.gewinn)}</E6007202>`);
    expect(rows[0]!.request_xml).toContain("<E6007311>Tesla Model Y</E6007311>");
    expect(rows[1]!.request_xml).toContain("<Testmerker>700000004</Testmerker>");
    expect(rows[2]!.request_xml).toContain("<E3003303>9654</E3003303>");

    // Eine erfolgreiche Echtübermittlung (hier direkt eingetragen) sperrt weitere
    await sql`insert into annual_submissions (form, year, kind, ok, code, message, figures, request_xml, response_xml, server_response_xml)
      values ('ust', 2025, 'send', true, 0, 'ok', '{}', '', '', '')`;
    const realClient = { validate: client.validate.bind(client), send: client.send.bind(client), fetchPostfach: client.fetchPostfach.bind(client), fetchBelege: client.fetchBelege.bind(client) };
    await expect(annual.submitAnnual(actor, "ust", 2025, realClient, { kind: "send", pin: "1234", herstellerId: "12345", today: TODAY })).rejects.toThrow(/schon übermittelt/);
    expect((await annual.annualOverview(2025, TODAY)).ust.sent).not.toBeNull();
    await expect(sql`update annual_submissions set ok = false`).rejects.toThrow();
  });

  it("Einkommensteuer: Gewinn aus der EÜR, gespeicherte Angaben und Zusammenveranlagung", async () => {
    const taxpayer = await import("./taxpayer.ts");
    const incomeTax = await import("./income-tax.ts");
    await sql`truncate income_tax_inputs`;
    await year2025();
    await assets.bookDepreciation(actor, 2025, TODAY);
    const client = new elster.FakeElsterClient();

    let overview = await annual.annualOverview(2025, TODAY);
    expect(overview.est.issues.some((i) => i.tone === "fehler" && i.text.includes("Persönliche Angaben"))).toBe(true);
    await expect(annual.submitAnnual(actor, "est", 2025, client, { kind: "validate", today: TODAY })).rejects.toThrow(/Persönliche Angaben/);

    const person = { idnr: "86095742719", anrede: "Herrn" as const, vorname: "Max", name: "Muster", geburtsdatum: "1985-04-12", beruf: "Entwickler" };
    await taxpayer.saveTaxpayer(actor, {
      a: person,
      b: { ...person, anrede: "Frau", vorname: "Erika", religion: "02" },
      veranlagung: "zusammen",
      verheiratetSeit: "2015-06-20",
    });
    await incomeTax.saveEstAngaben(actor, 2025, {
      vorsorge: { a: { pkv: 600_000 }, b: { gkv: 300_000 } },
      sonderausgaben: { spenden: 10_000 },
      kinder: [{ vorname: "Lena", geburtsdatum: "2020-01-15", kinderbetreuung: 150_000 }],
    });
    await expect(incomeTax.saveEstAngaben(actor, 2025, { kinder: [{ vorname: "", geburtsdatum: "x" }] })).rejects.toThrow();

    overview = await annual.annualOverview(2025, TODAY);
    expect(overview.est.issues.filter((i) => i.tone === "fehler")).toEqual([]);
    expect(overview.est.zusammen).toBe(true);
    expect(overview.est.anlagen).toEqual(["ESt 1 A", "Sonderausgaben", "Kind (1)", "S", "Vorsorgeaufwand"]);

    const result = await annual.submitAnnual(actor, "est", 2025, client, { kind: "validate", today: TODAY });
    expect(result.ok).toBe(true);
    const [row] = await sql`select figures, request_xml from annual_submissions where form = 'est'`;
    const euer = await annual.euerYear(2025);
    expect(row!.figures.gewinn).toBe(euer.gewinn);
    const xml: string = row!.request_xml;
    expect(xml).toContain("<DatenArt>ESt</DatenArt>");
    expect(xml).toContain(`<E0803202>${Math.round(euer.gewinn / 100)}</E0803202>`);
    expect(xml).toContain("<E0803101>Softwareentwicklung</E0803101>");
    expect(xml).toContain("<E0100801>Erika</E0100801>");
    expect(xml).toContain("<E0102102>DE89370400440532013000</E0102102>");
    expect(xml).toContain("<E2003104>6000</E2003104>");
    expect(xml).toContain("<E0506105>1500</E0506105>");
    expect(xml).toContain("<StNr>9198011310010</StNr>");

    await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(new Uint8Array([1]))})`;
    const tested = await annual.submitAnnual(actor, "est", 2025, client, { kind: "test", pin: "1234", today: TODAY });
    expect(tested.ok).toBe(true);
    const protocol = await annual.loadAnnualProtocol((await sql`select id from annual_submissions where form = 'est' and kind = 'test'`)[0]!.id);
    expect(protocol?.filename).toBe("Einkommensteuererklaerung-2025-Protokoll.pdf");
  });

  it("Einkommensteuer mit Anlage N: Arbeitslohn, Werbungskosten, Lohnsteuer in der Prognose, Homeoffice-Hinweis", async () => {
    const taxpayer = await import("./taxpayer.ts");
    const incomeTax = await import("./income-tax.ts");
    const pauschalen = await import("./pauschalen.ts");
    await sql`truncate income_tax_inputs`;
    await year2025();
    await assets.bookDepreciation(actor, 2025, TODAY);
    const person = { idnr: "86095742719", anrede: "Herrn" as const, vorname: "Max", name: "Muster", geburtsdatum: "1985-04-12", beruf: "Entwickler" };
    await taxpayer.saveTaxpayer(actor, {
      a: person,
      b: { ...person, anrede: "Frau", vorname: "Erika", religion: "02" },
      veranlagung: "zusammen",
      verheiratetSeit: "2015-06-20",
    });
    const lohn = { steuerklasse: 4 as const, brutto: 4_200_000, lohnsteuer: 612_340, kirchensteuer: 48_987, rvArbeitnehmer: 390_600, rvArbeitgeber: 390_600, kvArbeitnehmer: 341_200 };
    await expect(
      incomeTax.saveEstAngaben(actor, 2025, { arbeitnehmer: { b: { bescheinigungen: [{ ...lohn, brutto: 0 }] } } }),
    ).rejects.toThrow(/Bruttoarbeitslohn/);
    await incomeTax.saveEstAngaben(actor, 2025, {
      arbeitnehmer: {
        a: { bescheinigungen: [{ steuerklasse: 1, brutto: 200_000 }], werbungskosten: { homeofficeTage: 30 } },
        b: { bescheinigungen: [lohn], werbungskosten: { wege: { tage: 200, km: 25, adresse: "77815 Bühl, Industriestraße 4" }, arbeitsmittel: 50_000 } },
      },
    });
    for (const month of ["01", "02", "03", "04", "05", "06", "07", "08", "09"]) {
      await pauschalen.createPauschale(actor, { art: "homeoffice", month: `2025-${month}`, tage: 20 }, TODAY);
    }

    const overview = await annual.annualOverview(2025, TODAY);
    expect(overview.est.anlagen).toEqual(["ESt 1 A", "S", "N (Max)", "N (Erika)", "Vorsorgeaufwand"]);
    // 2025: 200 × (20 × 0,30 € + 5 × 0,38 €) + 500 € Arbeitsmittel; bei Max der Pauschbetrag
    const p = overview.est.prognose;
    expect(p.einkuenfteArbeit).toBe(4_200_000 - (1_580_00 + 500_00) + (200_000 - 123_000));
    expect(p.steuerabzug).toBe(612_340 + 48_987);
    expect(p.verbleibend).toBe(p.gesamt - 661_327);
    // 180 Tage in der EÜR plus 30 in Anlage N sind genau 210; ein Tag mehr gibt einen Hinweis
    expect(overview.est.issues.some((i) => /Homeoffice/.test(i.text))).toBe(false);
    await pauschalen.createPauschale(actor, { art: "homeoffice", month: "2025-10", tage: 1 }, TODAY);
    expect((await annual.annualOverview(2025, TODAY)).est.issues.find((i) => /Homeoffice/.test(i.text))).toMatchObject({ tone: "hinweis", link: "/pauschalen" });

    const client = new elster.FakeElsterClient();
    expect((await annual.submitAnnual(actor, "est", 2025, client, { kind: "validate", today: TODAY })).ok).toBe(true);
    const [row] = await sql`select request_xml from annual_submissions where form = 'est' order by created_at desc limit 1`;
    const xml: string = row!.request_xml;
    expect(xml).toMatch(/<N>\s*<Person>PersonA<\/Person>[\s\S]*<E0204507>30<\/E0204507>/);
    expect(xml).toMatch(/<N>\s*<Person>PersonB<\/Person>\s*<ArbL>\s*<LStB_1_5_Einz>\s*<E0200204>42000,00<\/E0200204>/);
    expect(xml).toContain("<E0203501>77815 Bühl, Industriestraße 4</E0203501>");
    expect(xml).toMatch(/<AVor>\s*<Person>PersonB<\/Person>\s*<E2000401>3906<\/E2000401>\s*<E2000801>3906<\/E2000801>/);
  });
});
