import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const ACCOUNT_IBAN = "DE89370400440532013000";
/** IBAN in der E-Rechnung (BT-84 in cii-prefixes.xml) */
const RECHNUNG_IBAN = "DE02120300000000202051";
const KONTAKT_IBAN = "DE75512108001245126199";

const einvoice = () =>
  new TextEncoder().encode(readFileSync(new URL("../../../../../../packages/einvoice/test-fixtures/incoming/cii-prefixes.xml", import.meta.url), "utf8"));

describe.skipIf(!testDatabaseUrl)("Abweichende IBAN der E-Rechnung am Beleg (Postgres, #410)", () => {
  let bank: typeof import("./index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  const now = new Date("2026-09-16T08:00:00Z");

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await sql`truncate document_iban_decisions, sepa_transfer_items, sepa_transfers, write_offs, allocations, bank_transactions, bank_imports,
      bank_accounts, journal_lines, journal_entries, document_amounts, documents, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, iban, bic, versteuerung, kontenrahmen)
      values (1, 'Müller & Söhne Design', 'Musterstraße 1', '93047', 'Regensburg', 'a@example.com', '198/113/10010', 'BY',
              ${ACCOUNT_IBAN}, 'COBADEFFXXX', 'ist', 'SKR03')`;
  });

  const contactInput = (iban: string) => ({
    kundennummer: "",
    name: "Netzwerk Hosting GmbH",
    strasse: "",
    plz: "",
    ort: "",
    land: "DE",
    email: "",
    ustId: "",
    iban,
    leitwegId: "",
    defaultFormat: null,
    isCustomer: false,
    isSupplier: true,
  });

  /** E-Rechnung mit IBAN DE0212…, gebucht, mit dem Kontakt als Lieferant */
  async function bookedEInvoice(contactId: string | null, bytes = einvoice()) {
    const { id } = await documents.uploadDocument(actor, { bytes, filename: "RE-2026-0815.xml" });
    await documents.updateDocument(actor, id, {
      supplierName: "Netzwerk Hosting GmbH",
      supplierUstId: "DE987654321",
      supplierContactId: contactId,
      invoiceNumber: "RE-2026/0815",
      documentDate: "2026-09-15",
      dueDate: "2026-09-29",
      category: "software",
      payment: "bank",
      note: "",
      amounts: [
        { taxRate: 1900, net: 15_432, tax: 2_932 },
        { taxRate: 700, net: 2_990, tax: 209 },
      ],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  const candidate = async (id: string) => (await bank.transferCandidates()).find((c) => c.documentId === id)!;
  const account = () => bank.createAccount(actor, { name: "Geschäftskonto", iban: ACCOUNT_IBAN });
  const transfer = async (documentId: string) => {
    const { id: bankAccountId } = await account();
    return bank.createSepaTransfer(actor, { bankAccountId, executionDate: "2026-09-17", items: [{ documentId, skonto: false }] }, now);
  };

  it("abweichend und nicht entschieden: Belegseite zeigt beide IBANs, unter Überweisungen gesperrt, auch serverseitig", async () => {
    const contact = await contacts.createContact(actor, contactInput("DE75 5121 0800 1245 1261 99"));
    const id = await bookedEInvoice(contact.id);

    expect(await bank.documentIbanCheck(id)).toEqual({ art: "abweichend", kontaktIban: KONTAKT_IBAN, rechnungsIban: RECHNUNG_IBAN, entscheidung: null });
    const c = await candidate(id);
    expect(c.iban).toBeNull();
    expect(c.ibanDecisionNeeded).toBe(true);
    expect(c.problem).toBe("Die E-Rechnung nennt eine andere IBAN als der Kontakt: am Beleg entscheiden, welche gilt");
    await expect(transfer(id)).rejects.toThrow("am Beleg entscheiden");
    expect(await sql`select 1 from sepa_transfers`).toHaveLength(0);
  });

  it("IBAN der E-Rechnung nur für diesen Beleg: nach dem Buchen möglich, im Audit-Log, Kontakt und Sperre unverändert; die Datei geht an sie", async () => {
    const contact = await contacts.createContact(actor, contactInput(KONTAKT_IBAN));
    const id = await bookedEInvoice(contact.id);
    const [before] = await sql`select locked_at, status from documents where id = ${id}`;

    await bank.decideDocumentIban(actor, id, { wahl: "e-rechnung", kontaktIban: KONTAKT_IBAN, rechnungsIban: RECHNUNG_IBAN });

    const check = await bank.documentIbanCheck(id);
    expect(check).toMatchObject({ art: "abweichend", entscheidung: { wahl: "e-rechnung", von: actor } });
    const [audit] = await sql`select count(*)::int as n from audit_log where table_name = 'document_iban_decisions' and action = 'INSERT'`;
    expect(audit!.n).toBe(1);
    const [after] = await sql`select locked_at, status from documents where id = ${id}`;
    expect(after).toEqual(before);
    const [kontakt] = await sql`select iban from contacts where id = ${contact.id}`;
    expect(kontakt!.iban).toBe(KONTAKT_IBAN);

    expect(await candidate(id)).toMatchObject({ iban: RECHNUNG_IBAN, ibanSource: "e-rechnung", problem: null, ibanDecisionNeeded: false });
    const { id: transferId } = await transfer(id);
    const file = await bank.sepaTransferFile(transferId);
    expect(file?.xml).toContain(`<IBAN>${RECHNUNG_IBAN}</IBAN>`);
    expect(file?.xml).not.toContain(`<IBAN>${KONTAKT_IBAN}</IBAN>`);
  });

  it("IBAN des Kontakts behalten: die Datei geht an den Kontakt; eine spätere Entscheidung ersetzt die frühere", async () => {
    const contact = await contacts.createContact(actor, contactInput(KONTAKT_IBAN));
    const id = await bookedEInvoice(contact.id);
    await bank.decideDocumentIban(actor, id, { wahl: "e-rechnung", kontaktIban: KONTAKT_IBAN, rechnungsIban: RECHNUNG_IBAN });
    await bank.decideDocumentIban(actor, id, { wahl: "kontakt", kontaktIban: KONTAKT_IBAN, rechnungsIban: RECHNUNG_IBAN });
    expect(await candidate(id)).toMatchObject({ iban: KONTAKT_IBAN, ibanSource: "kontakt", problem: null });
    const { id: transferId } = await transfer(id);
    expect((await bank.sepaTransferFile(transferId))?.xml).toContain(`<IBAN>${KONTAKT_IBAN}</IBAN>`);
    // Beide Entscheidungen bleiben stehen: nur anhängbar
    expect(await sql`select wahl from document_iban_decisions order by created_at`).toHaveLength(2);
  });

  it("die Tabelle ist nur anhängbar", async () => {
    const contact = await contacts.createContact(actor, contactInput(KONTAKT_IBAN));
    const id = await bookedEInvoice(contact.id);
    await bank.decideDocumentIban(actor, id, { wahl: "kontakt", kontaktIban: KONTAKT_IBAN, rechnungsIban: RECHNUNG_IBAN });
    await expect(sql`update document_iban_decisions set wahl = 'e-rechnung'`).rejects.toThrow();
    await expect(sql`delete from document_iban_decisions`).rejects.toThrow();
  });

  it("geänderte IBAN im Kontakt verlangt eine neue Entscheidung", async () => {
    const contact = await contacts.createContact(actor, contactInput(KONTAKT_IBAN));
    const id = await bookedEInvoice(contact.id);
    await bank.decideDocumentIban(actor, id, { wahl: "e-rechnung", kontaktIban: KONTAKT_IBAN, rechnungsIban: RECHNUNG_IBAN });
    await contacts.updateContact(actor, contact.id, contactInput("DE44500105175407324931"));
    expect(await bank.documentIbanCheck(id)).toMatchObject({ art: "abweichend", kontaktIban: "DE44500105175407324931", entscheidung: null });
    expect(await candidate(id)).toMatchObject({ iban: null, ibanDecisionNeeded: true });
  });

  it("eine Entscheidung zu veralteten IBANs oder ohne Abweichung lehnt Haben ab", async () => {
    const contact = await contacts.createContact(actor, contactInput(KONTAKT_IBAN));
    const id = await bookedEInvoice(contact.id);
    await expect(
      bank.decideDocumentIban(actor, id, { wahl: "e-rechnung", kontaktIban: "DE44500105175407324931", rechnungsIban: RECHNUNG_IBAN }),
    ).rejects.toThrow("Die IBANs haben sich geändert");
    await contacts.updateContact(actor, contact.id, contactInput(RECHNUNG_IBAN));
    await expect(bank.decideDocumentIban(actor, id, { wahl: "kontakt", kontaktIban: RECHNUNG_IBAN, rechnungsIban: RECHNUNG_IBAN })).rejects.toThrow(
      "Die IBANs haben sich geändert",
    );
    expect(await sql`select 1 from document_iban_decisions`).toHaveLength(0);
  });

  it("gleiche IBAN, anders geschrieben: kein Hinweis, keine Sperre", async () => {
    const contact = await contacts.createContact(actor, contactInput("de02 1203 0000 0000 2020 51"));
    const id = await bookedEInvoice(contact.id);
    expect(await bank.documentIbanCheck(id)).toEqual({ art: "gleich" });
    expect(await candidate(id)).toMatchObject({ iban: RECHNUNG_IBAN, ibanSource: "kontakt", problem: null, warning: null });
  });

  it("Kontakt ohne IBAN: IBAN der E-Rechnung erst nach Bestätigung, bis dahin gesperrt, auch serverseitig; der Kontakt bleibt unverändert", async () => {
    const contact = await contacts.createContact(actor, contactInput(""));
    const id = await bookedEInvoice(contact.id);
    expect(await bank.documentIbanCheck(id)).toEqual({ art: "ungeprueft", rechnungsIban: RECHNUNG_IBAN, entscheidung: null });
    expect(await candidate(id)).toMatchObject({
      iban: null,
      ibanDecisionNeeded: true,
      problem: "Die IBAN aus der E-Rechnung ist noch nicht bestätigt: am Beleg übernehmen",
    });
    const { id: bankAccountId } = await account();
    const file = () => bank.createSepaTransfer(actor, { bankAccountId, executionDate: "2026-09-17", items: [{ documentId: id, skonto: false }] }, now);
    await expect(file()).rejects.toThrow("noch nicht bestätigt");

    await bank.decideDocumentIban(actor, id, { wahl: "e-rechnung", kontaktIban: null, rechnungsIban: RECHNUNG_IBAN });
    expect(await bank.documentIbanCheck(id)).toMatchObject({ art: "ungeprueft", entscheidung: { wahl: "e-rechnung", kontaktIban: null, von: actor } });
    expect(await candidate(id)).toMatchObject({ iban: RECHNUNG_IBAN, ibanSource: "e-rechnung", problem: null, ibanDecisionNeeded: false });
    const [kontakt] = await sql`select iban from contacts where id = ${contact.id}`;
    expect(kontakt!.iban).toBe("");
    const [audit] =
      await sql`select count(*)::int as n from audit_log where table_name = 'document_iban_decisions' and action = 'INSERT' and new_value ->> 'document_id' = ${id}`;
    expect(audit!.n).toBe(1);
    const { id: transferId } = await file();
    expect((await bank.sepaTransferFile(transferId))?.xml).toContain(`<IBAN>${RECHNUNG_IBAN}</IBAN>`);
  });

  it("auf Wunsch zusätzlich in den Kontakt, nur wenn er keine IBAN hat; danach gilt die des Kontakts", async () => {
    const contact = await contacts.createContact(actor, contactInput(""));
    const id = await bookedEInvoice(contact.id);
    await bank.decideDocumentIban(actor, id, { wahl: "e-rechnung", kontaktIban: null, rechnungsIban: RECHNUNG_IBAN, auchInKontakt: true });
    const [kontakt] = await sql`select iban from contacts where id = ${contact.id}`;
    expect(kontakt!.iban).toBe(RECHNUNG_IBAN);
    // Der Kontakt hat eine neue Version; der Beleg vergleicht jetzt gleiche IBANs
    expect((await sql`select 1 from contact_versions where contact_id = ${contact.id}`).length).toBeGreaterThan(1);
    expect(await bank.documentIbanCheck(id)).toEqual({ art: "gleich" });
    expect(await candidate(id)).toMatchObject({ iban: RECHNUNG_IBAN, ibanSource: "kontakt", problem: null });
  });

  it("in den Kontakt nie still überschrieben: hat er inzwischen eine IBAN, lehnt Haben ab", async () => {
    const contact = await contacts.createContact(actor, contactInput(""));
    const id = await bookedEInvoice(contact.id);
    await contacts.updateContact(actor, contact.id, contactInput(KONTAKT_IBAN));
    await expect(
      bank.decideDocumentIban(actor, id, { wahl: "e-rechnung", kontaktIban: null, rechnungsIban: RECHNUNG_IBAN, auchInKontakt: true }),
    ).rejects.toThrow("Die IBANs haben sich geändert");
    const [kontakt] = await sql`select iban from contacts where id = ${contact.id}`;
    expect(kontakt!.iban).toBe(KONTAKT_IBAN);
  });

  it("ohne Kontakt am Beleg: bestätigen geht, in den Kontakt nicht; „IBAN des Kontakts“ gibt es hier nicht", async () => {
    const id = await bookedEInvoice(null);
    expect(await candidate(id)).toMatchObject({ iban: null, ibanDecisionNeeded: true });
    await expect(bank.decideDocumentIban(actor, id, { wahl: "kontakt", kontaktIban: null, rechnungsIban: RECHNUNG_IBAN })).rejects.toThrow(
      "Ohne IBAN im Kontakt",
    );
    await expect(
      bank.decideDocumentIban(actor, id, { wahl: "e-rechnung", kontaktIban: null, rechnungsIban: RECHNUNG_IBAN, auchInKontakt: true }),
    ).rejects.toThrow("Am Beleg hängt kein Kontakt");
    await bank.decideDocumentIban(actor, id, { wahl: "e-rechnung", kontaktIban: null, rechnungsIban: RECHNUNG_IBAN });
    expect(await candidate(id)).toMatchObject({ iban: RECHNUNG_IBAN, problem: null });
  });

  it("keine IBAN in der E-Rechnung (BT-84 nur eine Kontonummer): kommt nicht in den Kontakt, den das Kontaktformular sonst nicht mehr speichert", async () => {
    // BT-84 „Payment account identifier“ muss keine IBAN sein; @haben/einvoice übernimmt den Wert ungeprüft
    const kaputt = new TextEncoder().encode(new TextDecoder().decode(einvoice()).replace("DE02 1203 0000 0000 2020 51", "0000202051"));
    const contact = await contacts.createContact(actor, contactInput(""));
    const id = await bookedEInvoice(contact.id, kaputt);
    await expect(
      bank.decideDocumentIban(actor, id, { wahl: "e-rechnung", kontaktIban: null, rechnungsIban: "0000202051", auchInKontakt: true }),
    ).rejects.toThrow();
    const [kontakt] = await sql`select iban from contacts where id = ${contact.id}`;
    expect(kontakt!.iban).toBe("");
  });

  it("bestätigen erst am gebuchten Beleg", async () => {
    const contact = await contacts.createContact(actor, contactInput(""));
    const { id } = await documents.uploadDocument(actor, { bytes: einvoice(), filename: "RE-2026-0815.xml" });
    await sql`update documents set supplier_contact_id = ${contact.id} where id = ${id}`;
    await expect(bank.decideDocumentIban(actor, id, { wahl: "e-rechnung", kontaktIban: null, rechnungsIban: RECHNUNG_IBAN })).rejects.toThrow(
      "nach dem Buchen",
    );
  });

  it("ein noch nicht gebuchter Beleg bleibt löschbar: entschieden wird erst am gebuchten Beleg", async () => {
    const contact = await contacts.createContact(actor, contactInput(KONTAKT_IBAN));
    const { id } = await documents.uploadDocument(actor, { bytes: einvoice(), filename: "RE-2026-0815.xml" });
    await sql`update documents set supplier_contact_id = ${contact.id} where id = ${id}`;
    expect(await bank.documentIbanCheck(id)).toMatchObject({ art: "abweichend" });
    // Eine nur anhängbare Entscheidung am offenen Beleg hielte ihn per Fremdschlüssel fest
    await expect(bank.decideDocumentIban(actor, id, { wahl: "kontakt", kontaktIban: KONTAKT_IBAN, rechnungsIban: RECHNUNG_IBAN })).rejects.toThrow(
      "nach dem Buchen",
    );

    await documents.deleteDocument(actor, id);
    expect(await sql`select 1 from documents where id = ${id}`).toHaveLength(0);
  });

  it("ein Beleg ohne E-Rechnung hat nichts abzugleichen", async () => {
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1]), filename: "beleg.jpg" });
    expect(await bank.documentIbanCheck(id)).toEqual({ art: "keine" });
  });
});
