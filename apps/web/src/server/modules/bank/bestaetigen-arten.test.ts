import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

/*
 * Vorschläge bestätigen (#1440), die übrigen Wege: Rechnung, Beleg und die einfachen Arten buchen beim Bestätigen
 * dasselbe wie das Zuordnen von Hand, in beiden Kontenrahmen und bei Soll- und Ist-Versteuerung.
 */

const COMPANY_IBAN = "DE89370400440532013000";
const CUSTOMER_IBAN = "DE02100100100006820101";

type Zeile = [date: string, name: string, purpose: string, amount: string];

function dkbCsv(rows: Zeile[]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows
    .map(([date, name, purpose, amount]) =>
      [
        date,
        date,
        "Gebucht",
        amount.startsWith("-") ? "Testfirma" : name,
        amount.startsWith("-") ? name : "Testfirma",
        purpose,
        amount.startsWith("-") ? "Ausgang" : "Eingang",
        CUSTOMER_IBAN,
        amount,
        "",
        "",
        "",
      ]
        .map((c) => `"${c}"`)
        .join(";"),
    )
    .join("\n");
  return { bytes: new TextEncoder().encode(`﻿${header}${columns}${body}\n`), filename: "auszug.csv" };
}

const VARIANTEN = [
  ["SKR03", "soll"],
  ["SKR04", "ist"],
] as const;

describe.skipIf(!testDatabaseUrl)("Vorschläge bestätigen: Rechnung, Beleg, einfache Arten (Postgres)", () => {
  let bank: typeof import("./index.ts");
  let bestaetigen: typeof import("./bestaetigen.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let folge = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    bestaetigen = await import("./bestaetigen.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma(kontenrahmen: string, versteuerung: string) {
    await leeren(sql)`truncate write_offs, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, documents, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen,
                                   payment_term_days, rechtsform, kleinunternehmer)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', ${COMPANY_IBAN}, ${versteuerung}, ${kontenrahmen}, 14, 'einzelunternehmen', false)`;
  }

  const idVon = async (purpose: string) => (await sql<{ id: string }[]>`select id from bank_transactions where purpose = ${purpose}`)[0]!.id;
  const alleBuchungen = async () => new Set((await sql<{ id: string }[]>`select id from journal_entries`).map((r) => r.id));
  async function neueZeilen(vorher: Set<string>) {
    const rows = await sql<{ id: string; zeilen: string }[]>`
      select e.id, string_agg(l.account || ':' || l.debit || ':' || l.credit, ' ' order by l.account, l.debit, l.credit) as zeilen
        from journal_entries e join journal_lines l on l.entry_id = e.id where e.source_type = 'allocation' group by e.id`;
    return rows.filter((r) => !vorher.has(r.id)).map((r) => r.zeilen);
  }
  async function vorschlag(purpose: string) {
    const konten = await bank.listAccounts();
    const rows = await bank.listTransactions(
      konten.map((k) => k.id),
      "offen",
      "",
    );
    const { mitHinweisen } = await import("./umsatzauswahl.ts");
    const mit = await mitHinweisen(rows, await bank.openItems(), await bank.ownAccounts(), konten);
    return mit.find((r) => r.purpose === purpose)?.bestaetigung ?? null;
  }

  /** Bestätigen bucht, danach dasselbe von Hand: beide Buchungen müssen übereinstimmen */
  async function gegenProbe(bestaetigt: string, vonHand: () => Promise<void>) {
    const vorher = await alleBuchungen();
    await bestaetigen.bestaetigeVorschlaege(actor, [await idVon(bestaetigt)]);
    const a = await neueZeilen(vorher);
    const dazwischen = await alleBuchungen();
    await vonHand();
    const b = await neueZeilen(dazwischen);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  }

  it.each(VARIANTEN)("Rechnung bestätigen bucht wie Zuordnen von Hand (%s, %s-Versteuerung)", async (kontenrahmen, versteuerung) => {
    await firma(kontenrahmen, versteuerung);
    const kunde = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "buchhaltung@nordwerk.example",
      ustId: "",
      iban: CUSTOMER_IBAN,
      leitwegId: "",
      defaultFormat: null,
    });
    const rechnung = async () => {
      const defaults = await invoices.newDraftDefaults("2026-09-25");
      const draft = await invoices.createDraft(actor, {
        ...defaults,
        contactId: kunde.id,
        format: "zugferd",
        lines: [{ description: "Leistungen September", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
      });
      return invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    };
    const eins = await rechnung();
    const zwei = await rechnung();
    await bank.importStatement(
      actor,
      dkbCsv([
        ["03.10.26", "Nordwerk Software GmbH", `RE ${eins.number}`, "1.190,00"],
        ["04.10.26", "Nordwerk Software GmbH", `RE ${zwei.number}`, "1.190,00"],
      ]),
      null,
    );
    expect(await vorschlag(`RE ${eins.number}`)).toMatchObject({
      text: `Rechnung ${eins.number}`,
      input: { kind: "invoice", invoiceId: eins.id, amount: 119_000 },
    });
    await gegenProbe(`RE ${eins.number}`, async () => {
      await bank.allocate(actor, { kind: "invoice", transactionId: await idVon(`RE ${zwei.number}`), invoiceId: zwei.id, amount: 119_000 });
    });
    expect((await invoices.listInvoices("2026-12-31")).filter((i) => i.open === 0)).toHaveLength(2);
  });

  it.each(VARIANTEN)("Beleg bestätigen bucht wie Zuordnen von Hand (%s, %s-Versteuerung)", async (kontenrahmen, versteuerung) => {
    await firma(kontenrahmen, versteuerung);
    const beleg = async (nummer: string) => {
      folge++;
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, folge % 256, 37]);
      const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${folge}.jpg` });
      await documents.updateDocument(actor, id, {
        supplierName: "Codewerk Lizenzen GmbH",
        supplierUstId: "",
        invoiceNumber: nummer,
        documentDate: "2026-09-15",
        dueDate: null,
        category: "software",
        payment: "bank",
        note: "",
        amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
      });
      await documents.bookDocument(actor, id);
      return id;
    };
    const eins = await beleg("L-1001");
    const zwei = await beleg("L-1002");
    await bank.importStatement(
      actor,
      dkbCsv([
        ["20.09.26", "Codewerk Lizenzen GmbH", "L-1001", "-119,00"],
        ["21.09.26", "Codewerk Lizenzen GmbH", "L-1002", "-119,00"],
      ]),
      null,
    );
    expect(await vorschlag("L-1001")).toMatchObject({ text: expect.stringMatching(/^Beleg /), input: { kind: "document", documentId: eins, amount: -119_00 } });
    await gegenProbe("L-1001", async () => {
      await bank.allocate(actor, { kind: "document", transactionId: await idVon("L-1002"), documentId: zwei, amount: -119_00 });
    });
  });

  it.each([
    ["spende", "-50,00", -50_00, "Spendenverein Beispiel e.V."],
    ["gebuehren", "-4,90", -4_90, "Beispielbank AG"],
    ["zinsertrag", "12,30", 12_30, "Beispielbank AG"],
    ["mahnerloes", "15,00", 15_00, "Zahlungsverzug Kunde GmbH"],
  ] as const)("%s: gelernt, bestätigen bucht wie Zuordnen von Hand (SKR03, soll)", async (kind, betrag, cents, name) => {
    await firma("SKR03", "soll");
    await bank.importStatement(
      actor,
      dkbCsv([
        ["13.10.26", name, "Eins", betrag],
        ["14.10.26", name, "Zwei", betrag],
        ["15.10.26", name, "Drei", betrag],
        ["16.10.26", name, "Vier", betrag],
      ]),
      null,
    );
    for (const purpose of ["Eins", "Zwei"]) await bank.allocate(actor, { kind, transactionId: await idVon(purpose), amount: cents });
    expect(await vorschlag("Drei")).toMatchObject({ input: { kind, amount: cents } });
    await gegenProbe("Drei", async () => {
      await bank.allocate(actor, { kind, transactionId: await idVon("Vier"), amount: cents });
    });
  });

  it("Zahlung auf dem Konto eines Zahlungsdienstleisters ist nicht bestätigbar: dort kann eine Gebühr mitgebucht werden", async () => {
    await firma("SKR03", "soll");
    const kunde = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "buchhaltung@nordwerk.example",
      ustId: "",
      iban: CUSTOMER_IBAN,
      leitwegId: "",
      defaultFormat: null,
    });
    const defaults = await invoices.newDraftDefaults("2026-09-25");
    const draft = await invoices.createDraft(actor, {
      ...defaults,
      contactId: kunde.id,
      format: "zugferd",
      lines: [{ description: "Leistungen September", quantity: 1000, unit: "Psch.", unitPrice: 100_000, taxRate: 1900 }],
    });
    const rechnung = await invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
    const zweck = `RE ${rechnung.number}`;
    await bank.importStatement(actor, dkbCsv([["03.10.26", "Nordwerk Software GmbH", zweck, "1.190,00"]]), null);
    expect(await vorschlag(zweck)).not.toBeNull();
    await sql`update bank_accounts set purpose = 'zahlungsdienstleister', provider = 'paypal', ledger_index = 1, iban = null`;
    expect(await vorschlag(zweck)).toBeNull();
    await expect(bestaetigen.bestaetigeVorschlaege(actor, [await idVon(zweck)])).rejects.toThrow(/nichts gebucht/);
  });

  it("eine Ausgabe mit Beleg auf dem Konto eines Zahlungsdienstleisters bleibt bestätigbar, nur der Eingang nicht", async () => {
    await firma("SKR03", "soll");
    folge++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, folge % 256, 37]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${folge}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Codewerk Lizenzen GmbH",
      supplierUstId: "",
      invoiceNumber: "L-2001",
      documentDate: "2026-09-15",
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }],
    });
    await documents.bookDocument(actor, id);
    await bank.importStatement(actor, dkbCsv([["20.09.26", "Codewerk Lizenzen GmbH", "L-2001", "-119,00"]]), null);
    await sql`update bank_accounts set purpose = 'zahlungsdienstleister', provider = 'paypal', ledger_index = 1, iban = null`;
    expect(await vorschlag("L-2001")).toMatchObject({ input: { kind: "document", documentId: id, amount: -119_00 } });
  });
});
