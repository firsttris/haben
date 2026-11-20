import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

// Hinweis auf eine mögliche Dublette (#1314, #1378): derselbe Lieferant, dieselbe Rechnungsnummer
describe.skipIf(!testDatabaseUrl)("Belege mit gleicher Rechnungsnummer desselben Lieferanten (Postgres, #1314)", () => {
  let documents: typeof import("./documents.ts");
  let cancellation: typeof import("./cancellation.ts");
  let gleich: typeof import("./gleiche-nummer.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  let fileSeq = 0;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
    cancellation = await import("./cancellation.ts");
    gleich = await import("./gleiche-nummer.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(
      sql,
    )`truncate document_cancellations, journal_lines, journal_entries, document_amounts, documents, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', 'ist', 'SKR03')`;
  });

  type Angaben = { lieferant?: string; ustId?: string; nummer?: string; contactId?: string | null; buchen?: boolean };

  /** Ein Beleg über 119,00 € vom 15.09.2026, auf Wunsch gebucht */
  async function beleg({ lieferant = "Bürobedarf Muster GmbH", ustId = "", nummer = "RE-4711", contactId = null, buchen = false }: Angaben = {}) {
    fileSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, fileSeq % 256, Math.floor(fileSeq / 256), 41]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${fileSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: lieferant,
      supplierUstId: ustId,
      invoiceNumber: nummer,
      documentDate: "2026-09-15",
      dueDate: null,
      category: "buero",
      payment: "bank",
      note: "",
      privateShare: 0,
      reverseCharge: null,
      asset: null,
      amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
    });
    if (contactId) await sql`update documents set supplier_contact_id = ${contactId} where id = ${id}`;
    if (buchen) await documents.bookDocument(actor, id);
    const [row] = await sql`select id, invoice_number, supplier_contact_id, supplier_ust_id, supplier_name from documents where id = ${id}`;
    return {
      id,
      invoiceNumber: row!.invoice_number as string,
      supplierContactId: row!.supplier_contact_id as string | null,
      supplierUstId: row!.supplier_ust_id as string,
      supplierName: row!.supplier_name as string,
    };
  }

  const ids = async (b: Awaited<ReturnType<typeof beleg>>) => (await gleich.belegeMitGleicherNummer(b)).map((t) => t.id);

  it("findet den gebuchten Beleg desselben Lieferanten mit Datum, Betrag und Stand; auch ohne Groß-/Kleinschreibung und Leerzeichen", async () => {
    const alt = await beleg({ buchen: true });
    const neu = await beleg({ lieferant: "bürobedarf  muster gmbh", nummer: "re - 4711" });
    expect(await gleich.belegeMitGleicherNummer(neu)).toEqual([
      { id: alt.id, invoiceNumber: "RE-4711", supplierName: "Bürobedarf Muster GmbH", documentDate: "2026-09-15", gross: 11_900, gebucht: true },
    ]);
    // In beide Richtungen: Der gebuchte zeigt den neuen, noch nicht gebuchten
    expect(await gleich.belegeMitGleicherNummer(alt)).toMatchObject([{ id: neu.id, gebucht: false }]);
  }, 30_000);

  it("erkennt denselben Lieferanten über den Kontakt oder die USt-IdNr., auch bei anderem Namen", async () => {
    const { id: kontakt } = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Bürobedarf Muster GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const perKontakt = await beleg({ contactId: kontakt, nummer: "A-1" });
    expect(await ids(await beleg({ lieferant: "Muster Bürobedarf", contactId: kontakt, nummer: "A-1" }))).toEqual([perKontakt.id]);
    const perUstId = await beleg({ lieferant: "Muster GmbH", ustId: "DE123456789", nummer: "B-1" });
    expect(await ids(await beleg({ lieferant: "Muster Bürobedarf GmbH & Co.", ustId: "de 123456789", nummer: "B-1" }))).toEqual([perUstId.id]);
  }, 30_000);

  it("schweigt bei anderem Lieferanten, anderer Nummer, leerer Nummer und bei einem stornierten Beleg", async () => {
    await beleg({ nummer: "C-1" });
    expect(await ids(await beleg({ lieferant: "Anderer Lieferant AG", nummer: "C-1" }))).toEqual([]);
    expect(await ids(await beleg({ nummer: "C-2" }))).toEqual([]);
    await beleg({ nummer: "" });
    expect(await ids(await beleg({ nummer: "" }))).toEqual([]);

    const storniert = await beleg({ nummer: "D-1", buchen: true });
    await cancellation.cancelDocument(actor, storniert.id, { reason: "Doppelt erfasst" }, "2026-09-20");
    expect(await ids(await beleg({ nummer: "D-1" }))).toEqual([]);
  }, 30_000);

  it("sperrt nichts: Ein Beleg mit gleicher Nummer lässt sich buchen", async () => {
    await beleg({ nummer: "E-1", buchen: true });
    const zweiter = await beleg({ nummer: "E-1" });
    await documents.bookDocument(actor, zweiter.id);
    expect((await sql`select status from documents where id = ${zweiter.id}`)[0]?.status).toBe("gebucht");
  }, 30_000);
});
