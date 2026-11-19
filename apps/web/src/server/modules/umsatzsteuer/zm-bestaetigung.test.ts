import type postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { evatrDienst as dienst, evatrFehler as fehler, evatrOk as ok } from "../../test-evatr.ts";

/*
 * Vorprüfung der Zusammenfassenden Meldung mit der Bestätigung beim BZSt (#1385): jede gemeldete Nummer ohne Antwort oder
 * mit einer Antwort ungleich evatr-0000 steht als Hinweis da; der Knopf fragt einfach und speichert am Kontakt der Rechnung.
 */

describe.skipIf(!testDatabaseUrl)("ZM: gemeldete USt-IdNrn. beim BZSt bestätigen (Postgres)", () => {
  let sql: postgres.Sql;
  let zm: typeof import("./zm.ts");
  let bestaetigung: typeof import("./zm-bestaetigung.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  const actor = "test-user";
  const q3 = { year: 2026, month: 43 };
  let contactId: string;
  // Zeitpunkt der Antworten: jetzt, damit „frisch“ nicht vom Tag des Testlaufs abhängt
  const jetzt = () => new Date().toISOString();

  beforeAll(async () => {
    sql = await setupTestDb();
    zm = await import("./zm.ts");
    bestaetigung = await import("./zm-bestaetigung.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    await leeren(sql)`truncate ustid_bestaetigungen, journal_lines, journal_entries, invoice_lines, invoices, invoice_number_counters,
      contact_versions, contacts, vat_returns, zm_submissions, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010', 'DE136695976', 'BY',
              'DE89370400440532013000', 'soll', 'SKR03')`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Donaublick GmbH",
      strasse: "Praterstraße 3",
      plz: "1020",
      ort: "Wien",
      land: "AT",
      email: "einkauf@kunde.example",
      ustId: "ATU12345678",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = contact.id;
    const draft = await invoices.createDraft(actor, {
      contactId,
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
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  afterEach(() => {
    delete process.env.HABEN_EVATR;
  });

  const bestaetigungsHinweise = async () => (await zm.zmOverview(q3)).issues.filter((i) => i.text.startsWith("ATU12345678:"));

  it("nennt die nie bestätigte Nummer, fragt sie einfach ab und nennt eine ungültige mit Meldung", async () => {
    const vorher = await zm.zmOverview(q3);
    expect(vorher.bestaetigung).toEqual({ moeglich: true, offen: 1 });
    expect(await bestaetigungsHinweise()).toEqual([{ tone: "warn", text: "ATU12345678: beim BZSt noch nicht bestätigt." }]);

    const { via, anfragen } = dienst(fehler(404, "evatr-2001", jetzt()));
    expect(await bestaetigung.bestaetigeZmNummern(actor, vorher, { via })).toEqual({ gefragt: 1, hinweise: [] });
    expect(anfragen).toEqual([{ anfragendeUstid: "DE136695976", angefragteUstid: "ATU12345678" }]);
    const [zeile] = await sql`select contact_id, art, status from ustid_bestaetigungen`;
    expect(zeile).toMatchObject({ contact_id: contactId, art: "einfach", status: "evatr-2001" });
    expect((await bestaetigungsHinweise())[0]?.text).toMatch(/^ATU12345678: am \d\d\.\d\d\.\d{4} laut BZSt „Nicht vergeben“ \(evatr-2001\)\.$/);
  });

  it("nach einer gültigen Antwort kein Hinweis und keine weitere Abfrage", async () => {
    const meldung = await zm.zmOverview(q3);
    expect(await bestaetigung.bestaetigeZmNummern(actor, meldung, { via: dienst(ok("zm", undefined, jetzt())).via })).toEqual({ gefragt: 1, hinweise: [] });
    expect(await bestaetigungsHinweise()).toEqual([]);
    expect((await zm.zmOverview(q3)).bestaetigung).toEqual({ moeglich: true, offen: 0 });
    // Der Dienst hätte keine Antwort mehr
    expect(await bestaetigung.bestaetigeZmNummern(actor, meldung, { via: dienst().via })).toEqual({ gefragt: 0, hinweise: [] });
  });

  it("evatr-2008 ist gültig: nur ein Hinweis zur Besonderheit, keine Warnung", () => {
    const letzte = new Map([["ATU12345678", { status: "evatr-2008", anfrageZeitpunkt: new Date(), gueltigAb: null, gueltigBis: null }]]);
    expect(bestaetigung.zmBestaetigungIssues(["ATU12345678"], letzte)).toEqual([{ tone: "info", text: expect.stringContaining("Besonderheit") }]);
  });

  it("nach einem Ausfall fragt der Knopf die übrigen Nummern nicht mehr", async () => {
    const invoiceId = (await zm.zmOverview(q3)).quellen[0]!.invoiceId;
    const quellen = [
      { invoiceId, ustId: "ATU12345678" },
      { invoiceId, ustId: "FR12345678901" },
    ];
    const meldung = { quellen, naechste: { zeilen: quellen.map((quelle) => ({ ustId: quelle.ustId, betrag: 100 })) } };
    const spaeter = new Date(Date.now() + 31 * 86_400_000);
    const { via, anfragen } = dienst("kein-netz", ok("fr"));
    const ergebnis = await bestaetigung.bestaetigeZmNummern(actor, meldung, { jetzt: spaeter, via });
    expect(anfragen).toHaveLength(1);
    expect(ergebnis.gefragt).toBe(1);
    expect(ergebnis.hinweise).toEqual([expect.stringContaining("Keine Antwort vom BZSt"), "FR12345678901 nicht angefragt; versuch es später noch einmal."]);
  });

  it("ein Ausfall kommt als Hinweis zurück; abgeschaltet bleibt die Vorprüfung wie vorher", async () => {
    const meldung = await zm.zmOverview(q3);
    const spaeter = new Date(Date.now() + 31 * 86_400_000);
    const ausfall = await bestaetigung.bestaetigeZmNummern(actor, meldung, { jetzt: spaeter, via: dienst(fehler(503, "evatr-1001")).via });
    expect(ausfall.gefragt).toBe(1);
    expect(ausfall.hinweise[0]).toMatch(/^ATU12345678: .*evatr-1001/);

    process.env.HABEN_EVATR = "off";
    await sql`insert into ustid_bestaetigungen (contact_id, art, anfragende_ustid, angefragte_ustid, status, anfrage_zeitpunkt, antwort, created_by)
      values (${contactId}, 'einfach', 'DE136695976', 'ATU12345678', 'evatr-2001', now(), '{}', 'test-user')`;
    const aus = await zm.zmOverview(q3);
    expect(aus.bestaetigung).toEqual({ moeglich: false, offen: 0 });
    expect(aus.issues.some((i) => i.text.startsWith("ATU12345678:"))).toBe(false);
  });

  it("ein gesendetes Quartal ohne Berichtigung fragt nichts mehr: eine Bestätigung von heute belegt die Vergangenheit nicht", async () => {
    const zeilen = (await zm.zmOverview(q3)).zeilen;
    await sql`insert into zm_submissions (year, month, berichtigt, zeilen, kind, ok, code, message, request_xml, response_xml, server_response_xml)
      values (2026, 43, false, ${JSON.stringify(zeilen)}::jsonb, 'send', true, 0, 'ok', '', '', '')`;
    const gesendet = await zm.zmOverview(q3);
    expect(gesendet.naechste.zeilen).toEqual([]);
    expect(gesendet.bestaetigung).toEqual({ moeglich: false, offen: 0 });
    expect(gesendet.issues.some((i) => i.text.startsWith("ATU12345678:"))).toBe(false);
  });
});
