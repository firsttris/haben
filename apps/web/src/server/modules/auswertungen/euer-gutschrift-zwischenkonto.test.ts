import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * EÜR einer Gutschrift „erstattet bereits Bezahltes“ (#786) neben der Vorsteuer nach Leistungsdatum (#930): Beide
 * nutzen das Zwischenkonto (SKR03 1548, SKR04 1434). Die Minderung der Vorsteuer nach § 17 Abs. 1 Satz 2 UStG wirkt in
 * der EÜR mit der Erstattung (§ 11 Abs. 1 EStG): unerstattet nichts, erstattet bzw. verrechnet das Entgelt als
 * Minderung des Aufwands und die Steuer als Minderung der gezahlten Vorsteuer, im Jahr der Erstattung. Je Fall: Zeilen
 * der EÜR aus dem Journal und kein Unterschied im Abgleich (Nebenbücher, Gewinn nach der DATEV-Formel).
 */
describe.skipIf(!testDatabaseUrl)("EÜR: Gutschrift „erstattet bereits Bezahltes“ neben #930 (Postgres, #786, #930)", () => {
  let bank: typeof import("../bank/index.ts");
  let verrechnung: typeof import("../bank/verrechnung.ts");
  let documents: typeof import("../belege/documents.ts");
  let abgleich: typeof import("./abgleich.ts");
  let euerJournal: typeof import("./euer-journal.ts");
  let sql: postgres.Sql;
  const actor = "euer-gutschrift-zwischenkonto";
  let lauf = 0;
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 97]);

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/index.ts");
    verrechnung = await import("../bank/verrechnung.ts");
    documents = await import("../belege/documents.ts");
    abgleich = await import("./abgleich.ts");
    euerJournal = await import("./euer-journal.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  type Fall = { kontenrahmen: "SKR03" | "SKR04"; versteuerung: "ist" | "soll" };

  async function firma(p: Fall) {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, vat_return_submissions, year_closings,
      write_offs, allocations, cash_entries, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, document_splits, documents, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, rechtsform, kleinunternehmer, payment_term_days, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${p.versteuerung}, ${p.kontenrahmen}, 'einzelunternehmen', false, 14, 2026)`;
  }

  type Angaben = {
    datum?: string;
    netto?: number;
    kategorie?: "software" | "edv";
    erstattetBezahltes?: boolean;
    von?: string | null;
    bis?: string | null;
    vorsteuerAnteil?: number | null;
  };

  /** Gebuchter Beleg; negatives `netto` ist eine Gutschrift, 19 % */
  async function beleg(o: Angaben) {
    lauf++;
    const netto = o.netto ?? -10_000;
    const { id } = await documents.uploadDocument(actor, {
      bytes: new Uint8Array([...JPEG, lauf % 251, Math.floor(lauf / 251)]),
      filename: `gutschrift-${lauf}.jpg`,
    });
    await documents.updateDocument(actor, id, {
      supplierName: "Stadtwerke Beispiel GmbH",
      supplierUstId: "",
      invoiceNumber: `G-${lauf}`,
      documentDate: o.datum ?? "2026-09-15",
      dueDate: null,
      ...(o.von ? { serviceFrom: o.von, serviceTo: o.bis ?? o.von } : {}),
      category: o.kategorie ?? "software",
      payment: "bank",
      note: "",
      privateShare: 0,
      erstattetBezahltes: o.erstattetBezahltes ?? true,
      vorsteuerAnteil: o.vorsteuerAnteil ?? null,
      amounts: [{ taxRate: 1900, net: netto, tax: Math.round((netto * 1_900) / 10_000) }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  /** Bankumsatz und Zuordnung; `betrag` in Cent mit dem Vorzeichen auf dem Konto */
  async function zahlung(documentId: string, betrag: number, datum: string) {
    const euro = (Math.abs(betrag) / 100).toFixed(2).replace(".", ",");
    const [jahr, monat, tag] = datum.split("-");
    const d = `${tag}.${monat}.${jahr!.slice(2)}`;
    const csv =
      `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"${d}";"${d}";"Gebucht";"Stadtwerke Beispiel GmbH";"Testfirma";"Erstattung";"${betrag > 0 ? "Eingang" : "Ausgang"}";"DE02100100100006820101";"${betrag < 0 ? "-" : ""}${euro}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `zahlung-${++lauf}.csv` }, null);
    const [umsatz] = await sql`select id from bank_transactions order by created_at desc limit 1`;
    await bank.allocate(actor, { kind: "document", transactionId: umsatz!.id as string, documentId, amount: betrag });
  }

  async function euer(year = 2026) {
    const zeilen = Object.fromEntries(Object.entries((await euerJournal.euerAusJournal(year)).summe.zeilen).filter(([, v]) => v !== 0));
    const abweichungen = abgleich.abweichungen((await abgleich.euerAbgleich(year)).zeilen);
    return { zeilen, abweichungen };
  }
  const nichts = { zeilen: {}, abweichungen: [] };
  const erstattet = (netto: number, steuer: number) => ({ zeilen: { "ausgabe:software": -netto, vorsteuer: -steuer }, abweichungen: [] });

  const faelle: Fall[] = [
    { kontenrahmen: "SKR03", versteuerung: "ist" },
    { kontenrahmen: "SKR04", versteuerung: "soll" },
  ];

  for (const p of faelle) {
    const n = `${p.kontenrahmen}/${p.versteuerung}`;

    it(`${n}: nicht erstattet, nichts in der EÜR`, async () => {
      await firma(p);
      await beleg({});
      expect(await euer()).toEqual(nichts);
    });

    it(`${n}: voll erstattet`, async () => {
      await firma(p);
      const id = await beleg({});
      await zahlung(id, 11_900, "2026-10-05");
      expect(await euer()).toEqual(erstattet(10_000, 1_900));
    });

    it(`${n}: zur Hälfte erstattet`, async () => {
      await firma(p);
      const id = await beleg({});
      await zahlung(id, 5_950, "2026-10-05");
      expect(await euer()).toEqual(erstattet(5_000, 950));
    });

    it(`${n}: Gutschrift im Dezember, Erstattung im Januar`, async () => {
      await firma(p);
      const id = await beleg({ datum: "2026-12-15" });
      await zahlung(id, 11_900, "2027-01-15");
      expect({ y26: await euer(2026), y27: await euer(2027) }).toEqual({ y26: nichts, y27: erstattet(10_000, 1_900) });
    });

    it(`${n}: mit einer Rechnung desselben Lieferanten verrechnet`, async () => {
      await firma(p);
      const gs = await beleg({});
      const re = await beleg({ netto: 20_000, kategorie: "edv", erstattetBezahltes: false, datum: "2026-09-20" });
      await verrechnung.settleDocuments(actor, { documentId: re, counterDocumentId: gs, amount: 11_900, date: "2026-10-01", note: "Aufrechnung" });
      // Rechnung zur Hälfte durch die Verrechnung bezahlt, die Gutschrift ganz erstattet
      expect(await euer()).toEqual({ zeilen: { "ausgabe:edv": 10_000, "ausgabe:software": -10_000 }, abweichungen: [] });
    });

    it(`${n}: mit einer Rechnung verrechnet, deren Leistung erst später ausgeführt wird (beide auf dem Zwischenkonto)`, async () => {
      await firma(p);
      const gs = await beleg({});
      const re = await beleg({ netto: 20_000, kategorie: "edv", erstattetBezahltes: false, datum: "2026-09-20", von: "2026-12-01", bis: "2026-12-31" });
      await verrechnung.settleDocuments(actor, { documentId: re, counterDocumentId: gs, amount: 11_900, date: "2026-10-01", note: "Aufrechnung" });
      expect(await euer()).toEqual({ zeilen: { "ausgabe:edv": 10_000, "ausgabe:software": -10_000 }, abweichungen: [] });
    });

    it(`${n}: verrechnet im Dezember, Rest der Rechnung im Januar bezahlt`, async () => {
      await firma(p);
      const gs = await beleg({ datum: "2026-10-15" });
      const re = await beleg({ netto: 20_000, kategorie: "edv", erstattetBezahltes: false, datum: "2026-10-20" });
      await verrechnung.settleDocuments(actor, { documentId: re, counterDocumentId: gs, amount: 11_900, date: "2026-11-01", note: "Aufrechnung" });
      await zahlung(re, -11_900, "2027-01-15");
      expect({ y26: await euer(2026), y27: await euer(2027) }).toEqual({
        y26: { zeilen: { "ausgabe:edv": 10_000, "ausgabe:software": -10_000 }, abweichungen: [] },
        y27: { zeilen: { "ausgabe:edv": 10_000, vorsteuer: 1_900 }, abweichungen: [] },
      });
    });

    it(`${n}: Gutschrift mit Teilabzug 50 %, voll erstattet`, async () => {
      await firma(p);
      const id = await beleg({ vorsteuerAnteil: 5_000 });
      await zahlung(id, 11_900, "2026-10-05");
      expect(await euer()).toEqual(erstattet(10_950, 950));
    });
  }
});
