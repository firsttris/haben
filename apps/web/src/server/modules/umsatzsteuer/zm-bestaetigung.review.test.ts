import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { evatrDienst as dienst, evatrFehler as fehler, evatrOk as ok } from "../../test-evatr.ts";

/*
 * Review zu #1458 (Bestätigung beim BZSt in der Zusammenfassenden Meldung, #1385). Zwei Kunden mit Reverse Charge im
 * 3. Quartal 2026: Wien (ATU12345678) und Paris (FR12345678901).
 */

describe.skipIf(!testDatabaseUrl)("Review #1458: ZM-Knopf „Beim BZSt bestätigen“ (Postgres)", () => {
  let sql: postgres.Sql;
  let zm: typeof import("./zm.ts");
  let bestaetigung: typeof import("./zm-bestaetigung.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  const actor = "test-user";
  const q3 = { year: 2026, month: 43 };
  let rechnungWien: string;
  let rechnungParis: string;
  const jetzt = () => new Date().toISOString();

  const kunde = (name: string, ort: string, land: string, ustId: string) =>
    contacts.createContact(actor, {
      kundennummer: "",
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

  const rechnung = async (contactId: string, issueDate: string) => {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: issueDate,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      taxTreatment: "reverse_charge",
      lines: [{ description: "Beratung", quantity: 1000, unit: "Stk." as const, unitPrice: 100_000, taxRate: 0 }],
    });
    return (await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand)).id;
  };

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
    rechnungWien = await rechnung((await kunde("Donaublick GmbH", "Wien", "AT", "ATU12345678")).id, "2026-08-10");
    rechnungParis = await rechnung((await kunde("Seine Conseil SARL", "Paris", "FR", "FR12345678901")).id, "2026-08-12");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  beforeEach(async () => {
    await leeren(sql)`truncate ustid_bestaetigungen`;
  });

  it("A: eine Nummer, die das BZSt für syntaktisch falsch hält (evatr-0012), hält die übrigen nicht auf", async () => {
    // Haben prüft bei fremden Nummern keine Prüfziffer (zm.ts, AUFBAU); ein Tippfehler in der Prüfziffer besteht
    // evatrPruefbar, und das BZSt antwortet evatr-0012 „passt nicht in das Erzeugungsschema“. Das ist kein Ausfall.
    const quellen = [
      { invoiceId: rechnungWien, ustId: "ATU12345678" },
      { invoiceId: rechnungParis, ustId: "FR12345678901" },
    ];
    const { via, anfragen } = dienst(fehler(400, "evatr-0012", jetzt()), ok("fr", undefined, jetzt()));
    const meldung = { quellen, naechste: { zeilen: quellen.map((quelle) => ({ ustId: quelle.ustId, betrag: 100 })) } };
    const ergebnis = await bestaetigung.bestaetigeZmNummern(actor, meldung, { via });
    expect(anfragen.map((a) => a.angefragteUstid)).toEqual(["ATU12345678", "FR12345678901"]);
    expect(ergebnis.hinweise.join(" ")).not.toContain("nicht angefragt");
  });

  it("B: der Knopf fragt nur, was die Karte als offen zählt, nicht eine im Quartal stornierte Rechnung", async () => {
    // Storno der Rechnung nach Paris im selben Quartal: FR hebt sich auf und steht nicht in der Meldung
    await invoices.cancelInvoice(actor, rechnungParis, "2026-08-20");
    const overview = await zm.zmOverview(q3);
    expect(overview.zeilen.map((z) => z.ustId)).toEqual(["ATU12345678"]);
    expect(overview.bestaetigung).toEqual({ moeglich: true, offen: 1 });

    // Wie bestaetigeZmNummernFn (server/functions/zm.ts): bestaetigeZmNummern(context.user.id, await zmOverview(period))
    const { via, anfragen } = dienst(ok("a", undefined, jetzt()), ok("b", undefined, jetzt()));
    const ergebnis = await bestaetigung.bestaetigeZmNummern(actor, overview, { via });
    expect(anfragen.map((a) => a.angefragteUstid)).toEqual(["ATU12345678"]);
    expect(ergebnis.gefragt).toBe(overview.bestaetigung.offen);
  });
});
