import { JOURNAL_KENNZAHLEN } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Voranmeldung ab dem Stichjahr aus dem Journal (#542, docs/adr/journal-als-quelle.md): Die Kennzahlen kommen aus Konto und
 * Steuerschlüssel der Buchungen, die Privatnutzung von Fahrzeugen aus dem Anlagenverzeichnis; die Nebenbücher sind die
 * Gegenprobe im Abgleich. Vor dem Stichjahr bleibt es bei den Nebenbüchern.
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}
const incoming = (date: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Nordwerk",
  "Testfirma",
  purpose,
  "Eingang",
  "DE02100100100006820101",
  amount,
  "",
  "",
  "",
];

/*
 * Voranmeldung aus dem Journal gleich den Nebenbüchern in Sonderfällen (Fälle aus dem TDD-Review von Pull Request #575):
 * Ausfuhr und steuerfrei bei Ist, § 13b und Erwerb mit Privatanteil, ohne Vorsteuerabzug, Bewirtung, Kleinunternehmer,
 * Skonto und Forderungsausfall nach Teilzahlung, aufgehobene Zahlung.
 */
describe.skipIf(!testDatabaseUrl)("Voranmeldung aus dem Journal in Sonderfällen (Postgres)", () => {
  let figures: typeof import("./vat-figures.ts");
  let bank: typeof import("../bank/bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let docSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    figures = await import("./vat-figures.ts");
    bank = await import("../bank/bank.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    documents = await import("../belege/documents.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
  }, 30_000);
  afterAll(async () => {
    await sql?.end();
  });

  async function reset(versteuerung: "ist" | "soll", kontenrahmen: "SKR03" | "SKR04", journalAb: number | null = null) {
    await leeren(sql)`truncate asset_depreciations, assets, vat_return_submissions, vat_returns, write_offs, allocations, bank_transactions,
      bank_imports, bank_accounts, journal_lines, journal_entries, document_amounts, documents, invoice_lines, invoices,
      invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen, journal_ab)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, ${journalAb})`;
  }

  async function invoice(issueDate: string, lines: { unitPrice: number; taxRate: 1900 | 700 | 0 }[], taxTreatment: string = "regulaer") {
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: taxTreatment === "ausfuhr" ? "CH" : "DE",
      email: "a@b.example",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    const draft = await invoices.createDraft(actor, {
      contactId: contact.id,
      issueDate,
      serviceFrom: null,
      serviceTo: null,
      paymentTermDays: 14,
      format: "zugferd",
      note: "",
      taxTreatment: taxTreatment as never,
      exemptionReason: taxTreatment === "steuerfrei" ? "Steuerfrei nach § 4 Nr. 14 UStG" : "",
      lines: lines.map((l, i) => ({ description: `Leistung ${i}`, quantity: 1000, unit: "Psch." as const, unitPrice: l.unitPrice, taxRate: l.taxRate })),
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function rcDocument(date: string, net: number, tax: number, reverseCharge: "eu" | "drittland" | "ig_erwerb", privateShare: number, category?: string) {
    docSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 7]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `rc${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant EU",
      supplierUstId: reverseCharge === "drittland" ? "" : "ATU12345678",
      invoiceNumber: `RC${docSeq}`,
      documentDate: date,
      dueDate: null,
      category: (category ?? (reverseCharge === "ig_erwerb" ? "wareneinkauf" : "edv")) as never,
      payment: "privat",
      note: "",
      amounts: [{ taxRate: 1900, net, tax }],
      privateShare,
      reverseCharge,
    } as never);
    await documents.bookDocument(actor, id);
  }

  async function pay(invoiceId: string, rows: [date: string, purpose: string, amount: string][]) {
    await bank.importStatement(actor, { bytes: dkbCsv(rows.map(([d, p, a]) => incoming(d, p, a))), filename: `${rows[0]![1]}.csv` }, null);
    for (const [, purpose] of rows) {
      const [tx] = await sql`select id, amount from bank_transactions where purpose = ${purpose}`;
      await bank.allocate(actor, { kind: "invoice", transactionId: tx!.id, invoiceId, amount: Number(tx!.amount) });
    }
  }

  const kennzahlen = (f: Awaited<ReturnType<typeof figures.computeVatFigures>>) => Object.fromEntries(JOURNAL_KENNZAHLEN.map((k) => [k, f[k]]));
  async function gleich(months: number[]) {
    for (const month of months) {
      const f = await figures.computeVatFigures({ year: 2026, month });
      expect(f.quelle, String(month)).toBe("journal");
      const abw = abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2026, month })).zeilen);
      expect({ month, va: kennzahlen(f), abw }).toEqual({ month, va: f.nebenbuecher, abw: [] });
    }
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const [treatment, kz] of [
      ["ausfuhr", "kz43"],
      ["steuerfrei", "kz48"],
    ] as const) {
      it(`Ist: ${treatment} (${kz}) mit der Zahlung (${kontenrahmen})`, async () => {
        await reset("ist", kontenrahmen);
        const inv = await invoice("2026-09-20", [{ unitPrice: 50_000, taxRate: 0 }], treatment);
        await pay(inv.id, [["05.10.26", `Zahlung ${treatment}`, "500,00"]]);
        await gleich([9, 10]);
        expect((await figures.computeVatFigures({ year: 2026, month: 10 }))[kz]).toBe(50_000);
      }, 60_000);
    }

    for (const versteuerung of ["ist", "soll"] as const) {
      for (const rc of ["eu", "drittland", "ig_erwerb"] as const) {
        it(`${rc} mit Privatanteil 30 % (${kontenrahmen}, ${versteuerung})`, async () => {
          await reset(versteuerung, kontenrahmen);
          await rcDocument("2026-10-05", 100_000, 19_000, rc, 30);
          await gleich([10]);
        }, 60_000);
      }

      it(`Kleinunternehmer mit § 13b EU (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        await sql`update company set kleinunternehmer = true`;
        await rcDocument("2026-10-05", 100_000, 19_000, "eu", 0);
        await gleich([10]);
      }, 60_000);

      it(`Skonto und Forderungsausfall (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const a = await invoice("2026-09-20", [
          { unitPrice: 10_000, taxRate: 1900 },
          { unitPrice: 10_000, taxRate: 700 },
        ]);
        await bank.importStatement(actor, { bytes: dkbCsv([incoming("05.10.26", "Skonto A", "220,00")]), filename: "s.csv" }, null);
        const [tx] = await sql`select id from bank_transactions where purpose = 'Skonto A'`;
        await bank.allocateWithRest(actor, { transactionId: tx!.id, target: { kind: "invoice", invoiceId: a.id }, rest: "skonto" } as never);
        const b = await invoice("2026-09-21", [{ unitPrice: 30_000, taxRate: 1900 }]);
        await pay(b.id, [["06.10.26", "Teil B", "119,00"]]);
        await bank.writeOff(actor, { kind: "forderungsausfall", invoiceId: b.id, date: "2026-11-10" });
        await gleich([9, 10, 11]);
      }, 60_000);
    }
  }
  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      for (const rc of ["eu", "drittland", "ig_erwerb"] as const) {
        it(`${rc} Kategorie Geschenke und Bewirtung (${kontenrahmen}, ${versteuerung})`, async () => {
          await reset(versteuerung, kontenrahmen);
          await rcDocument("2026-10-05", 10_000, 1_900, rc, 0, "geschenke");
          await rcDocument("2026-10-06", 10_000, 1_900, rc, 20, "bewirtung");
          await gleich([10]);
        }, 60_000);
        // Innergemeinschaftlicher Erwerb als Kleinunternehmer lehnt Haben ab (§ 1a Abs. 3 UStG)
        if (rc !== "ig_erwerb")
          it(`${rc} als Kleinunternehmer mit Privatanteil (${kontenrahmen}, ${versteuerung})`, async () => {
            await reset(versteuerung, kontenrahmen);
            await sql`update company set kleinunternehmer = true`;
            await rcDocument("2026-10-05", 10_000, 1_900, rc, 25);
            await gleich([10]);
          }, 60_000);
      }
    }
    it(`Ist: Zahlung auf steuerfreie Rechnung aufgehoben (${kontenrahmen})`, async () => {
      await reset("ist", kontenrahmen);
      const inv = await invoice("2026-09-20", [{ unitPrice: 50_000, taxRate: 0 }], "steuerfrei");
      await pay(inv.id, [["05.10.26", "Zahlung frei", "500,00"]]);
      const [al] = await sql`select id from allocations where invoice_id = ${inv.id}`;
      await bank.reverseAllocation(actor, al!.id);
      await gleich([9, 10]);
    }, 60_000);
  }
});
