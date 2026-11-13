import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Gutschrift „erstattet bereits Bezahltes“ mit Privatanteil (#786): Beim Buchen steht nur der geschäftliche Teil der
 * Vorsteuer auf dem Zwischenkonto (SKR03 1548, SKR04 1434), der private Anteil geht auf die Privatentnahmen. Der
 * Ausgleich muss deshalb auch nur diesen Anteil auf die Vorsteuer umbuchen — sonst steht am Ende der private Teil als
 * Soll-Saldo auf dem Zwischenkonto und die Vorsteuer ist um ihn zu hoch. Den Privatanteil setzt Haben aus den Vorgaben
 * der Firmendaten je Kategorie (etwa Telefon 20 %), eine Gutschrift aus der Jahresabrechnung bekommt ihn also von selbst.
 */

type Profil = { kr: "SKR03" | "SKR04"; versteuerung: "ist" | "soll" };

const KONTEN = {
  SKR03: { zwischen: "1548", vorsteuer: "1576", verbindlichkeiten: "1600", bank: "1200", privat: "1800", aufwand: "4920" },
  SKR04: { zwischen: "1434", vorsteuer: "1406", verbindlichkeiten: "3300", bank: "1800", privat: "2100", aufwand: "6805" },
} as const;

describe.skipIf(!testDatabaseUrl)("Gutschrift „erstattet bereits Bezahltes“ mit Privatanteil (#786)", () => {
  let documents: typeof import("../belege/documents.ts");
  let bank: typeof import("./index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let sql: postgres.Sql;
  const actor = "privatanteil";
  let lauf = 0;
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 77]);

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("../belege/documents.ts");
    bank = await import("./index.ts");
    vat = await import("../umsatzsteuer/index.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma(p: Profil) {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, year_closings, write_offs, allocations,
      cash_entries, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, document_amounts,
      document_splits, documents, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, rechtsform, kleinunternehmer, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${p.versteuerung}, ${p.kr}, 'einzelunternehmen', false, 14)`;
  }

  async function beleg(privateShare: number) {
    lauf++;
    const bytes = new Uint8Array([...JPEG, lauf % 251]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${lauf}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Telefonica Germany GmbH",
      supplierUstId: "",
      invoiceNumber: `G-${lauf}`,
      documentDate: "2026-02-10",
      dueDate: null,
      category: "telefon",
      payment: "bank",
      note: "",
      privateShare,
      erstattetBezahltes: true,
      amounts: [{ taxRate: 1900, net: -10_000, tax: -1_900 }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  async function bankumsatz(betrag: number, datum: string) {
    const euro = (Math.abs(betrag) / 100).toFixed(2).replace(".", ",");
    const [jahr, monat, tag] = datum.split("-");
    const csv =
      `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"${tag}.${monat}.${jahr!.slice(2)}";"${tag}.${monat}.${jahr!.slice(2)}";"Gebucht";"Telefonica Germany GmbH";"Testfirma";"Erstattung";"Eingang";"DE02100100100006820101";"${euro}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `zahlung-${++lauf}.csv` }, null);
    const [umsatz] = await sql`select id from bank_transactions order by created_at desc limit 1`;
    return umsatz!.id as string;
  }

  async function zahlung(documentId: string, betrag: number, datum: string) {
    const umsatz = await bankumsatz(betrag, datum);
    await bank.allocate(actor, { kind: "document", transactionId: umsatz, documentId, amount: betrag });
  }

  async function salden() {
    return Object.fromEntries(
      (await sql`select account, sum(debit - credit)::int as saldo from journal_lines group by account having sum(debit - credit) <> 0 order by 1`).map((r) => [
        r.account,
        r.saldo,
      ]),
    ) as Record<string, number>;
  }

  for (const p of [
    { kr: "SKR03", versteuerung: "soll" },
    { kr: "SKR04", versteuerung: "ist" },
  ] as const) {
    it(`${p.kr}, ${p.versteuerung}: der Ausgleich bucht nur den geschäftlichen Anteil um`, async () => {
      await firma(p);
      const k = KONTEN[p.kr];
      const id = await beleg(50);

      // Gebucht: halber Aufwand, halbe Vorsteuer geparkt, halber Betrag auf die Privatentnahmen, Verbindlichkeit ganz
      expect(await salden()).toEqual({ [k.aufwand]: -5_000, [k.privat]: -5_950, [k.zwischen]: -950, [k.verbindlichkeiten]: 11_900 });

      await zahlung(id, 11_900, "2026-02-20");

      // Erstattet: das Zwischenkonto ist leer, die Vorsteuer nur um den geschäftlichen Teil gemindert
      expect(await salden()).toEqual({ [k.aufwand]: -5_000, [k.privat]: -5_950, [k.bank]: 11_900, [k.vorsteuer]: -950 });
      expect(await salden()).not.toHaveProperty(k.zwischen);
      expect((await vat.computeVatFigures({ year: 2026, month: 2 })).kz66).toBe(-950);
    }, 30_000);
  }

  it("zwei Teilerstattungen schreiben zusammen genau den geschäftlichen Anteil fort", async () => {
    const p = { kr: "SKR03", versteuerung: "soll" } as const;
    await firma(p);
    const k = KONTEN.SKR03;
    const id = await beleg(50);

    // Erste Hälfte: 4,75 € vom Zwischenkonto auf die Vorsteuer, 4,75 € bleiben geparkt
    await zahlung(id, 5_950, "2026-02-20");
    expect(await salden()).toMatchObject({ [k.zwischen]: -475, [k.vorsteuer]: -475 });

    // Zweite Hälfte: der Rest, kein Cent bleibt auf dem Konto
    await zahlung(id, 5_950, "2026-02-21");
    expect(await salden()).toEqual({ [k.aufwand]: -5_000, [k.privat]: -5_950, [k.bank]: 11_900, [k.vorsteuer]: -950 });
    expect((await vat.computeVatFigures({ year: 2026, month: 2 })).kz66).toBe(-950);
  }, 30_000);
});
