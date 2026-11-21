import { bwaZeitraum } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "./test-umsatz-stand.ts";

/*
 * BWA nach Zufluss und Abfluss (#1380): dieselben Beträge wie die EÜR aus dem Journal, je Buchung mit Datum. Über ein Jahr
 * ergibt die BWA mit der Überleitung den Gewinn der EÜR, ein Zeitraum zählt nur die Zahlungen darin. Alle Daten sind erfunden.
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}
const KOSTEN_43 = [
  "material",
  "fremdleistungen",
  "personal",
  "raum",
  "steuernVersicherungenBeitraege",
  "kfz",
  "werbeReise",
  "warenabgabe",
  "instandhaltung",
  "abschreibungen",
  "verschiedeneKosten",
];
const umsatz = (date: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Nordwerk",
  "Testfirma",
  purpose,
  "Umsatz",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];

describe.skipIf(!testDatabaseUrl)("BWA nach Zufluss und Abfluss (Postgres, #1380)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("../bank/index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let konten: typeof import("../eigene-konten/index.ts");
  let reports: typeof import("./reports.ts");
  let bwa: typeof import("./bwa.ts");
  let euerJournal: typeof import("./euer-journal.ts");
  const actor = "test-user";
  let contactId: string;
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    konten = await import("../eigene-konten/index.ts");
    reports = await import("./reports.ts");
    bwa = await import("./bwa.ts");
    euerJournal = await import("./euer-journal.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04", rechtsform = "einzelunternehmen") {
    await leeren(sql)`truncate own_accounts, document_settlements, asset_depreciations, assets, pauschalen, allocations, bank_transactions, bank_imports,
      bank_accounts, cash_entries, write_offs, journal_lines, journal_entries, document_splits, document_amounts, documents, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, rechtsform)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, ${rechtsform})`;
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

  async function invoice(issueDate: string, net: number) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: net, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
  }

  async function beleg(date: string, net: number, category: "edv" | "bewirtung" | "software", payment: "bank" | "privat" = "bank", ownAccountId?: string) {
    docSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 9]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `b${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Rechenzentrum Süd",
      supplierUstId: "",
      invoiceNumber: `R${docSeq}`,
      documentDate: date,
      dueDate: null,
      category,
      payment,
      note: "",
      amounts: [{ taxRate: 1900, net, tax: Math.round(net * 0.19) }],
      privateShare: 0,
      reverseCharge: null,
      ...(ownAccountId ? { ownAccountId } : {}),
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  async function bankumsaetze(rows: string[][]) {
    await bank.importStatement(actor, { bytes: dkbCsv(rows), filename: `${crypto.randomUUID()}.csv` }, null);
    return sql<{ id: string; amount: number }[]>`select id, amount from bank_transactions order by booking_date, amount`;
  }

  const zeile = (bericht: Awaited<ReturnType<typeof bwa.bwaBericht>>, key: string) => bericht.zeilen.find((z) => z.key === key)!;

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Jahr gleich EÜR, Zeitraum nach Zahlung, Vergleich und Drilldown (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        // Rechnung im Dezember, bezahlt in zwei Raten über den Jahreswechsel; Beleg im Dezember, bezahlt im Januar
        const r = await invoice("2026-12-10", 100_000);
        const b = await beleg("2026-12-15", 20_000, "edv");
        await beleg("2027-02-03", 10_000, "bewirtung", "privat");
        const txs = await bankumsaetze([
          umsatz("20.12.26", `RE ${r.number} Teil 1`, "500,00"),
          umsatz("15.01.27", `RE ${r.number} Teil 2`, "690,00"),
          umsatz("05.01.27", "Rechenzentrum", "-238,00"),
        ]);
        const id = (amount: number) => txs.find((t) => t.amount === amount)!.id;
        await bank.allocate(actor, { kind: "invoice", transactionId: id(50_000), invoiceId: r.id, amount: 50_000 });
        await bank.allocate(actor, { kind: "invoice", transactionId: id(69_000), invoiceId: r.id, amount: 69_000 });
        await bank.allocate(actor, { kind: "document", transactionId: id(-23_800), documentId: b, amount: -23_800 });

        // Der Sammler ist rein additiv: Die Beiträge je Buchung ergeben über ein Jahr je Zeile genau die EÜR
        for (const jahr of [2026, 2027]) {
          const gesammelt: Record<string, number> = {};
          let bewirtung = 0;
          let gewerbesteuer = 0;
          const euer = await euerJournal.euerAusJournal(jahr, undefined, undefined, false, (_b, beitrag) => {
            for (const [key, betrag] of Object.entries(beitrag.zeilen)) gesammelt[key] = (gesammelt[key] ?? 0) + (betrag ?? 0);
            bewirtung += beitrag.bewirtungNichtAbziehbar;
            gewerbesteuer += beitrag.gewerbesteuerNichtAbziehbar;
          });
          expect(gesammelt, String(jahr)).toEqual(euer.summe.zeilen);
          expect([bewirtung, gewerbesteuer]).toEqual([euer.summe.bewirtungNichtAbziehbar, euer.summe.gewerbesteuerNichtAbziehbar]);
          expect(Object.keys(gesammelt).length, String(jahr)).toBeGreaterThan(0);
        }

        // Über das ganze Jahr: Ergebnis plus Überleitung ist der Gewinn der EÜR
        for (const jahr of [2026, 2027]) {
          const bericht = await bwa.bwaBericht(bwaZeitraum("jahr", jahr), "keiner");
          expect(zeile(bericht, "gewinnEuer").betrag, String(jahr)).toBe((await reports.euerForYear(jahr)).gewinn);
        }

        // Januar 2027: die zweite Rate (netto und Steuer) und der Beleg, verglichen mit dem Januar 2026
        const januar = await bwa.bwaBericht(bwaZeitraum("monat", 2027, 1), "vorjahr");
        expect(januar.vergleich).toEqual({ von: "2026-01-01", bis: "2026-01-31" });
        const erloeseJanuar = zeile(januar, "erloese");
        expect(erloeseJanuar.betrag + zeile(januar, "umsatzsteuer").betrag).toBe(69_000);
        expect(erloeseJanuar.vergleich).toBe(0);
        expect(erloeseJanuar.abweichung).toEqual({ betrag: erloeseJanuar.betrag, prozent: null });
        expect(zeile(januar, "instandhaltung").betrag).toBe(20_000);
        expect(zeile(januar, "vorsteuer").betrag).toBe(3_800);
        // Kumuliert ab 1. Januar, der Vergleich kumuliert ab 1. Januar des Vorjahres
        expect(januar.kumuliert).toEqual({ von: "2027-01-01", bis: "2027-01-31" });
        expect(januar.vergleichKumuliert).toEqual({ von: "2026-01-01", bis: "2026-01-31" });

        // Februar: Bewirtung voll bei den Kosten, 30 % in der Überleitung
        const februar = await bwa.bwaBericht(bwaZeitraum("monat", 2027, 2), "vorperiode");
        expect(zeile(februar, "werbeReise").betrag).toBe(10_000);
        expect(zeile(februar, "nichtAbziehbar").betrag).toBe(3_000);
        expect(zeile(februar, "werbeReise").vergleich).toBe(0);

        // Anteile (#1635): Erlöse in % der Summe der Erlöse, Kosten in % der Summe der Kosten, je Block zusammen 100 %
        const jahr2027 = await bwa.bwaBericht(bwaZeitraum("jahr", 2027), "vorjahr");
        const anteile = (keys: string[]) => keys.map((k) => zeile(jahr2027, k).anteil);
        expect(anteile(["erloese", "summeErloese", "instandhaltung", "werbeReise", "summeKosten"])).toEqual([10000, 10000, 6667, 3333, 10000]);
        expect(anteile(["umsatzsteuer", "summeEinnahmen", "vorsteuer", "summeAusgaben", "ergebnis", "nichtAbziehbar", "gewinnEuer"])).toEqual(
          Array(7).fill(null),
        );
        const kostenzeilen = jahr2027.zeilen.filter((z) => KOSTEN_43.includes(z.key));
        expect(Math.abs(kostenzeilen.reduce((s, z) => s + (z.anteil ?? 0), 0) - 10000)).toBeLessThanOrEqual(kostenzeilen.length);
        // Über das Jahr ist kumuliert der Zeitraum
        expect(jahr2027.zeilen.map((z) => z.anteilKumuliert)).toEqual(jahr2027.zeilen.map((z) => z.anteil));

        // Kennzahlen für Zeitraum, Vergleich und kumuliert, in % der Erlöse
        const quote = (z: number, n: number) => Math.sign(z) * Math.round(Math.abs(z * 10_000) / n);
        const erloese2027 = zeile(jahr2027, "summeErloese").betrag;
        expect(jahr2027.kennzahlen.zeitraum.map((k) => [k.key, k.wert])).toEqual([
          ["rohertragsquote", 10000],
          ["personalkostenquote", 0],
          ["kostenquote", quote(30_000, erloese2027)],
          ["umsatzrendite", quote(erloese2027 - 30_000, erloese2027)],
        ]);
        expect(jahr2027.kennzahlen.kumuliert).toEqual(jahr2027.kennzahlen.zeitraum);
        const erloese2026 = zeile(jahr2027, "summeErloese").vergleich!;
        expect(jahr2027.kennzahlen.vergleich?.find((k) => k.key === "umsatzrendite")?.wert).toBe(quote(erloese2026, erloese2026));
        expect(jahr2027.kennzahlen.vergleichKumuliert).toEqual(jahr2027.kennzahlen.vergleich);
        expect(februar.kennzahlen.vergleichKumuliert).toBeNull();
        // Februar 2027 ohne Erlöse: Kennzahlen ohne Wert
        expect(februar.kennzahlen.zeitraum.map((k) => k.wert)).toEqual([null, null, null, null]);

        // Drilldown: die Erlöse des Januars führen zur Rechnung, mit Nummer und Kunde
        const details = await bwa.bwaZeileDetails(bwaZeitraum("monat", 2027, 1), "erloese");
        expect(details.map((g) => g.betrag).reduce((s, b) => s + b, 0)).toBe(erloeseJanuar.betrag);
        const vorgaenge = details.flatMap((g) => g.vorgaenge);
        expect(vorgaenge.length).toBeGreaterThan(0);
        for (const v of vorgaenge) {
          expect(v.rechnungId).toBe(r.id);
          expect(v.datum).toBe("2027-01-15");
          expect(v.text).toBe(`${r.number} · Nordwerk Software GmbH`);
        }
        const kosten = await bwa.bwaZeileDetails(bwaZeitraum("monat", 2027, 1), "instandhaltung");
        expect(kosten.map((g) => [g.euerZeile, g.betrag, g.vorgaenge.map((v) => v.belegId)])).toEqual([["ausgabe:edv", 20_000, [b]]]);
      }, 60_000);
    }
  }

  it("ein eigenes Sachkonto zählt in der Zeile seiner Elternkategorie, nicht nach seiner Nummer (#270)", async () => {
    await reset("ist", "SKR03");
    // 4250 liegt bei den Raumkosten des Kontenrahmens, die Elternkategorie Software bei den verschiedenen Kosten
    const ownAccountId = await konten.createOwnAccount(actor, { account: "4250", name: "Cloud-Dienste", parentCategory: "software" });
    await beleg("2027-03-01", 5_000, "software", "privat", ownAccountId);
    const bericht = await bwa.bwaBericht(bwaZeitraum("monat", 2027, 3), "keiner");
    expect(zeile(bericht, "raum").betrag).toBe(0);
    expect(zeile(bericht, "verschiedeneKosten").betrag).toBe(5_000);
  }, 60_000);

  it("nennt die Jahre, deren AfA im Anlagenverzeichnis noch nicht gebucht ist", async () => {
    await reset("ist", "SKR03");
    const anlagen = await import("../buchhaltung/index.ts");
    await anlagen.createAsset(actor, {
      name: "Schreibtisch",
      kind: "buero",
      method: "linear",
      acquisitionDate: "2026-03-01",
      cost: 240_000,
      usefulLifeMonths: 156,
      openingDate: "2026-03-01",
      openingBookValue: 240_000,
      disposalDate: null,
      note: "",
    });
    expect((await bwa.bwaBericht(bwaZeitraum("monat", 2026, 3), "keiner")).afaOffen).toEqual([2026]);
    // Kumuliert reicht nur bis zum Ende des Zeitraums: Dezember 2025 berührt 2026 nicht
    expect((await bwa.bwaBericht(bwaZeitraum("monat", 2025, 12), "keiner")).afaOffen).toEqual([]);
  }, 60_000);

  it("nennt bei einem freien Zeitraum über den Jahreswechsel jedes Jahr darin, dessen AfA noch nicht gebucht ist", async () => {
    await reset("ist", "SKR03");
    const anlagen = await import("../buchhaltung/index.ts");
    await anlagen.createAsset(actor, {
      name: "Schreibtisch",
      kind: "buero",
      method: "linear",
      acquisitionDate: "2025-03-01",
      cost: 240_000,
      usefulLifeMonths: 156,
      openingDate: "2025-03-01",
      openingBookValue: 240_000,
      disposalDate: null,
      note: "",
    });
    expect((await bwa.bwaBericht({ von: "2025-07-01", bis: "2026-06-30" }, "keiner")).afaOffen).toEqual([2025, 2026]);
  }, 60_000);

  it("GmbH: keine BWA nach Zufluss, sondern Form 01 (bwa-form01.test.ts)", async () => {
    await reset("soll", "SKR04", "gmbh");
    await beleg("2027-03-01", 5_000, "software", "privat");
    const bericht = await bwa.bwaBericht(bwaZeitraum("jahr", 2027), "vorjahr");
    expect(bericht.kapitalgesellschaft).toBe(true);
    expect(bericht.zeilen.some((z) => z.key === "gewinnEuer")).toBe(false);
    expect(zeile(bericht, "sonstigeKosten").betrag).toBe(5_000);
  }, 60_000);
});
