import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Rechnung kopieren: Aus einer festgeschriebenen Rechnung entsteht ein neuer Entwurf für die nächste ähnliche Rechnung. Die
 * Kopie ist ein Entwurf und bucht nichts; SKR03 und SKR04, Ist und Soll spielen erst beim Festschreiben eine Rolle und laufen
 * dort wie bei jeder anderen Rechnung. Das Original bleibt mit Siegel unverändert. Alle Daten sind erfunden.
 */

describe.skipIf(!testDatabaseUrl)("Rechnung kopieren (Postgres)", () => {
  let sql: postgres.Sql;
  let invoices: typeof import("./invoices.ts");
  let kopieren: typeof import("./rechnung-kopieren.ts");
  let persons: typeof import("../stammdaten/contact-persons.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let integrity: typeof import("../auswertungen/integrity.ts");
  const actor = "test-user";
  const heute = "2026-11-18";
  let contactId: string;

  beforeAll(async () => {
    sql = await setupTestDb();
    invoices = await import("./invoices.ts");
    kopieren = await import("./rechnung-kopieren.ts");
    persons = await import("../stammdaten/contact-persons.ts");
    contacts = await import("../stammdaten/contacts.ts");
    integrity = await import("../auswertungen/integrity.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(
      sql,
    )`truncate invoice_lines, invoices, invoice_number_counters, contact_persons, contact_versions, contacts, journal_lines, journal_entries, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', 'ist', 'SKR03')`;
    contactId = (
      await contacts.createContact(actor, {
        kundennummer: "",
        name: "Nordwerk Software GmbH",
        strasse: "Hafenstraße 5",
        plz: "20457",
        ort: "Hamburg",
        land: "DE",
        email: "buchhaltung@nordwerk.example",
        ustId: "",
        iban: "",
        leitwegId: "",
        defaultFormat: null,
      })
    ).id;
  });

  const draftInput = (overrides: Record<string, unknown> = {}) => ({
    contactId,
    issueDate: "2026-10-01",
    serviceFrom: "2026-09-01",
    serviceTo: "2026-09-30",
    paymentTermDays: 21,
    format: "zugferd" as const,
    intro: "wir berechnen unsere Leistungen im September.",
    note: "Zahlbar ohne Abzug.",
    buyerOrderReference: "4500012345",
    language: "en" as const,
    priceMode: "brutto" as const,
    discount: { kind: "prozent" as const, value: 300 },
    lines: [
      {
        description: "Beratung SAP",
        detail: "Workshop Konzern-IT\nVorbereitung und Protokoll",
        itemNumber: "B-100",
        quantity: 12_500,
        unit: "Std." as const,
        unitPrice: 14_280,
        taxRate: 1900 as const,
        discount: { kind: "prozent" as const, value: 1000 },
      },
      { description: "Reisekosten", quantity: 1000, unit: "Psch." as const, unitPrice: 25_000, taxRate: 1900 as const },
    ],
    ...overrides,
  });

  const final = async (overrides: Record<string, unknown> = {}) =>
    invoices.finalizeInvoice(actor, (await invoices.createDraft(actor, draftInput(overrides))).id);

  it("legt einen Entwurf mit Kunde, Positionen und Angaben an; Datum heute, ohne Nummer und Leistungszeitraum", async () => {
    const original = await final();
    const copy = await kopieren.copyInvoice(actor, original.id, heute);

    expect(copy).toMatchObject({
      kind: "rechnung",
      status: "draft",
      number: null,
      contactId,
      issueDate: heute,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 21,
      format: "zugferd",
      intro: original.intro,
      note: original.note,
      buyerOrderReference: "4500012345",
      language: "en",
      priceMode: "brutto",
      discountPercent: 300,
      net: original.net,
      tax: original.tax,
      gross: original.gross,
      quoteId: null,
      correctsId: null,
    });
    expect(copy.id).not.toBe(original.id);
    const pick = (lines: import("./invoices.ts").InvoiceLine[]) =>
      lines.map(({ position, description, detail, itemNumber, quantity, unit, unitPrice, taxRate, net, discountPercent, discountAmount }) => ({
        position,
        description,
        detail,
        itemNumber,
        quantity,
        unit,
        unitPrice,
        taxRate,
        net,
        discountPercent,
        discountAmount,
      }));
    const [originalData, copyData] = await Promise.all([invoices.getInvoice(original.id), invoices.getInvoice(copy.id)]);
    expect(pick(copyData!.lines)).toEqual(pick(originalData!.lines));
    expect(copyData!.lines[0]).toMatchObject({ detail: "Workshop Konzern-IT\nVorbereitung und Protokoll", itemNumber: "B-100", discountPercent: 1000 });
  });

  it("lässt das Original mit Nummer und Siegel unverändert", async () => {
    const original = await final();
    await kopieren.copyInvoice(actor, original.id, heute);
    const after = await invoices.getInvoice(original.id);
    expect(after!.invoice).toMatchObject({ status: "final", number: original.number, pdfSha256: original.pdfSha256, issueDate: "2026-10-01" });
    // Nur die eigene Rechnung: Siegel aus anderen Testdateien desselben Workers bleiben in der Datenbank stehen
    expect((await integrity.checkIntegrity(heute)).problems.filter((p) => p.zeile === original.id)).toEqual([]);
  });

  it("kopiert auch eine stornierte Rechnung", async () => {
    const original = await final();
    await invoices.cancelInvoice(actor, original.id, "2026-10-05");
    expect(await kopieren.copyInvoice(actor, original.id, heute)).toMatchObject({ status: "draft", kind: "rechnung", gross: original.gross });
  });

  it("macht aus „bereits bezahlt“ eine Überweisung ohne Zahlungsdienst und Datum", async () => {
    const original = await final({ paymentMethod: "bereits_bezahlt", paidVia: "PayPal", paidOn: "2026-10-01" });
    expect(await kopieren.copyInvoice(actor, original.id, heute)).toMatchObject({ paymentMethod: "ueberweisung", paidVia: null, paidOn: null });
  });

  it("behält den Ansprechpartner nur, solange er aktiv ist", async () => {
    const mara = await persons.createContactPerson(actor, contactId, { name: "Mara Beispiel", email: "mara@nordwerk.example", telefon: "", funktion: "" });
    const original = await final({ contactPersonId: mara });
    expect((await kopieren.copyInvoice(actor, original.id, heute)).contactPersonId).toBe(mara);
    await persons.setContactPersonActive(actor, mara, false);
    expect((await kopieren.copyInvoice(actor, original.id, heute)).contactPersonId).toBeNull();
  });

  it("lehnt Entwürfe, Stornorechnungen und Korrekturen ab", async () => {
    const draft = await invoices.createDraft(actor, draftInput());
    await expect(kopieren.copyInvoice(actor, draft.id, heute)).rejects.toThrow(/festgeschriebene/);
    const original = await final();
    const korrektur = await invoices.createCorrection(actor, original.id, "2026-10-03");
    await expect(kopieren.copyInvoice(actor, korrektur.id, heute)).rejects.toThrow(/Korrekturen/);
    const storno = await invoices.cancelInvoice(actor, (await final()).id, "2026-10-05");
    await expect(kopieren.copyInvoice(actor, storno.id, heute)).rejects.toThrow(/Stornorechnungen/);
  });
});
