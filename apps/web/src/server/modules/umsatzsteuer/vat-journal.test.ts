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

describe.skipIf(!testDatabaseUrl)("Voranmeldung aus dem Journal ab dem Stichjahr (Postgres)", () => {
  let figures: typeof import("./vat-figures.ts");
  let bank: typeof import("../bank/bank.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let documents: typeof import("../belege/documents.ts");
  let assets: typeof import("../buchhaltung/assets.ts");
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
    assets = await import("../buchhaltung/assets.ts");
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

  async function invoice(issueDate: string, lines: { unitPrice: number; taxRate: 1900 | 700 | 0 }[]) {
    const contact = await contacts.createContact(actor, {
      kundennummer: "",
      name: "Nordwerk Software GmbH",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
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
      lines: lines.map((l, i) => ({ description: `Leistung ${i}`, quantity: 1000, unit: "Psch." as const, unitPrice: l.unitPrice, taxRate: l.taxRate })),
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function bookedDocument(date: string, net: number, tax: number) {
    docSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, docSeq % 256, Math.floor(docSeq / 256), 9]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `b${docSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Lieferant",
      supplierUstId: "",
      invoiceNumber: `R${docSeq}`,
      documentDate: date,
      dueDate: null,
      category: "edv",
      payment: "privat",
      note: "",
      amounts: [{ taxRate: 1900, net, tax }],
      privateShare: 0,
      reverseCharge: null,
    });
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

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`ab dem Stichjahr aus dem Journal, gleich wie die Nebenbücher (${kontenrahmen}, ${versteuerung})`, async () => {
        await reset(versteuerung, kontenrahmen);
        const inv = await invoice("2026-09-20", [
          { unitPrice: 15_000, taxRate: 1900 },
          { unitPrice: 4_000, taxRate: 700 },
          { unitPrice: 13_000, taxRate: 0 },
        ]);
        await pay(inv.id, [
          ["01.10.26", "Rate 1", "117,10"],
          ["02.10.26", "Rate 2", "117,10"],
        ]);
        await bookedDocument("2026-10-05", 10_000, 1_900);
        for (const month of [9, 10]) {
          const f = await figures.computeVatFigures({ year: 2026, month });
          expect(f.quelle, String(month)).toBe("journal");
          expect(kennzahlen(f), String(month)).toEqual(f.nebenbuecher);
          expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2026, month })).zeilen), String(month)).toEqual([]);
        }
        // Es wurde wirklich etwas gemeldet: Vorsteuer im Oktober, Umsatzsteuer bei Soll im September, bei Ist mit den Raten
        const oct = await figures.computeVatFigures({ year: 2026, month: 10 });
        expect(oct.kz66).toBe(1_900);
        const steuerMonat = versteuerung === "soll" ? 9 : 10;
        expect((await figures.computeVatFigures({ year: 2026, month: steuerMonat })).tax81).toBeGreaterThan(0);
      }, 60_000);
    }

    it(`vor dem Stichjahr aus den Nebenbüchern (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen, 2027);
      await invoice("2026-09-20", [{ unitPrice: 10_000, taxRate: 1900 }]);
      const f = await figures.computeVatFigures({ year: 2026, month: 9 });
      expect(f.quelle).toBe("nebenbuecher");
      expect(f.nebenbuecher).toBeUndefined();
      expect({ kz81: f.kz81, tax81: f.tax81 }).toEqual({ kz81: 10_000, tax81: 1_900 });
    }, 60_000);

    it(`ab dem Stichjahr meldet die Voranmeldung, was im Journal steht; der Abgleich zeigt die Nebenbücher dagegen (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen);
      await invoice("2026-09-20", [{ unitPrice: 10_000, taxRate: 1900 }]);
      // An Haben vorbei: die Umsatzsteuer im Journal um 1 € gemindert
      const ust = kontenrahmen === "SKR03" ? "1776" : "3806";
      await sql.begin(async (tx) => {
        await tx`set local session_replication_role = replica`;
        await tx`update journal_lines set credit = credit - 100 where account = ${ust}`;
      });
      const f = await figures.computeVatFigures({ year: 2026, month: 9 });
      expect(f.tax81).toBe(1_800);
      expect(f.nebenbuecher!.tax81).toBe(1_900);
      expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2026, month: 9 })).zeilen)).toEqual([
        expect.objectContaining({ posten: "Umsatzsteuer 19 % (Kz 81)", journal: 1_800, quelle: 1_900 }),
      ]);
    }, 60_000);

    it(`Privatnutzung eines Fahrzeugs aus dem Anlagenverzeichnis, vor und nach dem Buchen der AfA (${kontenrahmen})`, async () => {
      await reset("soll", kontenrahmen);
      for (const drive of ["verbrenner", "elektro"] as const) {
        await assets.createAsset(actor, {
          name: `Firmenwagen ${drive}`,
          kind: "kfz",
          method: "linear",
          acquisitionDate: "2023-01-10",
          cost: 3_600_000,
          usefulLifeMonths: 72,
          openingDate: "2025-01-01",
          openingBookValue: 2_400_000,
          disposalDate: null,
          privateUse: { listPrice: 5_000_000, drive, rate: 100, vat: true },
          note: "",
        });
      }
      await invoice("2025-06-01", [{ unitPrice: 10_000, taxRate: 1900 }]);
      const vorher = await figures.computeVatFigures({ year: 2025, month: 6 });
      expect(vorher.quelle).toBe("journal");
      expect(kennzahlen(vorher)).toEqual(vorher.nebenbuecher);
      expect(vorher.kz81).toBeGreaterThan(10_000);
      await assets.bookDepreciation(actor, 2025, "2025-12-15");
      // Nach dem Buchen steht die Privatnutzung im Journal; die Voranmeldung bleibt dieselbe, auch beim Elektroauto
      const nachher = await figures.computeVatFigures({ year: 2025, month: 6 });
      expect(kennzahlen(nachher)).toEqual(kennzahlen(vorher));
      expect(abgleich.abweichungen((await abgleich.vatAbgleich({ year: 2025, month: 6 })).zeilen)).toEqual([]);
      expect(abgleich.abweichungen((await abgleich.euerAbgleich(2025)).zeilen)).toEqual([]);
    }, 60_000);
  }
});
