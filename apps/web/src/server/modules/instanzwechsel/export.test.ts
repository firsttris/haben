import { createHash } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const KUNDE = "0b6a1c1e-5d7e-4f0a-9a43-1f2d3c4b5a60";
const LAYOUT = "4f1e2d3c-6b5a-4978-8a1b-2c3d4e5f6a70";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 4, 5, 6]);
const PDF = new TextEncoder().encode("%PDF-1.7\nAllgemeine Geschäftsbedingungen\n%%EOF\n");
const eingebettet = (bytes: Uint8Array) => ({ sha256: createHash("sha256").update(bytes).digest("hex"), data: Buffer.from(bytes).toString("base64") });

describe.skipIf(!testDatabaseUrl)("Export der Einstellungen (Postgres)", () => {
  let instanzwechsel: typeof import("./index.ts");
  let integritaet: typeof import("./integritaet.ts");
  let storage: typeof import("../../storage.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    instanzwechsel = await import("./index.ts");
    integritaet = await import("./integritaet.ts");
    storage = await import("../../storage.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate company, einrichtung, mail_settings, contacts, contact_persons, text_blocks, articles, units, own_accounts,
      beleg_layouts, letterhead_profiles, company_logo, letterhead_background, quote_default_attachments, custom_pages, procedure_details cascade`;
  });

  /** Eine Testinstanz mit allem, was mitgehen soll, und Zugängen und Bestätigungen, die nicht mitgehen dürfen */
  async function testinstanz() {
    await sql`insert into company(id, name, ort, steuernummer, iban, kontenrahmen, invoice_number_format, customer_number_format, customer_number_next,
        taxpayer, mcp_enabled, elster_datenschutz_at, calendar_token_hash, firmendaten_gespeichert_at)
      values (1, 'Muster Design', 'Leipzig', '231/815/08150', 'DE02120300000000202051', 'SKR04', 'RE-{JJJJ}-{NNNN}', 'K-{NNNN}', 42,
        ${JSON.stringify({ a: { vorname: "Erika", name: "Mustermann" } })}::jsonb, true, now(), 'hash-des-kalender-abos', now())`;
    await sql`insert into einrichtung(id, ausgeblendete_bereiche) values (1, ${JSON.stringify(["lohn"])}::jsonb)`;
    await sql`insert into mail_settings(id, transport, host, port, secure, username, ciphertext, from_address, from_name, reminder_to, templates)
      values (1, 'smtp', 'smtp.example.org', 587, false, 'versand@example.org', ${Buffer.from("geheimes-passwort")}, 'rechnung@example.org',
        'Muster Design', 'erika@example.org', ${JSON.stringify({ rechnung: { betreff: "Rechnung {nummer}", text: "Hallo {name}" } })}::jsonb)`;
    await sql`insert into contacts(id, kundennummer, name, ort, email, debitor_nr, lexoffice_id) values (${KUNDE}, 'K-0041', 'Nordwerk GmbH', 'Hamburg', 'buchhaltung@nordwerk.example', 10041, 'lx-41')`;
    await sql`insert into contact_persons(contact_id, name, funktion, created_by) values (${KUNDE}, 'Jana Peters', 'Einkauf', 'test-user')`;
    await sql`insert into text_blocks(name, kind, text, contact_id) values ('Rahmenvertrag', 'kopf', 'Gemäß Rahmenvertrag RV-17 berechnen wir:', ${KUNDE})`;
    await sql`insert into units(label, code) values ('Lizenz', 'C62')`;
    await sql`insert into articles(number, description, unit, unit_price, tax_rate) values ('B-1', 'Beratung', 'Stunde', 9500, 1900)`;
    await sql`insert into own_accounts(kontenrahmen, account, name, parent_category, created_by) values ('SKR04', '6837', 'Software-Abos', 'software', 'test-user')`;
    await sql`insert into beleg_layouts(id, name, art, source, sha256, schema_version, packages, approved_sha256)
      values (${LAYOUT}, 'Mein Layout', 'beleg', '#import "@preview/cetz:0.3.4"', 'abc', 1, ${JSON.stringify([{ name: "@preview/cetz", version: "0.3.4" }])}::jsonb, 'abc')`;
    await sql`insert into letterhead_profiles(name, is_default, settings)
      values ('Standard', true, ${JSON.stringify({ accent: "#1F6FEB", layouts: { rechnung: { kind: "eigen", id: LAYOUT } } })}::jsonb)`;
    await sql`insert into company_logo(id, logo, format, sha256) values (1, ${Buffer.from(PNG)}, 'png', 'x')`;
    await sql`insert into letterhead_background(id, background, format, sha256) values (1, ${Buffer.from(JPG)}, 'jpg', 'y')`;
    const sha256 = await storage.storeFile(PDF);
    await sql`insert into quote_default_attachments(filename, mime_type, sha256, size) values ('AGB.pdf', 'application/pdf', ${sha256}, ${PDF.length})`;
    await sql`insert into custom_pages(name, url) values ('Wiki', 'https://wiki.example.org')`;
    await sql`insert into procedure_details(id, verantwortlich) values (1, 'Erika Mustermann')`;
  }

  /** Wie die Datei beim Herunterladen ankommt */
  async function datei() {
    return JSON.parse(JSON.stringify(await instanzwechsel.exportSettings(new Date("2026-12-20T10:00:00Z"))));
  }

  it("nimmt Firmendaten, Gestaltung und Stammdaten mit, ohne Zugänge und Bestätigungen dieser Instanz", async () => {
    await testinstanz();
    const export_ = await datei();

    expect(export_).toMatchObject({ format: "haben-einstellungen", version: 1, exportedAt: "2026-12-20T10:00:00.000Z" });
    expect(export_.company).toMatchObject({
      name: "Muster Design",
      steuernummer: "231/815/08150",
      kontenrahmen: "SKR04",
      invoiceNumberFormat: "RE-{JJJJ}-{NNNN}",
      customerNumberFormat: "K-{NNNN}",
      customerNumberNext: 42,
      taxpayer: { a: { vorname: "Erika", name: "Mustermann" } },
    });
    for (const feld of ["mcpEnabled", "elsterDatenschutzAt", "calendarTokenHash", "id"]) expect(export_.company).not.toHaveProperty(feld);
    // Nur damit der Import weiß, ob die Firmendaten bewusst gespeichert waren
    expect(export_.company.companySavedAt).toEqual(expect.any(String));
    expect(export_.einrichtung.ausgeblendeteBereiche).toEqual(["lohn"]);

    expect(export_.mail).toEqual({
      fromAddress: "rechnung@example.org",
      fromName: "Muster Design",
      reminderTo: "erika@example.org",
      remindersEnabled: true,
      reminderDays: [7, 1],
      templates: { rechnung: { betreff: "Rechnung {nummer}", text: "Hallo {name}" } },
      pruefwertMail: true,
    });

    expect(export_.contacts).toHaveLength(1);
    expect(export_.contacts[0]).toMatchObject({ id: KUNDE, kundennummer: "K-0041", name: "Nordwerk GmbH", debitorNr: 10041, lexofficeId: "lx-41" });
    expect(export_.contacts[0]).not.toHaveProperty("version");
    expect(export_.contactPersons).toEqual([expect.objectContaining({ contactId: KUNDE, name: "Jana Peters", funktion: "Einkauf", deactivatedAt: null })]);
    expect(export_.contactPersons[0]).not.toHaveProperty("createdBy");
    expect(export_.textBlocks).toEqual([expect.objectContaining({ name: "Rahmenvertrag", kind: "kopf", contactId: KUNDE })]);
    expect(export_.units).toEqual([expect.objectContaining({ label: "Lizenz", code: "C62", archivedAt: null })]);
    expect(export_.articles).toEqual([expect.objectContaining({ number: "B-1", description: "Beratung", unitPrice: 9500, taxRate: 1900 })]);
    expect(export_.ownAccounts).toEqual([
      expect.objectContaining({ kontenrahmen: "SKR04", account: "6837", name: "Software-Abos", parentCategory: "software" }),
    ]);
    expect(export_.customPages).toEqual([{ name: "Wiki", url: "https://wiki.example.org", openInNewTab: false }]);
    expect(export_.procedureDetails).toMatchObject({ verantwortlich: "Erika Mustermann" });
  });

  it("nimmt Logo, Briefpapier und Standardanhänge als Datei mit und eigene Layouts ohne Freigabe der Pakete", async () => {
    await testinstanz();
    const export_ = await datei();

    expect(export_.logo).toEqual({ format: "png", ...eingebettet(PNG) });
    expect(export_.background).toEqual({ format: "jpg", ...eingebettet(JPG) });
    expect(export_.quoteDefaultAttachments).toEqual([{ filename: "AGB.pdf", mimeType: "application/pdf", ...eingebettet(PDF) }]);
    expect(export_.layouts).toEqual([
      {
        id: LAYOUT,
        name: "Mein Layout",
        art: "beleg",
        source: '#import "@preview/cetz:0.3.4"',
        schemaVersion: 1,
        packages: [{ name: "@preview/cetz", version: "0.3.4" }],
      },
    ]);
    // Die Gestaltung verweist weiter auf das Layout in derselben Datei
    expect(export_.letterheadProfiles).toEqual([
      expect.objectContaining({
        name: "Standard",
        isDefault: true,
        settings: expect.objectContaining({ layouts: { rechnung: { kind: "eigen", id: LAYOUT } } }),
      }),
    ]);
  });

  it("enthält keine Zugangsdaten zum E-Mail-Versand", async () => {
    await testinstanz();
    const text = JSON.stringify(await datei());

    for (const zugang of [
      "smtp.example.org",
      "versand@example.org",
      "geheimes-passwort",
      Buffer.from("geheimes-passwort").toString("base64"),
      "hash-des-kalender-abos",
    ])
      expect(text).not.toContain(zugang);
  });

  it("trägt eine Prüfsumme, die eine geänderte Datei erkennt", async () => {
    await testinstanz();
    const export_ = await datei();

    expect(export_.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(integritaet.checksumProblem(export_)).toBeNull();
    export_.contacts[0].iban = "DE89370400440532013000";
    expect(integritaet.checksumProblem(export_)).toMatch(/Prüfsumme stimmt nicht/);
  });

  it("liefert eine leere Instanz ohne Fehler", async () => {
    const export_ = await datei();

    expect(export_).toMatchObject({ company: null, einrichtung: null, logo: null, background: null, mail: null, procedureDetails: null });
    expect(export_.contacts).toEqual([]);
    expect(export_.quoteDefaultAttachments).toEqual([]);
  });

  it("nennt Datum und Haben im Dateinamen", () => {
    expect(instanzwechsel.settingsExportFilename(new Date("2026-12-31T23:30:00Z"))).toBe("Haben-Einstellungen-2027-01-01.json");
  });
});
