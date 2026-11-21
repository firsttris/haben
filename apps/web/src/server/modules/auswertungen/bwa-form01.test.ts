import { bwaZeitraum } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "./test-umsatz-stand.ts";

/*
 * Kurzfristige Erfolgsrechnung nach DATEV-Form 01 für GmbH und UG (#1380): periodengerecht aus den Salden im Journal nach
 * Buchungsdatum. Über ein Jahr ist das vorläufige Ergebnis der Jahresüberschuss der GuV aus dem Jahresabschluss (nach den
 * Steuern vom Einkommen und Ertrag, § 275 Abs. 5 Nr. 7 und 8 HGB). Alle Daten sind erfunden.
 */

const KONTEN = {
  SKR03: { gesellschafter: "0730", forderungsverlust: "2400", kursverlust: "2150", kursgewinn: "2660", zinsertrag: "2650", koerperschaftsteuer: "2200" },
  SKR04: { gesellschafter: "3510", forderungsverlust: "6930", kursverlust: "6880", kursgewinn: "4840", zinsertrag: "7100", koerperschaftsteuer: "7600" },
} as const;

describe.skipIf(!testDatabaseUrl)("BWA nach DATEV-Form 01 (Postgres, #1380)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let konten: typeof import("../eigene-konten/index.ts");
  let buchhaltung: typeof import("../buchhaltung/index.ts");
  let manual: typeof import("../buchhaltung/manual.ts");
  let abschluss: typeof import("../buchhaltung/abschluss.ts");
  let bwa: typeof import("./bwa.ts");
  let form01: typeof import("./bwa-form01.ts");
  const actor = "test-user";
  let contactId: string;
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    konten = await import("../eigene-konten/index.ts");
    buchhaltung = await import("../buchhaltung/index.ts");
    manual = await import("../buchhaltung/manual.ts");
    abschluss = await import("../buchhaltung/abschluss.ts");
    bwa = await import("./bwa.ts");
    form01 = await import("./bwa-form01.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04", rechtsform = "gmbh") {
    await leeren(sql)`truncate own_accounts, document_settlements, asset_depreciations, assets, pauschalen, allocations, bank_transactions, bank_imports,
      bank_accounts, cash_entries, write_offs, journal_lines, journal_entries, document_splits, document_amounts, documents, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, rechtsform)
      values (1, 'Testfirma GmbH', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
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

  /** Beleg, vom Gesellschafter ausgelegt; ohne Bank, damit nur der Aufwand zählt */
  async function beleg(date: string, net: number, category: "edv" | "miete", ownAccountId?: string) {
    docSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 11]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `f${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Rechenzentrum Süd",
      supplierUstId: "",
      invoiceNumber: `R${docSeq}`,
      documentDate: date,
      dueDate: null,
      category,
      payment: "privat",
      note: "",
      amounts: [{ taxRate: 1900, net, tax: Math.round(net * 0.19) }],
      privateShare: 0,
      reverseCharge: null,
      ...(ownAccountId ? { ownAccountId } : {}),
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  /** Manuelle Buchung: `soll` an `haben` */
  const umbuchung = (date: string, soll: string, haben: string, betrag: number, description = "Umbuchung") =>
    manual.createManualEntry(
      actor,
      {
        date,
        description,
        lines: [
          { account: soll, debit: betrag, credit: 0 },
          { account: haben, debit: 0, credit: betrag },
        ],
      },
      "2099-12-31",
    );

  const zeile = (bericht: Awaited<ReturnType<typeof bwa.bwaBericht>>, key: string) => bericht.zeilen.find((z) => z.key === key)!;

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`Jahr gleich Jahresüberschuss der GuV, neutrale Konten, Zeitraum und Drilldown (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const k = KONTEN[kontenrahmen];
        await invoice("2027-03-10", 100_000);
        await beleg("2027-04-15", 20_000, "edv");
        // Manuelle Buchungen auf neutrale Konten, Zinsen und Körperschaftsteuer (gegen das Gesellschafter-Verrechnungskonto)
        await umbuchung("2027-05-02", k.forderungsverlust, k.gesellschafter, 5_000, "Forderungsausfall");
        await umbuchung("2027-05-03", k.kursverlust, k.gesellschafter, 1_000, "Kursverlust");
        await umbuchung("2027-05-04", k.gesellschafter, k.kursgewinn, 700, "Kursgewinn");
        await umbuchung("2027-06-30", k.gesellschafter, k.zinsertrag, 300, "Zinsen");
        await umbuchung("2027-12-31", k.koerperschaftsteuer, k.gesellschafter, 2_000, "Körperschaftsteuer");

        // Über das Jahr: vorläufiges Ergebnis = Jahresüberschuss der GuV (nach Steuern), ohne „Kontenklasse unbesetzt“
        const jahr = await bwa.bwaBericht(bwaZeitraum("jahr", 2027), "vorjahr");
        expect(jahr.kapitalgesellschaft).toBe(true);
        const guv = await abschluss.jahresabschluss(2027, "2028-06-30");
        if (!guv.kapitalgesellschaft) throw new Error("GmbH erwartet");
        expect(zeile(jahr, "vorlaeufigesErgebnis").betrag).toBe(guv.report.jahresergebnis);
        expect(guv.report.jahresergebnis).toBe(100_000 - 20_000 - 5_000 - 1_000 + 700 + 300 - 2_000);
        expect(zeile(jahr, "unbesetzt").betrag).toBe(0);

        // Forderungsverlust und Kursdifferenzen neutral, nicht im Betriebsergebnis
        expect(zeile(jahr, "umsatzerloese").betrag).toBe(100_000);
        expect(zeile(jahr, "instandhaltung").betrag).toBe(20_000);
        expect(zeile(jahr, "betriebsergebnis").betrag).toBe(80_000);
        expect(zeile(jahr, "neutralAufwand").betrag).toBe(6_000);
        expect(zeile(jahr, "neutralErtrag").betrag).toBe(700);
        expect(zeile(jahr, "zinsertrag").betrag).toBe(300);
        expect(zeile(jahr, "ergebnisVorSteuern").betrag).toBe(75_000);
        expect(zeile(jahr, "ertragsteuern").betrag).toBe(2_000);
        expect(zeile(jahr, "umsatzerloese").vergleich).toBe(0);

        // Anteile (#1635): Leistung in % der Gesamtleistung, Kostenarten in % der Gesamtkosten; Neutrales und Ergebnisse ohne
        const anteile = (keys: string[]) => keys.map((key) => zeile(jahr, key).anteil);
        expect(anteile(["umsatzerloese", "gesamtleistung", "rohertrag", "betrieblicherRohertrag", "instandhaltung", "gesamtkosten"])).toEqual([
          10000, 10000, 10000, 10000, 10000, 10000,
        ]);
        expect(anteile(["material", "personal"])).toEqual([0, 0]);
        expect(
          anteile(["betriebsergebnis", "neutralAufwand", "neutralerAufwand", "zinsertrag", "neutralerErtrag", "ergebnisVorSteuern", "ertragsteuern"]),
        ).toEqual(Array(7).fill(null));
        expect(zeile(jahr, "vorlaeufigesErgebnis").anteil).toBeNull();
        // Kennzahlen in % der Gesamtleistung; ohne Material kein Aufschlag, Vorjahr ohne Gesamtleistung ohne Wert
        expect(jahr.kennzahlen.zeitraum.map((k) => [k.key, k.wert])).toEqual([
          ["rohertragsquote", 10000],
          ["personalkostenquote", 0],
          ["kostenquote", 2000],
          ["umsatzrendite", 7300],
        ]);
        expect(jahr.kennzahlen.vergleich?.map((k) => k.wert)).toEqual([null, null, null, null]);

        // Periodengerecht nach Buchungsdatum: im März die Rechnung, im April der Beleg, unabhängig von der Zahlung
        const maerz = await bwa.bwaBericht(bwaZeitraum("monat", 2027, 3), "vorperiode");
        expect(zeile(maerz, "umsatzerloese").betrag).toBe(100_000);
        expect(zeile(maerz, "instandhaltung").betrag).toBe(0);
        expect(maerz.vergleich).toEqual({ von: "2027-02-01", bis: "2027-02-28" });
        const april = await bwa.bwaBericht(bwaZeitraum("monat", 2027, 4), "keiner");
        expect(zeile(april, "instandhaltung").betrag).toBe(20_000);
        expect(zeile(april, "instandhaltung").kumuliert).toBe(20_000);
        expect(zeile(april, "umsatzerloese").kumuliert).toBe(100_000);
        // Im April nur Kosten: kein Anteil an der Gesamtleistung; kumuliert seit Januar mit den Erlösen des März
        expect([zeile(april, "instandhaltung").anteil, zeile(april, "umsatzerloese").anteil]).toEqual([10000, null]);
        expect(zeile(april, "umsatzerloese").anteilKumuliert).toBe(10000);
        expect(april.kennzahlen.kumuliert.find((k) => k.key === "kostenquote")?.wert).toBe(2000);
        expect(april.kennzahlen.vergleich).toBeNull();

        // Drilldown: die Konten der Zeile, je mit Betrag
        const neutral = await form01.bwaForm01Konten(bwaZeitraum("jahr", 2027), "neutralAufwand");
        expect(neutral.map((n) => [n.konto, n.betrag])).toEqual([
          [k.forderungsverlust, 5_000],
          [k.kursverlust, 1_000],
        ]);
        expect(neutral[0]!.name).not.toBe("");

        // Kontenblatt für genau den Zeitraum: nur die Buchung darin, die Eröffnung ab Jahresbeginn
        const blatt = await buchhaltung.kontenblatt(k.forderungsverlust, buchhaltung.ledgerRangeVonBis({ von: "2027-05-02", bis: "2027-05-02" }));
        expect(blatt.zeilen.map((z) => [z.date, z.soll])).toEqual([["2027-05-02", 5_000]]);
        const danach = await buchhaltung.kontenblatt(k.forderungsverlust, buchhaltung.ledgerRangeVonBis({ von: "2027-05-03", bis: "2027-12-31" }));
        expect(danach.zeilen).toEqual([]);
        expect(danach.eroeffnung).toBe(5_000);
      }, 60_000);
    }
  }

  it("ein eigenes Sachkonto zählt in der Zeile seiner Elternkategorie und steht mit eigener Nummer im Drilldown (#270)", async () => {
    await reset("soll", "SKR03");
    // 4999 liegt bei den sonstigen Kosten, die Elternkategorie Miete bei den Raumkosten
    const ownAccountId = await konten.createOwnAccount(actor, { account: "4999", name: "Lagerfläche", parentCategory: "miete" });
    await beleg("2027-03-01", 5_000, "miete", ownAccountId);
    const bericht = await bwa.bwaBericht(bwaZeitraum("monat", 2027, 3), "keiner");
    expect(zeile(bericht, "raum").betrag).toBe(5_000);
    expect(zeile(bericht, "sonstigeKosten").betrag).toBe(0);
    const raum = await form01.bwaForm01Konten(bwaZeitraum("monat", 2027, 3), "raum");
    expect(raum.map((r) => [r.konto, r.name, r.betrag])).toEqual([["4999", "Lagerfläche", 5_000]]);
  }, 60_000);

  it("Eröffnungsbuchungen zählen nicht; Abschlussbuchungen als manuelle Buchung schon", async () => {
    await reset("soll", "SKR04", "ug");
    await manual.createManualEntry(
      actor,
      {
        kind: "eroeffnung",
        date: "2027-01-01",
        description: "Eröffnung",
        lines: [
          { account: "1800", debit: 50_000, credit: 0 },
          { account: "9000", debit: 0, credit: 50_000 },
        ],
      },
      "2099-12-31",
    );
    // Rückstellung für Abschlusskosten zum 31.12.: Aufwand im Jahr (6827 Abschluss- und Prüfungskosten an 3095)
    await umbuchung("2027-12-31", "6827", "3095", 1_500, "Rückstellung Abschlusskosten");
    const bericht = await bwa.bwaBericht(bwaZeitraum("jahr", 2027), "keiner");
    expect(zeile(bericht, "sonstigeKosten").betrag).toBe(1_500);
    expect(zeile(bericht, "vorlaeufigesErgebnis").betrag).toBe(-1_500);
    const guv = await abschluss.jahresabschluss(2027, "2028-06-30");
    if (!guv.kapitalgesellschaft) throw new Error("UG erwartet");
    expect(guv.report.jahresergebnis).toBe(-1_500);
  }, 60_000);

  for (const [kontenrahmen, ruecklage, gewinnruecklage] of [
    ["SKR03", "2496", "0846"],
    ["SKR04", "7765", "2930"],
  ] as const) {
    it(`Einstellung in die Gewinnrücklage ändert das vorläufige Ergebnis nicht (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen);
      await invoice("2027-03-10", 100_000);
      // Ergebnisverwendung nach dem Jahresergebnis (§ 158 AktG): Einstellung in die gesetzliche Rücklage
      await umbuchung("2027-12-31", ruecklage, gewinnruecklage, 5_000, "Einstellung in die Gewinnrücklage");
      const bericht = await bwa.bwaBericht(bwaZeitraum("jahr", 2027), "keiner");
      expect(zeile(bericht, "unbesetzt").betrag).toBe(0);
      expect(zeile(bericht, "vorlaeufigesErgebnis").betrag).toBe(100_000);
      const guv = await abschluss.jahresabschluss(2027, "2028-06-30");
      if (!guv.kapitalgesellschaft) throw new Error("GmbH erwartet");
      expect(zeile(bericht, "vorlaeufigesErgebnis").betrag).toBe(guv.report.jahresergebnis);
    }, 60_000);
  }

  it("Einzelunternehmen bekommen weiter Form 43", async () => {
    await reset("ist", "SKR03", "einzelunternehmen");
    const bericht = await bwa.bwaBericht(bwaZeitraum("jahr", 2027), "keiner");
    expect(bericht.kapitalgesellschaft).toBe(false);
    expect(bericht.zeilen.some((z) => z.key === "gewinnEuer")).toBe(true);
    expect(bericht.zeilen.some((z) => z.key === "vorlaeufigesErgebnis")).toBe(false);
  }, 60_000);
});
