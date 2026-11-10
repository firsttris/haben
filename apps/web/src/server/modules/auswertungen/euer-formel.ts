import { ACCOUNTS, ASSET_ACCOUNTS, datevFormelKonto, zahlungsStand, type Cents, type Kontenrahmen } from "@haben/core";
import { and, eq, gte, inArray, lt, ne, or, type SQL } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { buchungen, offenerPosten, type Buchung } from "./euer-journal.ts";
import { belegNebenbuch, belegTeilzahlung, type BelegNebenbuch } from "./euer-journal-nebenbuch.ts";

/*
 * Gewinn der EÜR nach der DATEV-Formel (#542, Schritt 5c), als Gegenprobe zum Gewinn aus den Zeilen: der negative Saldo
 * der Erfolgs- und Steuerkonten, der Forderungen und der Verbindlichkeiten im Jahr (datevFormelKonto). Erlöse und Aufwand
 * stehen dort nach Rechnungs- bzw. Belegdatum; die Veränderung von Forderungen und Verbindlichkeiten macht daraus den
 * Gewinn nach Zahlung (DATEV-Hilfe-Center, Dok.-Nr. 1036819).
 *
 * Eine Korrektur braucht die Formel bei offenen Posten, deren Buchung Zeilen außerhalb dieser Konten hat: der Privatanteil
 * eines Belegs (Entnahme), eine Anlage (wirkt über die AfA) oder bei aus Lexoffice übernommenen Rechnungen und Belegen der
 * Saldenvortrag. Solange der Posten offen ist, steckt ihr Anteil in der Veränderung von Forderungen bzw. Verbindlichkeiten,
 * ohne Einnahme oder Ausgabe zu sein. Abgezogen wird deshalb der noch offene Anteil dieser Zeilen am Jahresende,
 * hinzugerechnet der am Ende des Vorjahres.
 */

const ohneEroeffnung = (where: SQL | undefined) => and(where, ne(schema.journalEntries.sourceType, "eroeffnung"));

/**
 * Ob eine Zeile zur Formel gehört. Bei Rechnungen und Belegen außerdem: der Saldenvortrag einer aus Lexoffice übernommenen
 * Rechnung bzw. eines Belegs (er steht für Erlös bzw. Aufwand, der erst mit der Zahlung zufließt bzw. abfließt) und das
 * GWG-Konto, auf das die Kategorie „Hardware“ bucht (bei einer Anlage ist es Anlagevermögen, Herkunft „anlage“).
 */
function zaehlt(b: Buchung, account: string, anlagen: ReadonlySet<string>): boolean {
  const kr = b.kontenrahmen;
  if (datevFormelKonto(kr, account)) return true;
  if (b.sourceType !== "invoice" && b.sourceType !== "document") return false;
  if (account === ACCOUNTS[kr].saldenvortrag) return true;
  return b.sourceType === "document" && account === ASSET_ACCOUNTS[kr].gwg && !anlagen.has(b.sourceId);
}

interface Posten {
  gebucht: Buchung[];
  /** Beleg mit Privatanteil oder ohne Vorsteuerabzug: Anteil einer Zahlung wie computeEuer (euer-journal.ts) */
  beleg?: BelegNebenbuch;
}

/** Noch offener Anteil der Zeilen außerhalb der Formel, über alle offenen Posten bis zum Stichtag (einschließlich) */
function offenerAnteil(
  posten: Map<string, Posten>,
  ausgleiche: Map<string, Buchung[]>,
  datum: Map<string, string>,
  stichtag: string,
  anlagen: ReadonlySet<string>,
): Cents {
  let summe = 0;
  for (const [key, p] of posten) {
    const bis = p.gebucht.filter((b) => datum.get(b.id)! <= stichtag);
    const zahlungen = (ausgleiche.get(key) ?? [])
      .filter((b) => datum.get(b.id)! <= stichtag)
      .map((b) => -b.zeilen.filter((z) => offenerPosten(b.kontenrahmen, z)).reduce((s, z) => s + z.debit - z.credit, 0));
    // Im Voraus bezahlt (Zahlung vor dem Belegdatum): verteilt wird auf die spätere Buchung, gebucht ist noch nichts
    if (bis.length === 0 && zahlungen.length === 0) continue;
    const verteilt = bis.length > 0 ? bis : p.gebucht;
    const kr: Kontenrahmen = verteilt[0]!.kontenrahmen;
    const zeilen = verteilt.flatMap((b) =>
      b.zeilen.filter((z) => !offenerPosten(b.kontenrahmen, z)).map((z) => ({ ...z, ausserhalb: !zaehlt(b, z.account, anlagen) })),
    );
    const gesamt = verteilt.flatMap((b) => b.zeilen.filter((z) => offenerPosten(b.kontenrahmen, z))).reduce((s, z) => s + z.debit - z.credit, 0);
    const ausserhalbVerteilt = zeilen.filter((z) => z.ausserhalb).reduce((s, z) => s + z.debit - z.credit, 0);
    if (gesamt === 0 || ausserhalbVerteilt === 0) continue;
    // Was davon schon gebucht ist; im Voraus bezahlt noch nichts
    const ausserhalb = bis.length > 0 ? ausserhalbVerteilt : 0;
    const ausgeglichen = zahlungen.reduce((s, v) => s + v, 0);
    let bezahlt: Cents;
    if (p.beleg) {
      // Was eine Zahlung nicht als Ausgabe oder Vorsteuer wirkt, ist der private Teil bzw. der nicht wirkende Rest
      bezahlt = zahlungen.reduce((s, betrag) => {
        const wirkung = belegTeilzahlung(Number(stichtag.slice(0, 4)), p.beleg!, -betrag);
        const ausgabe = Object.values(wirkung.zeilen).reduce((x, v) => x + (v ?? 0), 0) + wirkung.bewirtungNichtAbziehbar;
        return s + (-betrag - ausgabe);
      }, 0);
    } else {
      // Gerundet wie die Zahlung (zahlungsStand); bei Rechnungen der Stand nach allen Zahlungen bis zum Stichtag
      const stand = zahlungsStand(kr, zeilen, gesamt, ausgeglichen);
      bezahlt = zeilen.reduce((s, z, i) => (z.ausserhalb ? s + stand[i]! : s), 0);
    }
    summe += ausserhalb - bezahlt;
  }
  return summe;
}

/** Datum je Buchung */
async function daten(q: Db | Tx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const e = schema.journalEntries;
  return new Map((await q.select({ id: e.id, date: e.date }).from(e).where(inArray(e.id, ids))).map((r) => [r.id, r.date]));
}

/**
 * Gewinn eines Jahres nach der DATEV-Formel, ohne die nicht abziehbaren Beträge (`nichtAbziehbar`: der nicht abziehbare
 * Teil der Bewirtung und die Gewerbesteuer samt Nebenleistungen, die auf Erfolgskonten stehen, den Gewinn der EÜR aber
 * nicht mindern)
 */
export async function gewinnNachDatevFormel(year: number, nichtAbziehbar: Cents, q: Db | Tx = db): Promise<Cents> {
  const e = schema.journalEntries;
  const ende = `${year}-12-31`;
  const vorjahr = `${year - 1}-12-31`;
  const jahr = await buchungen(q, ohneEroeffnung(and(gte(e.date, `${year}-01-01`), lt(e.date, `${year + 1}-01-01`))));
  // Rechnungen und Belege auf Ziel, auch mit späterem Datum: eine Zahlung kann vor dem Belegdatum liegen (Vorkasse)
  const aufZiel = (await buchungen(q, ohneEroeffnung(inArray(e.sourceType, ["invoice", "document"])))).filter((b) =>
    b.zeilen.some((z) => offenerPosten(b.kontenrahmen, z)),
  );
  // Belege der Kategorie Anlage: das GWG-Konto ist dort Anlagevermögen
  const belegIds = [...new Set([...jahr, ...aufZiel].filter((b) => b.sourceType === "document").map((b) => b.sourceId))];
  const anlagen = new Set(
    belegIds.length === 0
      ? []
      : (
          await q
            .select({ id: schema.documents.id })
            .from(schema.documents)
            .where(and(inArray(schema.documents.id, belegIds), eq(schema.documents.category, "anlage")))
        ).map((r) => r.id),
  );
  let formel = 0;
  for (const b of jahr) for (const z of b.zeilen) if (zaehlt(b, z.account, anlagen)) formel -= z.debit - z.credit;

  // Offene Posten mit Zeilen außerhalb der Formel
  const ursprung = aufZiel.filter((b) => b.zeilen.some((z) => !zaehlt(b, z.account, anlagen)));
  const posten = new Map<string, Posten>();
  for (const b of ursprung) {
    const key = `${b.sourceType}|${b.sourceId}`;
    const p = posten.get(key) ?? { gebucht: [] };
    p.gebucht.push(b);
    posten.set(key, p);
  }
  // Auch die übrigen Buchungen derselben Rechnung bzw. desselben Belegs (Storno): sie gehören zum selben Posten
  const ids = [...new Set(ursprung.map((b) => b.sourceId))];
  if (ids.length > 0) {
    for (const b of await buchungen(q, ohneEroeffnung(and(inArray(e.sourceId, ids), inArray(e.sourceType, ["invoice", "document"]))))) {
      const key = `${b.sourceType}|${b.sourceId}`;
      const vorhanden = posten.get(key);
      if (vorhanden && !vorhanden.gebucht.some((x) => x.id === b.id)) vorhanden.gebucht.push(b);
    }
  }
  // Zahlungen, Ausbuchungen und Bareinnahmen auf diese Posten
  const ausgleiche = new Map<string, Buchung[]>();
  const rechnungen = ursprung.filter((b) => b.sourceType === "invoice").map((b) => b.sourceId);
  const belege = ursprung.filter((b) => b.sourceType === "document").map((b) => b.sourceId);
  const quelle = new Map<string, string>();
  for (const t of [schema.allocations, schema.writeOffs, schema.cashEntries] as const) {
    const where = [...(rechnungen.length > 0 ? [inArray(t.invoiceId, rechnungen)] : []), ...(belege.length > 0 ? [inArray(t.documentId, belege)] : [])];
    if (where.length === 0) continue;
    const rows = await q
      .select({ id: t.id, invoiceId: t.invoiceId, documentId: t.documentId })
      .from(t)
      .where(or(...where));
    for (const r of rows) quelle.set(r.id, r.invoiceId ? `invoice|${r.invoiceId}` : `document|${r.documentId}`);
  }
  if (quelle.size > 0) {
    for (const b of await buchungen(q, ohneEroeffnung(and(lt(e.date, `${year + 1}-01-01`), inArray(e.sourceId, [...quelle.keys()]))))) {
      if (b.sourceType === "invoice" || b.sourceType === "document") continue;
      const key = quelle.get(b.sourceId)!;
      ausgleiche.set(key, [...(ausgleiche.get(key) ?? []), b]);
    }
  }
  for (const [key, p] of posten) if (key.startsWith("document|")) p.beleg = await belegNebenbuch(q, key.slice(9));
  const datum = await daten(
    q,
    [...[...posten.values()].flatMap((p) => p.gebucht), ...[...ausgleiche.values()].flat()].map((b) => b.id),
  );
  const korrektur = offenerAnteil(posten, ausgleiche, datum, ende, anlagen) - offenerAnteil(posten, ausgleiche, datum, vorjahr, anlagen);
  return formel - korrektur + nichtAbziehbar;
}
