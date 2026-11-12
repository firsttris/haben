import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * „Derselbe Lieferant“ in der Gegenbeleg-Liste und in settleDocuments (#274): Beide müssen denselben Begriff
 * verwenden, sonst bietet die Liste ein Paar an, das der Server danach ablehnt — oder sie verschweigt ein Paar,
 * das er annähme. Postgres lower() und JavaScript toLowerCase() falten Unicode unterschiedlich: lower('İstanbul')
 * ergibt in UTF-8 'istanbul', toLowerCase() dagegen 'i' plus kombinierenden Punkt (U+0307). In Datenbanken ohne
 * UTF-8-Locale (lc_ctype = 'C') faltet lower() zudem nur ASCII, also 'MÜLLER' nicht zu 'müller'.
 */
describe.skipIf(!testDatabaseUrl)("Gegenbeleg-Liste und Verrechnung vergleichen den Lieferanten gleich (Postgres)", () => {
  let documents: typeof import("../belege/documents.ts");
  let verrechnung: typeof import("./verrechnung.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9]);

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("../belege/documents.ts");
    verrechnung = await import("./verrechnung.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma() {
    await leeren(sql)`truncate document_cancellations, document_settlements, year_closings, write_offs, allocations,
      bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, documents, document_amounts,
      document_splits, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03', 14)`;
  }

  /** Gebuchter Beleg über die Bank; net negativ ergibt eine Gutschrift des Lieferanten */
  async function beleg(
    datum: string,
    netto: number,
    steuer: number,
    lieferant: string,
    { payment = "bank", buchen = true }: { payment?: "bank" | "privat"; buchen?: boolean } = {},
  ) {
    // Eigene Bytes je Beleg: gleiche Datei erkennt Haben als Dublette und gibt den ersten Beleg zurueck
    const bytes = new Uint8Array([...JPEG, datum.charCodeAt(9), Math.abs(netto) % 251]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `${datum}-${netto}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: lieferant,
      supplierUstId: "",
      invoiceNumber: `R-${datum}-${netto}`,
      documentDate: datum,
      dueDate: null,
      category: "telefon",
      payment,
      note: "",
      amounts: [{ taxRate: 1900, net: netto, tax: steuer }],
    });
    if (buchen) await documents.bookDocument(actor, id);
    return id;
  }

  it("bietet die Gutschrift an, wenn beide Belege „İstanbul Handels GmbH“ heißen", async () => {
    await firma();
    // Beide Namen sind zeichengleich; nur die Faltung von İ (U+0130) unterscheidet Postgres und JavaScript
    const rechnung = await beleg("2026-03-10", 10_000, 1_900, "İstanbul Handels GmbH");
    const gutschrift = await beleg("2026-03-12", -3_000, -570, "İstanbul Handels GmbH");

    expect(await verrechnung.settlementCandidates(rechnung)).toEqual([expect.objectContaining({ id: gutschrift, rest: -3_570 })]);
  }, 30_000);

  it("bietet keinen Gegenbeleg an, den settleDocuments als anderen Lieferanten ablehnt", async () => {
    await firma();
    // Nur die Schreibweise des İ unterscheidet die beiden Belege
    const rechnung = await beleg("2026-03-10", 10_000, 1_900, "Istanbul Handels GmbH");
    const gutschrift = await beleg("2026-03-12", -3_000, -570, "İstanbul Handels GmbH");

    // Der Server lehnt das Paar ab; die Liste darf es deshalb auch nicht anbieten
    await expect(
      verrechnung.settleDocuments(actor, {
        documentId: rechnung,
        counterDocumentId: gutschrift,
        amount: 1_000,
        date: "2026-03-12",
        note: "Gutschrift",
      }),
    ).rejects.toThrow(/verschiedenen Lieferanten/);
    expect((await verrechnung.settlementCandidates(rechnung)).map((k) => k.id)).not.toContain(gutschrift);
  }, 30_000);

  it("bietet keinen Gegenbeleg an, wenn der geöffnete Beleg nicht gebucht ist oder nicht über die Bank läuft", async () => {
    await firma();
    const gutschrift = await beleg("2026-03-12", -3_000, -570, "Telekom Deutschland GmbH");
    // Rechnung noch im Entwurf und Rechnung privat bezahlt: settleDocuments lehnt beide ab
    const entwurf = await beleg("2026-03-10", 10_000, 1_900, "Telekom Deutschland GmbH", { buchen: false });
    const privat = await beleg("2026-03-11", 5_000, 950, "Telekom Deutschland GmbH", { payment: "privat" });

    for (const rechnung of [entwurf, privat]) {
      await expect(
        verrechnung.settleDocuments(actor, { documentId: rechnung, counterDocumentId: gutschrift, amount: 1_000, date: "2026-03-12", note: "Gutschrift" }),
      ).rejects.toThrow(/nicht gebucht|nicht über die Bank/);
      // Die Oberfläche zeigt den Abschnitt „Verrechnung“, sobald die Liste etwas enthält; sie darf deshalb nichts anbieten
      expect(await verrechnung.settlementCandidates(rechnung)).toEqual([]);
    }
  }, 30_000);
});
