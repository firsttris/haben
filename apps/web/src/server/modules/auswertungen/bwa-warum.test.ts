import { bwaZeitraum, type Form43Zeile } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "./test-umsatz-stand.ts";

/*
 * „Warum?“ je Zeile der BWA (#1380, Teil 2): die Abweichung einer Zeile zum Vorjahr nach Kontakt, aus denselben Anteilen wie
 * die BWA. Kunde einer Rechnung, Lieferant eines Belegs mit Kontakt oder nur mit Namen. Alle Daten sind erfunden.
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}
const umsatz = (date: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Nordwerk",
  "Testfirma",
  purpose,
  "Umsatz",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];

const kontakt = (name: string, rolle: "kunde" | "lieferant") => ({
  kundennummer: "",
  name,
  strasse: "Hafenstraße 5",
  plz: "20457",
  ort: "Hamburg",
  land: "DE",
  email: "a@b.example",
  ustId: "",
  iban: "",
  leitwegId: "",
  defaultFormat: null,
  isCustomer: rolle === "kunde",
  isSupplier: rolle === "lieferant",
});

describe.skipIf(!testDatabaseUrl)("BWA: Warum? je Zeile (Postgres, #1380)", () => {
  let sql: postgres.Sql;
  let bank: typeof import("../bank/bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let bwa: typeof import("./bwa.ts");
  const actor = "test-user";
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("../bank/bank.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    bwa = await import("./bwa.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04") {
    await leeren(sql)`truncate own_accounts, document_settlements, asset_depreciations, assets, pauschalen, allocations, bank_transactions, bank_imports,
      bank_accounts, cash_entries, write_offs, journal_lines, journal_entries, document_splits, document_amounts, documents, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, rechtsform)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, 'einzelunternehmen')`;
  }

  async function invoice(contactId: string, issueDate: string, net: number) {
    const draft = await invoices.createDraft(actor, {
      contactId,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      lines: [{ description: "Leistung", quantity: 1000, unit: "Psch." as const, unitPrice: net, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id, kleinunternehmerStand);
  }

  /** Beleg über EDV (Instandhaltung), privat bezahlt: Abfluss am Belegdatum */
  async function beleg(date: string, net: number, supplierName: string, supplierContactId: string | null = null) {
    docSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 11]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `w${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName,
      supplierContactId,
      supplierUstId: "",
      invoiceNumber: `W${docSeq}`,
      documentDate: date,
      dueDate: null,
      category: "edv",
      payment: "privat",
      note: "",
      amounts: [{ taxRate: 1900, net, tax: Math.round(net * 0.19) }],
      privateShare: 0,
      reverseCharge: null,
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`zerlegt die Abweichung zum Vorjahr nach Kunde und Lieferant; die Teile ergeben die Zeile (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const kunde = (await contacts.createContact(actor, kontakt("Nordwerk Software GmbH", "kunde"))).id;
        const cloudwerk = (await contacts.createContact(actor, kontakt("Cloudwerk GmbH", "lieferant"))).id;
        const altanbieter = (await contacts.createContact(actor, kontakt("Altanbieter KG", "lieferant"))).id;

        // Kunde: 2026 eine Rechnung über 1.000 €, 2027 zwei, je bezahlt
        const r1 = await invoice(kunde, "2026-03-02", 100_000);
        const r2 = await invoice(kunde, "2027-03-01", 100_000);
        const r3 = await invoice(kunde, "2027-04-01", 100_000);
        await bank.importStatement(
          actor,
          {
            bytes: dkbCsv([
              umsatz("10.03.26", `RE ${r1.number}`, "1190,00"),
              umsatz("10.03.27", `RE ${r2.number}`, "1190,00"),
              umsatz("10.04.27", `RE ${r3.number}`, "1190,00"),
            ]),
            filename: `${crypto.randomUUID()}.csv`,
          },
          null,
        );
        const txs = await sql<{ id: string; amount: number }[]>`select id, amount from bank_transactions order by booking_date`;
        for (const [t, r] of [
          [txs[0]!, r1],
          [txs[1]!, r2],
          [txs[2]!, r3],
        ] as const)
          await bank.allocate(actor, { kind: "invoice", transactionId: t.id, invoiceId: r.id, amount: 119_000 });

        // Lieferanten: neu mit Kontakt (der Name am Beleg weicht ab), weggefallen mit Kontakt, ohne Kontakt nur mit Namen
        await beleg("2027-05-04", 30_000, "CLOUDWERK", cloudwerk);
        await beleg("2026-05-04", 45_000, "Altanbieter KG", altanbieter);
        await beleg("2026-06-01", 10_000, "Rechenzentrum Süd");
        await beleg("2027-06-01", 35_000, "Rechenzentrum Süd");

        const jahr = bwaZeitraum("jahr", 2027);
        const bericht = await bwa.bwaBericht(jahr, "vorjahr");
        const teile = async (zeile: Form43Zeile) => {
          const warum = (await bwa.bwaWarum(jahr, "vorjahr", zeile))!;
          return warum.teile.map((t) => [t.name, t.kontaktId, t.art, t.differenz, t.anzahl, t.jeVorgang, t.anzahlVergleich, t.jeVorgangVergleich]);
        };

        expect(await teile("erloese")).toEqual([["Nordwerk Software GmbH", kunde, "gestiegen", 100_000, 2, 100_000, 1, 100_000]]);
        expect(await teile("instandhaltung")).toEqual([
          ["Altanbieter KG", altanbieter, "weggefallen", -45_000, 0, null, 1, 45_000],
          ["Cloudwerk GmbH", cloudwerk, "neu", 30_000, 1, 30_000, 0, null],
          ["Rechenzentrum Süd", null, "gestiegen", 25_000, 1, 35_000, 1, 10_000],
        ]);

        // Jede Zeile mit Beträgen: Teile plus übrige sind genau die Abweichung der BWA
        const mitBetrag = bericht.zeilen.filter((z) => z.art === "zeile" && (z.betrag !== 0 || z.vergleich !== 0));
        expect(mitBetrag.map((z) => z.key)).toEqual(expect.arrayContaining(["erloese", "umsatzsteuer", "instandhaltung", "vorsteuer"]));
        for (const z of mitBetrag) {
          const warum = (await bwa.bwaWarum(jahr, "vorjahr", z.key as Form43Zeile))!;
          expect([warum.betrag, warum.vergleich, warum.abweichung], z.key).toEqual([z.betrag, z.vergleich, z.abweichung!.betrag]);
          const summe = warum.teile.reduce((s, t) => s + t.differenz, 0) + (warum.uebrige?.differenz ?? 0);
          expect(summe, z.key).toBe(z.abweichung!.betrag);
        }

        // Ohne Vergleich gibt es nichts zu erklären
        expect(await bwa.bwaWarum(jahr, "keiner", "erloese")).toBeNull();
      }, 60_000);
    }
  }
});
