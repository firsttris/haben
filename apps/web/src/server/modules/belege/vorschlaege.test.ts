import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Vorschläge für Belege aus allen früheren Belegen desselben Lieferanten (#295), mit Postgres: Kategorie (auch aus
 * aufgeteilten Belegen) und Bezahlung, mit Anzahl und Zeitpunkt der letzten Buchung; Lieferant über USt-IdNr., Namen
 * oder den gewählten Kontakt. Gebucht wird nichts von selbst. Die Buchung selbst in SKR03 und SKR04, bei Ist und Soll.
 */

// Die KI wird nicht aufgerufen; die Auslesung liefert feste Werte
vi.mock("./extraction.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./extraction.ts")>();
  return {
    ...original,
    extractionAvailable: () => true,
    extractDocument: vi.fn(async () => ({
      extraction: { quelle: "test" },
      fields: {
        supplierName: "Kiosk am Markt",
        supplierUstId: "",
        invoiceNumber: "Q-1",
        documentDate: "2026-10-05",
        dueDate: null,
        currency: "EUR",
        category: "sonstiges" as const,
        amounts: [{ taxRate: 1900 as const, net: 1_000, tax: 190 }],
        warnings: [],
      },
    })),
  };
});

let fileSeq = 0;
const jpeg = () => {
  fileSeq++;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, fileSeq % 256, Math.floor(fileSeq / 256), 83]);
};

describe.skipIf(!testDatabaseUrl)("Vorschläge für Belege aus früheren Belegen (Postgres)", () => {
  let documents: typeof import("./documents.ts");
  let vorschlaege: typeof import("./vorschlaege.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
    vorschlaege = await import("./vorschlaege.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma(kontenrahmen: "SKR03" | "SKR04" = "SKR03", versteuerung: "ist" | "soll" = "ist") {
    await leeren(sql)`truncate journal_lines, journal_entries, document_splits, document_amounts, documents, cash_entries, contact_versions, contacts,
      company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, kontenrahmen, versteuerung)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', ${kontenrahmen}, ${versteuerung})`;
  }

  beforeEach(() => firma());

  type Beleg = {
    supplierName?: string;
    supplierUstId?: string;
    supplierContactId?: string | null;
    category?: "telefon" | "internet" | "buero" | "software";
    payment?: "bank" | "privat" | "kasse";
    splits?: { category: "telefon" | "internet" | "buero" | "software"; taxRate: 1900; net: number }[];
  };

  async function gebucht(beleg: Beleg = {}) {
    const { id } = await documents.uploadDocument(actor, { bytes: jpeg(), filename: `v${fileSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: beleg.supplierName ?? "Kiosk am Markt",
      supplierUstId: beleg.supplierUstId ?? "",
      supplierContactId: beleg.supplierContactId ?? null,
      invoiceNumber: `Q-${fileSeq}`,
      documentDate: "2026-10-01",
      dueDate: null,
      category: beleg.category ?? "telefon",
      payment: beleg.payment ?? "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: 1_000, tax: 190 }],
      ...(beleg.splits ? { splits: beleg.splits } : {}),
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  const kiosk = { supplierName: "Kiosk am Markt", supplierUstId: "", supplierContactId: null };

  it("Kategorie mit Anzahl und Zeitpunkt der letzten Buchung so", async () => {
    await gebucht({ category: "telefon" });
    const zuletzt = await gebucht({ category: "telefon" });
    await gebucht({ category: "buero" });
    const [doc] = await sql`select locked_at from documents where id = ${zuletzt}`;
    expect(await vorschlaege.supplierCategory(kiosk)).toEqual({
      category: "telefon",
      count: 2,
      total: 3,
      last: new Date(doc!.locked_at as string).toISOString(),
    });
  });

  it("Aufgeteilte Belege zählen mit, jede Kategorie einmal je Beleg", async () => {
    await gebucht({ category: "internet" });
    await gebucht({
      splits: [
        { category: "internet", taxRate: 1900, net: 600 },
        { category: "telefon", taxRate: 1900, net: 400 },
      ],
    });
    // Zwei Belege, beide mit Internet; der aufgeteilte zählt einmal insgesamt
    expect(await vorschlaege.supplierCategory(kiosk)).toMatchObject({ category: "internet", count: 2, total: 2 });
  });

  it("Lieferant auch über den gewählten Kontakt erkannt, wenn der Name auf dem Beleg anders lautet", async () => {
    const stammdaten = await import("../stammdaten/index.ts");
    const kontakt = await stammdaten.createContact(actor, {
      kundennummer: "",
      name: "Telekom Deutschland GmbH",
      strasse: "",
      plz: "",
      ort: "",
      land: "DE",
      email: "",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
      isCustomer: false,
      isSupplier: true,
    });
    await gebucht({ supplierName: "Telekom Deutschland GmbH", supplierContactId: kontakt.id, category: "internet" });
    await gebucht({ supplierName: "Telekom Deutschland GmbH", supplierContactId: kontakt.id, category: "internet" });
    expect(await vorschlaege.supplierCategory({ supplierName: "Telekom", supplierUstId: "", supplierContactId: kontakt.id })).toMatchObject({
      category: "internet",
      count: 2,
    });
  });

  it("Bezahlung: ab zwei Belegen mit Mehrheit, mit Zeitpunkt der letzten", async () => {
    await gebucht({ payment: "privat" });
    expect(await vorschlaege.supplierPayment(kiosk)).toBeNull();
    const zuletzt = await gebucht({ payment: "privat" });
    await gebucht({ payment: "bank" });
    const [doc] = await sql`select locked_at from documents where id = ${zuletzt}`;
    expect(await vorschlaege.supplierPayment(kiosk)).toEqual({ payment: "privat", count: 2, total: 3, last: new Date(doc!.locked_at as string).toISOString() });
    await gebucht({ payment: "bank" });
    // 2 von 4: keine Mehrheit
    expect(await vorschlaege.supplierPayment(kiosk)).toBeNull();
  });

  it("Stornierte Belege zählen nicht", async () => {
    await gebucht({ payment: "privat" });
    const falsch = await gebucht({ payment: "privat" });
    const cancellation = await import("./cancellation.ts");
    await cancellation.cancelDocument(actor, falsch, { reason: "falsch erfasst" }, "2026-10-05");
    expect(await vorschlaege.supplierPayment(kiosk)).toBeNull();
  });

  it.each([
    ["SKR03", "ist", { aufwand: "4920", vorsteuer: "1576", privat: "1890" }],
    ["SKR03", "soll", { aufwand: "4920", vorsteuer: "1576", privat: "1890" }],
    ["SKR04", "ist", { aufwand: "6805", vorsteuer: "1406", privat: "2180" }],
    ["SKR04", "soll", { aufwand: "6805", vorsteuer: "1406", privat: "2180" }],
  ] as const)(
    "%s, %s: ausgelesener Beleg übernimmt Kategorie und Bezahlung des Lieferanten, gebucht erst auf Bestätigung",
    async (kr, versteuerung, konten) => {
      await firma(kr, versteuerung);
      await gebucht({ category: "telefon", payment: "privat" });
      await gebucht({ category: "telefon", payment: "privat" });
      const { id } = await documents.uploadDocument(actor, { bytes: jpeg(), filename: "neu.jpg" });
      const neu = (await documents.getDocument(id))!.document;
      // Die KI sagt „sonstiges“; die Belege des Lieferanten gehen vor, die Bezahlung ebenso
      expect(neu).toMatchObject({ category: "telefon", payment: "privat", status: "neu" });
      expect(await sql`select count(*)::int as n from journal_entries where source_id = ${id}`).toEqual([{ n: 0 }]);
      await documents.bookDocument(actor, id);
      const zeilen = await sql`select l.account, l.debit, l.credit from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_id = ${id} order by l.account`;
      expect(zeilen.map((z) => [z.account, z.debit, z.credit])).toEqual(
        [
          [konten.aufwand, 1_000, 0],
          [konten.vorsteuer, 190, 0],
          [konten.privat, 0, 1_190],
        ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      );
    },
  );

  it("Eine einzelne private Zahlung stellt die Vorgabe Geschäftskonto beim Auslesen nicht um", async () => {
    await gebucht({ payment: "privat" });
    const { id } = await documents.uploadDocument(actor, { bytes: jpeg(), filename: "neu.jpg" });
    expect((await documents.getDocument(id))!.document.payment).toBe("bank");
  });
});
