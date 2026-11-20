import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Werkzeug ustid_bestaetigungen (#1492): zeigt die gespeicherten Antworten des BZSt je Nummer, ohne die gesendete Anschrift,
 * und nennt ohne Eingabe die Nummern der nächsten ZM ohne frische gültige Antwort. Es fragt nie beim BZSt.
 */

describe.skipIf(!testDatabaseUrl)("MCP-Werkzeug ustid_bestaetigungen (Postgres)", () => {
  let sql: postgres.Sql;
  let tools: typeof import("./tools.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  const actor = "test-user";
  const ids: Record<string, string> = {};
  const fetchAufrufe = vi.fn(() => {
    throw new Error("Das Werkzeug darf das BZSt nicht fragen");
  });

  const run = (args: Record<string, unknown> = {}) =>
    tools.MCP_TOOLS.find((t) => t.name === "ustid_bestaetigungen")!.run(args, tools.todayContext()) as Promise<Record<string, unknown>>;

  async function kunde(name: string, ustId: string, ort: string, land: string, kundennummer: string) {
    const contact = await contacts.createContact(actor, {
      kundennummer,
      name,
      strasse: "Hauptstraße 1",
      plz: "1020",
      ort,
      land,
      email: "einkauf@kunde.example",
      ustId,
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate: "2026-08-10",
      serviceFrom: "2026-08-10",
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      taxTreatment: "reverse_charge",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Stk." as const, unitPrice: 100_000, taxRate: 0 }],
    });
    await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    return contact.id;
  }

  beforeAll(async () => {
    sql = await setupTestDb();
    tools = await import("./tools.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    await leeren(sql)`truncate ustid_bestaetigungen, journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, vat_returns, zm_submissions, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010', 'DE136695976', 'BY',
              'DE89370400440532013000', 'ist', 'SKR04')`;
    ids.donau = await kunde("Donaublick GmbH", "ATU12345678", "Wien", "AT", "K-1001");
    ids.seine = await kunde("Seine SARL", "FR12345678901", "Paris", "FR", "K-1002");
    // Donaublick: früher einfach unter einer alten Nummer, heute qualifiziert bestätigt, der Ort passt nicht
    await sql`insert into ustid_bestaetigungen (contact_id, art, anfragende_ustid, angefragte_ustid, status, anfrage_zeitpunkt, antwort, created_by)
      values (${ids.donau!}, 'einfach', 'DE136695976', 'ATU99999999', 'evatr-2006', now() - interval '400 days', '{}', ${actor})`;
    await sql`insert into ustid_bestaetigungen (contact_id, art, anfragende_ustid, angefragte_ustid, status, anfrage_zeitpunkt, antwort, created_by)
      values (${ids.donau!}, 'einfach', 'DE136695976', 'ATU12345678', 'evatr-0000', now() - interval '1 minute', '{}', ${actor})`;
    await sql`insert into ustid_bestaetigungen (contact_id, art, anfragende_ustid, angefragte_ustid, firmenname, strasse, plz, ort, status,
        anfrage_zeitpunkt, erg_firmenname, erg_strasse, erg_plz, erg_ort, bzst_id, antwort, created_by)
      values (${ids.donau!}, 'qualifiziert', 'DE136695976', 'ATU12345678', 'Donaublick GmbH', 'Hauptstraße 1', '1020', 'Wien', 'evatr-0000',
        now(), 'A', 'D', 'C', 'B', 'b1', '{"geheim":"Rohdatensatz"}', ${actor})`;
    // Seine: zuletzt vor 40 Tagen gültig, also nicht mehr frisch
    await sql`insert into ustid_bestaetigungen (contact_id, art, anfragende_ustid, angefragte_ustid, status, anfrage_zeitpunkt, antwort, created_by)
      values (${ids.seine!}, 'einfach', 'DE136695976', 'FR12345678901', 'evatr-0000', now() - interval '40 days', '{}', ${actor})`;
    vi.stubGlobal("fetch", fetchAufrufe);
  }, 60_000);

  afterEach(() => {
    delete process.env.HABEN_EVATR;
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await sql?.end();
  });

  it("liefert zu einem Kontakt je Nummer die letzte Antwort mit Ergebnis je Angabe, ohne die gesendete Anschrift", async () => {
    const ergebnis = await run({ kontakt: "K-1001" });
    expect(ergebnis).toMatchObject({ anzahl: 1, kontakte: [{ name: "Donaublick GmbH", kundennummer: "K-1001", archiviert: false }] });
    const [kontakt] = ergebnis.kontakte as { nummern: unknown[]; link: string }[];
    expect(kontakt!.link).toMatch(new RegExp(`/kontakte/${ids.donau}$`));
    expect(kontakt!.nummern).toEqual([
      {
        ustId: "ATU12345678",
        aktuell: true,
        letzteAntwort: {
          zeitpunkt: expect.any(Date),
          art: "qualifiziert",
          status: "evatr-0000",
          meldung: "Gültig",
          gueltig: true,
          frisch: true,
          ergebnis: { name: "Stimmt", strasse: "Nicht mitgeteilt", plz: "Nicht angefragt", ort: "Stimmt nicht" },
        },
      },
      {
        ustId: "ATU99999999",
        aktuell: false,
        letzteAntwort: expect.objectContaining({ art: "einfach", status: "evatr-2006", gueltig: false, frisch: false }),
      },
    ]);
    const text = JSON.stringify(ergebnis);
    expect(text).not.toMatch(/Hauptstraße|Rohdatensatz|1020/);
  });

  it("findet den Kontakt auch über den Namen; ohne Antwort „noch nicht bestätigt“, eine deutsche Nummer mit Hinweis", async () => {
    expect(await run({ kontakt: "seine" })).toMatchObject({ anzahl: 1, kontakte: [{ name: "Seine SARL" }] });
    await sql`insert into contacts (name, ust_id, land) values ('Neukunde BV', 'NL123456789B01', 'NL')`;
    expect(await run({ kontakt: "Neukunde" })).toMatchObject({
      kontakte: [{ name: "Neukunde BV", nummern: [{ ustId: "NL123456789B01", aktuell: true, letzteAntwort: "noch nicht bestätigt" }] }],
    });
    // Bestätigt werden nur Nummern anderer Mitgliedstaaten (UStAE 18e.1 Abs. 3 Satz 1); „noch nicht“ hieße, es stünde noch aus
    await sql`insert into contacts (name, ust_id, land) values ('Inlandskunde GmbH', 'DE123456789', 'DE')`;
    const inland = (await run({ kontakt: "Inlandskunde" })) as { kontakte: { nummern: unknown[] }[] };
    expect(inland.kontakte[0]!.nummern).toEqual([{ ustId: "DE123456789", aktuell: true, hinweis: expect.stringContaining("anderen EU-Mitgliedstaats") }]);
  });

  it("liefert zu einer Nummer die letzte Antwort, gleich an welchem Kontakt", async () => {
    expect(await run({ ustid: "fr 12345678901" })).toMatchObject({
      ustId: "FR12345678901",
      letzteAntwort: { art: "einfach", gueltig: true, frisch: false },
      kontakt: expect.stringMatching(new RegExp(`/kontakte/${ids.seine}$`)),
    });
    expect(await run({ ustid: "NL123456789B01" })).toMatchObject({
      letzteAntwort: "noch nicht bestätigt",
      kontakteMitDieserNummer: [{ name: "Neukunde BV" }],
    });
    expect(await run({ ustid: "DE136695976" })).toEqual({ ustId: "DE136695976", hinweis: expect.stringContaining("anderen EU-Mitgliedstaats") });
  });

  it("findet ohne Antwort auch Kontakte, deren Nummer mit Punkten oder GR gespeichert ist", async () => {
    // Der Kontakt speichert die Nummer, wie sie eingegeben wurde (Punkte und GR erlaubt); gefragt und gemeldet wird sie normalisiert
    await sql`insert into contacts (name, ust_id, land) values ('Brüssel BV', 'BE0123.456.789', 'BE'), ('Athen AE', 'GR123456789', 'GR')`;
    expect(await run({ ustid: "BE0123.456.789" })).toMatchObject({
      ustId: "BE0123456789",
      letzteAntwort: "noch nicht bestätigt",
      kontakteMitDieserNummer: [{ name: "Brüssel BV" }],
    });
    expect(await run({ ustid: "GR123456789" })).toMatchObject({
      ustId: "EL123456789",
      letzteAntwort: "noch nicht bestätigt",
      kontakteMitDieserNummer: [{ name: "Athen AE" }],
    });
  });

  it("nennt ohne Eingabe die Nummern der nächsten ZM ohne frische gültige Antwort", async () => {
    const ergebnis = await run();
    expect(ergebnis.zm).toMatchObject({ quartal: "2026-Q3", berichtigung: false, nummern: 2 });
    expect(ergebnis.ohneFrischeGueltigeAntwort).toEqual([
      { ustId: "FR12345678901", kunde: "Seine SARL", letzteAntwort: expect.objectContaining({ gueltig: true, frisch: false }) },
    ]);
    expect(await run({ quartal: "2026-Q2" })).toMatchObject({ zm: { quartal: "2026-Q2", nummern: 0 }, ohneFrischeGueltigeAntwort: [] });
  });

  it("sagt abgeschaltet, dass die Bestätigung aus ist, und zeigt die Antworten weiter", async () => {
    process.env.HABEN_EVATR = "off";
    expect(await run({ ustid: "ATU12345678" })).toMatchObject({
      abgeschaltet: expect.stringContaining("HABEN_EVATR=off"),
      letzteAntwort: { art: "qualifiziert", gueltig: true },
    });
  });

  it("hat in keinem Aufruf beim BZSt gefragt", () => {
    expect(fetchAufrufe).not.toHaveBeenCalled();
  });
});
