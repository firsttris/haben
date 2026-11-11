import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Ein Kontakt lässt sich nur dort zuordnen, wo seine Rolle passt: Kunden bei Rechnung, Angebot, wiederkehrender Rechnung
 * und Textbaustein, Lieferanten bei Beleg und Dauerbeleg. Geprüft wird auf dem Server, wenn die Zuordnung neu ist oder
 * sich ändert; ein bestehender Verweis auf einen Kontakt, der die Rolle inzwischen verloren hat, bleibt beim Speichern
 * anderer Felder unberührt (ob das so bleiben soll, ist offen).
 */

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3]);
const vertrag = { bytes: new TextEncoder().encode("%PDF-1.4\n% Mietvertrag\n%%EOF\n"), filename: "mietvertrag.pdf" };

type Rolle = "kunde" | "lieferant" | "beides";

interface Ziel {
  label: string;
  /** Rolle, die dort nicht passt */
  falsch: Exclude<Rolle, "beides">;
  meldung: RegExp;
  /** Legt an (ohne id) oder ändert (mit id); gibt die id zurück */
  speichern: (contactId: string, id?: string) => Promise<string>;
}

describe.skipIf(!testDatabaseUrl)("Rollen bei der Zuordnung von Kontakten (Postgres)", () => {
  let sql: postgres.Sql;
  let contacts: typeof import("./contacts.ts");
  let blocks: typeof import("./text-blocks.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let quotes: typeof import("../rechnungen/quotes.ts");
  let recurring: typeof import("../rechnungen/recurring.ts");
  let documents: typeof import("../belege/documents.ts");
  let dauer: typeof import("../belege/dauerbelege.ts");
  const actor = "test-user";
  let zaehler = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    contacts = await import("./contacts.ts");
    blocks = await import("./text-blocks.ts");
    invoices = await import("../rechnungen/invoices.ts");
    quotes = await import("../rechnungen/quotes.ts");
    recurring = await import("../rechnungen/recurring.ts");
    documents = await import("../belege/documents.ts");
    dauer = await import("../belege/dauerbelege.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate journal_lines, journal_entries, document_amounts, documents, recurring_documents, invoice_lines, invoices,
      invoice_number_counters, quote_lines, quotes, recurring_invoices, text_blocks, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, bic, bank, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 123456',
              '198/113/10010', 'DE123456789', 'BY', 'DE89370400440532013000', 'COBADEFFXXX', 'Commerzbank', 'SKR03')`;
  });

  async function kontakt(rolle: Rolle) {
    zaehler++;
    return contacts.createContact(actor, {
      kundennummer: "",
      name: `${rolle === "lieferant" ? "Lieferant" : rolle === "kunde" ? "Kunde" : "Beides"} ${zaehler} GmbH`,
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
      isCustomer: rolle !== "lieferant",
      isSupplier: rolle !== "kunde",
    });
  }

  /** Der Kontakt verliert eine Rolle, wie bei einem Altbestand oder nach dem Ändern des Kontakts */
  async function rolleEntziehen(id: string, nun: Exclude<Rolle, "beides">) {
    await sql`update contacts set is_customer = ${nun === "kunde"}, is_supplier = ${nun === "lieferant"} where id = ${id}`;
  }

  const zeile = { description: "Wartung", quantity: 1000, unit: "Psch." as const, unitPrice: 50_000, taxRate: 1900 as const };

  const ziele: Ziel[] = [
    {
      label: "Rechnung",
      falsch: "lieferant",
      meldung: /ist kein Kunde/,
      speichern: async (contactId, id) => {
        const input = {
          contactId,
          issueDate: "2026-10-01",
          serviceFrom: null,
          serviceTo: null,
          paymentTermDays: 14,
          format: "zugferd" as const,
          note: "",
          lines: [zeile],
        };
        return id ? (await invoices.updateDraft(actor, id, input)).id : (await invoices.createDraft(actor, input)).id;
      },
    },
    {
      label: "Angebot",
      falsch: "lieferant",
      meldung: /ist kein Kunde/,
      speichern: async (contactId, id) => {
        const input = { contactId, issueDate: "2026-10-01", validUntil: "2026-10-31", serviceFrom: null, serviceTo: null, note: "", lines: [zeile] };
        return id ? (await quotes.updateQuoteDraft(actor, id, input)).id : (await quotes.createQuoteDraft(actor, input)).id;
      },
    },
    {
      label: "Wiederkehrende Rechnung",
      falsch: "lieferant",
      meldung: /ist kein Kunde/,
      speichern: async (contactId, id) => {
        const input = {
          name: "Wartung",
          active: true,
          contactId,
          format: "zugferd" as const,
          paymentTermDays: 14,
          note: "",
          taxTreatment: "regulaer" as const,
          exemptionReason: "",
          lines: [zeile],
          intervalMonths: 1 as const,
          nextDate: "2026-11-30",
          endDate: null,
          servicePeriod: "laufend" as const,
          mode: "entwurf" as const,
        };
        return id ? (await recurring.updateRecurring(actor, id, input)).id : (await recurring.createRecurring(actor, input)).id;
      },
    },
    {
      label: "Textbaustein",
      falsch: "lieferant",
      meldung: /ist kein Kunde/,
      speichern: async (contactId, id) => {
        const input = { name: "Rahmenvertrag", kind: "kopf" as const, text: "Gemäß Rahmenvertrag", contactId };
        return id ? (await blocks.updateTextBlock(actor, id, input)).id : (await blocks.createTextBlock(actor, input)).id;
      },
    },
    {
      label: "Beleg",
      falsch: "kunde",
      meldung: /ist kein Lieferant/,
      speichern: async (contactId, id) => {
        const belegId = id ?? (await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, 40 + zaehler]), filename: "beleg.jpg" })).id;
        await documents.updateDocument(actor, belegId, {
          supplierName: "Hetzner Online GmbH",
          supplierUstId: "",
          supplierContactId: contactId,
          invoiceNumber: "R1",
          documentDate: "2026-09-15",
          dueDate: null,
          category: "software",
          payment: "bank",
          note: id ? "geändert" : "",
          amounts: [{ taxRate: 1900, net: 1_000, tax: 190 }],
        });
        return belegId;
      },
    },
    {
      label: "Dauerbeleg",
      falsch: "kunde",
      meldung: /ist kein Lieferant/,
      speichern: async (contactId, id) => {
        const input = {
          name: "Büromiete",
          supplierName: "Hafen Immobilien GmbH",
          supplierUstId: "DE811907980",
          supplierContactId: contactId,
          reference: "MV-1",
          category: "sonstiges" as const,
          payment: "bank" as const,
          amounts: [{ taxRate: 1900 as const, net: 100_000, tax: 19_000 }],
          taxShown: true,
          note: id ? "geändert" : "",
          intervalMonths: 1 as const,
          nextDate: "2026-11-30",
          endDate: null,
          dueDays: 3,
        };
        return id ? (await dauer.updateDauerbeleg(actor, id, input, null)).id : (await dauer.createDauerbeleg(actor, input, vertrag)).id;
      },
    },
  ];

  for (const ziel of ziele) {
    describe(ziel.label, () => {
      it("weist einen Kontakt ohne die Rolle beim Anlegen ab", async () => {
        const falsch = await kontakt(ziel.falsch);
        await expect(ziel.speichern(falsch.id)).rejects.toThrow(ziel.meldung);
        await expect(ziel.speichern(falsch.id)).rejects.toThrow(falsch.name);
      });

      it("nimmt einen Kontakt mit der Rolle an, auch wenn er beides ist", async () => {
        const passend = await kontakt(ziel.falsch === "kunde" ? "lieferant" : "kunde");
        const beides = await kontakt("beides");
        await expect(ziel.speichern(passend.id)).resolves.toBeTruthy();
        await expect(ziel.speichern(beides.id)).resolves.toBeTruthy();
      });

      it("weist beim Ändern einen Kontakt ohne die Rolle ab und lässt den bisherigen stehen", async () => {
        const passend = await kontakt(ziel.falsch === "kunde" ? "lieferant" : "kunde");
        const falsch = await kontakt(ziel.falsch);
        const id = await ziel.speichern(passend.id);
        await expect(ziel.speichern(falsch.id, id)).rejects.toThrow(ziel.meldung);
        await expect(ziel.speichern(passend.id, id)).resolves.toBe(id);
      });

      it("ein bestehender Verweis auf einen Kontakt, der die Rolle verloren hat, bleibt beim Speichern unberührt", async () => {
        const passend = await kontakt("beides");
        const id = await ziel.speichern(passend.id);
        await rolleEntziehen(passend.id, ziel.falsch);
        await expect(ziel.speichern(passend.id, id)).resolves.toBe(id);
      });
    });
  }
});
