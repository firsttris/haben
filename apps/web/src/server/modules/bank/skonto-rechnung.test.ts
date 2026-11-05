import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

const COMPANY_IBAN = "DE89370400440532013000";
const CUSTOMER_IBAN = "DE02100100100006820101";

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n"Kontostand vom 06.10.2026:";"4.664,80 €"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  const body = rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
  return new TextEncoder().encode(`﻿${header}${columns}${body}\n`);
}

const incoming = (date: string, purpose: string, amount: string) => [
  date,
  date,
  "Gebucht",
  "Nordwerk Software GmbH",
  "Testfirma",
  purpose,
  "Eingang",
  CUSTOMER_IBAN,
  amount,
  "",
  "",
  "",
];

/** Konten je Kontenrahmen: Bank, Umsatzsteuer 19 %, Erlöse 19 %, gewährte Skonti 19 % (wie beim Ausbuchen) */
const ACCOUNTS = {
  SKR03: { bank: "1200", ust: "1776", erloese: "8400", skonto: "8730" },
  SKR04: { bank: "1800", ust: "3806", erloese: "4400", skonto: "4730" },
} as const;

describe.skipIf(!testDatabaseUrl)("Skonto auf Ausgangsrechnungen (Postgres)", () => {
  let bank: typeof import("./index.ts");
  let invoices: typeof import("../rechnungen/invoices.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let auswertungen: typeof import("../auswertungen/index.ts");
  let sql: postgres.Sql;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    invoices = await import("../rechnungen/invoices.ts");
    contacts = await import("../stammdaten/contacts.ts");
    vat = await import("../umsatzsteuer/index.ts");
    auswertungen = await import("../auswertungen/index.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Firma mit 2 % Skonto in 10 Tagen als Vorgabe, Zahlungsziel 14 Tage */
  async function company(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await sql`truncate write_offs, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen,
                                   payment_term_days, skonto)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', ${COMPANY_IBAN}, ${versteuerung}, ${kontenrahmen}, 14, ${JSON.stringify([{ days: 10, percent: 200 }])}::jsonb)`;
  }

  async function customer(skonto?: { days: number; percent: number }[] | null) {
    return contacts.createContact(actor, {
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
      ...(skonto === undefined ? {} : { skonto }),
    });
  }

  /** Rechnung vom 25.09.2026 über 4.000,00 € netto, 4.760,00 € brutto, mit den Vorgaben wie ein neuer Entwurf im Editor */
  async function finalInvoice(contactId: string, format: "zugferd" | "xrechnung-cii" = "zugferd") {
    const defaults = await invoices.newDraftDefaults("2026-09-25");
    const draft = await invoices.createDraft(actor, {
      ...defaults,
      contactId,
      format,
      lines: [{ description: "Leistungen September", quantity: 1000, unit: "Psch.", unitPrice: 400_000, taxRate: 1900 }],
    });
    return invoices.finalizeInvoice(actor, draft.id);
  }

  async function balances() {
    return Object.fromEntries(
      (await sql`select account, sum(debit - credit)::int as saldo from journal_lines group by account having sum(debit - credit) <> 0 order by 1`).map((r) => [
        r.account,
        r.saldo,
      ]),
    );
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    for (const versteuerung of ["ist", "soll"] as const) {
      it(`${kontenrahmen}, ${versteuerung}: Zahlung in der Frist mit Skonto zugeordnet, Rest als gewährtes Skonto, Voranmeldung gemindert`, async () => {
        await company(kontenrahmen, versteuerung);
        const { id: contactId } = await customer();
        const invoice = await finalInvoice(contactId, "xrechnung-cii");
        // Vorgabe aus den Firmendaten an der festgeschriebenen Rechnung, in der E-Rechnung nach BR-DE-18
        expect(invoice.skonto).toEqual([{ days: 10, percent: 200 }]);
        expect(invoice.xml).toContain("#SKONTO#TAGE=10#PROZENT=2.00#\n");
        // 2 % von 4.760,00 € = 95,20 €, bis 05.10.2026
        await bank.importStatement(
          actor,
          {
            bytes: dkbCsv([incoming("03.10.26", `RE ${invoice.number}`, "4.664,80"), incoming("06.10.26", "Andere Zahlung", "4.664,80")]),
            filename: "a.csv",
          },
          null,
        );
        const [inTime] = await sql`select id from bank_transactions where booking_date = '2026-10-03'`;
        const [late] = await sql`select id from bank_transactions where booking_date = '2026-10-06'`;
        const detail = await bank.transactionDetail(inTime!.id);
        expect(detail?.suggestions[0]).toMatchObject({ item: { id: invoice.id }, amount: 466_480, skonto: 9_520 });
        expect(detail?.suggestions[0]?.reasons[0]).toBe("Betrag stimmt mit 2 % Skonto (95,20 €), in der Frist");
        // Nach der Frist kein Skonto mehr, nur ein Teilbetrag
        expect((await bank.transactionDetail(late!.id))?.suggestions[0]?.skonto).toBeUndefined();

        await bank.allocateWithRest(actor, { transactionId: inTime!.id, target: { kind: "invoice", invoiceId: invoice.id }, rest: "skonto" });
        expect((await invoices.listInvoices("2026-10-06")).find((i) => i.id === invoice.id)).toMatchObject({ listStatus: "bezahlt", open: 0 });
        expect((await bank.listWriteOffs({ invoiceId: invoice.id })).map((w) => [w.kind, w.amount, w.date])).toEqual([["skonto", 9_520, "2026-10-03"]]);
        // Erlös 4.000,00 €, Skonto netto 80,00 €, Umsatzsteuer 760,00 − 15,20 = 744,80 € (§ 17 Abs. 1 UStG)
        const a = ACCOUNTS[kontenrahmen];
        expect(await balances()).toEqual({ [a.bank]: 466_480, [a.ust]: -74_480, [a.erloese]: -400_000, [a.skonto]: 8_000 });
        // Nach der Zuordnung keine offene Rechnung mehr für den späteren Umsatz
        expect((await bank.transactionDetail(late!.id))?.suggestions).toEqual([]);

        const september = await vat.computeVatFigures({ year: 2026, month: 9 });
        const october = await vat.computeVatFigures({ year: 2026, month: 10 });
        if (versteuerung === "soll") {
          // Soll: Umsatz im Monat der Rechnung, Minderung im Monat der Ausbuchung
          expect(september).toMatchObject({ kz81: 400_000, tax81: 76_000 });
          expect(october).toMatchObject({ kz81: -8_000, tax81: -1_520 });
        } else {
          // Ist: nur was bezahlt ist, im Monat der Zahlung; das Skonto kam nie in die Anmeldung
          expect(september).toMatchObject({ kz81: 0, tax81: 0 });
          expect(october).toMatchObject({ kz81: 392_000, tax81: 74_480 });
        }
        for (const month of [9, 10]) {
          const abgleich = await auswertungen.vatAbgleich({ year: 2026, month });
          expect(abgleich.zeilen.filter((z) => z.journal !== z.quelle)).toEqual([]);
        }
      }, 60_000);
    }
  }

  it("Vorgabe vom Kunden vor den Firmendaten; Fristen über das Zahlungsziel entfallen; Prüfungen beim Speichern", async () => {
    await company("SKR03", "ist");
    const own = await customer([
      { days: 20, percent: 100 },
      { days: 7, percent: 300 },
    ]);
    expect(own.skonto).toEqual([
      { days: 7, percent: 300 },
      { days: 20, percent: 100 },
    ]);
    const { defaultSkonto } = await import("../rechnungen/index.ts");
    const company_ = await sql`select skonto from company`;
    expect(defaultSkonto({ skonto: company_[0]!.skonto }, own, 14)).toEqual([{ days: 7, percent: 300 }]);
    expect(defaultSkonto({ skonto: company_[0]!.skonto }, { skonto: [] }, 14)).toEqual([]);
    expect(defaultSkonto({ skonto: company_[0]!.skonto }, { skonto: null }, 14)).toEqual([{ days: 10, percent: 200 }]);

    const base = {
      ...(await invoices.newDraftDefaults("2026-09-25")),
      contactId: own.id,
      lines: [{ description: "Beratung", quantity: 1000, unit: "Psch." as const, unitPrice: 10_000, taxRate: 1900 as const }],
    };
    const parse = (input: object) => invoices.draftSchema.safeParse({ ...base, ...input });
    expect(parse({ skonto: [{ days: 15, percent: 200 }] }).error?.issues[0]?.message).toBe(
      "Die Skontofrist von 15 Tagen ist länger als das Zahlungsziel von 14 Tagen.",
    );
    expect(parse({ currency: "USD", skonto: [{ days: 10, percent: 200 }] }).error?.issues[0]?.message).toBe("Skonto gibt es nur bei Rechnungen in Euro.");
    expect(parse({ skonto: [{ days: 10, percent: 0 }] }).success).toBe(false);
    expect(parse({}).data?.skonto).toEqual([{ days: 10, percent: 200 }]);

    // Im Entwurf änderbar, nach dem Festschreiben gesperrt
    const draft = await invoices.createDraft(actor, { ...base, skonto: [{ days: 10, percent: 200 }] });
    const updated = await invoices.updateDraft(actor, draft.id, { ...base, skonto: [{ days: 5, percent: 300 }] });
    expect(updated.skonto).toEqual([{ days: 5, percent: 300 }]);
    const final = await invoices.finalizeInvoice(actor, draft.id);
    expect(final.pdf).not.toBeNull();
    await expect(sql`update invoices set skonto = '[]'::jsonb where id = ${draft.id}`).rejects.toThrow();

    // Storno und Korrektur bieten kein Skonto an
    const storno = await invoices.cancelInvoice(actor, draft.id, "2026-09-26");
    expect(storno.skonto).toEqual([]);
    expect(storno.xml).not.toContain("#SKONTO#");
  }, 60_000);
});
