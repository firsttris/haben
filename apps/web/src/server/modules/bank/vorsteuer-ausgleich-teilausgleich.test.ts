import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { leeren, setupTestDb, testDatabaseUrl } from "../../test-db.ts";

/*
 * Teilausgleich über die Verrechnung, Aufhebung, Storno und 0 % (#786).
 * Die Fälle, die die Etappen 1–4 nicht abdecken: Eine Gutschrift „erstattet bereits Bezahltes“ wird in mehreren
 * Verrechnungen getilgt (nicht per Bank) und danach aufgehoben, eine gebuchte wird storniert, eine zu 0 % trägt nichts
 * auf das Konto. Der Skonto-Fall hält den Rundungsrest fest: Teilerstattung und Skonto auf den Rest ergeben zusammen
 * genau die Vorsteuer des Belegs, kein Cent bleibt auf dem Zwischenkonto stehen.
 */

type Profil = { kr: "SKR03" | "SKR04"; versteuerung: "ist" | "soll" };

const KONTEN = {
  SKR03: { zwischen: "1548", vorsteuer: "1576", verrechnung: "1590", verbindlichkeiten: "1600" },
  SKR04: { zwischen: "1434", vorsteuer: "1406", verrechnung: "1370", verbindlichkeiten: "3300" },
} as const;

describe.skipIf(!testDatabaseUrl)("Teilausgleich, Aufhebung und Storno einer Gutschrift „erstattet bereits Bezahltes“ (Postgres, #786)", () => {
  let documents: typeof import("../belege/documents.ts");
  let cancellation: typeof import("../belege/cancellation.ts");
  let verrechnung: typeof import("./verrechnung.ts");
  let bank: typeof import("./index.ts");
  let vat: typeof import("../umsatzsteuer/index.ts");
  let sql: postgres.Sql;
  const actor = "selbstpruefung";
  let lauf = 0;
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 55]);

  beforeAll(async () => {
    sql = await setupTestDb();
    documents = await import("../belege/documents.ts");
    cancellation = await import("../belege/cancellation.ts");
    verrechnung = await import("./verrechnung.ts");
    bank = await import("./index.ts");
    vat = await import("../umsatzsteuer/index.ts");
  }, 60_000);

  afterAll(async () => {
    await sql?.end();
  });

  async function firma(p: Profil) {
    await leeren(sql)`truncate document_cancellations, document_settlements, vat_returns, year_closings, write_offs, allocations,
      cash_entries, bank_transactions, bank_imports, bank_accounts, journal_lines, journal_entries, document_amounts,
      document_splits, documents, contact_versions, contacts, company cascade`;
    await sql`insert into company (id, name, strasse, plz, ort, email, telefon, steuernummer, ust_id, bundesland, iban,
        versteuerung, kontenrahmen, rechtsform, kleinunternehmer, payment_term_days)
      values (1, 'Testfirma', 'Musterstraße 1', '93047', 'Regensburg', 'rechnung@example.com', '+49 941 1', '198/113/10010',
              'DE123456789', 'BY', 'DE89370400440532013000', ${p.versteuerung}, ${p.kr}, 'einzelunternehmen', false, 14)`;
  }

  async function beleg(input: { datum: string; net: number; tax: number; erstattetBezahltes?: boolean }) {
    lauf++;
    const bytes = new Uint8Array([...JPEG, lauf % 251]);
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
      amounts: [{ taxRate: input.tax === 0 && input.net < 0 ? 0 : 1900, net: input.net, tax: input.tax }],
    });
    await documents.bookDocument(actor, id);
    return id;
  }

  /** Echter Bankumsatz; Betrag positiv = Eingang (Erstattung des Lieferanten) */
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

  async function zahlung(documentId: string, betrag: number, datum: string) {
    const umsatz = await bankumsatz(betrag, datum);
    await bank.allocate(actor, { kind: "document", transactionId: umsatz, documentId, amount: betrag });
  }

  const verrechne = (rechnung: string, gutschrift: string, amount: number, date: string) =>
    verrechnung.settleDocuments(actor, { documentId: rechnung, counterDocumentId: gutschrift, amount, date, note: "Teilverrechnung" });

  /** Bewegung des Zwischenkontos und der Vorsteuer */
  async function saldo(p: Profil) {
    const k = KONTEN[p.kr];
    const [row] = await sql`select
        coalesce(sum(case when account = ${k.zwischen} then debit - credit end), 0)::int as zwischen,
        coalesce(sum(case when account = ${k.vorsteuer} then debit - credit end), 0)::int as vorsteuer
      from journal_lines`;
    return { zwischen: row!.zwischen as number, vorsteuer: row!.vorsteuer as number };
  }

  for (const p of [
    { kr: "SKR03", versteuerung: "soll" },
    { kr: "SKR04", versteuerung: "ist" },
  ] as const) {
    it(`${p.kr}: drei Teilverrechnungen ergeben zusammen genau die Vorsteuer`, async () => {
      await firma(p);
      const rechnung = await beleg({ datum: "2026-02-10", net: 10_000, tax: 1_900 });
      const gutschrift = await beleg({ datum: "2026-02-16", net: -10_000, tax: -1_900, erstattetBezahltes: true });

      await verrechne(rechnung, gutschrift, 3_806, "2026-02-20");
      await verrechne(rechnung, gutschrift, 3_806, "2026-02-21");
      await verrechne(rechnung, gutschrift, 4_288, "2026-02-22");

      // Vereinigung: Rechnung und Gutschrift heben sich auf, das Zwischenkonto ist leer, die Vorsteuer ganz gemindert
      expect(await saldo(p)).toEqual({ zwischen: 0, vorsteuer: 0 });
      const [buchungen] = await sql`select count(*)::int as n from journal_entries where source_type = 'verrechnung'`;
      expect(buchungen!.n).toBe(6);
      expect((await vat.computeVatFigures({ year: 2026, month: 2 })).kz66).toBe(0);
    }, 30_000);

    it(`${p.kr}: Aufhebung einer Verrechnung stellt die Journalzeilen wieder her`, async () => {
      await firma(p);
      const rechnung = await beleg({ datum: "2026-03-10", net: 10_000, tax: 1_900 });
      const gutschrift = await beleg({ datum: "2026-03-16", net: -10_000, tax: -1_900, erstattetBezahltes: true });
      const { ids } = await verrechne(rechnung, gutschrift, 5_950, "2026-03-20");
      expect(await saldo(p)).toEqual({ zwischen: -950, vorsteuer: 950 });

      await verrechnung.reverseSettlement(actor, ids[0]!, "2026-03-25", "");

      // Der Saldo steht wieder wie vor der Verrechnung, und die Gegenbuchung ist Zeile für Zeile das Spiegelbild
      expect(await saldo(p)).toEqual({ zwischen: -1_900, vorsteuer: 1_900 });
      const [original] = await sql`select id from journal_entries
        where source_type = 'verrechnung' and reverses_id is null and source_id = ${ids[1]!}`;
      const [gegen] = await sql`select id, date from journal_entries where reverses_id = ${original!.id as string}`;
      expect(gegen).toMatchObject({ date: "2026-03-25" });
      const zeilen = await sql`select entry_id, account, debit, credit, tax_code, basis from journal_lines
        where entry_id in (${original!.id as string}, ${gegen!.id as string}) order by account, debit desc`;
      const jeBuchung = new Map<
        string,
        { entry_id: string; account: string; debit: number; credit: number; tax_code: string | null; basis: number | null }[]
      >();
      for (const z of zeilen) {
        const id = z.entry_id as string;
        jeBuchung.set(id, [...(jeBuchung.get(id) ?? []), z as never]);
      }
      const [a, b] = [...jeBuchung.values()];
      expect(a).toHaveLength(4);
      expect(b).toHaveLength(4);
      expect(a!.map((z) => `${z.account}|${z.debit}|${z.credit}|${z.tax_code}|${z.basis ?? ""}`).sort()).toEqual(
        b!.map((z) => `${z.account}|${z.credit}|${z.debit}|${z.tax_code}|${z.basis == null ? "" : -z.basis}`).sort(),
      );
      expect((await vat.computeVatFigures({ year: 2026, month: 3 })).kz66).toBe(1_900);
    }, 30_000);
  }

  it("Teilerstattung und Skonto auf den Rest ziehen zusammen genau die Vorsteuer", async () => {
    const p = { kr: "SKR03", versteuerung: "soll" } as const;
    await firma(p);
    // 7,80 € netto, 1,48 € Vorsteuer (19 %), 9,28 € brutto; 5,80 € erstattet, 3,48 € als Skonto ausgebucht
    const gutschrift = await beleg({ datum: "2026-07-10", net: -780, tax: -148, erstattetBezahltes: true });
    await zahlung(gutschrift, 580, "2026-07-20");
    await bank.writeOff(actor, { kind: "skontoErhalten", documentId: gutschrift, date: "2026-07-20" });

    // Das Zwischenkonto ist leer und die Vorsteuer genau um die Steuer des Belegs gemindert
    expect(await saldo(p)).toEqual({ zwischen: 0, vorsteuer: -93 });
  }, 30_000);

  it("Storno einer gebuchten Gutschrift hebt das Zwischenkonto wieder auf", async () => {
    await firma({ kr: "SKR03", versteuerung: "soll" });
    const gutschrift = await beleg({ datum: "2026-04-10", net: -10_000, tax: -1_900, erstattetBezahltes: true });
    expect(await saldo({ kr: "SKR03", versteuerung: "soll" })).toEqual({ zwischen: -1_900, vorsteuer: 0 });

    // Monat gemeldet: die Gegenbuchung steht am Tag des Stornos, nicht rückwirkend
    await sql`insert into vat_returns (year, month, status, kz81, kz86, kz66, kz83, sent_at) values (2026, 4, 'sent', 0, 0, 0, 0, now())`;
    await cancellation.cancelDocument(actor, gutschrift, { reason: "Fehlerfassung" }, "2026-06-02");

    expect(await saldo({ kr: "SKR03", versteuerung: "soll" })).toEqual({ zwischen: 0, vorsteuer: 0 });
    const [gegen] = await sql`select date from journal_entries where source_type = 'document' and reverses_id is not null`;
    expect(gegen).toMatchObject({ date: "2026-06-02" });
    expect((await vat.computeVatFigures({ year: 2026, month: 4 })).kz66).toBe(0);
    expect((await vat.computeVatFigures({ year: 2026, month: 6 })).kz66).toBe(0);
  }, 30_000);

  it("0 %: die Angabe legt nichts auf das Zwischenkonto", async () => {
    await firma({ kr: "SKR03", versteuerung: "soll" });
    const gutschrift = await beleg({ datum: "2026-05-10", net: -10_000, tax: 0, erstattetBezahltes: true });
    expect(await saldo({ kr: "SKR03", versteuerung: "soll" })).toEqual({ zwischen: 0, vorsteuer: 0 });
    const [zeilen] = await sql`select count(*)::int as n from journal_lines where account in ('1548', '1576')`;
    expect(zeilen!.n).toBe(0);
    expect(gutschrift).toBeTruthy();
  }, 30_000);
});
