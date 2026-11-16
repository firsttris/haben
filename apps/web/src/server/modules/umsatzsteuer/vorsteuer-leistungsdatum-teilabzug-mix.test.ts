import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Leistungsdatum (#693) mit Teilabzug (#926) in Kombination: Aufteilung, Privatanteil, Verrechnung. Kz 66 aus Journal
 * und Nebenbüchern je Monat, Zwischenkonto am Ende 0, EÜR ohne Abweichung im Abgleich.
 */
describe.skipIf(!testDatabaseUrl)("Vorsteuer nach Leistungsdatum mit Teilabzug, Kombinationen (#693, #926)", () => {
  let figures: typeof import("./vat-figures.ts");
  let bank: typeof import("../bank/index.ts");
  let verrechnung: typeof import("../bank/verrechnung.ts");
  let documents: typeof import("../belege/documents.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let euerJournal: typeof import("../auswertungen/euer-journal.ts");
  let sql: postgres.Sql;
  const actor = "leistungsdatum-teilabzug-mix";
  let lauf = 0;
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 93]);

  beforeAll(async () => {
    sql = await setupTestDb();
    figures = await import("./vat-figures.ts");
    bank = await import("../bank/index.ts");
    verrechnung = await import("../bank/verrechnung.ts");
    documents = await import("../belege/documents.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
    euerJournal = await import("../auswertungen/euer-journal.ts");
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
    leistung?: boolean;
    netto?: number;
    vorsteuerAnteil?: number | null;
    privateShare?: number;
    splits?: { category: "software" | "buero"; taxRate: 1900; net: number }[];
  };

  async function beleg(o: Angaben = {}) {
    lauf++;
    const netto = o.netto ?? 10_000;
    const { id } = await documents.uploadDocument(actor, {
      bytes: new Uint8Array([...JPEG, lauf % 251, Math.floor(lauf / 251)]),
      filename: `mix-${lauf}.jpg`,
    });
    await documents.updateDocument(actor, id, {
      supplierName: "Stadtwerke Beispiel GmbH",
      supplierUstId: "",
      invoiceNumber: `M-${lauf}`,
      documentDate: o.datum ?? "2026-09-01",
      dueDate: null,
      ...(o.leistung === false ? {} : { serviceFrom: "2026-10-01", serviceTo: "2026-10-31" }),
      category: o.splits ? "sonstiges" : "edv",
      payment: "bank",
      note: "",
      privateShare: o.privateShare ?? 0,
      vorsteuerAnteil: o.vorsteuerAnteil === undefined ? 5_000 : o.vorsteuerAnteil,
      amounts: [{ taxRate: 1900, net: netto, tax: Math.round((netto * 1_900) / 10_000) }],
      ...(o.splits ? { splits: o.splits } : {}),
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  async function zahlung(documentId: string, betrag: number, datum: string) {
    const euro = (Math.abs(betrag) / 100).toFixed(2).replace(".", ",");
    const [jahr, monat, tag] = datum.split("-");
    const d = `${tag}.${monat}.${jahr!.slice(2)}`;
    const csv =
      `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"${d}";"${d}";"Gebucht";"Stadtwerke Beispiel GmbH";"Testfirma";"Abschlag";"Ausgang";"DE02100100100006820101";"-${euro}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `zahlung-${++lauf}.csv` }, null);
    const [umsatz] = await sql`select id from bank_transactions order by created_at desc limit 1`;
    await bank.allocate(actor, { kind: "document", transactionId: umsatz!.id as string, documentId, amount: betrag });
  }

  const MONATE = [8, 9, 10, 11, 12];

  /** Kz 66 je Monat aus Journal und Nebenbüchern, Zwischenkonto, EÜR-Vorsteuer, Summe der Ausgaben und Abweichungen */
  async function stand() {
    const journal: number[] = [];
    const nebenbuecher: (number | undefined)[] = [];
    const vat: unknown[] = [];
    for (const month of MONATE) {
      const f = await figures.computeVatFigures({ year: 2026, month });
      journal.push(f.kz66);
      nebenbuecher.push(f.nebenbuecher?.kz66);
      vat.push(...abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2026, month })).zeilen));
    }
    const [z] = await sql`select coalesce(sum(debit - credit), 0)::int as saldo from journal_lines where account in ('1548', '1434')`;
    const zeilen = (await euerJournal.euerAusJournal(2026)).summe.zeilen as Record<string, number>;
    const ausgaben = Object.entries(zeilen)
      .filter(([k]) => k.startsWith("ausgabe:"))
      .reduce((s, [, v]) => s + v, 0);
    const euer = abgleich.abweichungen((await abgleich.euerAbgleich(2026)).zeilen);
    return { journal, nebenbuecher, zw: z!.saldo as number, vorsteuer: zeilen.vorsteuer ?? 0, ausgaben, vat, euer };
  }
  const erwartet = (kz66: number[], vorsteuer: number, ausgaben: number) => ({
    journal: kz66,
    nebenbuecher: kz66,
    zw: 0,
    vorsteuer,
    ausgaben,
    vat: [],
    euer: [],
  });

  const SPLITS = [
    { category: "software" as const, taxRate: 1900 as const, net: 6_000 },
    { category: "buero" as const, taxRate: 1900 as const, net: 4_000 },
  ];

  for (const p of [
    { kontenrahmen: "SKR03" as const, versteuerung: "ist" as const },
    { kontenrahmen: "SKR04" as const, versteuerung: "soll" as const },
  ]) {
    const n = `${p.kontenrahmen}/${p.versteuerung}`;

    it(`${n} Aufteilung auf zwei Kategorien, nie bezahlt`, async () => {
      await firma(p);
      await beleg({ splits: SPLITS });
      expect(await stand()).toEqual(erwartet([0, 0, 950, 0, 0], 0, 0));
    });

    it(`${n} Aufteilung, halb vor der Ausführung bezahlt`, async () => {
      await firma(p);
      const id = await beleg({ splits: SPLITS });
      await zahlung(id, -5_950, "2026-09-10");
      expect(await stand()).toEqual(erwartet([0, 475, 475, 0, 0], 475, 5_475));
    });

    it(`${n} Aufteilung, nach der Ausführung bezahlt`, async () => {
      await firma(p);
      const id = await beleg({ splits: SPLITS });
      await zahlung(id, -11_900, "2026-11-10");
      expect(await stand()).toEqual(erwartet([0, 0, 950, 0, 0], 950, 10_950));
    });

    // Privatanteil 20 %: betriebliche Steuer 1.520, davon 50 % = 760 abziehbar
    it(`${n} Privatanteil und Teilabzug, vor der Ausführung bezahlt`, async () => {
      await firma(p);
      const id = await beleg({ privateShare: 20 });
      await zahlung(id, -11_900, "2026-09-10");
      expect(await stand()).toEqual(erwartet([0, 760, 0, 0, 0], 760, 9_520 - 760));
    });

    it(`${n} Privatanteil und Teilabzug, nach der Ausführung bezahlt`, async () => {
      await firma(p);
      const id = await beleg({ privateShare: 20 });
      await zahlung(id, -11_900, "2026-11-10");
      expect(await stand()).toEqual(erwartet([0, 0, 760, 0, 0], 760, 9_520 - 760));
    });

    // Gutschrift im August (voller Abzug, mindert im August), Verrechnung im September zahlt die Hälfte des Belegs
    it(`${n} vor der Ausführung mit einer Gutschrift verrechnet`, async () => {
      await firma(p);
      const gs = await beleg({ datum: "2026-08-20", leistung: false, netto: -5_000, vorsteuerAnteil: null });
      const id = await beleg();
      await verrechnung.settleDocuments(actor, { documentId: id, counterDocumentId: gs, amount: 5_950, date: "2026-09-10", note: "Aufrechnung" });
      // Verrechnet 5.950 von 11.900: Steuer 950, davon 475 abziehbar; Gutschrift -950
      expect(await stand()).toEqual(erwartet([-950, 475, 475, 0, 0], 475 - 950, 5_475 - 5_000));
    });
  }
});
