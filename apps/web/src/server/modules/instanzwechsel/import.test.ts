import { designWithDefaults } from "@haben/core";
import { startvorlage } from "@haben/einvoice";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const KUNDE = "0b6a1c1e-5d7e-4f0a-9a43-1f2d3c4b5a60";
const LIEFERANT = "5a2b8c4d-1e3f-4a5b-8c6d-7e8f9a0b1c2d";
const LAYOUT = "4f1e2d3c-6b5a-4978-8a1b-2c3d4e5f6a70";
const PNG = new Uint8Array(readFileSync(new URL("../../../../public/icon-192.png", import.meta.url)));
const PDF = new TextEncoder().encode("%PDF-1.7\nAllgemeine Geschäftsbedingungen\n%%EOF\n");
const HEUTE = "2026-12-20";
const ERIKA = { idnr: "65929970489", anrede: "Frau", vorname: "Erika", name: "Mustermann", geburtsdatum: "1980-05-17", religion: "11", beruf: "Designerin" };
const actor = "inhaber-neu";

/** Die JSON aus dem ZIP, wie der Import sie liest */
const einstellungen = (zip: Uint8Array) => JSON.parse(strFromU8(unzipSync(zip)["einstellungen.json"]!));

/** Dasselbe ZIP mit ersetzten Dateien */
const neuGepackt = (dateien: Record<string, Uint8Array>, ersetzt: Record<string, Uint8Array>) => zipSync({ ...dateien, ...ersetzt });

/**
 * Das ZIP, nachdem Safari es beim Laden entpackt hat (Voreinstellung „Sichere Dateien nach dem Laden öffnen“, das ZIP
 * kommt in den Papierkorb) und der Finder den Ordner mit „Komprimieren“ wieder gepackt hat: alles im Ordner, mit
 * Ordnereinträgen und unter __MACOSX/ den erweiterten Attributen je Datei. Aufbau wie `ditto -c -k --sequesterRsrc --keepParent`.
 */
function vomFinderNeuGepackt(zip: Uint8Array, ordner: string): Uint8Array {
  const leer = new Uint8Array(0);
  const attribute = strToU8("Mac OS X        ATTR com.apple.quarantine");
  const neu: Record<string, Uint8Array> = { [`${ordner}/`]: leer, "__MACOSX/": leer, [`__MACOSX/${ordner}/`]: leer };
  for (const [name, bytes] of Object.entries(unzipSync(zip))) {
    neu[`${ordner}/${name}`] = bytes;
    if (name.endsWith("/")) {
      neu[`__MACOSX/${ordner}/${name}`] = leer;
      neu[`__MACOSX/${ordner}/._${name.slice(0, -1)}`] = attribute;
    } else {
      const teile = name.split("/");
      const datei = teile.pop()!;
      neu[`__MACOSX/${ordner}/${teile.map((teil) => `${teil}/`).join("")}._${datei}`] = attribute;
    }
  }
  return zipSync(neu);
}

type Zeile = Record<string, unknown>;
const gesetzt = (zeile: Zeile, feld: string) => ({ ...zeile, [feld]: zeile[feld] !== null });
const ohneId = (zeilen: Zeile[]) => zeilen.map(({ id: _, ...zeile }) => zeile);

type Datei = Zeile & {
  company: Zeile & { dunning: Zeile };
  einrichtung: Zeile;
  letterheadProfiles: Zeile[];
  units: Zeile[];
  articles: Zeile[];
  contacts: Zeile[];
  contactPersons: Zeile[];
  textBlocks: Zeile[];
  ownAccounts: Zeile[];
};

/** Was der Import neu vergibt (IDs, Zeitpunkte) oder vervollständigt (Vorgaben), gleich gemacht; alles andere muss ankommen */
function vergleichbar(datei: Datei) {
  const { exportedAt: _a, appVersion: _v, sha256: _s, ...rest } = datei;
  return {
    ...rest,
    company: { ...gesetzt(datei.company, "companySavedAt"), dunning: { autoBaseRate: false, baseRateSince: null, ...datei.company.dunning } },
    einrichtung: gesetzt(datei.einrichtung, "fragenAt"),
    letterheadProfiles: ohneId(datei.letterheadProfiles).map((profil) => ({ ...profil, settings: designWithDefaults(profil.settings as never) })),
    units: ohneId(datei.units).map((zeile) => gesetzt(zeile, "archivedAt")),
    articles: ohneId(datei.articles).map((zeile) => gesetzt(zeile, "archivedAt")),
    contacts: datei.contacts.map((zeile) => gesetzt(zeile, "archivedAt")),
    contactPersons: ohneId(datei.contactPersons).map((zeile) => gesetzt(zeile, "deactivatedAt")),
    textBlocks: ohneId(datei.textBlocks).map((zeile) => gesetzt(zeile, "archivedAt")),
    ownAccounts: ohneId(datei.ownAccounts).map((zeile) => gesetzt(zeile, "archivedAt")),
  };
}

describe.skipIf(!testDatabaseUrl)("Einstellungen übernehmen (Postgres)", () => {
  let instanzwechsel: typeof import("./index.ts");
  let storage: typeof import("../../storage.ts");
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = await setupTestDb();
    instanzwechsel = await import("./index.ts");
    storage = await import("../../storage.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Alles leeren, was eine neue Instanz nicht hat */
  const neuBeginnen = () =>
    leeren(sql)`truncate company, einrichtung, contacts, contact_persons, text_blocks, articles, units, own_accounts, beleg_layouts, letterhead_profiles,
      company_logo, letterhead_background, quote_default_attachments, custom_pages, procedure_details, invoice_number_counters, quote_number_counters,
      mail_settings cascade`;

  beforeEach(async () => {
    await neuBeginnen();
  });

  /** Die Testinstanz, aus der exportiert wird; alle Werte so, wie die Formulare sie annehmen */
  async function testinstanz() {
    await sql`insert into company(id, name, strasse, plz, ort, email, steuernummer, ust_id, iban, bic, kontenrahmen, versteuerung, payment_term_days,
        invoice_number_format, quote_number_format, invoice_counter_running, customer_number_format, customer_number_next, datev_berater_nr, datev_mandant_nr,
        taxpayer, nav_color, archive_search, mcp_enabled, firmendaten_gespeichert_at)
      values (1, 'Muster Design', 'Lindenstraße 4', '04109', 'Leipzig', 'rechnung@muster.example', '231/815/08150', 'DE123456789', 'DE89370400440532013000',
        'COBADEFFXXX', 'SKR04', 'soll', 21, 'RE-{NNNN}', 'AN-{JJJJ}-{NNN}', true, 'K-{NNNN}', 42, '12345', '678',
        ${JSON.stringify({ a: ERIKA })}::jsonb, '#1D4ED8', false, true, now())`;
    await sql`insert into einrichtung(id, ausgeblendete_bereiche, fragen_at) values (1, ${JSON.stringify(["personal"])}::jsonb, now())`;
    await sql`insert into contacts(id, kundennummer, name, ort, email, debitor_nr, lexoffice_id) values (${KUNDE}, 'K-0041', 'Nordwerk GmbH', 'Hamburg', 'einkauf@nordwerk.example', 10041, 'lx-41')`;
    await sql`insert into contacts(id, is_customer, is_supplier, name, archived_at) values (${LIEFERANT}, false, true, 'Altlieferant KG', now())`;
    await sql`insert into contact_persons(contact_id, name, funktion, created_by) values (${KUNDE}, 'Jana Peters', 'Einkauf', 'test-user')`;
    await sql`insert into text_blocks(name, kind, text, contact_id) values ('Rahmenvertrag', 'kopf', 'Gemäß Rahmenvertrag RV-17 berechnen wir:', ${KUNDE})`;
    await sql`insert into units(label, code) values ('Lizenz', 'C62')`;
    await sql`insert into articles(number, description, unit, unit_price, tax_rate) values ('L-1', 'Jahreslizenz', 'Lizenz', 49000, 1900)`;
    await sql`insert into own_accounts(kontenrahmen, account, name, parent_category, created_by) values ('SKR04', '6999', 'Software-Abos', 'software', 'test-user')`;
    await sql`insert into beleg_layouts(id, name, art, source, sha256, schema_version, packages)
      values (${LAYOUT}, 'Mein Layout', 'beleg', ${startvorlage("beleg")}, 'x', 1, '[]'::jsonb)`;
    // Wie ein Profil seit Migration 0312 (#113), mit accentFromLayout; ohne gilt es als Datei von davor
    await sql`insert into letterhead_profiles(name, is_default, settings)
      values ('Standard', true, ${JSON.stringify({ accent: "#1F6FEB", font: "plex-sans", accentFromLayout: false, layouts: { rechnung: { kind: "eigen", id: LAYOUT } } })}::jsonb)`;
    await sql`insert into company_logo(id, logo, format, sha256) values (1, ${Buffer.from(PNG)}, 'png', 'x')`;
    const sha256 = await storage.storeFile(PDF);
    await sql`insert into quote_default_attachments(filename, mime_type, sha256, size) values ('AGB.pdf', 'application/pdf', ${sha256}, ${PDF.length})`;
    await sql`insert into custom_pages(name, url) values ('Wiki', 'https://wiki.example.org/')`;
    await sql`insert into procedure_details(id, verantwortlich) values (1, 'Erika Mustermann')`;
    await mailEinrichten();
    await sql`update mail_settings set from_name = 'Muster Design', templates = ${JSON.stringify({ "rechnung:de": { subject: "Rechnung {nummer}", body: "Hallo" } })}::jsonb`;
  }

  /** Versand mit Zugang, wie ihn jemand vor dem Übernehmen einrichtet */
  async function mailEinrichten() {
    await sql`insert into mail_settings(id, transport, host, port, secure, username, ciphertext, from_address, reminder_to)
      values (1, 'smtp', 'smtp.example.org', 587, false, 'versand@example.org', ${Buffer.from("x")}, 'rechnung@muster.example', 'erika@muster.example')`;
  }

  /** Exportieren, die Testinstanz verwerfen: danach ist die Datenbank wie eine neue Instanz */
  async function exportierenUndNeu(): Promise<Uint8Array> {
    const text = await instanzwechsel.exportSettingsZip(new Date("2026-12-20T10:00:00Z"));
    await neuBeginnen();
    return text;
  }

  it("übernimmt Firmendaten, Gestaltung und Stammdaten mit ihren Verweisen", async () => {
    await testinstanz();
    const text = await exportierenUndNeu();
    await mailEinrichten();

    const result = await instanzwechsel.importSettings(actor, text, HEUTE);

    expect(result).toEqual({ contacts: 2, articles: 1, textBlocks: 1, layouts: 1, mail: true });
    const [firma] = await sql`select * from company`;
    expect(firma).toMatchObject({
      name: "Muster Design",
      plz: "04109",
      kontenrahmen: "SKR04",
      versteuerung: "soll",
      payment_term_days: 21,
      invoice_number_format: "RE-{NNNN}",
      invoice_counter_running: true,
      customer_number_format: "K-{NNNN}",
      customer_number_next: 42,
      datev_berater_nr: "12345",
      taxpayer: { a: ERIKA },
      nav_color: "#1D4ED8",
      archive_search: false,
      mcp_enabled: false,
    });
    expect(firma!.firmendaten_gespeichert_at).not.toBeNull();
    expect((await sql`select ausgeblendete_bereiche from einrichtung`)[0]!.ausgeblendete_bereiche).toEqual(["personal"]);

    const kontakte = await sql`select id, kundennummer, name, debitor_nr, lexoffice_id, archived_at from contacts order by name`;
    expect(kontakte.map((k) => [k.id, k.kundennummer, k.name, k.debitor_nr, k.lexoffice_id, k.archived_at !== null])).toEqual([
      [LIEFERANT, null, "Altlieferant KG", null, null, true],
      [KUNDE, "K-0041", "Nordwerk GmbH", 10041, "lx-41", false],
    ]);
    expect(await sql`select contact_id, name, funktion, created_by from contact_persons`).toEqual([
      { contact_id: KUNDE, name: "Jana Peters", funktion: "Einkauf", created_by: actor },
    ]);
    expect((await sql`select contact_id from text_blocks`)[0]!.contact_id).toBe(KUNDE);
    expect(await sql`select number, unit, unit_price from articles`).toEqual([{ number: "L-1", unit: "Lizenz", unit_price: 49000 }]);
    expect(await sql`select kontenrahmen, account, name, created_by from own_accounts`).toEqual([
      { kontenrahmen: "SKR04", account: "6999", name: "Software-Abos", created_by: actor },
    ]);
    expect(await sql`select name, url from custom_pages`).toEqual([{ name: "Wiki", url: "https://wiki.example.org/" }]);
    expect((await sql`select verantwortlich from procedure_details`)[0]!.verantwortlich).toBe("Erika Mustermann");
  });

  it("ergibt nach dem Übernehmen wieder dieselbe Datei, bis auf neue IDs und Zeitpunkte", async () => {
    await testinstanz();
    const zip = await exportierenUndNeu();
    const vorher = einstellungen(zip);
    await mailEinrichten();

    await instanzwechsel.importSettings(actor, zip, HEUTE);

    const nachher = einstellungen(await instanzwechsel.exportSettingsZip(new Date("2026-12-20T10:00:00Z")));
    expect(vergleichbar(nachher)).toEqual(vergleichbar(vorher));
  });

  it.each([
    {
      fall: "SKR03, Ist, Kleinunternehmer",
      kontenrahmen: "SKR03",
      versteuerung: "ist",
      kleinunternehmer: true,
      rechtsform: "einzelunternehmen",
      konto: "4999",
    },
    { fall: "SKR04, Soll, GmbH", kontenrahmen: "SKR04", versteuerung: "soll", kleinunternehmer: false, rechtsform: "gmbh", konto: "6999" },
  ])("ergibt auch mit $fall nach dem Übernehmen wieder dieselbe Datei", async ({ kontenrahmen, versteuerung, kleinunternehmer, rechtsform, konto }) => {
    await testinstanz();
    const gmbh = rechtsform === "gmbh";
    await sql`update company set kontenrahmen = ${kontenrahmen}, versteuerung = ${versteuerung}, kleinunternehmer = ${kleinunternehmer}, rechtsform = ${rechtsform},
      registergericht = ${gmbh ? "Amtsgericht Leipzig" : ""}, registernummer = ${gmbh ? "HRB 12345" : ""}, geschaeftsfuehrer = ${gmbh ? "Erika Mustermann" : ""}`;
    // Nummer und Kontenrahmen eines eigenen Kontos ändern sich nie (Trigger 0211): neu anlegen
    await sql`delete from own_accounts`;
    await sql`insert into own_accounts(kontenrahmen, account, name, parent_category, created_by) values (${kontenrahmen}, ${konto}, 'Software-Abos', 'software', 'test-user')`;
    const zip = await exportierenUndNeu();
    await mailEinrichten();

    await instanzwechsel.importSettings(actor, zip, HEUTE);

    const nachher = einstellungen(await instanzwechsel.exportSettingsZip(new Date("2026-12-20T10:00:00Z")));
    expect(vergleichbar(nachher)).toEqual(vergleichbar(einstellungen(zip)));
    expect(nachher.company).toMatchObject({ kontenrahmen, versteuerung, kleinunternehmer, rechtsform });
    expect(nachher.ownAccounts).toEqual([expect.objectContaining({ kontenrahmen, account: konto })]);
  });

  it("übernimmt Logo, Layout samt Zuordnung, Standardanhang und E-Mail-Vorlagen, ohne den Zugang zu ändern", async () => {
    await testinstanz();
    const text = await exportierenUndNeu();
    await mailEinrichten();

    await instanzwechsel.importSettings(actor, text, HEUTE);

    const [logo] = await sql`select logo, sha256 from company_logo`;
    expect(new Uint8Array(logo!.logo)).toEqual(PNG);
    expect(logo!.sha256).toBe(createHash("sha256").update(PNG).digest("hex"));
    expect(await sql`select id, name, approved_sha256 from beleg_layouts`).toEqual([{ id: LAYOUT, name: "Mein Layout", approved_sha256: null }]);
    const [profil] = await sql`select settings from letterhead_profiles where is_default`;
    expect(profil!.settings).toMatchObject({ accent: "#1F6FEB", layouts: { rechnung: { kind: "eigen", id: LAYOUT }, mahnung: { kind: "eingebaut" } } });
    const [anhang] = await sql`select filename, sha256 from quote_default_attachments`;
    expect(anhang!.filename).toBe("AGB.pdf");
    expect(new Uint8Array(await storage.loadFile(anhang!.sha256))).toEqual(PDF);
    const [mail] = await sql`select host, username, from_name, templates from mail_settings`;
    expect(mail).toEqual({
      host: "smtp.example.org",
      username: "versand@example.org",
      from_name: "Muster Design",
      templates: { "rechnung:de": { subject: "Rechnung {nummer}", body: "Hallo" } },
    });
  });

  it("übernimmt jedes eingebaute Layout aus dem Katalog samt Optionen (#113)", async () => {
    await testinstanz();
    const settings = {
      accent: "#1F6FEB",
      font: "layout",
      accentFromLayout: true,
      layouts: { rechnung: { kind: "eingebaut", id: "modern" } },
      layoutOptions: { modern: { akzent: "sparsam" } },
    };
    await sql`update letterhead_profiles set settings = ${JSON.stringify(settings)}::jsonb`;

    await instanzwechsel.importSettings(actor, await exportierenUndNeu(), HEUTE);

    const [profil] = await sql`select settings from letterhead_profiles where is_default`;
    expect(profil!.settings).toMatchObject({ ...settings, layouts: { rechnung: { kind: "eingebaut", id: "modern" } } });
  });

  it("liest eine Datei von vor Migration 0312 wie die Migration: bisheriges Layout, bisherige Schrift, eigene Farbe (#113)", async () => {
    await testinstanz();
    // So stand das Profil vor 0312 in der Datenbank: eingebaut hieß „klassisch“, Schrift und accentFromLayout fehlen
    const alt = {
      accent: "#1F6FEB",
      logoSize: "l",
      layouts: { rechnung: { kind: "eingebaut", id: "klassisch" }, mahnung: { kind: "eingebaut", id: "klassisch" } },
    };
    await sql`update letterhead_profiles set settings = ${JSON.stringify(alt)}::jsonb`;

    await instanzwechsel.importSettings(actor, await exportierenUndNeu(), HEUTE);

    const [profil] = await sql`select settings from letterhead_profiles where is_default`;
    expect(profil!.settings).toMatchObject({
      accent: "#1F6FEB",
      logoSize: "l",
      font: "plex-sans",
      accentFromLayout: false,
      layouts: { rechnung: { kind: "eingebaut", id: "klar" }, mahnung: { kind: "eingebaut", id: "klar" } },
      layoutOptions: { klar: { fassung: "klassisch" } },
    });
  });

  it("übernimmt ein Layout mit Paketen als freigegeben, geladen werden sie erst auf Klick; Pakete müssen zum Quelltext passen", async () => {
    await testinstanz();
    const source = `#import "@preview/cetz:0.3.4": canvas\n${startvorlage("beleg")}`;
    const cetz = [{ name: "@preview/cetz", version: "0.3.4" }];
    await sql`update beleg_layouts set source = ${source}, packages = ${JSON.stringify(cetz)}::jsonb where id = ${LAYOUT}`;
    await instanzwechsel.importSettings(actor, await exportierenUndNeu(), HEUTE);

    const [layout] = await sql`select packages, sha256, approved_sha256 from beleg_layouts`;
    expect(layout).toEqual({ packages: cetz, sha256: createHash("sha256").update(source).digest("hex"), approved_sha256: layout!.sha256 });

    await neuBeginnen();
    await testinstanz();
    await sql`update beleg_layouts set source = ${source}, packages = '[]'::jsonb where id = ${LAYOUT}`;
    await expect(instanzwechsel.importSettings(actor, await exportierenUndNeu(), HEUTE)).rejects.toThrow(
      "Layout „Mein Layout“: Die Pakete passen nicht zum Quelltext.",
    );
  });

  it("setzt ein eigenes Layout ohne Pakete wie beim Hochladen zur Probe und lehnt eines ohne Pflichtangaben ab", async () => {
    await testinstanz();
    await sql`update beleg_layouts set source = '#let rechnung(daten) = [Rechnung]' where id = ${LAYOUT}`;

    await expect(instanzwechsel.importSettings(actor, await exportierenUndNeu(), HEUTE)).rejects.toThrow(
      /^Layout „Mein Layout“: Das Layout verwendet diese Pflichtfelder nicht/,
    );
    expect(await sql`select 1 from beleg_layouts`).toEqual([]);
  });

  it("lehnt ein Layout ab, das ein Paket nur im Kommentar nennt", async () => {
    await testinstanz();
    const cetz = [{ name: "@preview/cetz", version: "0.3.4" }];
    const source = "// @preview/cetz:0.3.4\n#let rechnung(daten) = [Rechnung]";
    await sql`update beleg_layouts set source = ${source}, packages = ${JSON.stringify(cetz)}::jsonb where id = ${LAYOUT}`;

    await expect(instanzwechsel.importSettings(actor, await exportierenUndNeu(), HEUTE)).rejects.toThrow();
    expect(await sql`select 1 from beleg_layouts`).toEqual([]);
  });

  it("gibt ein Layout nicht frei, das nur die Meldung eines fehlenden Pakets nachahmt", async () => {
    await testinstanz();
    const cetz = [{ name: "@preview/cetz", version: "0.3.4" }];
    // Kein #import: Typst lädt nichts, die Meldung kommt aus dem Layout selbst
    const source = `// @preview/cetz:0.3.4\n#panic("failed to download package")\n${startvorlage("beleg")}`;
    await sql`update beleg_layouts set source = ${source}, packages = ${JSON.stringify(cetz)}::jsonb where id = ${LAYOUT}`;

    await expect(instanzwechsel.importSettings(actor, await exportierenUndNeu(), HEUTE)).rejects.toThrow();
    expect(await sql`select 1 from beleg_layouts`).toEqual([]);
  });

  it("gibt ein Layout nicht frei, das ein anderes Paket lädt als die Datei nennt", async () => {
    await testinstanz();
    const cetz = [{ name: "@preview/cetz", version: "0.3.4" }];
    // cetz steht nur im Kommentar; den zusammengesetzten Namen sieht erst Typst beim Setzen
    const source = `// @preview/cetz:0.3.4\n#import "@preview/" + "tablex:0.0.8": tablex\n${startvorlage("beleg")}`;
    await sql`update beleg_layouts set source = ${source}, packages = ${JSON.stringify(cetz)}::jsonb where id = ${LAYOUT}`;

    await expect(instanzwechsel.importSettings(actor, await exportierenUndNeu(), HEUTE)).rejects.toThrow("@preview/tablex:0.0.8");
    expect(await sql`select 1 from beleg_layouts`).toEqual([]);
  });

  it("gibt ein Layout nicht frei, wenn nur die Paketliste das zusammengesetzt geladene Paket nennt", async () => {
    await testinstanz();
    // „Pakete neu laden“ lädt die Pakete aus dem Quelltext, nicht die Liste der Datei
    const liste = [
      { name: "@preview/cetz", version: "0.3.4" },
      { name: "@preview/tablex", version: "0.0.8" },
    ];
    const source = `// @preview/cetz:0.3.4\n#import "@preview/" + "tablex:0.0.8": tablex\n${startvorlage("beleg")}`;
    await sql`update beleg_layouts set source = ${source}, packages = ${JSON.stringify(liste)}::jsonb where id = ${LAYOUT}`;

    await expect(instanzwechsel.importSettings(actor, await exportierenUndNeu(), HEUTE)).rejects.toThrow("@preview/tablex:0.0.8");
    expect(await sql`select 1 from beleg_layouts`).toEqual([]);
  });

  it("gibt ein Layout frei, das ohne seine Pakete auch an einer Folge davon scheitert", async () => {
    await testinstanz();
    const cetz = [{ name: "@preview/cetz", version: "0.3.4" }];
    // Ohne cetz fehlt der Wert, den der zweite #context abfragt; Typst meldet dazu „array is empty“
    const source = `#context { import "@preview/cetz:0.3.4": canvas; [#metadata(1) <wert>] }\n#context query(<wert>).first().value\n${startvorlage("beleg")}`;
    await sql`update beleg_layouts set source = ${source}, packages = ${JSON.stringify(cetz)}::jsonb where id = ${LAYOUT}`;

    await instanzwechsel.importSettings(actor, await exportierenUndNeu(), HEUTE);

    const sha256 = createHash("sha256").update(source).digest("hex");
    expect(await sql`select packages, approved_sha256 from beleg_layouts`).toEqual([{ packages: cetz, approved_sha256: sha256 }]);
  });

  it("speichert ein Layout, das ohne seine Pakete setzt, wie eines ohne Pakete: geprüft und ohne Freigabe", async () => {
    await testinstanz();
    const cetz = [{ name: "@preview/cetz", version: "0.3.4" }];
    const source = `// Früher: #import "@preview/cetz:0.3.4": canvas\n${startvorlage("beleg")}`;
    await sql`update beleg_layouts set source = ${source}, packages = ${JSON.stringify(cetz)}::jsonb where id = ${LAYOUT}`;

    await instanzwechsel.importSettings(actor, await exportierenUndNeu(), HEUTE);

    expect(await sql`select packages, approved_sha256 from beleg_layouts`).toEqual([{ packages: [], approved_sha256: null }]);
  });

  it("lehnt ein Layout ab, dessen Quelltext kein Paket lädt, wenn die Datei trotzdem Pakete nennt", async () => {
    await testinstanz();
    // Die Liste in der Datei allein macht kein Layout mit Paketen: Ohne #import im Quelltext gäbe es nichts nachzuladen,
    // „Pakete neu laden“ prüfte es nie, es bliebe ohne Probesatz freigegeben und setzte trotzdem
    const cetz = [{ name: "@preview/cetz", version: "0.3.4" }];
    await sql`update beleg_layouts set source = '#let rechnung(daten) = [Rechnung]', packages = ${JSON.stringify(cetz)}::jsonb where id = ${LAYOUT}`;

    await expect(instanzwechsel.importSettings(actor, await exportierenUndNeu(), HEUTE)).rejects.toThrow(
      "Layout „Mein Layout“: Die Pakete passen nicht zum Quelltext.",
    );
    expect(await sql`select 1 from beleg_layouts`).toEqual([]);
  });

  it("schreibt jede Änderung mit der Person ins Änderungsprotokoll", async () => {
    await testinstanz();
    const text = await exportierenUndNeu();
    const vorher = (await sql`select coalesce(max(id), 0) as id from audit_log`)[0]!.id;

    await instanzwechsel.importSettings(actor, text, HEUTE);

    const eintraege = await sql`select distinct actor, table_name from audit_log where id > ${vorher} and table_name in ('company', 'contacts', 'articles')`;
    expect(eintraege.map((e) => e.table_name).sort()).toEqual(["articles", "company", "contacts"]);
    expect(new Set(eintraege.map((e) => e.actor))).toEqual(new Set([actor]));
  });

  it("legt ohne eingerichteten Versand keine E-Mail-Einstellungen an und sagt es", async () => {
    await testinstanz();
    const text = await exportierenUndNeu();

    expect((await instanzwechsel.importSettings(actor, text, HEUTE)).mail).toBe(false);
    expect(await sql`select id from mail_settings`).toEqual([]);
  });

  it("lässt offene Fragen offen, wenn die Firmendaten in der alten Instanz nie bewusst gespeichert wurden", async () => {
    await testinstanz();
    await sql`update company set firmendaten_gespeichert_at = null`;
    await sql`update einrichtung set offen = '["kleinunternehmer"]'::jsonb`;

    await instanzwechsel.importSettings(actor, await exportierenUndNeu(), HEUTE);

    expect((await sql`select offen from einrichtung`)[0]!.offen).toEqual(["kleinunternehmer"]);
    expect((await sql`select firmendaten_gespeichert_at from company`)[0]!.firmendaten_gespeichert_at).toBeNull();
  });

  it("gibt einem Kunden ohne Kundennummer keine neue und lässt den Zähler stehen", async () => {
    await testinstanz();
    await sql`insert into contacts(name) values ('Ohne Nummer GmbH')`;

    await instanzwechsel.importSettings(actor, await exportierenUndNeu(), HEUTE);

    expect((await sql`select kundennummer from contacts where name = 'Ohne Nummer GmbH'`)[0]!.kundennummer).toBeNull();
    expect((await sql`select customer_number_next from company`)[0]!.customer_number_next).toBe(42);
  });

  it("meldet ungültige Werte auf Deutsch", async () => {
    await testinstanz();
    await sql`update contacts set language = 'xx' where id = ${KUNDE}`;

    await expect(instanzwechsel.importSettings(actor, await exportierenUndNeu(), HEUTE)).rejects.toThrow(
      /^Kontakt „Nordwerk GmbH“ \(language\): Ungültige Option/,
    );
  });

  it("hält beim Übernehmen die Höchstzahl eigener Layouts des Betreibers ein (LAYOUTS_MAX_COUNT)", async () => {
    const layouts = await import("../stammdaten/layout-uebernahme.ts");
    const { withActor } = await import("../../db/actor.ts");
    const layout = (id: string, name: string) => ({ id, name, art: "beleg" as const, source: startvorlage("beleg"), schemaVersion: 1, packages: [] });

    await expect(
      withActor(actor, async (tx) => {
        await layouts.insertImportedLayout(tx, layout(LAYOUT, "Eins"), { maxCount: 1 });
        await layouts.insertImportedLayout(tx, layout(KUNDE, "Zwei"), { maxCount: 1 });
      }),
    ).rejects.toThrow(/mehr erlaubt diese Installation nicht/);
  });

  it("lehnt eine Instanz ab, in der schon Stammdaten oder Belege angelegt sind, und ändert nichts", async () => {
    await testinstanz();
    const text = await exportierenUndNeu();
    await sql`insert into company(id, name) values (1, 'Neue Firma')`;
    await sql`insert into contacts(name) values ('Schon da GmbH')`;

    await expect(instanzwechsel.importSettings(actor, text, HEUTE)).rejects.toThrow(
      "Einstellungen lassen sich nur in eine neue Instanz übernehmen. Hier gibt es schon Kontakte.",
    );
    expect((await sql`select name from company`)[0]!.name).toBe("Neue Firma");
    expect(await sql`select name from contacts`).toEqual([{ name: "Schon da GmbH" }]);
  });

  it("übernimmt alles oder nichts und nennt den Eintrag, der nicht passt", async () => {
    await testinstanz();
    await sql`update contacts set email = 'keine-adresse' where id = ${KUNDE}`;
    const text = await exportierenUndNeu();

    await expect(instanzwechsel.importSettings(actor, text, HEUTE)).rejects.toThrow(/^Kontakt „Nordwerk GmbH“ \(email\): Keine gültige E-Mail-Adresse/);
    for (const tabelle of ["company", "contacts", "units", "articles", "company_logo", "beleg_layouts"])
      expect(await sql`select 1 from ${sql(tabelle)}`, tabelle).toEqual([]);
  });

  it("lehnt ein verändertes oder beschädigtes ZIP ab, bevor es etwas schreibt", async () => {
    await testinstanz();
    const zip = await exportierenUndNeu();
    const dateien = unzipSync(zip);

    const geaendert = einstellungen(zip);
    geaendert.company.iban = "DE02120300000000202051";
    await expect(
      instanzwechsel.importSettings(actor, neuGepackt(dateien, { "einstellungen.json": strToU8(JSON.stringify(geaendert)) }), HEUTE),
    ).rejects.toThrow(/Prüfsumme stimmt nicht/);
    await expect(instanzwechsel.importSettings(actor, neuGepackt(dateien, { "logo.png": PNG.subarray(0, 20) }), HEUTE)).rejects.toThrow(
      "Logo: logo.png fehlt im ZIP oder passt nicht zur Prüfsumme.",
    );
    await expect(instanzwechsel.importSettings(actor, zip.subarray(0, Math.floor(zip.length / 2)), HEUTE)).rejects.toThrow(/keine ZIP-Datei oder beschädigt/);

    expect(await sql`select 1 from company`).toEqual([]);
  });

  it("entpackt nur bis zur Grenze, ein ZIP mit riesigem Inhalt bricht ab (Zip-Bombe)", async () => {
    const { readSettingsZip } = await import("./lesen.ts");
    const bombe = zipSync({ "einstellungen.json": new Uint8Array(2 * 1024 * 1024) });

    expect(bombe.length).toBeLessThan(20_000);
    expect(() => readSettingsZip(bombe, { maxEntries: 20, maxUnpackedBytes: 1024 * 1024 })).toThrow(/entpackt größer/);
    const viele = zipSync(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`${i}.txt`, strToU8("x")])));
    expect(() => readSettingsZip(viele, { maxEntries: 20, maxUnpackedBytes: 1024 * 1024 })).toThrow(/mehr als 20 Einträge/);
  });

  it("übernimmt das ZIP auch, wenn Safari es entpackt und der Finder den Ordner wieder gepackt hat", async () => {
    await testinstanz();
    // Zehn Standardanhänge, so viele, wie es geben kann: Mit den Attributen unter __MACOSX/ hat das ZIP fast doppelt so viele Einträge
    for (let i = 2; i <= 10; i++) {
      const pdf = new TextEncoder().encode(`%PDF-1.7\nAnhang ${i}\n%%EOF\n`);
      await sql`insert into quote_default_attachments(filename, mime_type, sha256, size) values (${`Anhang ${i}.pdf`}, 'application/pdf', ${await storage.storeFile(pdf)}, ${pdf.length})`;
    }
    const zip = await exportierenUndNeu();

    await instanzwechsel.importSettings(actor, vomFinderNeuGepackt(zip, "Haben-Einstellungen-2026-12-20"), HEUTE);

    expect((await sql`select name from company`)[0]!.name).toBe("Muster Design");
    expect((await sql`select logo from company_logo`)[0]!.logo).toEqual(Buffer.from(PNG));
    expect(await sql`select count(*)::int as anzahl from quote_default_attachments`).toEqual([{ anzahl: 10 }]);
  });

  it("übernimmt einen Textbaustein, dessen Kontakt inzwischen kein Kunde mehr ist", async () => {
    await testinstanz();
    // Erlaubt in der alten Instanz: updateTextBlock lässt den Kontakt am Baustein, auch wenn er nur noch Lieferant ist
    await sql`update contacts set is_customer = false, is_supplier = true where id = ${KUNDE}`;

    await instanzwechsel.importSettings(actor, await exportierenUndNeu(), HEUTE);

    expect(await sql`select name, contact_id from text_blocks`).toEqual([{ name: "Rahmenvertrag", contact_id: KUNDE }]);
  });

  it("lässt bei Microsoft Graph ohne eigenes Postfach das Postfach des Versands, wie es war", async () => {
    await testinstanz();
    const text = await exportierenUndNeu();
    await sql`insert into mail_settings(id, transport, graph_tenant_id, graph_client_id, graph_auth, ciphertext, from_address, reminder_to)
      values (1, 'graph', 'firma.onmicrosoft.com', '0b6a1c1e-5d7e-4f0a-9a43-1f2d3c4b5a61', 'secret', ${Buffer.from("x")}, 'versand@echt.example', 'erika@echt.example')`;

    expect((await instanzwechsel.importSettings(actor, text, HEUTE)).mail).toBe(true);

    // Aus diesem Postfach sendet Graph (transport-graph.ts: graphMailbox || fromAddress); es gehört zum Zugang
    const [mail] = await sql`select graph_mailbox, from_address from mail_settings`;
    expect(mail!.graph_mailbox ?? mail!.from_address).toBe("versand@echt.example");
  });

  it("übernimmt den Voranmeldungszeitraum, nach dem die Einrichtung in der alten Instanz gefragt hat", async () => {
    await testinstanz();
    // Antwort „vierteljährlich“ auf die Frage zur Voranmeldung: einrichtungSpeichern schreibt sie in vat_frequencies
    await sql`insert into vat_frequencies(year, from_month, frequency) values (2026, 1, 'vierteljaehrlich')`;
    const text = await exportierenUndNeu();
    await leeren(sql)`truncate vat_frequencies`;

    await instanzwechsel.importSettings(actor, text, HEUTE);

    // Die neue Instanz fragt danach nicht mehr (Firmenname und fragenAt aus der Datei, fragenFehlen in lib/einrichtung.ts)
    const { einrichtungStand } = await import("../auswertungen/index.ts");
    expect((await einrichtungStand(HEUTE)).stand.voranmeldung).toBe("vierteljaehrlich");
  });

  it("lehnt eine fremde Datei und eine aus einer neueren Version ab", async () => {
    await expect(instanzwechsel.importSettings(actor, strToU8(JSON.stringify({ name: "Kontakte" })), HEUTE)).rejects.toThrow(/keine ZIP-Datei/);
    await expect(instanzwechsel.importSettings(actor, zipSync({ "kontakte.csv": strToU8("Name\n") }), HEUTE)).rejects.toThrow(
      "Das ist keine Einstellungsdatei von Haben: Im ZIP fehlt einstellungen.json.",
    );
    const neuer = zipSync({ "einstellungen.json": strToU8(JSON.stringify({ format: "haben-einstellungen", version: 2 })) });
    await expect(instanzwechsel.importSettings(actor, neuer, HEUTE)).rejects.toThrow(/neueren Version von Haben/);
  });
});
