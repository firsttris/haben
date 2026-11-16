import { ACCOUNTS, gleicheSalden, paymentProviderAccount, type Cents, type Kontenrahmen, type PostingLine, type Rechtsform } from "@haben/core";
import { and, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { belegZeilen, loadSplits } from "../belege/index.ts";
import { loadOwnAccountNumbers } from "../eigene-konten/index.ts";
import { invoiceTaxReader } from "../rechnungen/index.ts";

/*
 * Vorgang gegen Buchung (#1116): Jeder gespeicherte Vorgang muss genau seine Buchung mit seinen Beträgen haben. Statt die
 * Voranmeldung oder die EÜR ein zweites Mal aus den Nebenbüchern zu rechnen, vergleicht der Abgleich jeden Vorgang mit
 * seiner Buchung im Journal:
 * - Beleg: je Konto der Saldo der Buchung gegen die Zeilen, die Haben aus Beträgen, Aufteilung und Angaben des Belegs bucht
 *   (belegZeilen), also Aufwand, Vorsteuer, § 13b, Erwerb, Einfuhrumsatzsteuer, Privatanteil und Gegenkonto auf einmal;
 * - Zuordnung im Bankabgleich: ihr Betrag gegen die Zeile auf dem Bank- bzw. Verrechnungskonto ihrer Buchung;
 * - Kassenbuch: die Beträge der Zeilen gegen das Kassenkonto ihrer Buchung;
 * - Pauschale: ihr Betrag gegen das Aufwandskonto ihrer Buchung;
 * - Rechnung bei Ist, ganz erledigt: Die „nicht fällige“ Umsatzsteuer ihrer Buchungen (Rechnung, Zahlungen, Ausbuchungen,
 *   Bareinnahmen) ist auf den Cent null. So fällt auch ein systematischer Rest auf, den die Verprobung je Buchung mit ihrer
 *   Toleranz nicht sieht.
 *
 * Nicht verglichen: aus Lexoffice übernommene Belege und Rechnungen (gebucht gegen den Saldenvortrag), Zuordnungen auf
 * privaten Konten (sie buchen auf Privatkonten), Kassenzeilen aus dem Datenimport (sie hängen an einer Originalbuchung)
 * und Rechnungen mit Anzahlungen, Korrekturen oder Verrechnungen (eigene Buchungsketten, OPOS-Abgleich).
 */

export interface VorgangZeile {
  zeitraum: string;
  posten: string;
  journal: Cents;
  vorgang: Cents;
}

type Zeile = { entryId: string; account: string; debit: number; credit: number; taxCode: string | null };

const saldo = (zeilen: readonly Zeile[], konten: ReadonlySet<string>) =>
  zeilen.filter((z) => konten.has(z.account)).reduce((s, z) => s + z.debit - z.credit, 0);

async function zeilenVon(q: Db | Tx, entryIds: string[]): Promise<Map<string, Zeile[]>> {
  const result = new Map<string, Zeile[]>();
  for (let i = 0; i < entryIds.length; i += 5000) {
    const block = entryIds.slice(i, i + 5000);
    const l = schema.journalLines;
    for (const z of await q
      .select({ entryId: l.entryId, account: l.account, debit: l.debit, credit: l.credit, taxCode: l.taxCode })
      .from(l)
      .where(inArray(l.entryId, block))) {
      const liste = result.get(z.entryId) ?? [];
      liste.push(z);
      result.set(z.entryId, liste);
    }
  }
  return result;
}

const imJahr = (year: number) => and(gte(schema.journalEntries.date, `${year}-01-01`), lt(schema.journalEntries.date, `${year + 1}-01-01`));

/** Belege: je Konto die Buchung gegen die Zeilen aus den Angaben des Belegs */
async function belege(year: number, q: Db | Tx, rechtsform: Rechtsform): Promise<VorgangZeile[]> {
  const e = schema.journalEntries;
  const d = schema.documents;
  const rows = await q
    .select({ entryId: e.id, date: e.date, kontenrahmen: e.kontenrahmen, doc: d })
    .from(e)
    .innerJoin(d, eq(d.id, e.sourceId))
    .where(and(eq(e.sourceType, "document"), isNull(e.reversesId), imJahr(year), isNull(d.lexofficeVoucherId)));
  if (rows.length === 0) return [];
  const zeilen = await zeilenVon(
    q,
    rows.map((r) => r.entryId),
  );
  const amounts = await q
    .select()
    .from(schema.documentAmounts)
    .where(
      inArray(
        schema.documentAmounts.documentId,
        rows.map((r) => r.doc.id),
      ),
    );
  const eigene = await loadOwnAccountNumbers(q);
  const result: VorgangZeile[] = [];
  for (const r of rows) {
    const gebucht = (zeilen.get(r.entryId) ?? []) as PostingLine[];
    let erwartet: PostingLine[];
    try {
      const splits = await loadSplits(r.doc.id, q);
      erwartet = belegZeilen(
        r.doc,
        amounts.filter((a) => a.documentId === r.doc.id),
        splits,
        { kontenrahmen: r.kontenrahmen as Kontenrahmen, rechtsform },
        r.doc.vorsteuerAbzug,
        eigene,
      );
    } catch {
      // Die heutige Buchungslogik nimmt den Beleg nicht mehr an (eine später verschärfte Regel): nichts zu vergleichen
      continue;
    }
    if (gleicheSalden(gebucht, erwartet)) continue;
    const konten = new Set([...gebucht, ...erwartet].map((z) => z.account));
    for (const konto of [...konten].sort()) {
      const k = new Set([konto]);
      const j = saldo(gebucht as Zeile[], k);
      const b = saldo(erwartet as Zeile[], k);
      if (j !== b)
        result.push({
          zeitraum: r.date.slice(0, 7),
          posten: `Beleg ${r.doc.invoiceNumber || r.doc.filename} (${r.doc.supplierName}): Konto ${konto}`,
          journal: j,
          vorgang: b,
        });
    }
  }
  return result;
}

/** Zuordnungen im Bankabgleich: Betrag gegen die Zeile auf dem Bank- bzw. Verrechnungskonto */
async function zuordnungen(year: number, q: Db | Tx): Promise<VorgangZeile[]> {
  const e = schema.journalEntries;
  const a = schema.allocations;
  const t = schema.bankTransactions;
  const ba = schema.bankAccounts;
  const rows = await q
    .select({ entryId: e.id, date: e.date, kontenrahmen: e.kontenrahmen, amount: a.amount, ledgerIndex: ba.ledgerIndex, name: t.counterpartyName })
    .from(e)
    .innerJoin(a, and(eq(e.sourceType, "allocation"), eq(a.id, e.sourceId)))
    .innerJoin(t, eq(t.id, a.transactionId))
    .innerJoin(ba, eq(ba.id, t.bankAccountId))
    .where(and(imJahr(year), ne(ba.purpose, "privat")));
  const zeilen = await zeilenVon(
    q,
    rows.map((r) => r.entryId),
  );
  return rows.flatMap((r) => {
    const kr = r.kontenrahmen as Kontenrahmen;
    const konto = r.ledgerIndex === null ? ACCOUNTS[kr].bank : paymentProviderAccount(kr, r.ledgerIndex);
    const j = saldo(zeilen.get(r.entryId) ?? [], new Set([konto]));
    return j === r.amount
      ? []
      : [{ zeitraum: r.date.slice(0, 7), posten: `Zuordnung vom ${r.date} (${r.name || "Bankumsatz"}): Konto ${konto}`, journal: j, vorgang: r.amount }];
  });
}

/** Kassenbuch: Beträge der Zeilen je Buchung gegen das Kassenkonto */
async function kasse(year: number, q: Db | Tx): Promise<VorgangZeile[]> {
  const e = schema.journalEntries;
  const c = schema.cashEntries;
  const rows = await q
    .select({
      entryId: e.id,
      date: e.date,
      kontenrahmen: e.kontenrahmen,
      betrag: sql<string>`sum(${c.amount})`,
      nummern: sql<string>`string_agg(${c.number}::text, ', ')`,
    })
    .from(c)
    .innerJoin(e, eq(e.id, c.journalEntryId))
    .where(and(imJahr(year), ne(c.kind, "import")))
    .groupBy(e.id, e.date, e.kontenrahmen);
  const zeilen = await zeilenVon(
    q,
    rows.map((r) => r.entryId),
  );
  return rows.flatMap((r) => {
    const konto = ACCOUNTS[r.kontenrahmen as Kontenrahmen].kasse;
    const j = saldo(zeilen.get(r.entryId) ?? [], new Set([konto]));
    const v = Number(r.betrag);
    return j === v ? [] : [{ zeitraum: r.date.slice(0, 7), posten: `Kassenbuch Nr. ${r.nummern}: Konto ${konto}`, journal: j, vorgang: v }];
  });
}

/** Pauschalen: Betrag gegen das Aufwandskonto (alles außer der Privateinlage) */
async function pauschalen(year: number, q: Db | Tx): Promise<VorgangZeile[]> {
  const e = schema.journalEntries;
  const p = schema.pauschalen;
  const rows = await q
    .select({ entryId: e.id, date: e.date, kontenrahmen: e.kontenrahmen, amount: p.amount, description: p.description })
    .from(p)
    .innerJoin(e, eq(e.id, p.journalEntryId))
    .where(imJahr(year));
  const zeilen = await zeilenVon(
    q,
    rows.map((r) => r.entryId),
  );
  return rows.flatMap((r) => {
    const einlage = ACCOUNTS[r.kontenrahmen as Kontenrahmen].privateinlagen;
    const aufwand = (zeilen.get(r.entryId) ?? []).filter((z) => z.account !== einlage).reduce((s, z) => s + z.debit - z.credit, 0);
    return aufwand === r.amount
      ? []
      : [{ zeitraum: r.date.slice(0, 7), posten: `Pauschale vom ${r.date} (${r.description}): Aufwand`, journal: aufwand, vorgang: r.amount }];
  });
}

/** Rechnungen bei Ist, ganz erledigt: Die nicht fällige Umsatzsteuer ihrer Buchungen ist null */
async function nichtFaelligeUmsatzsteuer(year: number, q: Db | Tx): Promise<VorgangZeile[]> {
  const i = schema.invoices;
  const rechnungen = await q
    .select({ invoice: i })
    .from(i)
    .innerJoin(
      schema.journalEntries,
      and(eq(schema.journalEntries.sourceType, "invoice"), eq(schema.journalEntries.sourceId, i.id), isNull(schema.journalEntries.reversesId)),
    )
    .where(
      and(
        imJahr(year),
        eq(i.status, "final"),
        isNull(i.variant),
        isNull(i.advanceAccounting),
        isNull(i.correctsId),
        isNull(i.lexofficeVoucherId),
        sql`not exists (select 1 from invoices k where k.corrects_id = ${i.id})`,
        sql`not exists (select 1 from invoice_settlements s where s.invoice_id = ${i.id} or s.counter_invoice_id = ${i.id})`,
      ),
    );
  if (rechnungen.length === 0) return [];
  const taxes = invoiceTaxReader(q);
  const ist: (typeof rechnungen)[number]["invoice"][] = [];
  for (const { invoice } of rechnungen) if ((await taxes.postingMode(invoice)) === "ist") ist.push(invoice);
  if (ist.length === 0) return [];
  const ids = ist.map((r) => r.id);
  // Alle Buchungen der Rechnung: sie selbst (auch Storno), Zahlungen, Ausbuchungen, Bareinnahmen
  const buchungen = await q.execute<{ invoice_id: string; entry_id: string; kontenrahmen: Kontenrahmen }>(sql`
    select x.invoice_id, e.id as entry_id, e.kontenrahmen from (
      select id as invoice_id, 'invoice' as typ, id as source_id from invoices where id in ${ids}
      union all select invoice_id, 'allocation', id from allocations where invoice_id in ${ids}
      union all select invoice_id, 'ausbuchung', id from write_offs where invoice_id in ${ids}
      union all select c.invoice_id, 'kasse', c.id from cash_entries c where c.invoice_id in ${ids}
    ) x join journal_entries e on e.source_type = x.typ and e.source_id = x.source_id`);
  const zeilen = await zeilenVon(
    q,
    [...buchungen].map((b) => b.entry_id),
  );
  // Erledigt: Zuordnungen, Ausbuchungen und Bareinnahmen decken das Brutto
  const erledigt = new Map(
    [
      ...(await q.execute<{ id: string; summe: string }>(sql`
      select id, sum(betrag) as summe from (
        select invoice_id as id, amount as betrag from allocations where invoice_id in ${ids}
        union all select invoice_id, amount from write_offs where invoice_id in ${ids}
        union all select invoice_id, amount from cash_entries where invoice_id in ${ids}
      ) z group by id`)),
    ].map((r) => [r.id, Number(r.summe)]),
  );
  const result: VorgangZeile[] = [];
  for (const invoice of ist) {
    if (invoice.gross === 0 || erledigt.get(invoice.id) !== invoice.gross) continue;
    const eigene = [...buchungen].filter((b) => b.invoice_id === invoice.id);
    const kr = eigene[0]?.kontenrahmen ?? "SKR03";
    const konten = new Set<string>(Object.values(ACCOUNTS[kr].ustNichtFaellig));
    const rest = eigene.reduce((s, b) => s + saldo(zeilen.get(b.entry_id) ?? [], konten), 0);
    if (rest !== 0)
      result.push({
        zeitraum: invoice.issueDate.slice(0, 7),
        posten: `Rechnung ${invoice.number ?? "ohne Nummer"} (Ist, ganz erledigt): Umsatzsteuer nicht fällig`,
        journal: rest,
        vorgang: 0,
      });
  }
  return result;
}

/** Alle Vorgänge, deren Buchung im Jahr liegt, mit Abweichungen zu ihrer Buchung */
export async function vorgangZeilen(year: number, q: Db | Tx = db): Promise<VorgangZeile[]> {
  const [firma] = await q.select({ rechtsform: schema.company.rechtsform }).from(schema.company).limit(1);
  return [
    ...(firma ? await belege(year, q, firma.rechtsform) : []),
    ...(await zuordnungen(year, q)),
    ...(await kasse(year, q)),
    ...(await pauschalen(year, q)),
    ...(await nichtFaelligeUmsatzsteuer(year, q)),
  ];
}
