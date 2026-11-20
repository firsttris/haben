import {
  ACCOUNTS,
  gleicheSalden,
  IST_NACH_ZAHLUNG,
  kennzahlenAusJournal,
  paymentProviderAccount,
  type Cents,
  type Kontenrahmen,
  type PostingLine,
  type Rechtsform,
} from "@haben/core";
import { and, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { belegZeilen, loadSplits } from "../belege/index.ts";
import { loadOwnAccountNumbers } from "../eigene-konten/index.ts";
import { invoiceTaxReader } from "../rechnungen/index.ts";
import { zahlungenWieHeute } from "../umsatzsteuer/index.ts";

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
 *   Toleranz nicht sieht. Ist sie ganz bezahlt (ohne Ausbuchung), melden ihre Buchungen bei Ist zusammen genau die
 *   Bemessungsgrundlagen, die die Rechnung bei Soll meldet (Kz 81, 86, 43, 48, 0 %). Zahlungen von vor #552 zählen dabei
 *   wie heute gebucht (zahlungenWieHeute, #1502); jede andere Zahlung ohne Bemessungsgrundlage fällt so auf, auch auf
 *   einer steuerfreien Rechnung, an der die Verprobung mangels Steuer nichts sieht.
 *
 * Nicht verglichen: aus Lexoffice übernommene Belege und Rechnungen (gebucht gegen den Saldenvortrag), Zuordnungen auf
 * privaten Konten (sie buchen auf Privatkonten), Kassenzeilen aus dem Datenimport (sie hängen an einer Originalbuchung)
 * und Rechnungen mit Anzahlungen, Korrekturen oder Verrechnungen (eigene Buchungsketten, OPOS-Abgleich).
 */

export interface VorgangZeile {
  zeitraum: string;
  posten: string;
  /** Stabiler Schlüssel des Postens (AbgleichZeile.schluessel) */
  schluessel: string;
  journal: Cents;
  vorgang: Cents;
}

type Zeile = { entryId: string; account: string; debit: number; credit: number; taxCode: string | null; basis: number | null };

const saldo = (zeilen: readonly Zeile[], konten: ReadonlySet<string>) =>
  zeilen.filter((z) => konten.has(z.account)).reduce((s, z) => s + z.debit - z.credit, 0);

async function zeilenVon(q: Db | Tx, entryIds: string[]): Promise<Map<string, Zeile[]>> {
  const result = new Map<string, Zeile[]>();
  for (let i = 0; i < entryIds.length; i += 5000) {
    const block = entryIds.slice(i, i + 5000);
    const l = schema.journalLines;
    for (const z of await q
      .select({ entryId: l.entryId, account: l.account, debit: l.debit, credit: l.credit, taxCode: l.taxCode, basis: l.basis })
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
    let bestand: PostingLine[];
    try {
      const splits = await loadSplits(r.doc.id, q);
      const zeilenFuer = (doc: typeof r.doc) =>
        belegZeilen(
          doc,
          amounts.filter((a) => a.documentId === r.doc.id),
          splits,
          { kontenrahmen: r.kontenrahmen as Kontenrahmen, rechtsform },
          r.doc.vorsteuerAbzug,
          eigene,
        );
      erwartet = zeilenFuer(r.doc);
      // Vor #930 gebucht, mit Leistungszeitraum aus 0.9 (#879): Die Vorsteuer steht im Belegmonat statt auf dem Zwischenkonto
      // und zählt weiter nach dem Belegdatum (#930, „Bestand“); so gebucht ist der Beleg richtig
      bestand = zeilenFuer({ ...r.doc, serviceFrom: null, serviceTo: null });
    } catch {
      // Die heutige Buchungslogik nimmt den Beleg nicht mehr an (eine später verschärfte Regel): nichts zu vergleichen
      continue;
    }
    if (gleicheSalden(gebucht, erwartet) || gleicheSalden(gebucht, bestand)) continue;
    const konten = new Set([...gebucht, ...erwartet].map((z) => z.account));
    for (const konto of [...konten].sort()) {
      const k = new Set([konto]);
      const j = saldo(gebucht as Zeile[], k);
      const b = saldo(erwartet as Zeile[], k);
      if (j !== b)
        result.push({
          zeitraum: r.date.slice(0, 7),
          posten: `Beleg ${r.doc.invoiceNumber || r.doc.filename} (${r.doc.supplierName}): Konto ${konto}`,
          schluessel: `buchung:${r.entryId}:${konto}`,
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
      : [
          {
            zeitraum: r.date.slice(0, 7),
            posten: `Zuordnung vom ${r.date} (${r.name || "Bankumsatz"}): Konto ${konto}`,
            schluessel: `buchung:${r.entryId}:${konto}`,
            journal: j,
            vorgang: r.amount,
          },
        ];
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
    return j === v
      ? []
      : [
          {
            zeitraum: r.date.slice(0, 7),
            posten: `Kassenbuch Nr. ${r.nummern}: Konto ${konto}`,
            schluessel: `buchung:${r.entryId}:${konto}`,
            journal: j,
            vorgang: v,
          },
        ];
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
      : [
          {
            zeitraum: r.date.slice(0, 7),
            posten: `Pauschale vom ${r.date} (${r.description}): Aufwand`,
            schluessel: `buchung:${r.entryId}:aufwand`,
            journal: aufwand,
            vorgang: r.amount,
          },
        ];
  });
}

/** Rechnungen bei Ist, ganz erledigt: keine nicht fällige Umsatzsteuer mehr, ganz bezahlt die volle Bemessungsgrundlage gemeldet */
async function erledigteIstRechnungen(year: number, q: Db | Tx): Promise<VorgangZeile[]> {
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
  const buchungen = await q.execute<{ invoice_id: string; typ: string; source_id: string; entry_id: string; kontenrahmen: Kontenrahmen }>(sql`
    select x.invoice_id, x.typ, x.source_id, e.id as entry_id, e.kontenrahmen from (
      select id as invoice_id, 'invoice' as typ, id as source_id from invoices where id in ${ids}
      union all select invoice_id, 'allocation', id from allocations where invoice_id in ${ids}
      union all select invoice_id, 'ausbuchung', id from write_offs where invoice_id in ${ids}
      union all select c.invoice_id, 'kasse', c.id from cash_entries c where c.invoice_id in ${ids}
    ) x join journal_entries e on e.source_type = x.typ and e.source_id = x.source_id`);
  const zeilen = await zeilenVon(
    q,
    [...buchungen].map((b) => b.entry_id),
  );
  // Gemeldet wird mit den Zahlungen bei Ist von vor #552 so, wie Haben sie heute bucht (#1502)
  const wieHeute = new Map(
    (
      await zahlungenWieHeute(
        [...buchungen].map((b) => ({
          id: b.entry_id,
          sourceType: b.typ,
          sourceId: b.source_id,
          kontenrahmen: b.kontenrahmen,
          zeilen: zeilen.get(b.entry_id) ?? [],
        })),
        q,
      )
    ).map((b) => [b.id, b.zeilen]),
  );
  // Erledigt: Zuordnungen, Ausbuchungen und Bareinnahmen decken das Brutto
  const summen = new Map(
    [
      ...(await q.execute<{ id: string; bezahlt: string; ausgebucht: string }>(sql`
      select id, sum(bezahlt) as bezahlt, sum(ausgebucht) as ausgebucht from (
        select invoice_id as id, amount as bezahlt, 0 as ausgebucht from allocations where invoice_id in ${ids}
        union all select invoice_id, 0, amount from write_offs where invoice_id in ${ids}
        union all select invoice_id, amount, 0 from cash_entries where invoice_id in ${ids}
      ) z group by id`)),
    ].map((r) => [r.id, { bezahlt: Number(r.bezahlt), ausgebucht: Number(r.ausgebucht) }]),
  );
  const result: VorgangZeile[] = [];
  for (const invoice of ist) {
    const summe = summen.get(invoice.id);
    if (invoice.gross === 0 || !summe || summe.bezahlt + summe.ausgebucht !== invoice.gross) continue;
    const eigene = [...buchungen].filter((b) => b.invoice_id === invoice.id);
    const posten = `Rechnung ${invoice.number ?? "ohne Nummer"} (Ist, ganz erledigt)`;
    // Je Buchung die Konten ihres Kontenrahmens: Nach einem Wechsel zum Jahresbeginn bucht die Zahlung im neuen Rahmen
    const rest = eigene.reduce((s, b) => s + saldo(zeilen.get(b.entry_id) ?? [], new Set(Object.values(ACCOUNTS[b.kontenrahmen].ustNichtFaellig))), 0);
    if (rest !== 0)
      result.push({
        zeitraum: invoice.issueDate.slice(0, 7),
        posten: `${posten}: Umsatzsteuer nicht fällig`,
        schluessel: `rechnung:${invoice.id}:nicht-faellig`,
        journal: rest,
        vorgang: 0,
      });
    if (summe.ausgebucht !== 0) continue;
    const gemeldet = (v: "ist" | "soll", typen: (b: (typeof eigene)[number]) => boolean) =>
      eigene.filter(typen).reduce((s, b) => {
        const k = kennzahlenAusJournal(b.kontenrahmen, v, [wieHeute.get(b.entry_id) ?? []]);
        return s + [...IST_NACH_ZAHLUNG].reduce((t, feld) => t + k[feld], 0);
      }, 0);
    const beiZahlung = gemeldet("ist", () => true);
    const laut = gemeldet("soll", (b) => b.typ === "invoice");
    if (beiZahlung !== laut)
      result.push({
        zeitraum: invoice.issueDate.slice(0, 7),
        posten: `${posten}: gemeldete Bemessungsgrundlage`,
        schluessel: `rechnung:${invoice.id}:bemessung`,
        journal: beiZahlung,
        vorgang: laut,
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
    ...(await erledigteIstRechnungen(year, q)),
  ];
}
