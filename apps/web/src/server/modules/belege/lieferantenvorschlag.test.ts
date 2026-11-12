import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { completion, startTestService, type TestService } from "./test-ki-dienst.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3]);

const answer = (iban: string | null, fundstelle: string | null) => ({
  lieferant: "Telekom Deutschland GmbH",
  lieferantUstId: "DE123475223",
  lieferantIban: iban,
  lieferantIbanFundstelle: fundstelle,
  empfaenger: null,
  empfaengerUstId: null,
  rechnungsnummer: "MF-2026-09",
  belegdatum: "2026-09-29",
  faelligAm: null,
  waehrung: "EUR",
  istGutschrift: false,
  betraege: [{ steuersatz: "19", netto: "38.57", steuer: "7.33" }],
  brutto: "45.90",
  kategorie: "telefon",
  hinweis: null,
});

const einvoice = () =>
  new TextEncoder().encode(readFileSync(new URL("../../../../../../packages/einvoice/test-fixtures/incoming/cii-prefixes.xml", import.meta.url), "utf8"));

describe.skipIf(!testDatabaseUrl)("Lieferantenvorschlag und IBAN als Vorschlag (Postgres, #329)", () => {
  let documents: typeof import("./documents.ts");
  let suggestion: typeof import("./lieferantenvorschlag.ts");
  let bank: typeof import("../bank/index.ts");
  let service: TestService;
  let sql: postgres.Sql;
  const actor = "test-user";
  let counter = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    service = await startTestService(() => ({ body: completion(JSON.stringify(answer(null, null))) }));
    Object.assign(process.env, { EXTRACTION_BASE_URL: service.baseUrl, EXTRACTION_MODEL: "qwen2.5vl:7b", EXTRACTION_TIMEOUT_SECONDS: "10" });
    documents = await import("./documents.ts");
    suggestion = await import("./lieferantenvorschlag.ts");
    bank = await import("../bank/index.ts");
  }, 30_000);

  afterAll(async () => {
    await service?.close();
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate journal_lines, journal_entries, document_amounts, documents, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, kontenrahmen, versteuerung) values (1, 'Testfirma', 'SKR03', 'ist')`;
  });

  async function photo(iban: string | null, fundstelle: string | null) {
    service.reply(() => ({ body: completion(JSON.stringify(answer(iban, fundstelle))) }));
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, ++counter]), filename: `telekom-${counter}.jpg` });
    return id;
  }

  it("IBAN aus der KI-Auslesung: Vorschlag mit Fundstelle und Prüfziffer, nicht am Beleg und nie in einer Überweisung", async () => {
    const id = await photo("DE02 1203 0000 0000 2020 51", "Bankverbindung: Commerzbank, IBAN DE02 1203 0000 0000 2020 51");
    expect(await suggestion.supplierSuggestion(id)).toEqual({
      contact: { name: "Telekom Deutschland GmbH", ustId: "DE123475223" },
      iban: {
        iban: "DE02120300000000202051",
        source: "ki",
        fundstelle: "Bankverbindung: Commerzbank, IBAN DE02 1203 0000 0000 2020 51",
        valid: true,
      },
    });
    // Gebucht und per Bank zu zahlen: ohne Kontakt mit IBAN keine Überweisung, die KI-IBAN zählt nicht
    await sql`update documents set status = 'gebucht', payment = 'bank', supplier_name = 'Telekom Deutschland GmbH', gross = 4590 where id = ${id}`;
    const candidate = (await bank.transferCandidates()).find((c) => c.documentId === id);
    expect(candidate).toMatchObject({ iban: null, problem: "IBAN fehlt: im Kontakt des Lieferanten eintragen" });
  });

  it("falsche Prüfziffer bleibt sichtbar; ohne IBAN kein Vorschlag", async () => {
    const wrong = await photo("DE00 1203 0000 0000 2020 51", "IBAN DE00 1203 0000 0000 2020 51");
    expect((await suggestion.supplierSuggestion(wrong)).iban).toMatchObject({ iban: "DE00120300000000202051", valid: false });
    const none = await photo(null, null);
    expect((await suggestion.supplierSuggestion(none)).iban).toBeNull();
    // Eine Fundstelle ohne IBAN oder Unsinn als IBAN zählt nicht
    const nonsense = await photo("siehe Rückseite", "siehe Rückseite");
    expect((await suggestion.supplierSuggestion(nonsense)).iban).toBeNull();
  });

  it("E-Rechnung: Kontaktvorschlag mit Anschrift und USt-IdNr. des Verkäufers, IBAN aus BT-84", async () => {
    const { id } = await documents.uploadDocument(actor, { bytes: einvoice(), filename: "RE-2026-0815.xml" });
    const result = await suggestion.supplierSuggestion(id);
    expect(result.contact).toMatchObject({ name: "Netzwerk Hosting GmbH", ustId: expect.stringMatching(/^DE\d{9}$/), land: "DE" });
    expect(result.contact.strasse).toBeTruthy();
    expect(result.contact.plz).toBeTruthy();
    expect(result.contact.ort).toBeTruthy();
    expect(result.iban).toEqual({ iban: "DE02120300000000202051", source: "e-rechnung", fundstelle: null, valid: true });
  });

  it("E-Rechnung als Gutschrift: BT-84 ist das Konto des Käufers, kein IBAN-Vorschlag für den Lieferanten", async () => {
    // EN 16931 BT-84: Konto, auf das gezahlt wird; bei einer Gutschrift (381) zahlt der Verkäufer an den Käufer
    const xml = readFileSync(new URL("../../../../../../packages/einvoice/test-fixtures/incoming/ubl-creditnote-cbc-default.xml", import.meta.url));
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array(xml), filename: "GS-2026-12.xml" });
    const result = await suggestion.supplierSuggestion(id);
    expect(result.contact.name).toBeTruthy();
    expect(result.iban).toBeNull();
  });

  it("ein von Hand angelegter Beleg hat keinen Vorschlag", async () => {
    service.reply(() => ({ status: 500, body: "kaputt" }));
    const { id } = await documents.uploadDocument(actor, { bytes: new Uint8Array([...JPEG, ++counter]), filename: "x.jpg" });
    expect(await suggestion.supplierSuggestion(id)).toEqual({ contact: {}, iban: null });
  });
});
