import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/*
 * Unsere Lieferantennummer beim Kunden (#711): steht beim Festschreiben als Stand im Käufer der Rechnung und von dort
 * in PDF und XML (Verkäuferkennung BT-29, EN 16931-1). Spätere Änderungen am Kontakt ändern die Rechnung nicht, der
 * Storno trägt den Stand der Rechnung. Keine Buchung ändert sich, SKR03/SKR04 und Ist/Soll spielen keine Rolle. Alle
 * Daten sind erfunden.
 */

describe.skipIf(!testDatabaseUrl)("Unsere Lieferantennummer an der Rechnung (Postgres, #711)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  const actor = "test-user";
  const kunde = {
    kundennummer: "",
    name: "Wohnbau Nord eG",
    strasse: "Hafenweg 3",
    plz: "20457",
    ort: "Hamburg",
    land: "DE",
    email: "rechnung@wohnbau-nord.example",
    ustId: "",
    iban: "",
    leitwegId: "",
    unsereLieferantennummer: "70815",
    defaultFormat: null,
  };

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./index.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
  });

  const draftInput = (contactId: string, format: "zugferd" | "xrechnung-ubl") => ({
    contactId,
    issueDate: "2026-09-05",
    serviceFrom: null,
    serviceTo: null,
    paymentTermDays: 14,
    format,
    note: "",
    lines: [{ description: "Hausmeisterdienst August", quantity: 1000, unit: "Psch." as const, unitPrice: 100_000, taxRate: 1900 as const }],
  });

  it("steht nach dem Festschreiben im Käufer und als BT-29 beim Verkäufer, spätere Änderungen am Kontakt berühren sie nicht", async () => {
    const contact = await contacts.createContact(actor, kunde);
    const invoice = await invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draftInput(contact.id, "zugferd"))).id, kleinunternehmerStand);
    expect(invoice.buyer?.unsereLieferantennummer).toBe("70815");
    const seller = invoice.xml?.match(/<ram:SellerTradeParty>([\s\S]*?)<ram:Name>/)?.[1] ?? "";
    expect(seller).toContain("<ram:ID>70815</ram:ID>");

    await contacts.updateContact(actor, contact.id, { ...kunde, unsereLieferantennummer: "99999" });
    expect((await invoices.getInvoice(invoice.id))?.invoice.buyer?.unsereLieferantennummer).toBe("70815");
    const storno = await invoices.cancelInvoice(actor, invoice.id, "2026-09-20");
    expect(storno.buyer?.unsereLieferantennummer).toBe("70815");
  });

  it("ohne Nummer am Kontakt bleibt der Käufer wie bisher (XRechnung UBL)", async () => {
    const contact = await contacts.createContact(actor, { ...kunde, unsereLieferantennummer: "" });
    const invoice = await invoices.finalizeInvoice(
      actor,
      (await invoices.createDraft(actor, draftInput(contact.id, "xrechnung-ubl"))).id,
      kleinunternehmerStand,
    );
    expect(invoice.buyer).not.toHaveProperty("unsereLieferantennummer");
    // Mit USt-IdNr. braucht der Verkäufer keine Verkäuferkennung (BR-CO-26)
    const seller = invoice.xml?.match(/<cac:AccountingSupplierParty>([\s\S]*?)<\/cac:AccountingSupplierParty>/)?.[1] ?? "";
    expect(seller).not.toContain("PartyIdentification");
  });
});
