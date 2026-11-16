import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * EÜR bei Belegen mit Leistung nach dem Belegdatum (#693, #930): Die Steuer steht bis zur Ausführung auf dem
 * Zwischenkonto (SKR03 1548, SKR04 1434), die Freigabe bucht sie auf die Vorsteuer um. In der EÜR (§ 4 Abs. 3 EStG) ist
 * die gezahlte Vorsteuer Betriebsausgabe im Jahr der Zahlung (§ 11 Abs. 2 EStG); die Freigabe ändert weder den Gewinn
 * noch die Zeile „Gezahlte Vorsteuerbeträge“. Der nicht abziehbare Teil (§ 15 Abs. 4 UStG, #926) ist Aufwand.
 * Je Fall: die Zeilen der EÜR aus dem Journal wie nach dieser Regel und kein Unterschied im Abgleich (euerAbgleich:
 * Journal gegen Nebenbücher, dazu der Gewinn nach der DATEV-Formel).
 */
describe.skipIf(!testDatabaseUrl)("EÜR: Vorsteuer nach Leistungsdatum (Postgres, #693, #930)", () => {
  let bank: typeof import("../bank/index.ts");
  let documents: typeof import("../belege/documents.ts");
  let cancellation: typeof import("../belege/cancellation.ts");
  let abgleich: typeof import("./abgleich.ts");
  let euerJournal: typeof import("./euer-journal.ts");
  let sql: postgres.Sql;
  const actor = "euer-leistungsdatum";
  let lauf = 0;
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 95]);

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/index.ts");
    documents = await import("../belege/documents.ts");
    cancellation = await import("../belege/cancellation.ts");
    abgleich = await import("./abgleich.ts");
    euerJournal = await import("./euer-journal.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  type Fall = { kontenrahmen: "SKR03" | "SKR04"; versteuerung: "ist" | "soll"; anteil: 10_000 | 5_000 };

  async function firma(p: Fall) {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, vat_return_submissions, year_closings,
      write_offs, allocations, cash_entries, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, document_splits, documents, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, rechtsform, kleinunternehmer, payment_term_days, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${p.versteuerung}, ${p.kontenrahmen}, 'einzelunternehmen', false, 14, 2026)`;
  }

  type Betrag = { taxRate: 700 | 1900; net: number; tax: number; vorsteuerAnteil?: number | null };

  /** Gebuchter Eingangsbeleg über 100 € netto zu 19 %, Leistung im Monat nach dem Belegdatum */
  async function beleg(p: Fall, o: { datum?: string; von?: string; bis?: string; amounts?: Betrag[] } = {}) {
    lauf++;
    const { id } = await documents.uploadDocument(actor, {
      bytes: new Uint8Array([...JPEG, lauf % 251, Math.floor(lauf / 251)]),
      filename: `leistung-${lauf}.jpg`,
    });
    await documents.updateDocument(actor, id, {
      supplierName: "Stadtwerke Beispiel GmbH",
      supplierUstId: "",
      invoiceNumber: `L-${lauf}`,
      documentDate: o.datum ?? "2026-09-01",
      dueDate: null,
      serviceFrom: o.von ?? "2026-10-01",
      serviceTo: o.bis ?? "2026-10-31",
      category: "edv",
      payment: "bank",
      note: "",
      privateShare: 0,
      vorsteuerAnteil: p.anteil === 10_000 ? null : p.anteil,
      amounts: o.amounts ?? [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  async function bankumsatz(betrag: number, datum: string) {
    const euro = (Math.abs(betrag) / 100).toFixed(2).replace(".", ",");
    const [jahr, monat, tag] = datum.split("-");
    const d = `${tag}.${monat}.${jahr!.slice(2)}`;
    const csv =
      `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"${d}";"${d}";"Gebucht";"Stadtwerke Beispiel GmbH";"Testfirma";"Abschlag";"Ausgang";"DE02100100100006820101";"-${euro}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `zahlung-${++lauf}.csv` }, null);
    const [umsatz] = await sql`select id from bank_transactions order by created_at desc limit 1`;
    return umsatz!.id as string;
  }

  async function zahlung(documentId: string, betrag: number, datum: string) {
    const umsatz = await bankumsatz(betrag, datum);
    await bank.allocate(actor, { kind: "document", transactionId: umsatz, documentId, amount: betrag });
    const [zuordnung] = await sql`select id from allocations where transaction_id = ${umsatz} and reverses_id is null`;
    return zuordnung!.id as string;
  }

  /** Zeilen der EÜR aus dem Journal ohne Nullen und die Zeilen des Abgleichs mit Unterschied */
  async function euer(year = 2026) {
    const zeilen = Object.fromEntries(Object.entries((await euerJournal.euerAusJournal(year)).summe.zeilen).filter(([, v]) => v !== 0));
    const abweichungen = abgleich.abweichungen((await abgleich.euerAbgleich(year)).zeilen);
    return { zeilen, abweichungen };
  }

  /** Bezahlt `brutto` von 119 €: Vorsteuer anteilig (kumuliert gerundet), davon der abziehbare Teil, der Rest Aufwand */
  const bezahlt = (p: Fall, brutto: number) => {
    const steuer = Math.round((brutto * 1_900) / 11_900);
    const vorsteuer = Math.round((steuer * p.anteil) / 10_000);
    return { zeilen: { "ausgabe:edv": brutto - vorsteuer, vorsteuer }, abweichungen: [] };
  };
  const nichts = { zeilen: {}, abweichungen: [] };

  const faelle: Fall[] = [
    { kontenrahmen: "SKR03", versteuerung: "ist", anteil: 10_000 },
    { kontenrahmen: "SKR04", versteuerung: "soll", anteil: 5_000 },
    { kontenrahmen: "SKR03", versteuerung: "ist", anteil: 5_000 },
    { kontenrahmen: "SKR04", versteuerung: "soll", anteil: 10_000 },
  ];

  for (const p of faelle) {
    const n = `${p.kontenrahmen}/${p.versteuerung}, ${p.anteil / 100} % Abzug`;

    it(`${n}: nie bezahlt, die Freigabe zur Ausführung wirkt nicht`, async () => {
      await firma(p);
      await beleg(p);
      expect(await euer()).toEqual(nichts);
    });

    it(`${n}: nach der Ausführung bezahlt`, async () => {
      await firma(p);
      const id = await beleg(p);
      await zahlung(id, -11_900, "2026-11-10");
      expect(await euer()).toEqual(bezahlt(p, 11_900));
    });

    it(`${n}: Vorkasse vor dem Rechnungsdatum`, async () => {
      await firma(p);
      const id = await beleg(p);
      await zahlung(id, -11_900, "2026-08-20");
      expect(await euer()).toEqual(bezahlt(p, 11_900));
    });

    it(`${n}: Teilzahlungen vor der Ausführung, der Rest bleibt offen`, async () => {
      await firma(p);
      const id = await beleg(p);
      await zahlung(id, -3_000, "2026-09-10");
      await zahlung(id, -2_000, "2026-09-20");
      expect(await euer()).toEqual(bezahlt(p, 5_000));
    });

    it(`${n}: Teilzahlung vor und Rest nach der Ausführung`, async () => {
      await firma(p);
      const id = await beleg(p);
      await zahlung(id, -5_000, "2026-09-10");
      await zahlung(id, -6_900, "2026-11-10");
      expect(await euer()).toEqual(bezahlt(p, 11_900));
    });

    it(`${n}: Zahlung mit Skonto vor der Ausführung, die EÜR zählt das Gezahlte`, async () => {
      await firma(p);
      const id = await beleg(p);
      const umsatz = await bankumsatz(-11_662, "2026-09-10");
      await bank.allocateWithRest(actor, { transactionId: umsatz, target: { kind: "document", documentId: id }, rest: "skontoErhalten" });
      expect(await euer()).toEqual(bezahlt(p, 11_662));
    });

    it(`${n}: Zahlung vor der Ausführung aufgehoben`, async () => {
      await firma(p);
      const id = await beleg(p);
      const z = await zahlung(id, -11_900, "2026-09-15");
      await bank.reverseAllocation(actor, z, "2026-09-20");
      expect(await euer()).toEqual(nichts);
    });

    it(`${n}: unbezahlt vor der Ausführung storniert`, async () => {
      await firma(p);
      const id = await beleg(p);
      await cancellation.cancelDocument(actor, id, { reason: "falscher Beleg", allocationIds: [] }, "2026-09-20");
      expect(await euer()).toEqual(nichts);
    });

    it(`${n}: bezahlt und nach der Ausführung storniert, die Zahlung wird mit aufgehoben`, async () => {
      await firma(p);
      const id = await beleg(p);
      const z = await zahlung(id, -11_900, "2026-09-15");
      await cancellation.cancelDocument(actor, id, { reason: "falscher Beleg", allocationIds: [z] }, "2026-11-10");
      expect(await euer()).toEqual(nichts);
    });

    it(`${n}: im Dezember bezahlt, Leistung im Januar: EÜR-Jahr der Zahlung`, async () => {
      await firma(p);
      const id = await beleg(p, { datum: "2026-12-01", von: "2027-01-01", bis: "2027-01-31" });
      await zahlung(id, -11_900, "2026-12-15");
      expect({ y26: await euer(2026), y27: await euer(2027) }).toEqual({ y26: bezahlt(p, 11_900), y27: nichts });
    });

    it(`${n}: Leistung im Dezember, Rechnung im November, im Januar bezahlt: EÜR-Jahr der Zahlung`, async () => {
      await firma(p);
      const id = await beleg(p, { datum: "2026-11-20", von: "2026-12-01", bis: "2026-12-31" });
      await zahlung(id, -11_900, "2027-01-10");
      expect({ y26: await euer(2026), y27: await euer(2027) }).toEqual({ y26: nichts, y27: bezahlt(p, 11_900) });
    });
  }

  /** Zwei Sätze, 151,10 € brutto: 50 % von 19,00 € und 25 % von 2,10 € (je Satz eigener Anteil) */
  const ZWEI: Betrag[] = [
    { taxRate: 1900, net: 10_000, tax: 1_900, vorsteuerAnteil: 5_000 },
    { taxRate: 700, net: 3_000, tax: 210, vorsteuerAnteil: 2_500 },
  ];

  for (const p of [faelle[0]!, faelle[1]!]) {
    const n = `${p.kontenrahmen}/${p.versteuerung}`;
    const zwei = p.anteil === 10_000 ? ZWEI.map(({ vorsteuerAnteil: _, ...b }) => b) : ZWEI;

    it(`${n}: zwei Sätze, Teilzahlung vor der Ausführung`, async () => {
      await firma(p);
      const id = await beleg(p, { amounts: zwei });
      await zahlung(id, -7_555, "2026-09-15");
      // Die Hälfte der Steuer je Satz (950 und 105), davon abziehbar 100 % bzw. 50 % und 25 % (475 und 26)
      const vorsteuer = p.anteil === 10_000 ? 1_055 : 501;
      expect(await euer()).toEqual({ zeilen: { "ausgabe:edv": 7_555 - vorsteuer, vorsteuer }, abweichungen: [] });
    });

    it(`${n}: zwei Sätze, nach der Ausführung bezahlt`, async () => {
      await firma(p);
      const id = await beleg(p, { amounts: zwei });
      await zahlung(id, -15_110, "2026-11-10");
      const vorsteuer = p.anteil === 10_000 ? 2_110 : 1_003;
      expect(await euer()).toEqual({ zeilen: { "ausgabe:edv": 15_110 - vorsteuer, vorsteuer }, abweichungen: [] });
    });
  }
});
