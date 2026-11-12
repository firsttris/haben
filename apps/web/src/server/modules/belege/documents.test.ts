import { readFileSync } from "node:fs";
import { computeInvoiceTotals } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Die KI wird nicht aufgerufen; die Auslesung liefert feste Werte.
vi.mock("./extraction.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./extraction.ts")>();
  return {
    ...original,
    extractionAvailable: () => true,
    extractDocument: vi.fn(async () => ({
      extraction: { quelle: "test" },
      fields: {
        supplierName: "Telekom Deutschland GmbH",
        supplierUstId: "DE123475223",
        invoiceNumber: "MF-2026-09",
        documentDate: "2026-09-29",
        dueDate: null,
        currency: "EUR",
        category: "telefon" as const,
        amounts: [{ taxRate: 1900 as const, net: 3857, tax: 733 }],
        warnings: [],
      },
    })),
  };
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3]);

describe.skipIf(!testDatabaseUrl)("Belege (Postgres)", () => {
  let documents: typeof import("./documents.ts");
  let vorschlaege: typeof import("./vorschlaege.ts");
  let einvoice: typeof import("@haben/einvoice");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
    vorschlaege = await import("./vorschlaege.ts");
    einvoice = await import("@haben/einvoice");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate journal_lines, journal_entries, document_amounts, documents, exchange_rates, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, kontenrahmen) values (1, 'Testfirma', 'SKR03')`;
  });

  it("merkt sich den aus den Kontakten gewählten Lieferanten; ein unbekannter Kontakt wird abgelehnt", async () => {
    const stammdaten = await import("../stammdaten/index.ts");
    const hetzner = await stammdaten.createContact(actor, {
      kundennummer: "",
      name: "Hetzner Online GmbH",
      strasse: "",
      plz: "",
      ort: "",
      land: "DE",
      email: "",
      ustId: "DE812871812",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
      isCustomer: false,
      isSupplier: true,
    });
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 91]), filename: "hetzner.jpg" });
    const input = {
      supplierName: "Hetzner Online GmbH",
      supplierUstId: "DE812871812",
      supplierContactId: hetzner.id,
      invoiceNumber: "R1",
      documentDate: "2026-09-15",
      dueDate: null,
      category: "software" as const,
      payment: "bank" as const,
      note: "",
      amounts: [{ taxRate: 1900 as const, net: 1_000, tax: 190 }],
    };
    await documents.updateDocument(actor, id, input);
    expect((await documents.getDocument(id))!.document.supplierContactId).toBe(hetzner.id);
    await expect(documents.updateDocument(actor, id, { ...input, supplierContactId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(
      /Lieferant nicht gefunden/,
    );
    await documents.updateDocument(actor, id, { ...input, supplierContactId: null });
    expect((await documents.getDocument(id))!.document.supplierContactId).toBeNull();
  });

  it("erneutes Auslesen mit anderem Lieferanten löst die Verknüpfung zum Kontakt", async () => {
    const stammdaten = await import("../stammdaten/index.ts");
    const hetzner = await stammdaten.createContact(actor, {
      kundennummer: "",
      name: "Hetzner Online GmbH",
      strasse: "",
      plz: "",
      ort: "",
      land: "DE",
      email: "",
      ustId: "DE812871812",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
      isCustomer: false,
      isSupplier: true,
    });
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 92]), filename: "hetzner-2.jpg" });
    await documents.updateDocument(actor, id, {
      supplierName: "Hetzner Online GmbH",
      supplierUstId: "DE812871812",
      supplierContactId: hetzner.id,
      invoiceNumber: "R2",
      documentDate: "2026-09-15",
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: 1_000, tax: 190 }],
    });
    // Die Auslesung (Mock) liefert „Telekom Deutschland GmbH“: der Beleg zeigt nicht mehr auf Hetzner
    await documents.runExtraction(actor, id);
    const { document } = (await documents.getDocument(id))!;
    expect(document.supplierName).toBe("Telekom Deutschland GmbH");
    expect(document.supplierContactId).toBeNull();
  });

  it("von Hand eingetragener Tabellenkurs: der später veröffentlichte amtliche Kurs gilt auch für ungebuchte Belege", async () => {
    const stammdaten = await import("../stammdaten/index.ts");
    await stammdaten.storeExchangeRates(actor, [{ currency: "USD", month: "2026-09", rate: "1.08" }], "manuell");
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 77]), filename: "gh.jpg" });
    const input = {
      supplierName: "GitHub Inc.",
      supplierUstId: "",
      invoiceNumber: "GH-1",
      documentDate: "2026-09-15",
      dueDate: null,
      category: "software" as const,
      payment: "bank" as const,
      note: "",
      currency: "USD",
      exchangeRate: null as string | null,
      amounts: [{ taxRate: 1900 as const, net: 0, tax: 0, originalNet: 10_000, originalTax: 1_900 }],
    };
    await documents.updateDocument(actor, id, input);
    expect((await documents.getDocument(id))!.document).toMatchObject({ exchangeRate: "1.080000", exchangeRateSource: "ust" });
    // Ein eigener Kurs am zweiten Beleg bleibt
    const { id: own } = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 78]), filename: "gh2.jpg" });
    await documents.updateDocument(actor, own, { ...input, invoiceNumber: "GH-2", exchangeRate: "1,05" });

    await stammdaten.storeExchangeRates(actor, [{ currency: "USD", month: "2026-09", rate: "1.0812" }], "bmf");
    expect(await documents.applyPublishedRates(actor)).toBe(1);
    await documents.bookDocument(actor, id);
    expect((await documents.getDocument(id))!.document).toMatchObject({ exchangeRate: "1.081200", exchangeRateSource: "ust", gross: 11_006 });
    expect((await documents.getDocument(own))!.document).toMatchObject({ exchangeRate: "1.050000", exchangeRateSource: "manuell" });
  });

  it("liest eine ZUGFeRD-Rechnung beim Hochladen aus", async () => {
    const lines = [{ description: "Server CX22", quantity: 1000, unit: "Monat" as const, unitPrice: 3240, taxRate: 1900 as const }];
    const sample: import("@haben/einvoice").InvoiceDocument = {
      kind: "rechnung",
      format: "zugferd",
      number: "R0018834512",
      issueDate: "2026-09-30",
      dueDate: "2026-10-14",
      paymentTermDays: 14,
      currency: "EUR",
      seller: {
        name: "Hetzner Online GmbH",
        strasse: "Industriestr. 25",
        plz: "91710",
        ort: "Gunzenhausen",
        land: "DE",
        email: "info@hetzner.example",
        telefon: "+49 9831 5050",
        ustId: "DE812871812",
        iban: "DE92760700120750007700",
      },
      buyer: { name: "Testfirma", strasse: "Musterstraße 1", plz: "93047", ort: "Regensburg", land: "DE", email: "a@b.example" },
      lines: lines.map((l, i) => ({ ...l, position: i + 1, net: l.unitPrice })),
      totals: computeInvoiceTotals(lines),
    };
    const { pdf } = await einvoice.buildEInvoice(sample);
    const { id, duplicate } = await documents.uploadDocument(actor, { bytes: pdf, filename: "rechnung.pdf" });
    expect(duplicate).toBe(false);

    const result = await documents.getDocument(id);
    expect(result?.document).toMatchObject({
      extractedBy: "zugferd",
      extractionStatus: "fertig",
      supplierName: sample.seller.name,
      invoiceNumber: sample.number,
      documentDate: sample.issueDate,
      gross: sample.totals.gross,
      category: null,
    });
    expect(result?.amounts.map((a) => [a.taxRate, a.net, a.tax])).toEqual(sample.totals.taxes.map((t) => [t.rate, t.base, t.tax]));

    const again = await documents.uploadDocument(actor, { bytes: pdf, filename: "nochmal.pdf" });
    expect(again).toEqual({ id, duplicate: true });
  }, 30_000);

  it("Foto geht an die KI, Buchen erzeugt Aufwand und Vorsteuer und sperrt", async () => {
    const { id } = await documents.uploadDocument(actor, { bytes: JPEG, filename: "quittung.jpg" });
    const before = (await documents.getDocument(id))!;
    expect(before.document).toMatchObject({ extractedBy: "ki", extractionStatus: "fertig", category: "telefon", gross: 4590 });
    expect(documents.bookingIssues(before.document, before.amounts)).toEqual([]);

    await documents.bookDocument(actor, id);
    const lines = await sql`select l.account, l.debit, l.credit, l.tax_code from journal_lines l
      join journal_entries e on e.id = l.entry_id where e.source_id = ${id} order by l.debit desc`;
    expect(lines.map((l) => [l.account, l.debit, l.credit, l.tax_code])).toEqual([
      ["4920", 3857, 0, "VSt19"],
      ["1576", 733, 0, "VSt19"],
      ["1600", 0, 4590, null],
    ]);

    await expect(sql`update documents set note = 'x' where id = ${id}`).rejects.toThrow(/festgeschrieben/);
    await expect(sql`delete from document_amounts where document_id = ${id}`).rejects.toThrow(/gebucht/);
    await expect(documents.deleteDocument(actor, id)).rejects.toThrow(/gebucht/);
    expect(await documents.inputTaxForPeriod({ year: 2026, month: 9 })).toBe(733);
    expect(await documents.inputTaxForPeriod({ year: 2026, month: 10 })).toBe(0);
  });

  it("merkt sich die Kategorie je Lieferant und bucht privat bezahlte Belege an Privateinlage", async () => {
    const first = await documents.uploadDocument(actor, { bytes: JPEG, filename: "a.jpg" });
    await documents.updateDocument(actor, first.id, {
      supplierName: "Telekom Deutschland GmbH",
      supplierUstId: "DE123475223",
      invoiceNumber: "MF-2026-09",
      documentDate: "2026-09-29",
      dueDate: null,
      category: "internet",
      payment: "privat",
      note: "",
      amounts: [{ taxRate: 1900, net: 3857, tax: 733 }],
    });
    await documents.bookDocument(actor, first.id);
    const [counter] = await sql`select l.account from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_id = ${first.id} and l.credit > 0`;
    expect(counter?.account).toBe("1890");

    const second = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 9]), filename: "b.jpg" });
    expect((await documents.getDocument(second.id))?.document.category).toBe("internet");
  });

  it("Kategorie je Lieferant: die häufigste, bei Gleichstand die zuletzt gebuchte, mit Anzahl", async () => {
    const book = async (n: number, category: "internet" | "telefon") => {
      const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 40 + n]), filename: `t${n}.jpg` });
      await documents.updateDocument(actor, id, {
        supplierName: "Telekom Deutschland GmbH",
        supplierUstId: "DE123475223",
        invoiceNumber: `MF-${n}`,
        documentDate: "2026-09-29",
        dueDate: null,
        category,
        payment: "bank",
        note: "",
        amounts: [{ taxRate: 1900, net: 3857, tax: 733 }],
      });
      await documents.bookDocument(actor, id);
    };
    await book(1, "internet");
    await book(2, "telefon");
    // Gleichstand: der zuletzt gebuchte
    const lieferant = (supplierName: string, supplierUstId: string) => ({ supplierName, supplierUstId, supplierContactId: null });
    expect(await vorschlaege.supplierCategory(lieferant("Telekom Deutschland GmbH", ""))).toMatchObject({ category: "telefon", count: 1, total: 2 });
    await book(3, "internet");
    await book(4, "internet");
    // Zuletzt „telefon“, häufiger bleibt „internet“
    await book(5, "telefon");
    // Erkannt an der USt-IdNr. oder am Namen ohne Groß- und Kleinschreibung
    expect(await vorschlaege.supplierCategory(lieferant("", "DE123475223"))).toMatchObject({ category: "internet", count: 3, total: 5 });
    expect(await vorschlaege.supplierCategory(lieferant("telekom deutschland gmbh ", ""))).toMatchObject({ category: "internet", count: 3, total: 5 });
    expect(await vorschlaege.supplierCategory(lieferant("Andere GmbH", ""))).toBeNull();
    // Auch die Auslesung (KI: „telefon“) überstimmt die häufigste Kategorie
    const next = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 99]), filename: "neu.jpg" });
    expect((await documents.getDocument(next.id))?.document.category).toBe("internet");
  });

  it("Fremdwährung: KI-Beträge sind Originalbeträge, gebucht wird erst mit Kurs und dann in Euro", async () => {
    const extraction = await import("./extraction.ts");
    vi.mocked(extraction.extractDocument).mockResolvedValueOnce({
      extraction: { quelle: "test" } as unknown as import("./extraction.ts").Extraction,
      fields: {
        supplierName: "Figma Inc.",
        supplierUstId: "",
        invoiceNumber: "F-1001",
        documentDate: "2026-09-15",
        dueDate: null,
        currency: "USD",
        category: "software",
        amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
        warnings: ["Währung USD: bitte den Umrechnungskurs eintragen"],
      },
    });
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 7]), filename: "figma.jpg" });
    const extracted = (await documents.getDocument(id))!;
    expect(extracted.document).toMatchObject({ currency: "USD", exchangeRate: null, net: 0, tax: 0, gross: 0 });
    expect(extracted.amounts.map((a) => [a.net, a.tax, a.originalNet, a.originalTax])).toEqual([[0, 0, 10_000, 1_900]]);
    expect(documents.bookingIssues(extracted.document, extracted.amounts, "2026-10-22")).toEqual(["Umrechnungskurs für USD 09/2026 fehlt"]);
    expect(documents.bookingIssues(extracted.document, extracted.amounts, "2026-09-30")[0]).toMatch(/^Kurs für 09\/2026 noch nicht veröffentlicht/);
    await expect(documents.bookDocument(actor, id)).rejects.toThrow(/Kurs für 09\/2026|Umrechnungskurs für USD 09\/2026/);

    const input = {
      supplierName: "Figma Inc.",
      supplierUstId: "",
      invoiceNumber: "F-1001",
      documentDate: "2026-09-15",
      dueDate: null,
      category: "software" as const,
      payment: "bank" as const,
      note: "",
      currency: "usd",
      exchangeRate: "1,0812",
      amounts: [{ taxRate: 1900 as const, net: 0, tax: 0, originalNet: 10_000, originalTax: 1_900 }],
    };
    await documents.updateDocument(actor, id, input);
    const converted = (await documents.getDocument(id))!;
    // 100,00 USD / 1,0812 = 92,49 €; 19,00 USD / 1,0812 = 17,57 €
    expect(converted.document).toMatchObject({ currency: "USD", exchangeRate: "1.081200", net: 9249, tax: 1757, gross: 11_006 });
    expect(converted.amounts.map((a) => [a.net, a.tax, a.originalNet, a.originalTax])).toEqual([[9249, 1757, 10_000, 1_900]]);
    expect(documents.bookingIssues(converted.document, converted.amounts)).toEqual([]);

    await documents.bookDocument(actor, id);
    const lines = await sql`select l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id where e.source_id = ${id}`;
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(11_006);
    expect(lines.reduce((s, l) => s + l.credit, 0)).toBe(11_006);
  });

  it("USt-Umrechnungskurs: ohne eigenen Kurs der Kurs des Monats, nach Veröffentlichung nachgetragen, eigener Kurs bleibt", async () => {
    const stammdaten = await import("../stammdaten/index.ts");
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 12]), filename: "gh.jpg" });
    const input = {
      supplierName: "GitHub Inc.",
      supplierUstId: "",
      invoiceNumber: "GH-1",
      documentDate: "2026-09-15",
      dueDate: null,
      category: "software" as const,
      payment: "bank" as const,
      note: "",
      currency: "USD",
      exchangeRate: null,
      amounts: [{ taxRate: 1900 as const, net: 0, tax: 0, originalNet: 10_000, originalTax: 1_900 }],
    };
    await documents.updateDocument(actor, id, input);
    expect((await documents.getDocument(id))!.document).toMatchObject({ exchangeRate: null, exchangeRateSource: null, gross: 0 });

    // Das BMF veröffentlicht September: der wartende Beleg wird umgerechnet
    await stammdaten.storeExchangeRates(
      actor,
      [
        { currency: "USD", month: "2026-09", rate: "1.0812" },
        { currency: "USD", month: "2026-10", rate: "1.1" },
      ],
      "bmf",
    );
    expect(await documents.applyPublishedRates(actor)).toBe(1);
    const applied = (await documents.getDocument(id))!.document;
    expect(applied).toMatchObject({ exchangeRate: "1.081200", exchangeRateSource: "ust", exchangeRateDate: "2026-09-01", gross: 11_006 });

    // Unverändert übernommen folgt der Kurs dem Belegdatum
    await documents.updateDocument(actor, id, { ...input, documentDate: "2026-10-02", exchangeRate: "1,0812" });
    expect((await documents.getDocument(id))!.document).toMatchObject({ exchangeRate: "1.100000", exchangeRateSource: "ust", exchangeRateDate: "2026-10-01" });

    // Eigener Kurs (z. B. aus der Bankabrechnung) bleibt; mit gestattetem Tageskurs als Tageskurs mit Datum
    await documents.updateDocument(actor, id, { ...input, documentDate: "2026-10-02", exchangeRate: "1,0950" });
    expect((await documents.getDocument(id))!.document).toMatchObject({ exchangeRate: "1.095000", exchangeRateSource: "manuell", exchangeRateDate: null });
    await sql`update company set tageskurs = true`;
    await documents.updateDocument(actor, id, { ...input, documentDate: "2026-10-02", exchangeRate: "1,0950", exchangeRateDate: "2026-10-05" });
    expect((await documents.getDocument(id))!.document).toMatchObject({ exchangeRateSource: "tageskurs", exchangeRateDate: "2026-10-05" });

    // Gebucht ändert ein neuer Kurs nichts mehr
    await documents.bookDocument(actor, id);
    await stammdaten.storeExchangeRates(actor, [{ currency: "USD", month: "2026-10", rate: "1.2" }], "bmf");
    expect(await documents.applyPublishedRates(actor)).toBe(0);
    expect((await documents.getDocument(id))!.document.exchangeRate).toBe("1.095000");
  });

  it("lehnt § 13b beim Wareneinkauf ab: Waren aus dem EU-Ausland sind ein innergemeinschaftlicher Erwerb, keine sonstige Leistung", async () => {
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 41]), filename: "waren-eu.jpg" });
    await documents.updateDocument(actor, id, {
      supplierName: "Groothandel B.V.",
      supplierUstId: "NL123456789B01",
      invoiceNumber: "NL-2026-7",
      documentDate: "2026-09-30",
      dueDate: null,
      category: "wareneinkauf",
      payment: "bank",
      note: "",
      reverseCharge: "eu",
      currency: "EUR",
      exchangeRate: null,
      amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
    });
    const doc = (await documents.getDocument(id))!;
    // § 13b Abs. 1 UStG gilt nur für sonstige Leistungen (Kz 46/47); Waren gehören in Kz 89/93 (§ 1a UStG)
    expect(documents.bookingIssues(doc.document, doc.amounts)).toContain("§ 13b gilt nicht für Wareneinkäufe");
  });

  it.each([
    ["eu", "software", "Steuer § 13b"],
    ["ig_erwerb", "buero", "Erwerbsteuer"],
  ] as const)(
    "%s in Euro: die selbst geschuldete Steuer rechnet der Server aus Netto und Satz, nicht aus der Eingabe (#331)",
    async (reverseCharge, category, name) => {
      const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, reverseCharge.length, 42]), filename: `${reverseCharge}.jpg` });
      const input = {
        supplierName: "Lieferant B.V.",
        supplierUstId: "NL123456789B01",
        invoiceNumber: `NL-${reverseCharge}`,
        documentDate: "2026-09-30",
        dueDate: null,
        category,
        payment: "bank" as const,
        note: "",
        reverseCharge,
        currency: "EUR",
        exchangeRate: null,
      };
      // Über die API oder ein altes Formular kommt eine abweichende Steuer; maßgeblich sind 19 % bzw. 7 % vom Netto
      await documents.updateDocument(actor, id, {
        ...input,
        amounts: [
          { taxRate: 1900, net: 20_000, tax: 0 },
          { taxRate: 700, net: 10_000, tax: 999 },
        ],
      });
      const doc = (await documents.getDocument(id))!;
      expect(doc.amounts.map((a) => [a.taxRate, a.net, a.tax]).sort()).toEqual(
        [
          [1900, 20_000, 3_800],
          [700, 10_000, 700],
        ].sort(),
      );
      expect(doc.document).toMatchObject({ net: 30_000, tax: 4_500, gross: 30_000 });
      // Ein schon gespeicherter Entwurf mit abweichender Steuer lässt sich nicht buchen, bis er neu gespeichert ist
      await sql`update document_amounts set tax = 0 where document_id = ${id} and tax_rate = 1900`;
      const legacy = (await documents.getDocument(id))!;
      expect(documents.bookingIssues(legacy.document, legacy.amounts)).toContain(`${name} passt nicht zu Netto und Satz; öffne den Beleg und speichere ihn`);
    },
  );

  it("§ 13b in Fremdwährung neu ausgelesen: die Steuer kommt aus dem umgerechneten Netto, nicht aus der Auslesung (#335)", async () => {
    const extraction = await import("./extraction.ts");
    await sql`insert into exchange_rates (currency, month, rate, source) values ('USD', '2026-09', 1.0812, 'bmf')`;
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 9, 13]), filename: "aws-usd.jpg" });
    await documents.updateDocument(actor, id, {
      supplierName: "Amazon Web Services, Inc.",
      supplierUstId: "",
      invoiceNumber: "US-1",
      documentDate: "2026-09-30",
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      reverseCharge: "drittland",
      currency: "USD",
      exchangeRate: null,
      amounts: [{ taxRate: 1900, net: 0, tax: 0, originalNet: 10_000, originalTax: 0 }],
    });
    // Die Rechnung weist keine Steuer aus; neu ausgelesen bleibt der Beleg § 13b
    vi.mocked(extraction.extractDocument).mockResolvedValueOnce({
      extraction: { quelle: "test" } as unknown as import("./extraction.ts").Extraction,
      fields: {
        supplierName: "Amazon Web Services, Inc.",
        supplierUstId: "",
        invoiceNumber: "US-1",
        documentDate: "2026-09-30",
        dueDate: null,
        currency: "USD",
        category: "software",
        amounts: [{ taxRate: 1900, net: 10_000, tax: 0 }],
        warnings: [],
      },
    });
    await documents.runExtraction(actor, id);
    const doc = (await documents.getDocument(id))!;
    expect(doc.document.reverseCharge).toBe("drittland");
    // 100,00 USD / 1,0812 = 92,49 €; § 13b: 19 % davon = 17,57 € in Kz 85, gezahlt wird netto
    expect(doc.amounts.map((a) => [a.net, a.tax])).toEqual([[9249, 1757]]);
    expect(doc.document).toMatchObject({ net: 9249, tax: 1757, gross: 9249 });
  });

  it("Fremdwährung mit § 13b: Steuer aus dem umgerechneten Netto; zurück auf Euro löscht Kurs und Originalbeträge", async () => {
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 8]), filename: "aws.jpg" });
    const base = {
      supplierName: "Amazon Web Services EMEA SARL",
      supplierUstId: "LU26888617",
      invoiceNumber: "EUINDE26-1",
      documentDate: "2026-09-30",
      dueDate: null,
      category: "software" as const,
      payment: "bank" as const,
      note: "",
      reverseCharge: "eu" as const,
    };
    await documents.updateDocument(actor, id, {
      ...base,
      currency: "USD",
      exchangeRate: "1.0812",
      amounts: [{ taxRate: 1900, net: 0, tax: 0, originalNet: 10_000, originalTax: 0 }],
    });
    const rc = (await documents.getDocument(id))!;
    // Bezahlt wird netto; die Steuer nach § 13b ist 19 % von 92,49 €
    expect(rc.document).toMatchObject({ net: 9249, tax: 1757, gross: 9249 });

    await expect(
      documents.updateDocument(actor, id, {
        ...base,
        currency: "USD",
        exchangeRate: "0",
        amounts: [{ taxRate: 1900, net: 0, tax: 0, originalNet: 1, originalTax: 0 }],
      }),
    ).rejects.toThrow(/Umrechnungskurs ungültig/);
    await expect(
      documents.updateDocument(actor, id, {
        ...base,
        currency: "USD",
        exchangeRate: "0,000001",
        amounts: [{ taxRate: 1900, net: 0, tax: 0, originalNet: 10_000_000, originalTax: 0 }],
      }),
    ).rejects.toThrow(/zu groß/);
    // 50 Mio. Yen passen nicht in int4-Cent, als Originalbetrag aber schon; umgerechnet (1 EUR = 160 JPY) sind es 312.500 €
    await documents.updateDocument(actor, id, {
      ...base,
      currency: "JPY",
      exchangeRate: "160",
      amounts: [{ taxRate: 1900, net: 0, tax: 0, originalNet: 5_000_000_000, originalTax: 0 }],
    });
    const yen = (await documents.getDocument(id))!;
    expect(yen.amounts.map((a) => [a.originalNet, a.net])).toEqual([[5_000_000_000, 31_250_000]]);
    // Winziger Betrag mit großem Kurs: umgerechnet 0,00 €, also nicht buchbar
    await documents.updateDocument(actor, id, {
      ...base,
      currency: "USD",
      exchangeRate: "1000",
      amounts: [{ taxRate: 1900, net: 0, tax: 0, originalNet: 4, originalTax: 0 }],
    });
    const zero = (await documents.getDocument(id))!;
    expect(documents.bookingIssues(zero.document, zero.amounts)).toEqual(["Umgerechnet 0,00 €, bitte den Kurs prüfen"]);

    await documents.updateDocument(actor, id, {
      ...base,
      currency: "EUR",
      exchangeRate: "1.0812",
      amounts: [{ taxRate: 1900, net: 5000, tax: 950, originalNet: 10_000, originalTax: 0 }],
    });
    const euro = (await documents.getDocument(id))!;
    expect(euro.document).toMatchObject({ currency: "EUR", exchangeRate: null, net: 5000, gross: 5000 });
    expect(euro.amounts.map((a) => [a.originalNet, a.originalTax])).toEqual([[null, null]]);
  });

  it("Bestand: alte Fremdwährungsbelege bekommen ihre Beträge als Originalbeträge, gesperrte bleiben", async () => {
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 9]), filename: "alt.jpg" });
    // So hat die Auslesung vor den Kursen gespeichert: Dollarbeträge in den Euro-Spalten
    await sql`update documents set currency = 'USD', net = 10000, tax = 0, gross = 10000 where id = ${id}`;
    await sql`delete from document_amounts where document_id = ${id}`;
    await sql`insert into document_amounts (document_id, tax_rate, net, tax) values (${id}, 0, 10000, 0)`;
    const migration = readFileSync(new URL("../../../../drizzle/0075_fremdwaehrung_bestand.sql", import.meta.url), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) await sql.unsafe(statement);
    const after = (await documents.getDocument(id))!;
    expect(after.document).toMatchObject({ currency: "USD", net: 0, tax: 0, gross: 0 });
    expect(after.amounts.map((a) => [a.net, a.originalNet])).toEqual([[0, 10000]]);
    expect(documents.bookingIssues(after.document, after.amounts, "2026-10-22")).toEqual(["Umrechnungskurs für USD 09/2026 fehlt"]);
  });

  it("verlangt Pflichtangaben und erlaubt Löschen ungebuchter Belege", async () => {
    const { id } = await documents.uploadDocument(actor, { bytes: JPEG, filename: "c.jpg" });
    await documents.updateDocument(actor, id, {
      supplierName: "",
      supplierUstId: "",
      invoiceNumber: "",
      documentDate: null,
      dueDate: null,
      category: null,
      payment: "bank",
      note: "",
      amounts: [],
    });
    await expect(documents.bookDocument(actor, id)).rejects.toThrow(/Lieferant fehlt, Belegdatum fehlt, Kategorie fehlt, Beträge fehlen/);
    await documents.deleteDocument(actor, id);
    expect(await documents.getDocument(id)).toBeNull();
  });

  it("Löschen lässt Dateien liegen, die das Archiv noch nutzt", async () => {
    const storage = await import("../../storage.ts");
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 7, 7, 1]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: "x.jpg" });
    const sha = storage.sha256Of(bytes);
    await sql`insert into archive_files (kind, year, filename, sha256, mime_type, size) values ('kontoauszug', 2025, 'auszug.jpg', ${sha}, 'image/jpeg', 8)`;
    await documents.deleteDocument(actor, id);
    expect((await storage.loadFile(sha)).byteLength).toBe(8);

    const other = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 2]);
    const second = await documents.uploadDocument(actor, { bytes: other, filename: "y.jpg" });
    await documents.deleteDocument(actor, second.id);
    await expect(storage.loadFile(storage.sha256Of(other))).rejects.toThrow();
  });

  it("Löschen lässt Dateien liegen, die ein Bescheid aus dem Postfach nutzt", async () => {
    const storage = await import("../../storage.ts");
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 3, 3, 3, 3]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: "bescheid.jpg" });
    const sha = storage.sha256Of(bytes);
    const [request] = await sql<{ id: string }[]>`
      insert into postfach_requests (art, test, ok, code, message, request_xml, response_xml, server_response_xml)
      values ('anfrage', true, true, 0, '', '', '', '') returning id`;
    await sql`
      insert into postfach_documents (referenz_id, bereitstellung_id, datenart, veranlagungszeitraum, steuernummer,
        bescheiddatum, dateibezeichnung, mime_type, filename, sha256, size, test, request_id)
      values ('r1', 'b1', 'ESt', '2025', '', '', '', 'image/jpeg', 'bescheid.jpg', ${sha}, 8, true, ${request!.id})`;
    await documents.deleteDocument(actor, id);
    expect((await storage.loadFile(sha)).byteLength).toBe(8);
  });

  it("stellt eine beschädigte Datei beim erneuten Ablegen wieder her", async () => {
    const storage = await import("../../storage.ts");
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 4, 4, 4]);
    const sha = await storage.storeFile(bytes);
    await writeFile(join(process.env.DOCUMENTS_DIR!, sha.slice(0, 2), sha), "");
    await expect(storage.loadFile(sha)).rejects.toThrow(/beschädigt/);
    await storage.storeFile(bytes);
    expect((await storage.loadFile(sha)).byteLength).toBe(8);
  });

  it("gibt eine durch Neustart abgebrochene Auslesung wieder frei", async () => {
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 5, 5]), filename: "z.jpg" });
    await sql`update documents set extraction_status = 'laeuft', supplier_name = '' where id = ${id}`;
    const detail = await documents.getDocument(id);
    expect(detail?.document).toMatchObject({ extractionStatus: "fehler", extractionError: expect.stringMatching(/unterbrochen/) });
    const [audit] = await sql`
      select actor from audit_log where table_name = 'documents' and row_id = ${id} and new_value->>'extraction_status' = 'fehler'`;
    expect(audit?.actor).toBe("system:auslesung");
  });

  it("lehnt unbekannte Dateitypen ab", async () => {
    await expect(documents.uploadDocument(actor, { bytes: new TextEncoder().encode("hallo"), filename: "x.txt" })).rejects.toThrow(/Erlaubt sind/);
  });
});
