import { ACCOUNTS, EXPENSE_CATEGORIES } from "@haben/core";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Ausgleich einer Gutschrift „erstattet bereits Bezahltes“ (#786, Etappe 2): Jeder Weg, der den offenen Posten mindert —
 * Bankerstattung, Verrechnung und Ausbuchung (Skonto, Kursdifferenz) —, bucht den Anteil vom Zwischenkonto (SKR03 1548,
 * SKR04 1434) auf die Vorsteuer um, mit Steuerschlüssel und Bemessungsgrundlage (§ 17 Abs. 1 Satz 2 und 8 UStG). Der
 * Anteil ist anteilig je Steuersatz und fortgeschrieben wie settlementTaxShares, damit mehrere Teilausgleiche zusammen
 * genau die Vorsteuer des Belegs ergeben. Ohne die Angabe, bei Kleinunternehmern und bei Belegen, deren Buchung nichts
 * auf das Zwischenkonto gelegt hat (Altbestand), wird nichts umgebucht: sonst entstünde eine zweite Minderung.
 */

type Profil = { kr: "SKR03" | "SKR04"; versteuerung: "ist" | "soll" };

const profile: Profil[] = [
  { kr: "SKR03", versteuerung: "ist" },
  { kr: "SKR03", versteuerung: "soll" },
  { kr: "SKR04", versteuerung: "ist" },
  { kr: "SKR04", versteuerung: "soll" },
];

const KONTEN = {
  SKR03: { zwischen: "1548", vorsteuer: "1576", vorsteuer7: "1571", verbindlichkeiten: "1600", bank: "1200" },
  SKR04: { zwischen: "1434", vorsteuer: "1406", vorsteuer7: "1401", verbindlichkeiten: "3300", bank: "1800" },
} as const;

describe.skipIf(!testDatabaseUrl)("Vorsteuer aus dem Zwischenkonto beim Ausgleich (#786, Etappe 2)", () => {
  let documents: typeof import("../belege/documents.ts");
  let bank: typeof import("./index.ts");
  let verrechnung: typeof import("./verrechnung.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let ledger: typeof import("../buchhaltung/index.ts");
  let sql: postgres.Sql;
  const actor = "vorsteuer-ausgleich";
  let lauf = 0;
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 17]);

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("../belege/documents.ts");
    bank = await import("./index.ts");
    verrechnung = await import("./verrechnung.ts");
    vat = await import("../umsatzsteuer/index.ts");
    ledger = await import("../buchhaltung/index.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  /** Firma im gewünschten Profil; jeder Fall beginnt bei null */
  async function firma(p: Profil, optionen: { kleinunternehmer?: boolean; rechtsform?: string } = {}) {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, year_closings, write_offs, allocations,
      cash_entries, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, document_amounts,
      document_splits, documents, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, rechtsform, kleinunternehmer, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${p.versteuerung}, ${p.kr}, ${optionen.rechtsform ?? "einzelunternehmen"},
              ${optionen.kleinunternehmer ?? false}, 14)`;
  }

  type Betrag = { taxRate: 0 | 700 | 1900; net: number; tax: number; originalNet?: number; originalTax?: number };

  /** Gebuchter Beleg über die Bank; negative Beträge ergeben eine Gutschrift des Lieferanten */
  async function beleg(input: { datum: string; amounts: Betrag[]; erstattetBezahltes?: boolean; currency?: string; exchangeRate?: string | null }) {
    lauf++;
    const bytes = new Uint8Array([...JPEG, lauf % 251, Math.floor(lauf / 251)]);
    const { id } = await documents.uploadDocument(actor, { bytes, filename: `beleg-${lauf}.jpg` });
    await documents.updateDocument(actor, id, {
      supplierName: "Stadtwerke Beispiel GmbH",
      supplierUstId: "",
      invoiceNumber: `B-${lauf}`,
      documentDate: input.datum,
      dueDate: null,
      category: "software",
      payment: "bank",
      note: "",
      erstattetBezahltes: input.erstattetBezahltes ?? false,
      currency: input.currency ?? "EUR",
      exchangeRate: input.exchangeRate ?? null,
      amounts: input.amounts,
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  /** Echter Bankumsatz mit einem Betrag (Cent, negativ = Ausgang); gibt die Umsatz-Id zurück */
  async function bankumsatz(betrag: number, datum: string) {
    const euro = (Math.abs(betrag) / 100).toFixed(2).replace(".", ",");
    const [jahr, monat, tag] = datum.split("-");
    const csv =
      `"Girokonto";"DE89 3704 0044 0532 0130 00"\n\n` +
      `"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"\n` +
      `"${tag}.${monat}.${jahr!.slice(2)}";"${tag}.${monat}.${jahr!.slice(2)}";"Gebucht";"Stadtwerke Beispiel GmbH";"Testfirma";"Erstattung";"${betrag < 0 ? "Ausgang" : "Eingang"}";"DE02100100100006820101";"${betrag < 0 ? "-" : ""}${euro}";"";"";""\n`;
    await bank.importStatement(actor, { bytes: new TextEncoder().encode(csv), filename: `zahlung-${++lauf}.csv` }, null);
    const [umsatz] = await sql`select id from bank_transactions order by created_at desc limit 1`;
    return umsatz!.id as string;
  }

  /** Bankumsatz und Zuordnung auf den Beleg */
  async function zahlung(documentId: string, betrag: number, datum: string) {
    const umsatz = await bankumsatz(betrag, datum);
    await bank.allocate(actor, { kind: "document", transactionId: umsatz, documentId, amount: betrag });
    return umsatz;
  }

  /** Saldo je Konto (Soll − Haben), Konten mit Saldo 0 fehlen */
  async function salden() {
    return Object.fromEntries(
      (await sql`select account, sum(debit - credit)::int as saldo from journal_lines group by account having sum(debit - credit) <> 0 order by 1`).map((r) => [
        r.account,
        r.saldo,
      ]),
    ) as Record<string, number>;
  }

  /** Die Umbuchungszeilen aller Ausgleichsbuchungen: nur die Buchungen der Ausgleichswege, nicht die Belegbuchung */
  async function umbuchungen(p: Profil) {
    const k = KONTEN[p.kr];
    const rows = await sql`select l.account, l.debit, l.credit, l.tax_code, l.basis
        from journal_lines l join journal_entries e on e.id = l.entry_id
       where e.source_type in ('allocation', 'ausbuchung', 'verrechnung')
         and l.account in (${k.zwischen}, ${k.vorsteuer}, ${k.vorsteuer7})`;
    return rows.map((r) => ({ account: r.account, debit: r.debit, credit: r.credit, tax_code: r.tax_code, basis: r.basis }));
  }

  for (const p of profile) {
    const k = KONTEN[p.kr];
    const aufwand = EXPENSE_CATEGORIES.software[p.kr];
    const skonti = ACCOUNTS[p.kr].skontiErhalten;
    const kursAufwand = ACCOUNTS[p.kr].kursAufwand;
    const name = `${p.kr}, ${p.versteuerung}`;

    it(`${name}: Bankerstattung bucht vom Zwischenkonto auf die Vorsteuer um`, async () => {
      await firma(p);
      const id = await beleg({ datum: "2026-09-15", amounts: [{ taxRate: 1900, net: -10_000, tax: -1_900 }], erstattetBezahltes: true });
      // Im Belegmonat steht die Minderung auf dem Zwischenkonto, die Vorsteuer ist unberührt
      expect(await salden()).toEqual({ [aufwand]: -10_000, [k.zwischen]: -1_900, [k.verbindlichkeiten]: 11_900 });
      expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(0);

      await zahlung(id, 11_900, "2026-09-20");

      // Mit der Erstattung: Zwischenkonto ausgeglichen, Vorsteuer gemindert, sonst nichts
      expect(await salden()).toEqual({ [aufwand]: -10_000, [k.bank]: 11_900, [k.vorsteuer]: -1_900 });
      expect(await umbuchungen(p)).toEqual([
        { account: k.zwischen, debit: 1_900, credit: 0, tax_code: "VSt19", basis: 10_000 },
        { account: k.vorsteuer, debit: 0, credit: 1_900, tax_code: "VSt19", basis: null },
      ]);
      expect((await vat.computeVatFigures({ year: 2026, month: 9 })).kz66).toBe(-1_900);
    }, 30_000);

    it(`${name}: Verrechnung bucht den Anteil um, anteilig nach dem verrechneten Teil`, async () => {
      await firma(p);
      const rechnung = await beleg({ datum: "2026-02-10", amounts: [{ taxRate: 1900, net: 10_000, tax: 1_900 }] });
      const gutschrift = await beleg({ datum: "2026-02-16", amounts: [{ taxRate: 1900, net: -10_000, tax: -1_900 }], erstattetBezahltes: true });
      // Hälfte verrechnet: 950,00 € vom Zwischenkonto auf die Vorsteuer; Kz 66 sieht die Rechnung (+19,00 €) und die
      // Minderung (−9,50 €) zusammen
      await verrechnung.settleDocuments(actor, {
        documentId: rechnung,
        counterDocumentId: gutschrift,
        amount: 5_950,
        date: "2026-02-16",
        note: "Teilverrechnung",
      });

      // Der Aufwand der Rechnung und der Gutschrift hebt sich auf; offen bleibt die halbe Vorsteuer
      expect(await salden()).toEqual({ [k.zwischen]: -950, [k.vorsteuer]: 950 });
      expect(await umbuchungen(p)).toEqual([
        { account: k.zwischen, debit: 950, credit: 0, tax_code: "VSt19", basis: 5_000 },
        { account: k.vorsteuer, debit: 0, credit: 950, tax_code: "VSt19", basis: null },
      ]);
      expect((await vat.computeVatFigures({ year: 2026, month: 2 })).kz66).toBe(950);
      expect((await vat.computeVatFigures({ year: 2026, month: 1 })).kz66).toBe(0);
    }, 30_000);

    it(`${name}: Ausbuchung als Skonto bucht den Rest des Zwischenkontos um`, async () => {
      await firma(p);
      const id = await beleg({ datum: "2026-03-10", amounts: [{ taxRate: 1900, net: -10_000, tax: -1_900 }], erstattetBezahltes: true });
      // 100,00 € erstattet, 19,00 € bleiben offen und werden als Skonto ausgebucht
      await zahlung(id, 10_000, "2026-03-20");
      await bank.writeOff(actor, { kind: "skontoErhalten", documentId: id, date: "2026-03-20" });

      // 1.597 Cent der Minderung zieht die Erstattung, die restlichen 303 erstattet niemand: sie werden vom
      // Zwischenkonto abgeschrieben, nicht als Vorsteuer gezogen (§ 17 Abs. 1 Satz 2 UStG)
      expect(await salden()).toEqual({ [aufwand]: -10_000, [k.bank]: 10_000, [skonti]: 1_597, [k.vorsteuer]: -1_597 });
      const umgebucht = (await umbuchungen(p)).filter((z) => z.account === k.zwischen).reduce((sum, z) => sum + z.debit - z.credit, 0);
      expect(umgebucht).toBe(1_900);
      expect((await vat.computeVatFigures({ year: 2026, month: 3 })).kz66).toBe(-1_597);
    }, 30_000);

    it(`${name}: Ausbuchung als Kursdifferenz bucht den Rest ebenfalls um`, async () => {
      await firma(p);
      const id = await beleg({
        datum: "2026-04-10",
        amounts: [{ taxRate: 1900, net: 0, tax: 0, originalNet: -10_000, originalTax: -1_900 }],
        erstattetBezahltes: true,
        currency: "USD",
        exchangeRate: "1,0812",
      });
      const [doc] = await sql`select net, tax, gross from documents where id = ${id}`;
      const offen = Math.abs(doc!.gross as number);
      const umsatz = await bankumsatz(offen - 6, "2026-04-20");
      await bank.allocateWithRest(actor, { transactionId: umsatz, target: { kind: "document", documentId: id }, rest: "kursdifferenz" });

      // Die Steuer bleibt beim Kurs des Belegs; die 6 Cent Kursdifferenz ziehen ihren Anteil (1 Cent) mit um
      expect(await salden()).toEqual({
        [aufwand]: doc!.net as number,
        [k.bank]: offen - 6,
        [kursAufwand]: 6,
        [k.vorsteuer]: doc!.tax as number,
      });
      const umgebucht = (await umbuchungen(p)).filter((z) => z.account === k.zwischen).reduce((sum, z) => sum + z.debit - z.credit, 0);
      expect(umgebucht).toBe(-(doc!.tax as number));
    }, 30_000);

    it(`${name}: Teilerstattungen ergeben zusammen genau die Vorsteuer des Belegs`, async () => {
      await firma(p);
      const id = await beleg({
        datum: "2026-05-10",
        amounts: [
          { taxRate: 1900, net: -6_000, tax: -1_140 },
          { taxRate: 700, net: -4_000, tax: -280 },
        ],
        erstattetBezahltes: true,
      });
      expect(await salden()).toMatchObject({ [k.zwischen]: -1_420 });

      await zahlung(id, 3_806, "2026-05-20");
      expect(await salden()).toMatchObject({ [k.zwischen]: -947 });
      await zahlung(id, 3_806, "2026-05-25");
      await zahlung(id, 3_808, "2026-05-30");

      // Kein Rundungsrest: 473 + 473 + 474 = 1.420 Cent
      expect(await salden()).toEqual({
        [aufwand]: -10_000,
        [k.bank]: 11_420,
        [k.vorsteuer]: -1_140,
        [k.vorsteuer7]: -280,
      });
      const nachSatz = new Map<string, number>();
      for (const zeile of await umbuchungen(p)) {
        if (zeile.account !== k.zwischen) continue;
        nachSatz.set(zeile.tax_code ?? "", (nachSatz.get(zeile.tax_code ?? "") ?? 0) + zeile.debit - zeile.credit);
      }
      expect([...nachSatz]).toEqual([
        ["VSt19", 1_140],
        ["VSt7", 280],
      ]);
    }, 30_000);

    it(`${name}: Jahreswechsel — Gutschrift im Dezember, Erstattung im Januar`, async () => {
      await firma(p);
      const id = await beleg({ datum: "2026-12-15", amounts: [{ taxRate: 1900, net: -10_000, tax: -1_900 }], erstattetBezahltes: true });
      // Der Saldo bleibt als Bestandskonto über den Jahreswechsel stehen, im Dezember mindert er Kz 66 nicht
      expect(await salden()).toMatchObject({ [k.zwischen]: -1_900 });
      expect((await vat.computeVatFigures({ year: 2026, month: 12 })).kz66).toBe(0);

      await zahlung(id, 11_900, "2027-01-05");

      // Die Minderung entsteht im Januar, nicht rückwirkend im Dezember
      expect(await salden()).toEqual({ [aufwand]: -10_000, [k.bank]: 11_900, [k.vorsteuer]: -1_900 });
      expect((await vat.computeVatFigures({ year: 2027, month: 1 })).kz66).toBe(-1_900);
      expect((await vat.computeVatFigures({ year: 2026, month: 12 })).kz66).toBe(0);
    }, 30_000);

    it(`${name}: Aufhebung nimmt die Umbuchung mit zurück`, async () => {
      await firma(p);
      const id = await beleg({ datum: "2026-06-15", amounts: [{ taxRate: 1900, net: -10_000, tax: -1_900 }], erstattetBezahltes: true });
      const umsatz = await zahlung(id, 11_900, "2026-06-20");
      expect(await salden()).toMatchObject({ [k.vorsteuer]: -1_900 });
      const [allocation] = await sql`select id from allocations where transaction_id = ${umsatz}`;

      // Die Aufhebung trägt ihr eigenes Datum (#782); ohne Datum bucht sie heute und der Juni bliebe gemindert
      await bank.reverseAllocation(actor, allocation!.id as string, "2026-06-20");

      // Gegenbuchung am Tag des Stornos: der Zwischenkontosaldo steht wieder, die Vorsteuer ist unberührt
      expect(await salden()).toEqual({ [aufwand]: -10_000, [k.zwischen]: -1_900, [k.verbindlichkeiten]: 11_900 });
      expect((await vat.computeVatFigures({ year: 2026, month: 6 })).kz66).toBe(0);
      const [gegen] = await sql`select date, reverses_id from journal_entries where source_type = 'allocation' and reverses_id is not null`;
      expect(gegen).toMatchObject({ date: "2026-06-20" });
    }, 30_000);

    it(`${name}: Kleinunternehmer buchen nichts um`, async () => {
      await firma(p, { kleinunternehmer: true });
      const id = await beleg({ datum: "2026-07-15", amounts: [{ taxRate: 1900, net: -10_000, tax: -1_900 }], erstattetBezahltes: true });
      expect(await salden()).toEqual({ [aufwand]: -11_900, [k.verbindlichkeiten]: 11_900 });

      await zahlung(id, 11_900, "2026-07-20");

      expect(await salden()).toEqual({ [aufwand]: -11_900, [k.bank]: 11_900 });
      expect(await umbuchungen(p)).toEqual([]);
    }, 30_000);

    it(`${name}: Altbestand ohne Buchung auf dem Zwischenkonto bucht nichts um`, async () => {
      await firma(p);
      // Ohne die Angabe: die Vorsteuer ist schon im Belegmonat gemindert, eine Umbuchung wäre eine zweite Minderung
      const id = await beleg({ datum: "2026-08-15", amounts: [{ taxRate: 1900, net: -10_000, tax: -1_900 }] });
      expect(await salden()).toMatchObject({ [k.vorsteuer]: -1_900 });

      await zahlung(id, 11_900, "2026-08-20");

      expect(await salden()).toEqual({ [aufwand]: -10_000, [k.bank]: 11_900, [k.vorsteuer]: -1_900 });
      const [zeilen] = await sql`select count(*)::int as n from journal_lines where account = ${k.zwischen}`;
      expect(zeilen!.n).toBe(0);
    }, 30_000);
  }

  it("Jahreswechsel (GmbH): der offene Saldo steht in der Eröffnung und wird im Januar ausgeglichen", async () => {
    await firma({ kr: "SKR03", versteuerung: "soll" }, { rechtsform: "gmbh" });
    const id = await beleg({ datum: "2026-12-15", amounts: [{ taxRate: 1900, net: -10_000, tax: -1_900 }], erstattetBezahltes: true });

    const zeilen = await ledger.saldenliste({ from: "2027-01-01", to: "2027-12-31" });
    // Bestandskonto: der Saldo läuft ins neue Jahr, damit die Erstattung im Januar ihn noch trifft
    expect(zeilen.find((z) => z.account === KONTEN.SKR03.zwischen)).toMatchObject({ eroeffnung: -1_900, soll: 0, haben: 0, saldo: -1_900 });

    await zahlung(id, 11_900, "2027-01-05");

    // Im Januar steht die Minderung, und der Saldo des Zwischenkontos ist danach ausgeglichen
    expect(await salden()).toEqual({ "4964": -10_000, "1200": 11_900, "1576": -1_900 });
    expect((await ledger.saldenliste({ from: "2027-01-01", to: "2027-12-31" })).find((z) => z.account === KONTEN.SKR03.zwischen)?.saldo).toBe(0);
  }, 30_000);
});
