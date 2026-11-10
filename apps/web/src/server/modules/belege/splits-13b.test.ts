import { parseDatevBuchungsstapel } from "@haben/import";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * § 13b mit Aufteilung (#508). Erfundene Sammelrechnung eines Zahlungsdienstleisters, alles zu 19 % nach § 13b:
 * 120 € Transaktionsgebühren, 60 € Zahlungsabwicklung, 20 € Einstellgebühren, 50 € Werbung = 250 € netto, 47,50 € Steuer,
 * gezahlt werden 250 €. Aufgeteilt muss der Beleg dieselbe Voranmeldung, dieselbe EÜR-Summe und denselben DATEV-Saldo je
 * Steuerkonto ergeben wie derselbe Beleg ohne Aufteilung; nur der Aufwand steht je Kategorie.
 */

function dkbCsv(rows: string[][]) {
  const header = `"Girokonto";"DE12 1203 0000 1234 5678 90"\n""\n`;
  const columns = `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n`;
  return new TextEncoder().encode(`${header + columns + rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n")}\n`);
}

const KONTEN = {
  SKR03: { geld: "4970", fremd: "3100", sonstiges: "4900", werbung: "4600", ustRc: "1787", vorsteuerRc: "1577", verbindlichkeiten: "1600", privat: "1890" },
  SKR04: { geld: "6855", fremd: "5900", sonstiges: "6300", werbung: "6600", ustRc: "3837", vorsteuerRc: "1407", verbindlichkeiten: "3300", privat: "2180" },
} as const;

type Category = "geldverkehr" | "fremdleistung" | "sonstiges" | "werbung" | "wareneinkauf" | "software";
type Split = { category: Category; taxRate: 1900 | 700 | 0; net: number };

const GEBUEHREN: Split[] = [
  { category: "geldverkehr", taxRate: 1900, net: 12_000 },
  { category: "fremdleistung", taxRate: 1900, net: 6_000 },
  { category: "sonstiges", taxRate: 1900, net: 2_000 },
  { category: "werbung", taxRate: 1900, net: 5_000 },
];
const CODE = { eu: "RC13bEU", drittland: "RC13bDrittland" } as const;
/** Kennzahlen der Voranmeldung je Fall: Bemessungsgrundlage und Steuer */
const KZ = { eu: ["kz46", "kz47"], drittland: ["kz84", "kz85"] } as const;

describe.skipIf(!testDatabaseUrl)("§ 13b mit Aufteilung (Postgres)", () => {
  let documents: typeof import("./documents.ts");
  let cancellation: typeof import("./cancellation.ts");
  let vat: typeof import("../umsatzsteuer/vat-figures.ts");
  let reports: typeof import("../auswertungen/reports.ts");
  let abgleich: typeof import("../auswertungen/abgleich.ts");
  let datev: typeof import("../auswertungen/datev-export.ts");
  let bank: typeof import("../bank/bank.ts");
  let sql: postgres.Sql;
  const actor = "test-user";
  let fileSeq = 0;

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("./documents.ts");
    cancellation = await import("./cancellation.ts");
    vat = await import("../umsatzsteuer/vat-figures.ts");
    reports = await import("../auswertungen/reports.ts");
    abgleich = await import("../auswertungen/abgleich.ts");
    datev = await import("../auswertungen/datev-export.ts");
    bank = await import("../bank/bank.ts");
  }, 30_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function reset(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", kleinunternehmer = false) {
    await sql`truncate document_cancellations, vat_returns, write_offs, allocations, bank_transactions, bank_imports, bank_accounts, cash_entries,
      asset_depreciations, assets, journal_lines, journal_entries, document_splits, document_amounts, documents, year_closings, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, steuernummer, bundesland, versteuerung, kontenrahmen, kleinunternehmer)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '198/113/10010', 'BY', ${versteuerung}, ${kontenrahmen}, ${kleinunternehmer})`;
  }

  type Options = {
    payment?: "bank" | "privat";
    amounts?: { taxRate: 1900 | 700 | 0; net: number; tax: number }[];
    splits?: Split[];
    category?: Category;
    reverseCharge?: "eu" | "drittland" | "ig_erwerb";
    privateShare?: number;
    currency?: string;
    documentDate?: string;
  };

  async function draft(options: Options = {}) {
    fileSeq++;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, fileSeq % 256, Math.floor(fileSeq / 256), 13]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `rc-split-${fileSeq}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Beispiel Payments Ltd.",
      supplierUstId: options.reverseCharge === "ig_erwerb" ? "ATU12345675" : "",
      invoiceNumber: `BP-${fileSeq}`,
      documentDate: options.documentDate ?? "2026-09-15",
      dueDate: null,
      category: options.category ?? "sonstiges",
      payment: options.payment ?? "bank",
      note: "",
      privateShare: options.privateShare ?? 0,
      reverseCharge: options.reverseCharge ?? "eu",
      currency: options.currency ?? "EUR",
      exchangeRate: options.currency ? "1,1" : null,
      amounts: (options.amounts ?? [{ taxRate: 1900, net: 25_000, tax: 4_750 }]).map((a) =>
        options.currency ? { ...a, net: 0, tax: 0, originalNet: a.net, originalTax: a.tax } : a,
      ),
      splits: options.splits === undefined ? GEBUEHREN : options.splits,
    });
    return id;
  }

  async function entryLines(documentId: string) {
    return sql`select l.account, l.debit, l.credit, l.tax_code from journal_lines l join journal_entries e on e.id = l.entry_id
      where e.source_type = 'document' and e.source_id = ${documentId} and e.reverses_id is null order by l.account, l.debit, l.credit`;
  }

  const byAccount = <T extends { account: string; debit: number; credit: number }>(lines: T[]) =>
    [...lines].sort((a, b) => a.account.localeCompare(b.account) || a.debit - b.debit || a.credit - b.credit);

  async function payFromBank(documentId: string, date: string, amount: string) {
    await bank.importStatement(
      actor,
      {
        bytes: dkbCsv([[date, date, "Gebucht", "Testfirma", "Beispiel Payments", "BP", "Ausgang", "IE29AIBK93115212345678", amount, "", "", ""]]),
        filename: `konto-${fileSeq}.csv`,
      },
      null,
    );
    const [t] = await sql`select id, amount from bank_transactions order by booking_date desc limit 1`;
    await bank.allocate(actor, { kind: "document", transactionId: t!.id as string, documentId, amount: t!.amount as number });
  }

  const ausgabe = (euer: Awaited<ReturnType<typeof reports.euerForYear>>, key: string) => euer.ausgaben.find((l) => l.key === key)?.amount ?? 0;

  /** Saldo (Soll − Haben) je Konto im DATEV-Buchungsstapel des Jahres */
  async function datevBalances() {
    await datev.saveDatevNumbers(actor, { beraterNr: "29098", mandantNr: "55003" });
    const stack = parseDatevBuchungsstapel((await datev.datevExport(2026, new Date(2026, 9, 20, 8, 0, 0))).bytes);
    const result: Record<string, number> = {};
    for (const b of stack.bookings) {
      const signed = b.side === "S" ? b.amount : -b.amount;
      result[b.account] = (result[b.account] ?? 0) + signed;
      result[b.contraAccount] = (result[b.contraAccount] ?? 0) - signed;
    }
    return result;
  }

  /** Bucht den Beleg (aufgeteilt oder mit einer Kategorie), bezahlt ihn und liefert, was Voranmeldung, EÜR und DATEV zeigen */
  async function scenario(kontenrahmen: "SKR03" | "SKR04", versteuerung: "ist" | "soll", rc: "eu" | "drittland", split: boolean) {
    await reset(kontenrahmen, versteuerung);
    const id = await draft({ reverseCharge: rc, splits: split ? GEBUEHREN : [] });
    await documents.bookDocument(actor, id);
    await payFromBank(id, "25.09.26", "-250,00");
    const september = await vat.computeVatFigures({ year: 2026, month: 9 });
    const euer = await reports.euerForYear(2026);
    return {
      id,
      vat: { base: september[KZ[rc][0]], tax: september[KZ[rc][1]], kz67: september.kz67, kz66: september.kz66 },
      vatAbgleich: (await abgleich.vatAbgleich({ year: 2026, month: 9 })).zeilen.filter((z) => z.journal !== z.quelle),
      euerAbgleich: (await abgleich.euerAbgleich(2026)).zeilen.filter((z) => z.journal !== z.quelle),
      euer,
      datev: await datevBalances(),
      openItems: (await bank.openItems()).filter((i) => i.type === "document"),
    };
  }

  for (const kontenrahmen of ["SKR03", "SKR04"] as const) {
    const k = KONTEN[kontenrahmen];
    for (const versteuerung of ["ist", "soll"] as const) {
      for (const rc of ["eu", "drittland"] as const) {
        const code = CODE[rc];

        it(`${kontenrahmen}, ${versteuerung}, ${rc}: Aufwand je Kategorie mit ${code}, Steuer einmal je Satz, Summen wie ohne Aufteilung`, async () => {
          const single = await scenario(kontenrahmen, versteuerung, rc, false);
          const split = await scenario(kontenrahmen, versteuerung, rc, true);

          expect(await entryLines(split.id)).toEqual(
            byAccount([
              { account: k.geld, debit: 12_000, credit: 0, tax_code: code },
              { account: k.fremd, debit: 6_000, credit: 0, tax_code: code },
              { account: k.sonstiges, debit: 2_000, credit: 0, tax_code: code },
              { account: k.werbung, debit: 5_000, credit: 0, tax_code: code },
              { account: k.vorsteuerRc, debit: 4_750, credit: 0, tax_code: "VSt13b" },
              { account: k.ustRc, debit: 0, credit: 4_750, tax_code: code },
              { account: k.verbindlichkeiten, debit: 0, credit: 25_000, tax_code: null },
            ]),
          );

          // Voranmeldung: Kz 46/47 bzw. 84/85 und 67 aus den Beträgen je Satz, wie ohne Aufteilung; Journal und Quelle stimmen
          expect(split.vat).toEqual({ base: 25_000, tax: 4_750, kz67: 4_750, kz66: 0 });
          expect(split.vat).toEqual(single.vat);
          expect(split.vatAbgleich).toEqual([]);

          // EÜR: Aufwand je Kontierungszeile; Summe und Vorsteuer wie ohne Aufteilung (§ 13b hebt sich auf, gezahlt ist netto)
          expect(ausgabe(split.euer, "ausgabe:geldverkehr")).toBe(12_000);
          expect(ausgabe(split.euer, "ausgabe:fremdleistung")).toBe(6_000);
          expect(ausgabe(split.euer, "ausgabe:sonstiges")).toBe(2_000);
          expect(ausgabe(split.euer, "ausgabe:werbung")).toBe(5_000);
          expect(ausgabe(split.euer, "vorsteuer")).toBe(ausgabe(single.euer, "vorsteuer"));
          expect(ausgabe(single.euer, "ausgabe:sonstiges")).toBe(25_000);
          expect(split.euer.totalAusgaben).toBe(single.euer.totalAusgaben);
          expect(split.euer.totalAusgaben).toBe(25_000);
          expect(split.euer.totalEinnahmen).toBe(single.euer.totalEinnahmen);
          expect(split.euerAbgleich).toEqual([]);

          // DATEV: Saldo der Steuerkonten, der Verbindlichkeit und der Bank wie ohne Aufteilung; der Aufwand je Kategorie
          for (const account of [k.ustRc, k.vorsteuerRc, k.verbindlichkeiten]) expect(split.datev[account] ?? 0).toBe(single.datev[account] ?? 0);
          expect(split.datev[k.ustRc]).toBe(-4_750);
          expect(split.datev[k.vorsteuerRc]).toBe(4_750);
          expect([k.geld, k.fremd, k.sonstiges, k.werbung].map((a) => split.datev[a])).toEqual([12_000, 6_000, 2_000, 5_000]);
          expect(single.datev[k.sonstiges]).toBe(25_000);

          // Ein offener Posten über netto, durch die Zahlung erledigt
          expect(split.openItems).toEqual([]);
        }, 30_000);

        it(`${kontenrahmen}, ${versteuerung}, ${rc}: Storno nimmt alle Zeilen zurück, Neuerfassung übernimmt Aufteilung und § 13b`, async () => {
          await reset(kontenrahmen, versteuerung);
          const id = await draft({ reverseCharge: rc, payment: "privat" });
          await documents.bookDocument(actor, id);
          await sql`insert into vat_returns (year, month, status, source, sent_at, locked_at) values (2026, 9, 'sent', 'manuell', now(), now())`;
          await cancellation.cancelDocument(actor, id, { reason: "Falsch aufgeteilt" }, "2026-10-05");

          const balances = await sql`select l.account, sum(l.debit - l.credit)::int as saldo from journal_lines l join journal_entries e on e.id = l.entry_id
            where e.source_id = ${id} group by l.account order by l.account`;
          expect(balances.map((b) => b.account).sort()).toEqual([k.geld, k.fremd, k.sonstiges, k.werbung, k.ustRc, k.vorsteuerRc, k.privat].sort());
          expect(balances.every((b) => b.saldo === 0)).toBe(true);
          const oktober = await vat.computeVatFigures({ year: 2026, month: 10 });
          expect([oktober[KZ[rc][0]], oktober[KZ[rc][1]], oktober.kz67]).toEqual([-25_000, -4_750, -4_750]);
          const euer = await reports.euerForYear(2026);
          for (const key of ["ausgabe:geldverkehr", "ausgabe:fremdleistung", "ausgabe:sonstiges", "ausgabe:werbung", "vorsteuer"])
            expect(ausgabe(euer, key)).toBe(0);

          const reentry = await cancellation.reenterDocument(actor, id);
          const copy = (await documents.getDocument(reentry))!;
          expect(copy.document).toMatchObject({ status: "neu", category: null, reverseCharge: rc, replacesDocumentId: id });
          expect(copy.splits.map(({ position, category, net, tax }) => ({ position, category, net, tax }))).toEqual([
            { position: 1, category: "geldverkehr", net: 12_000, tax: 2_280 },
            { position: 2, category: "fremdleistung", net: 6_000, tax: 1_140 },
            { position: 3, category: "sonstiges", net: 2_000, tax: 380 },
            { position: 4, category: "werbung", net: 5_000, tax: 950 },
          ]);
          expect(documents.bookingIssues(copy.document, copy.amounts, "2026-10-06", copy.splits)).toEqual([]);
          await documents.bookDocument(actor, reentry);
          expect((await entryLines(reentry)).filter((l) => l.tax_code === "VSt13b")).toEqual([
            { account: k.vorsteuerRc, debit: 4_750, credit: 0, tax_code: "VSt13b" },
          ]);
        }, 30_000);
      }
    }

    for (const rc of ["eu", "drittland"] as const) {
      it(`${kontenrahmen}, ${rc}: ohne Vorsteuerabzug Netto und Steueranteil je Zeile, keine Vorsteuer; Summen wie ohne Aufteilung`, async () => {
        const run = async (split: boolean) => {
          await reset(kontenrahmen, "ist", true);
          const id = await draft({ reverseCharge: rc, payment: "privat", splits: split ? GEBUEHREN : [] });
          await documents.bookDocument(actor, id);
          const september = await vat.computeVatFigures({ year: 2026, month: 9 });
          return {
            id,
            vat: [september[KZ[rc][0]], september[KZ[rc][1]], september.kz67],
            euer: await reports.euerForYear(2026),
            vatAbgleich: (await abgleich.vatAbgleich({ year: 2026, month: 9 })).zeilen.filter((z) => z.journal !== z.quelle),
          };
        };
        const single = await run(false);
        const split = await run(true);
        expect(await entryLines(split.id)).toEqual(
          byAccount([
            // Netto mit dem Steuerschlüssel, der Steueranteil als Aufwand daneben (#542)
            { account: k.geld, debit: 12_000, credit: 0, tax_code: CODE[rc] },
            { account: k.geld, debit: 2_280, credit: 0, tax_code: "keineVSt" },
            { account: k.fremd, debit: 6_000, credit: 0, tax_code: CODE[rc] },
            { account: k.fremd, debit: 1_140, credit: 0, tax_code: "keineVSt" },
            { account: k.sonstiges, debit: 2_000, credit: 0, tax_code: CODE[rc] },
            { account: k.sonstiges, debit: 380, credit: 0, tax_code: "keineVSt" },
            { account: k.werbung, debit: 5_000, credit: 0, tax_code: CODE[rc] },
            { account: k.werbung, debit: 950, credit: 0, tax_code: "keineVSt" },
            { account: k.ustRc, debit: 0, credit: 4_750, tax_code: CODE[rc] },
            { account: k.privat, debit: 0, credit: 25_000, tax_code: null },
          ]),
        );
        expect(split.vat).toEqual([25_000, 4_750, 0]);
        expect(split.vat).toEqual(single.vat);
        expect(split.vatAbgleich).toEqual([]);
        // EÜR: gezahlt ist netto; die geschuldete Steuer zählt erst mit der Voranmeldung, wie ohne Aufteilung
        expect(split.euer.totalAusgaben).toBe(single.euer.totalAusgaben);
        expect(ausgabe(split.euer, "vorsteuer")).toBe(0);
        const categories = ["geldverkehr", "fremdleistung", "sonstiges", "werbung"].map((c) => ausgabe(split.euer, `ausgabe:${c}`));
        expect(categories).toEqual([12_000, 6_000, 2_000, 5_000]);
      }, 30_000);
    }
  }

  for (const rc of ["eu", "drittland"] as const) {
    it(`${rc}: alle offenen Gebühren des Monats dem aufgeteilten Beleg zuordnen`, async () => {
      await reset("SKR03", "ist");
      const stripe = await bank.createProviderAccount(actor, { name: "Stripe", provider: "stripe" });
      const csv = [
        `id,Type,Source,Amount,Fee,Net,Currency,Created (UTC),Available On (UTC),Description`,
        `txn_1,charge,ch_1,100.00,1.50,98.50,eur,2026-10-01 10:00:00,2026-10-08 00:00:00,A`,
        `txn_2,charge,ch_2,200.00,3.00,197.00,eur,2026-10-15 10:00:00,2026-10-22 00:00:00,B`,
      ].join("\n");
      await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `stripe-${rc}.csv` }, stripe.id);
      // 4,50 € netto zu 19 % = 0,86 € § 13b; 0,57 € und 0,29 € je Zeile
      const id = await draft({
        reverseCharge: rc,
        documentDate: "2026-10-31",
        amounts: [{ taxRate: 1900, net: 450, tax: 86 }],
        splits: [
          { category: "geldverkehr", taxRate: 1900, net: 300 },
          { category: "werbung", taxRate: 1900, net: 150 },
        ],
      });
      await documents.bookDocument(actor, id);
      const [firstFee] = await sql`select id from bank_transactions where amount = -150`;
      expect(await bank.allocateFeesToDocument(actor, { transactionId: firstFee!.id, documentId: id })).toBe(2);
      expect((await bank.openItems()).filter((i) => i.type === "document")).toEqual([]);
      const euer = await reports.euerForYear(2026);
      expect(ausgabe(euer, "ausgabe:geldverkehr")).toBe(300);
      expect(ausgabe(euer, "ausgabe:werbung")).toBe(150);
      expect(euer.totalAusgaben).toBe(450);
      const oktober = await vat.computeVatFigures({ year: 2026, month: 10 });
      expect([oktober[KZ[rc][0]], oktober[KZ[rc][1]], oktober.kz67]).toEqual([450, 86, 86]);
    }, 30_000);
  }

  it("lehnt weiter ab: innergemeinschaftlicher Erwerb, Privatanteil und Fremdwährung mit Aufteilung, § 13b auf Wareneinkauf", async () => {
    await reset("SKR03", "soll");
    const ige = await draft({ reverseCharge: "ig_erwerb", splits: GEBUEHREN.map((s) => ({ ...s, category: "software" as const })) });
    await expect(documents.bookDocument(actor, ige)).rejects.toThrow(/Innergemeinschaftlicher Erwerb mit Aufteilung wird nicht unterstützt/);
    const privat = await draft({ reverseCharge: "eu", privateShare: 20 });
    await expect(documents.bookDocument(actor, privat)).rejects.toThrow(/Privatanteil mit Aufteilung/);
    const usd = await draft({ reverseCharge: "drittland", currency: "USD" });
    await expect(documents.bookDocument(actor, usd)).rejects.toThrow(/Fremdwährung mit Aufteilung/);
    const ware = await draft({
      reverseCharge: "eu",
      splits: [
        { category: "wareneinkauf", taxRate: 1900, net: 20_000 },
        { category: "werbung", taxRate: 1900, net: 5_000 },
      ],
    });
    await expect(documents.bookDocument(actor, ware)).rejects.toThrow(/§ 13b gilt nicht für Wareneinkäufe/);
    expect(await sql`select count(*)::int as n from journal_entries`).toEqual([{ n: 0 }]);
  });
});
