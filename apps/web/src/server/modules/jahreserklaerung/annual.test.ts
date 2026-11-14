import { EricGeprueftClient } from "../../test-eric.ts";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n"Kontostand vom 31.12.2025:";"10.000,00 €"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
  return new TextEncoder().encode(`﻿${header}${columns}${body}\n`);
}

const row = (date: string, party: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  party,
  party,
  purpose,
  amount.startsWith("-") ? "Ausgang" : "Eingang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];

const TODAY = "2026-10-02";

describe.skipIf(!testDatabaseUrl)("Jahreserklärungen (Postgres)", () => {
  let annual: typeof import("./annual.ts");
  let assets: typeof import("../buchhaltung/assets.ts");
  let bank: typeof import("../bank/bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let elster: typeof import("@haben/elster");
  let crypto: typeof import("../../crypto.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    annual = await import("./annual.ts");
    assets = await import("../buchhaltung/assets.ts");
    bank = await import("../bank/bank.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    reports = await import("../auswertungen/reports.ts");
    elster = await import("@haben/elster");
    crypto = await import("../../crypto.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate asset_depreciations, assets, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, documents, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, vat_return_submissions,
      vat_returns, vat_frequencies, annual_submissions, elster_certificates, company cascade`;
    // `company` bleibt im Truncate: Ein Upsert setzt nur die Spalten zurück, die er ausdrücklich nennt. rechtsform
    // (finanzamt/fristen.test.ts stellt auf 'gmbh'), journal_ab, taxpayer und finanzamt stünden sonst noch aus früheren
    // Dateien desselben Workers in der Zeile. Das Insert darunter bekommt trotzdem `on conflict … do update set`: Läuft
    // ein Test in den Timeout, arbeitet sein Code weiter und legt die Firma in genau dem Fenster zwischen Truncate und
    // Insert neu an – ohne den Zusatz wäre das ein company_pkey-Fehler. Genannt sind alle Spalten, die das Leeren
    // vorher zurückgesetzt hat, plus die, die einzelne Tests weiter unten ändern (kleinunternehmer, kontenrahmen,
    // versteuerung, einkunftsart).
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen,
              einkunftsart, taetigkeit, kleinunternehmer)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03', 'selbstaendig', 'Softwareentwicklung', false)
      on conflict (id) do update set
        name = excluded.name, strasse = excluded.strasse, plz = excluded.plz, ort = excluded.ort, email = excluded.email,
        telefon = excluded.telefon, steuernummer = excluded.steuernummer, ust_id = excluded.ust_id, bundesland = excluded.bundesland,
        iban = excluded.iban, versteuerung = excluded.versteuerung, kontenrahmen = excluded.kontenrahmen,
        einkunftsart = excluded.einkunftsart, taetigkeit = excluded.taetigkeit, kleinunternehmer = excluded.kleinunternehmer`;
  });

  async function bookedDocument(
    marker: number,
    fields: {
      supplierName: string;
      documentDate: string;
      category: "telefon" | "buero" | "software" | "wareneinkauf";
      payment: "bank" | "privat";
      net: number;
      tax: number;
    },
  ) {
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

  /** §-13b-Beleg als Leistungsempfänger: Steuer und Vorsteuer rechnet der Server aus dem Netto */
  async function reverseCharge(marker: number, kind: "eu" | "drittland", documentDate: string, net: number) {
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, marker]), filename: `rc-${marker}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: kind === "eu" ? "Google Cloud EMEA Ltd" : "Example Software Inc.",
      supplierUstId: kind === "eu" ? "IE6388047V" : "",
      invoiceNumber: `RC-${marker}`,
      documentDate,
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      reverseCharge: kind,
      amounts: [{ taxRate: 1900, net, tax: Math.round(net * 0.19) }],
    } as Parameters<typeof documents.updateDocument>[2]);
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

    // Heute auf Kleinunternehmer umgestellt: gilt für dieses Jahr, nicht rückwirkend für 2025 (vorjahr.test.ts)
    await sql`update company set kleinunternehmer = true`;
    const thisYear = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()).slice(0, 4));
    expect((await annual.annualOverview(thisYear, `${thisYear + 1}-03-01`)).ust.issues.some((i) => i.tone === "fehler" && /ab 2024 keine/.test(i.text))).toBe(
      true,
    );
    expect((await annual.annualOverview(2025, TODAY)).ust.issues.some((i) => /Kleinunternehmer/.test(i.text))).toBe(false);
    // Die Texte je nach Jahr: ab 2024 keine Erklärung, für 2023 noch eine (übers ELSTER-Portal)
    const issue = (ku: boolean, year: number) =>
      annual
        .ustIssues(ku, ust, year)
        .map((i) => i.text)
        .join(" ");
    expect(issue(true, 2025)).toMatch(/ab 2024 keine Umsatzsteuererklärung/);
    expect(issue(true, 2023)).toMatch(/Für 2023 gibst du auch als Kleinunternehmer noch eine Umsatzsteuererklärung ab/);
    expect(issue(false, 2025)).not.toMatch(/Kleinunternehmer/);
    // Als Kleinunternehmer kein Hinweis auf fehlende Voranmeldungen
    expect(issue(true, 2025)).not.toMatch(/gesendete Voranmeldung/);
    // Eigener Rahmen nur für diesen Test: Er baut ein volles Geschäftsjahr auf (Rechnung, fünf Belege, Bankimport,
    // Anlagegut) und braucht im CI über die 5 s von Vitest (5240 ms im Lauf 43286362239, #784). Läuft er in den
    // Timeout, arbeitet sein Code weiter, und `loadCompany` legt die Firma in genau dem Fenster zwischen Truncate und
    // Insert des nächsten `beforeEach` an – daher kam der company_pkey-Fehler.
  }, 20_000);

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)(
    "%s, %s: § 13b, innergemeinschaftlicher Erwerb und Einfuhrumsatzsteuer summiert die Jahreserklärung; nur Kz 48 sperrt",
    async (kontenrahmen, versteuerung) => {
      await sql`update company set kontenrahmen = ${kontenrahmen}, versteuerung = ${versteuerung}`;
      await reverseCharge(11, "eu", "2025-03-10", 10_099);
      await reverseCharge(12, "drittland", "2025-04-10", 5_000);
      const { id: erwerbId } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 13]), filename: "erwerb-13.jpg" });
      await documents.updateDocument(actor, erwerbId, {
        supplierName: "Hollandse Hardware B.V.",
        supplierUstId: "NL123456789B01",
        invoiceNumber: "NL-13",
        documentDate: "2025-05-15",
        dueDate: null,
        category: "wareneinkauf",
        payment: "bank",
        note: "",
        reverseCharge: "ig_erwerb",
        amounts: [{ taxRate: 1900, net: 20_000, tax: 3_800 }],
      } as Parameters<typeof documents.updateDocument>[2]);
      await documents.bookDocument(actor, erwerbId);
      const { id: zollId } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 14]), filename: "zoll-14.jpg" });
      await documents.updateDocument(actor, zollId, {
        supplierName: "Hauptzollamt Regensburg",
        supplierUstId: "",
        invoiceNumber: "ATB-14",
        documentDate: "2025-06-20",
        dueDate: null,
        category: "einfuhrumsatzsteuer",
        payment: "bank",
        note: "",
        reverseCharge: null,
        amounts: [{ taxRate: 0, net: 3_800, tax: 0 }],
      } as Parameters<typeof documents.updateDocument>[2]);
      await documents.bookDocument(actor, zollId);

      const ust = await annual.ustYear(2025);
      expect(ust.figures).toMatchObject({
        // Bemessungsgrundlage in vollen Euro (10.099 Cent → 100 €), die Steuer bleibt centgenau
        kz46: 10_000,
        kz47: 1_919,
        kz84: 5_000,
        kz85: 950,
        kz67: 2_869,
        kz89: 20_000,
        tax89: 3_800,
        kz61: 3_800,
        kz62: 3_800,
      });
      // Steuer 1.919 + 950 + 3.800, Vorsteuer 2.869 + 3.800 + 3.800
      expect(ust.steuer).toBe(1_919 + 950 + 3_800 - (2_869 + 3_800 + 3_800));
      // Keine Sperre mehr: Diese Kennzahlen gehen jetzt in die Erklärung
      expect(annual.ustIssues(false, ust, 2025).every((i) => i.tone !== "fehler")).toBe(true);
      // Mein ELSTER bekommt dieselben Feldkennungen wie das E50-XML
      const mein = await import("./mein-elster.ts");
      const werte = await mein.meinElsterWerte("ust", 2025, TODAY);
      const felder = new Map(werte.felder.map((f) => [f.kennung, f.wert]));
      for (const [kennung, wert] of [
        ["E3102205", "100"],
        ["E3102206", "19,19"],
        ["E3102503", "50"],
        ["E3102504", "9,50"],
        ["E3102601", "28,69"],
        ["E3100902", "200"],
        ["E3100903", "38,00"],
        ["E3006502", "28,69"],
        ["E3006401", "38,00"],
        ["E3006901", "104,69"],
        ["E3010201", "-38,00"],
      ] as const) {
        expect(felder.get(kennung), kennung).toBe(wert);
      }
    },
    30_000,
  );

  it("Nur steuerfreie Umsätze ohne Vorsteuerabzug (Kz 48) sperren die Übermittlung", async () => {
    const basis = {
      figures: { base19: 0, tax19: 0, base7: 0, tax7: 0, vorsteuer: 0, vorauszahlungen: 0 },
      steuer: 0,
      abschluss: 0,
      kz48: 0,
      missingMonths: [] as number[],
      lastFilingPeriod: null,
    };
    expect(
      annual
        .ustIssues(false, { ...basis, figures: { ...basis.figures, kz47: 1_900, kz67: 1_900 }, missingMonths: [1, 2] }, 2025)
        .every((i) => i.tone !== "fehler"),
    ).toBe(true);
    const gesperrt = annual.ustIssues(false, { ...basis, kz48: 12_345 }, 2025);
    expect(gesperrt.some((i) => i.tone === "fehler" && /Kz 48/.test(i.text))).toBe(true);
    // Ein Jahr nur mit ergänzenden Angaben gilt nicht als Nullerklärung
    expect(annual.ustIssues(false, { ...basis, figures: { ...basis.figures, kz45: 5_000 } }, 2025).some((i) => /Nullerklärung/.test(i.text))).toBe(false);
    expect(annual.ustIssues(false, basis, 2025).some((i) => /Nullerklärung/.test(i.text))).toBe(true);
    // Der Vermerk „außerhalb abgegeben“ unterdrückt die Nullerklärungs-Meldung auch mit unserer Prüfung
    expect(annual.ustIssues(false, basis, 2025, { vermerkt: true }).some((i) => /Nullerklärung/.test(i.text))).toBe(false);
  });

  it("Link zu fehlenden Voranmeldungen nennt den letzten Zeitraum des betroffenen Jahres (#869)", async () => {
    const hinweis = (data: Awaited<ReturnType<typeof annual.ustYear>>) => annual.ustIssues(false, data, 2025).find((i) => i.link === "/umsatzsteuer");

    // Vierteljährlich: das vierte Quartal des Jahres, nicht der laufende Zeitraum
    await sql`insert into vat_frequencies (year, from_month, frequency) values (2025, 1, 'vierteljaehrlich')`;
    const quartal = await annual.ustYear(2025);
    expect(hinweis(quartal)).toMatchObject({ zeitraum: "2025-Q4" });

    // Monatlich: der Dezember
    await sql`update vat_frequencies set frequency = 'monatlich' where year = 2025`;
    expect(hinweis(await annual.ustYear(2025))).toMatchObject({ zeitraum: "2025-12" });

    // Der letzte Zeitraum nach der Einstellung: ein Jahr ohne eigene Einstellung übernimmt die des Vorjahres, ein
    // Wechsel zum 1. Oktober macht den Dezember zum letzten Zeitraum
    expect(annual.lastFilingPeriodKey([{ year: 2025, fromMonth: 1, frequency: "vierteljaehrlich" }], 2026)).toBe("2026-Q4");
    expect(
      annual.lastFilingPeriodKey(
        [
          { year: 2025, fromMonth: 1, frequency: "vierteljaehrlich" },
          { year: 2025, fromMonth: 10, frequency: "monatlich" },
        ],
        2025,
      ),
    ).toBe("2025-12");
    // Ohne Voranmeldung gibt es keinen Zeitraum für den Link
    expect(annual.lastFilingPeriodKey([{ year: 2025, fromMonth: 1, frequency: "keine" }], 2025)).toBeNull();
  });

  it("Meldungen zu Habens leerem Jahr treten hinter dem Vermerk zurück (#869)", async () => {
    const { loadCompany } = await import("../stammdaten/index.ts");
    const company = await loadCompany();
    const ust = await annual.ustYear(2025);
    const euer = await annual.euerYear(2025);
    const ohneVermerk = [...annual.ustIssues(false, ust, 2025), ...annual.euerIssues(company, euer)].map((i) => i.text);
    expect(ohneVermerk).toContain("Keine Umsätze und keine Vorsteuer: eine Nullerklärung geht über das ELSTER-Portal.");
    expect(ohneVermerk).toContain("Keine Betriebseinnahmen und -ausgaben im Jahr.");

    // Der Vermerk „außerhalb von Haben abgegeben“ steht direkt darunter; die Seite darf ihm nicht widersprechen
    await sql`insert into annual_submissions (form, year, kind, ok, code, message, figures, request_xml, response_xml, server_response_xml, filed_on)
      values ('ust', 2025, 'vermerk', true, 0, 'Außerhalb von Haben abgegeben', '{}'::jsonb, '', '', '', '2026-09-29'),
             ('euer', 2025, 'vermerk', true, 0, 'Außerhalb von Haben abgegeben', '{}'::jsonb, '', '', '', '2026-09-29')`;
    const overview = await annual.annualOverview(2025, TODAY);
    expect(overview.ust.submitted).not.toBeNull();
    expect(overview.euer.submitted).not.toBeNull();
    const texte = [...overview.ust.issues, ...overview.euer.issues].map((i) => i.text).join(" ");
    expect(texte).not.toMatch(/Nullerklärung/);
    expect(texte).not.toMatch(/Keine Betriebseinnahmen/);
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
      {
        gruppe: "kfz",
        bezeichnung: "Tesla Model Y",
        anschaffung: "2024-01-10",
        anschaffungskosten: 3_600_000,
        buchwertBeginn: 3_000_000,
        afa: 600_000,
        abgang: 0,
        buchwertEnde: 2_400_000,
        elektro: true,
      },
    ]);
    expect((await annual.annualOverview(2025, TODAY)).euer.issues).toEqual([]);
    expect(car.id).toBeTruthy();

    // Wechsel auf SKR04 zum neuen Jahr: Entnahmen und Einlagen des Vorjahres zählen in dessen Kontenrahmen weiter
    await sql`update company set kontenrahmen = 'SKR04'`;
    expect((await annual.euerYear(2025)).figures).toMatchObject({ entnahmen: 300_000 + 12 * (14_725 + 8_953), einlagen: 1_190 });
    await sql`update company set kontenrahmen = 'SKR03'`;

    await sql`update company set einkunftsart = null`;
    expect((await annual.annualOverview(2025, TODAY)).euer.issues[0]!.link).toBe("/einstellungen");
  });

  it("Anlage EÜR: negative Umsatzsteuer in Zeile 18 oder 58 wird vor dem Senden umgegliedert (#708, #933)", async () => {
    await year2025();
    const euer = await annual.euerYear(2025);
    const { loadCompany } = await import("../stammdaten/index.ts");
    const company = await loadCompany();
    const texte = (data: typeof euer) =>
      annual
        .euerIssues(company, data)
        .map((i) => i.text)
        .join(" ");
    // Der Grund muss tone fehler tragen: checkAnnual bricht nur darauf ab und würde sonst weiter senden.
    // euerIssues meldet auch anderes (fehlende Einkunftsart, Kontenrahmen), deshalb grenzt der Filter auf Zeile 18 und 58 ein.
    const fehler = (data: typeof euer) => annual.euerIssues(company, data).filter((i) => i.tone === "fehler" && /Zeile (58|18) \(Kz/.test(i.text));
    const hinweis = (data: typeof euer) => annual.euerIssues(company, data).filter((i) => i.tone === "hinweis" && /Zeile (58|18) \(Kz/.test(i.text));
    // Ein negativer Saldo wird umgegliedert statt mit Vorzeichen gesendet: Hinweis, kein Fehler (#933)
    const umgliederung = [
      "In Zeile 58 (Kz E6005101, „An das Finanzamt gezahlte und ggf. verrechnete Umsatzsteuer“) standen 190,00: im Jahr wurde mehr Umsatzsteuer erstattet als gezahlt. Der Gewinn bleibt gleich, gebuchte Daten ändern sich nicht.",
    ];
    expect(texte({ ...euer, ustUmgliederung: umgliederung })).toMatch(/Zeile 58 \(Kz E6005101.*190,00/);
    expect(texte({ ...euer, ustUmgliederung: umgliederung })).toMatch(/Der Gewinn bleibt gleich/);
    expect(hinweis({ ...euer, ustUmgliederung: umgliederung })).toHaveLength(1);
    // Ohne negativen Betrag bleibt die Vorprüfung still
    expect(texte(euer)).not.toMatch(/Zeile 58|Zeile 18 \(Kz/);
    expect(fehler({ ...euer, figures: { ...euer.figures, gezahlteUst: -19_000 } })).toHaveLength(1);
    expect(fehler({ ...euer, figures: { ...euer.figures, erstatteteUst: -19_000 } })).toHaveLength(1);
    expect(fehler({ ...euer, figures: { ...euer.figures, gezahlteUst: -19_000, erstatteteUst: -19_000 } })).toHaveLength(2);
    expect(fehler(euer)).toHaveLength(0);
  });

  it.each([
    ["SKR03", "ist"],
    ["SKR04", "soll"],
  ] as const)("Anlage EÜR: Wareneinkauf (Handelsware) in der Zeile Waren, Rohstoffe und Hilfsstoffe (%s, %s)", async (kontenrahmen, versteuerung) => {
    await sql`update company set kontenrahmen = ${kontenrahmen}, versteuerung = ${versteuerung}`;
    await bookedDocument(3, {
      supplierName: "Großhandel Süd",
      documentDate: "2025-05-12",
      category: "wareneinkauf",
      payment: "privat",
      net: 25_000,
      tax: 4_750,
    });
    const euer = await annual.euerYear(2025);
    expect(euer.figures).toMatchObject({ waren: 25_000, vorsteuer: 4_750 });
    expect(euer.figures.uebrige).toBeUndefined();
  });

  it.each([
    ["SKR03", "ist", "1840"],
    ["SKR04", "soll", "2250"],
  ] as const)(
    "Spende vom Geschäftskonto: Entnahme, keine Betriebsausgabe, Summe auf Zuwendungen, Spenden (%s, %s)",
    async (kontenrahmen, versteuerung, konto) => {
      await sql`update company set kontenrahmen = ${kontenrahmen}, versteuerung = ${versteuerung}`;
      await bank.importStatement(actor, { bytes: dkbCsv([row("15.12.25", "Ärzte ohne Grenzen e.V.", "Spende", "-150,00")]), filename: "s.csv" }, null);
      const [tx] = await sql`select id from bank_transactions`;
      await bank.allocate(actor, { kind: "spende", transactionId: tx!.id, amount: -15_000 });

      const lines = await sql`select account, debit, credit from journal_lines order by debit`;
      expect(lines.map((l) => [l.account, Number(l.debit), Number(l.credit)])).toEqual([
        [kontenrahmen === "SKR03" ? "1200" : "1800", 0, 15_000],
        [konto, 15_000, 0],
      ]);
      const euer = await annual.euerYear(2025);
      // Keine Ausgabe, keine andere Zeile: nur die Entnahme (Einlagen weist die Anlage stets aus)
      expect(euer.figures).toEqual({ entnahmen: 15_000, einlagen: 0 });
    },
  );

  it("prüft und übermittelt testweise, speichert Werte und XML, sperrt eine zweite Echtübermittlung", async () => {
    await year2025();
    await assets.bookDepreciation(actor, 2025, TODAY);
    const client = new EricGeprueftClient();

    const validated = await annual.submitAnnual(actor, "euer", 2025, client, { kind: "validate", today: TODAY });
    expect(validated.ok).toBe(true);
    await expect(annual.submitAnnual(actor, "euer", 2025, client, { kind: "test", today: TODAY })).rejects.toThrow(/PIN/);
    await expect(annual.submitAnnual(actor, "euer", 2025, client, { kind: "test", pin: "1234", today: TODAY })).rejects.toThrow(/Zertifikat/);
    await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(new Uint8Array([1, 2, 3]))})`;
    const tested = await annual.submitAnnual(actor, "euer", 2025, client, { kind: "test", pin: "1234", today: TODAY });
    expect(tested.ok).toBe(true);
    expect(tested.transferTicket).toMatch(/^fake-/);
    await expect(annual.submitAnnual(actor, "euer", 2025, client, { kind: "send", pin: "1234", herstellerId: "12345", today: TODAY })).rejects.toThrow(
      /Ohne ERiC/,
    );
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
    const realClient = {
      validate: client.validate.bind(client),
      send: client.send.bind(client),
      fetchPostfach: client.fetchPostfach.bind(client),
      fetchBelege: client.fetchBelege.bind(client),
    };
    await expect(annual.submitAnnual(actor, "ust", 2025, realClient, { kind: "send", pin: "1234", herstellerId: "12345", today: TODAY })).rejects.toThrow(
      /schon übermittelt/,
    );
    expect((await annual.annualOverview(2025, TODAY)).ust.sent).not.toBeNull();

    // Ein Vermerk außerhalb von Haben sperrt die Echtübermittlung ebenso: beides zugleich wäre eine doppelte Abgabe
    await sql`insert into annual_submissions (form, year, kind, ok, code, message, figures, request_xml, response_xml, server_response_xml)
      values ('euer', 2025, 'vermerk', true, 0, 'Außerhalb von Haben abgegeben', '{}'::jsonb, '', '', '')`;
    await expect(annual.submitAnnual(actor, "euer", 2025, realClient, { kind: "send", pin: "1234", herstellerId: "12345", today: TODAY })).rejects.toThrow(
      /außerhalb von Haben/,
    );
    await expect(sql`update annual_submissions set ok = false`).rejects.toThrow();
  });

  it("Einkommensteuer: Gewinn aus der EÜR, gespeicherte Angaben und Zusammenveranlagung", async () => {
    const taxpayer = await import("../stammdaten/taxpayer.ts");
    const incomeTax = await import("./income-tax.ts");
    await leeren(sql)`truncate income_tax_inputs`;
    await year2025();
    await assets.bookDepreciation(actor, 2025, TODAY);
    const client = new EricGeprueftClient();

    let overview = await annual.annualOverview(2025, TODAY);
    expect(overview.est.issues.some((i) => i.tone === "fehler" && i.text.includes("Persönliche Angaben"))).toBe(true);
    // Für die Einkommensteuer gibt es keinen Vermerk: ohne Versand ist „offen“ dort keine Pflicht (#869)
    expect(overview.est.verwaltet).toBe(false);
    await expect(annual.submitAnnual(actor, "est", 2025, client, { kind: "validate", today: TODAY })).rejects.toThrow(/Persönliche Angaben/);

    const person = { idnr: "86095742719", anrede: "Herrn" as const, vorname: "Max", name: "Muster", geburtsdatum: "1985-04-12", beruf: "Entwickler" };
    await taxpayer.saveTaxpayer(actor, {
      a: person,
      b: { ...person, idnr: "65929970489", anrede: "Frau", vorname: "Erika", religion: "02" },
      veranlagung: "zusammen",
      verheiratetSeit: "2015-06-20",
    });
    await incomeTax.saveEstAngaben(actor, 2025, {
      vorsorge: { a: { pkv: 600_000 }, b: { gkv: 300_000 } },
      sonderausgaben: { spenden: 10_000 },
      kinder: [{ vorname: "Lena", geburtsdatum: "2020-01-15", familienkasse: "Familienkasse Baden-Württemberg", kinderbetreuung: 150_000 }],
    });
    await expect(incomeTax.saveEstAngaben(actor, 2025, { kinder: [{ vorname: "", geburtsdatum: "x", familienkasse: "Familienkasse BW" }] })).rejects.toThrow();

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

    // Werte für Mein ELSTER: Personen mit Namen, wie Mein ELSTER die Anlagen je Person überschreibt
    const werte = await (await import("./mein-elster.ts")).meinElsterWerte("est", 2025, TODAY);
    expect(werte.personen).toEqual({ A: "Max Muster", B: "Erika Muster" });
    expect(werte.felder.find((f) => f.kennung === "E0803202")).toMatchObject({ wert: String(Math.round(euer.gewinn / 100)), person: "A" });

    await sql`insert into elster_certificates (filename, ciphertext) values ('test.pfx', ${crypto.encrypt(new Uint8Array([1]))})`;
    const tested = await annual.submitAnnual(actor, "est", 2025, client, { kind: "test", pin: "1234", today: TODAY });
    expect(tested.ok).toBe(true);
    const protocol = await annual.loadAnnualProtocol((await sql`select id from annual_submissions where form = 'est' and kind = 'test'`)[0]!.id);
    expect(protocol?.filename).toBe("Einkommensteuererklaerung-2025-Protokoll.pdf");
  });

  it("Einkommensteuer mit Anlage N: Arbeitslohn, Werbungskosten, Lohnsteuer in der Prognose, Homeoffice-Hinweis", async () => {
    const taxpayer = await import("../stammdaten/taxpayer.ts");
    const incomeTax = await import("./income-tax.ts");
    const pauschalen = await import("../buchhaltung/pauschalen.ts");
    await leeren(sql)`truncate income_tax_inputs`;
    await year2025();
    await assets.bookDepreciation(actor, 2025, TODAY);
    const person = { idnr: "86095742719", anrede: "Herrn" as const, vorname: "Max", name: "Muster", geburtsdatum: "1985-04-12", beruf: "Entwickler" };
    await taxpayer.saveTaxpayer(actor, {
      a: person,
      b: { ...person, idnr: "65929970489", anrede: "Frau", vorname: "Erika", religion: "02" },
      veranlagung: "zusammen",
      verheiratetSeit: "2015-06-20",
    });
    const lohn = {
      steuerklasse: 4 as const,
      brutto: 4_200_000,
      lohnsteuer: 612_340,
      kirchensteuer: 48_987,
      rvArbeitnehmer: 390_600,
      rvArbeitgeber: 390_600,
      kvArbeitnehmer: 341_200,
    };
    await expect(incomeTax.saveEstAngaben(actor, 2025, { arbeitnehmer: { b: { bescheinigungen: [{ ...lohn, brutto: 0 }] } } })).rejects.toThrow(
      /Bruttoarbeitslohn/,
    );
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
    expect((await annual.annualOverview(2025, TODAY)).est.issues.find((i) => /Homeoffice/.test(i.text))).toMatchObject({
      tone: "hinweis",
      link: "/pauschalen",
    });

    const client = new EricGeprueftClient();
    expect((await annual.submitAnnual(actor, "est", 2025, client, { kind: "validate", today: TODAY })).ok).toBe(true);
    const [row] = await sql`select request_xml from annual_submissions where form = 'est' order by created_at desc limit 1`;
    const xml: string = row!.request_xml;
    expect(xml).toMatch(/<N>\s*<Person>PersonA<\/Person>[\s\S]*<E0204507>30<\/E0204507>/);
    expect(xml).toMatch(/<N>\s*<Person>PersonB<\/Person>\s*<ArbL>\s*<LStB_1_5_Einz>\s*<E0200204>42000,00<\/E0200204>/);
    expect(xml).toContain("<E0203501>77815 Bühl, Industriestraße 4</E0203501>");
    expect(xml).toMatch(/<AVor>\s*<Person>PersonB<\/Person>\s*<E2000401>3906<\/E2000401>\s*<E2000801>3906<\/E2000801>/);
  });

  it("Werte für Mein ELSTER: dieselben Felder wie im XML, das beim Prüfen über ERiC rausgeht", async () => {
    await year2025();
    await assets.bookDepreciation(actor, 2025, TODAY);
    const mein = await import("./mein-elster.ts");
    const werte = await mein.meinElsterWerte("euer", 2025, TODAY, new Date("2026-10-02T08:00:00Z"));
    await annual.submitAnnual(actor, "euer", 2025, new EricGeprueftClient(), { kind: "validate", today: TODAY });
    const [sent] = await sql`select request_xml from annual_submissions where form = 'euer' order by created_at desc limit 1`;
    expect(werte).toMatchObject({ format: "haben-mein-elster", version: 1, formular: "euer", jahr: 2025, erstellt: "2026-10-02T08:00:00.000Z" });
    expect(werte.felder).toEqual(elster.elsterFelder(sent!.request_xml as string));
    expect(werte.felder.find((f) => f.kennung === "E6000401")?.wert).toMatch(/^\d+,\d{2}$/);
    // Die Hersteller-ID steht nur im Transferkopf und landet nie in Mein ELSTER
    expect(werte.felder.some((f) => f.wert === elster.NUR_AUSLESEN)).toBe(false);
    await expect(mein.meinElsterWerte("euer", 2026, TODAY)).rejects.toThrow(/nach Ablauf/);
  });
});
