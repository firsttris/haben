import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";
import { kleinunternehmerStand } from "../auswertungen/test-umsatz-stand.ts";

// „Rechnung minus Korrektur“ als erster Vorschlag (#1398): Der Abgleich schlägt Rechnung und Korrektur zusammen vor,
// auch mehrere Korrekturen und Skonto auf den geminderten Betrag, und bucht es mit einem Klick bzw. per „Bestätigen“
describe.skipIf(!testDatabaseUrl)("Vorschlag „Rechnung mit Korrektur“ im Abgleich (Postgres, #1398)", () => {
  let bank: typeof import("./index.ts");
  let invoices: typeof import("../rechnungen/index.ts");
  let contacts: typeof import("../stammdaten/contacts.ts");
  let sql: postgres.Sql;
  let contactId: string;
  const actor = "test-user";

  beforeAll(async () => {
    sql = await setupTestDb();
    bank = await import("./index.ts");
    invoices = await import("../rechnungen/index.ts");
    contacts = await import("../stammdaten/contacts.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Firma mit 2 % Skonto in 10 Tagen als Vorgabe, Zahlungsziel 14 Tage */
  async function firma(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll") {
    await leeren(sql)`truncate write_offs, allocations, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries,
      document_amounts, documents, invoice_lines, invoices, invoice_number_counters, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban, versteuerung, kontenrahmen,
                                   payment_term_days, skonto)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${versteuerung}, ${kontenrahmen}, 14, ${JSON.stringify([{ days: 10, percent: 200 }])}::jsonb)`;
    const contact = await contacts.createContact(actor, {
      kundennummer: "10001",
      name: "Testkunde",
      strasse: "Hafenstraße 5",
      plz: "20457",
      ort: "Hamburg",
      land: "DE",
      email: "kunde@example.com",
      ustId: "",
      iban: "",
      leitwegId: "",
      defaultFormat: null,
    });
    contactId = contact.id;
  }

  beforeEach(() => firma("SKR03", "ist"));

  async function beleg(unitPrice: number, issueDate: string, korrigiert?: string) {
    const defaults = await invoices.newDraftDefaults(issueDate);
    const lines = [{ description: "Wartung", quantity: 1000, unit: "Psch.", unitPrice, taxRate: 1900 as const }];
    const entwurf = await invoices.createDraft(
      actor,
      { ...defaults, contactId, format: "zugferd", lines },
      korrigiert ? { kind: "korrektur", correctsId: korrigiert } : undefined,
    );
    return invoices.finalizeInvoice(actor, entwurf.id, kleinunternehmerStand);
  }

  /** Rechnung 119,00 € vom 02.11.2026 und Korrekturen über die angegebenen Nettobeträge (−20,00 € → −23,80 €) */
  async function rechnungMitKorrekturen(...netto: number[]) {
    const rechnung = await beleg(10_000, "2026-11-02");
    const korrekturen = [];
    for (const n of netto) korrekturen.push(await beleg(n, "2026-11-05", rechnung.id));
    return { rechnung, korrekturen };
  }

  async function zahlung(betrag: string, zweck: string, datum = "06.11.26") {
    const head = '"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n"Kontostand vom 20.11.2026:";"95,20 €"\n""\n';
    const columns =
      '"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n';
    const row = [datum, datum, "Gebucht", "Testkunde", "Testfirma", zweck, "Eingang", "", betrag, "", "", ""];
    const bytes = new TextEncoder().encode(`﻿${head}${columns}${row.map((v) => `"${v}"`).join(";")}\n`);
    await bank.importStatement(actor, { bytes, filename: `${zweck}.csv` }, null);
    const [tx] = await sql`select id from bank_transactions where purpose = ${zweck}`;
    return tx!.id as string;
  }

  const offen = async (...ids: string[]) => (await bank.openItems()).filter((item) => ids.includes(item.id)).map((item) => [item.number, item.open]);

  it("schlägt Rechnung und Korrektur zusammen vor; „Bestätigen“ bucht die Aufteilung, beide sind bezahlt", async () => {
    const { rechnung, korrekturen } = await rechnungMitKorrekturen(-2000);
    const [korrektur] = korrekturen;
    const id = await zahlung("95,20", `Rechnung ${rechnung.number} abzgl. Korrektur ${korrektur!.number}`);
    const [best] = (await bank.transactionDetail(id))!.suggestions;
    expect(best).toMatchObject({ item: { id: rechnung.id }, amount: 9520, corrections: [{ id: korrektur!.id, open: -2380 }] });
    expect(best!.skonto).toBeUndefined();

    await bank.bestaetigeVorschlaege(actor, [id]);
    expect(await offen(rechnung.id, korrektur!.id)).toEqual([]);
    expect(await sql`select id from write_offs`).toHaveLength(0);
    const teile = await sql`select amount, split_id from allocations order by amount desc`;
    expect(teile.map((t) => t.amount)).toEqual([11_900, -2380]);
    expect(new Set(teile.map((t) => t.split_id)).size).toBe(1);
  }, 30_000);

  it("nimmt zwei Korrekturen zusammen, wenn erst ihre Summe den Rest ausgleicht", async () => {
    const { rechnung, korrekturen } = await rechnungMitKorrekturen(-1000, -1000);
    const id = await zahlung("95,20", `Rechnung ${rechnung.number}`);
    const [best] = (await bank.transactionDetail(id))!.suggestions;
    expect(best?.corrections?.map((k) => k.id).sort()).toEqual(korrekturen.map((k) => k.id).sort());

    await bank.bestaetigeVorschlaege(actor, [id]);
    expect(await offen(rechnung.id, ...korrekturen.map((k) => k.id))).toEqual([]);
    expect(await sql`select id from write_offs`).toHaveLength(0);
  }, 30_000);

  it.each([
    ["SKR03", "ist", { bank: "1200", ust: "1776", erloese: "8400", skonto: "8730" }],
    ["SKR04", "soll", { bank: "1800", ust: "3806", erloese: "4400", skonto: "4730" }],
  ] as const)(
    "rechnet Skonto vom geminderten Betrag und bucht Aufteilung und Skonto zusammen (%s, %s)",
    async (kontenrahmen, versteuerung, konto) => {
      await firma(kontenrahmen, versteuerung);
      const { rechnung, korrekturen } = await rechnungMitKorrekturen(-2000);
      const [korrektur] = korrekturen;
      // 95,20 € nach der Korrektur, davon 2 % Skonto = 1,90 €; der Kunde zahlt 93,30 € in der Frist
      const item = (await bank.openItems()).find((i) => i.id === rechnung.id);
      expect(item?.skontoNachKorrektur).toMatchObject([{ percent: 200, amount: 190, payable: 9330 }]);
      const id = await zahlung("93,30", `Rechnung ${rechnung.number}`);
      const [best] = (await bank.transactionDetail(id))!.suggestions;
      expect(best).toMatchObject({ item: { id: rechnung.id }, corrections: [{ id: korrektur!.id }], skonto: 190 });

      await bank.allocateWithRest(actor, {
        transactionId: id,
        target: { kind: "invoice", invoiceId: rechnung.id },
        rest: "skonto",
        korrekturen: [korrektur!.id],
      });
      expect(await offen(rechnung.id, korrektur!.id)).toEqual([]);
      expect((await bank.listWriteOffs({ invoiceId: rechnung.id })).map((w) => [w.kind, w.amount])).toEqual([["skonto", 190]]);
      // Bank 93,30 €; Erlös 80,00 € netto, davon 1,60 € Skonto; Umsatzsteuer 15,20 € − 0,30 €; die Forderung ist ausgeglichen
      const salden = Object.fromEntries(
        (await sql`select account, sum(debit - credit)::int as saldo from journal_lines group by account having sum(debit - credit) <> 0`).map((r) => [
          r.account,
          r.saldo,
        ]),
      );
      expect(salden).toEqual({ [konto.bank]: 9330, [konto.erloese]: -8000, [konto.ust]: -1490, [konto.skonto]: 160 });
    },
    30_000,
  );

  it("hebt Aufteilung und Skonto zusammen auf", async () => {
    const { rechnung, korrekturen } = await rechnungMitKorrekturen(-2000);
    const [korrektur] = korrekturen;
    const id = await zahlung("93,30", `Rechnung ${rechnung.number}`);
    await bank.allocateWithRest(actor, {
      transactionId: id,
      target: { kind: "invoice", invoiceId: rechnung.id },
      rest: "skonto",
      korrekturen: [korrektur!.id],
    });
    const [teil] = await sql`select id from allocations where invoice_id = ${korrektur!.id}`;
    await bank.reverseAllocation(actor, teil!.id, "2026-11-20");
    expect(await offen(rechnung.id, korrektur!.id)).toEqual([
      [rechnung.number, 11_900],
      [korrektur!.number, -2380],
    ]);
    expect((await bank.listWriteOffs({ invoiceId: rechnung.id })).map((w) => w.reversed)).toEqual([true]);
  }, 30_000);

  it("lehnt eine Korrektur einer anderen Rechnung ab", async () => {
    const { rechnung } = await rechnungMitKorrekturen();
    const fremd = await rechnungMitKorrekturen(-2000);
    const id = await zahlung("93,30", `Rechnung ${rechnung.number}`);
    await expect(
      bank.allocateWithRest(actor, {
        transactionId: id,
        target: { kind: "invoice", invoiceId: rechnung.id },
        rest: "skonto",
        korrekturen: [fremd.korrekturen[0]!.id],
      }),
    ).rejects.toThrow(/gehört nicht zu dieser Rechnung/);
    expect(await sql`select id from allocations`).toHaveLength(0);
  }, 30_000);
});
