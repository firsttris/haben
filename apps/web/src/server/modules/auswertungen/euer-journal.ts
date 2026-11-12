import {
  ACCOUNTS,
  euerAusZeilen,
  leereEuerAusJournal,
  zahlungsAnteil,
  zahlungsStand,
  type EuerAusJournal,
  type EuerHerkunft,
  type Kontenrahmen,
} from "@haben/core";
import { and, eq, gte, inArray, lt, ne } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { imEuerJahr } from "./euer-jahreswechsel.ts";
import { ausgleichsBuchungenJe, bloecke, type Buchung, buchungen, buchungenJe, offenerPosten, type Zeile } from "./euer-journal-buchungen.ts";
import { belegNebenbuecher, belegTeilzahlung, uebernommeneZeilen, type BelegNebenbuch } from "./euer-journal-nebenbuch.ts";

/*
 * EÜR aus dem Journal (#542, Schritt 5b), als Schattenrechnung neben euerForYear. Eine Buchung ohne Forderungen und
 * Verbindlichkeiten (Bank, Kasse, privat bezahlt, Pauschale, AfA) zählt mit ihrem Datum nach ihren Konten. Eine Rechnung
 * bzw. ein Beleg auf Ziel zählt erst mit der Zahlung: Jede Zahlung, Bareinnahme oder Kursdifferenz wird anteilig auf die
 * Zeilen der Buchung verteilt, die sie ausgleicht (zahlungsAnteil). Welche das ist, sagt die Zuordnung im Nebenbuch.
 * Skonto und Forderungsausfall wirken nicht, die EÜR zählt nur, was gezahlt wird.
 */

const offen = (b: Buchung) => b.zeilen.filter((z) => offenerPosten(b.kontenrahmen, z)).reduce((s, z) => s + z.debit - z.credit, 0);
const ausbuchungOhneZahlung = (b: Buchung) => {
  const a = ACCOUNTS[b.kontenrahmen];
  return b.zeilen.some((z) => z.account === a.skontiGewaehrt || z.account === a.skontiErhalten || z.account === a.forderungsverluste);
};

interface Ziel {
  invoiceId: string | null;
  documentId: string | null;
  loanId?: string | null;
}

/** Rechnung bzw. Beleg, den eine Zahlung, Ausbuchung oder Bareinnahme ausgleicht, je Herkunft der Buchung */
async function ziele(q: Db | Tx, ids: string[]): Promise<Map<string, Ziel>> {
  const result = new Map<string, Ziel>();
  if (ids.length === 0) return result;
  const a = schema.allocations;
  const w = schema.writeOffs;
  const c = schema.cashEntries;
  for (const block of bloecke(ids)) {
    for (const r of await q.select({ id: a.id, invoiceId: a.invoiceId, documentId: a.documentId, loanId: a.loanId }).from(a).where(inArray(a.id, block)))
      result.set(r.id, r);
    for (const r of await q.select({ id: w.id, invoiceId: w.invoiceId, documentId: w.documentId }).from(w).where(inArray(w.id, block))) result.set(r.id, r);
    for (const r of await q.select({ id: c.id, invoiceId: c.invoiceId, documentId: c.documentId }).from(c).where(inArray(c.id, block))) result.set(r.id, r);
  }
  return result;
}

export interface EuerJournal {
  summe: EuerAusJournal;
  /**
   * Zahlungen auf aus Lexoffice übernommene Rechnungen und Belege: Deren Buchung steht gegen den Saldenvortrag, ohne Erlös-
   * bzw. Aufwandszeilen; verteilt wird auf die Zeilen, die Haben für Rechnung bzw. Beleg buchen würde (uebernommeneZeilen)
   */
  uebernommen: number;
  /** Wirkung je Monat (Index 0 = Januar), für die Grafik nach Monaten */
  monate: EuerAusJournal[];
}

interface Ursprung {
  uebernommen: boolean;
  /** Kontenrahmen der ausgeglichenen Buchung; er kann zum Jahreswechsel gewechselt haben */
  kontenrahmen: Kontenrahmen;
  zeilen: Zeile[];
  gesamt: number;
  herkunft: EuerHerkunft;
  /** Rechnung: Anteil jeder ausgleichenden Buchung an den Zeilen, wie gespeichert (settlementTaxShares) */
  anteile?: Map<string, number[]>;
  beleg?: BelegNebenbuch;
}

/**
 * Anteile aller Zahlungen, Ausbuchungen und Bareinnahmen einer Rechnung, wie Haben sie beim Zuordnen speichert: jede gegen
 * das bis dahin Erfasste (settlementTaxShares), eine Gegenbuchung genau umgekehrt wie die aufgehobene
 */
function rechnungsAnteile(kr: Kontenrahmen, zeilen: Zeile[], gesamt: number, ausgleiche: Buchung[]): Map<string, number[]> {
  const anteile = new Map<string, number[]>();
  let ausgeglichen = 0;
  let erfasst = zeilen.map(() => 0);
  for (const a of ausgleiche) {
    const betrag = -offen(a);
    const umgekehrt = a.reversesId ? anteile.get(a.reversesId) : undefined;
    const stand = umgekehrt ? null : zahlungsStand(kr, zeilen, gesamt, ausgeglichen + betrag);
    const anteil = umgekehrt ? umgekehrt.map((v) => -v) : stand!.map((v, i) => v - erfasst[i]!);
    erfasst = erfasst.map((v, i) => v + anteil[i]!);
    ausgeglichen += betrag;
    anteile.set(a.id, anteil);
  }
  return anteile;
}

const alsZeilen = (zeilen: Zeile[], anteil: number[]): Zeile[] =>
  zeilen.map((z, i) => ({ ...z, debit: Math.max(anteil[i]!, 0), credit: Math.max(-anteil[i]!, 0) }));

/** Summiert die Wirkung `von` in `nach`, bei einer aufgehobenen Zuordnung mit umgekehrtem Vorzeichen */
function dazu(nach: EuerAusJournal, von: EuerAusJournal, vorzeichen: 1 | -1 = 1) {
  for (const [key, betrag] of Object.entries(von.zeilen) as [keyof EuerAusJournal["zeilen"], number][])
    nach.zeilen[key] = (nach.zeilen[key] ?? 0) + vorzeichen * betrag;
  nach.bewirtungNichtAbziehbar += vorzeichen * von.bewirtungNichtAbziehbar;
  nach.gewerbesteuerNichtAbziehbar += vorzeichen * von.gewerbesteuerNichtAbziehbar;
}

/** Die EÜR eines Jahres aus dem Journal: Zeilen wie computeEuer, ohne AfA und Privatnutzung, die noch nicht gebucht sind */
export async function euerAusJournal(year: number, q: Db | Tx = db): Promise<EuerJournal> {
  const e = schema.journalEntries;
  // Vorauszahlung für Dezember bzw. das vierte Quartal vom 1. bis 10. Januar im Vorjahr (euer-jahreswechsel.ts)
  const jahr = await imEuerJahr(
    year,
    await buchungen(q, and(gte(e.date, `${year}-01-01`), lt(e.date, `${year + 1}-01-01`), ne(e.sourceType, "eroeffnung"))),
    q,
  );
  const zielVon = await ziele(
    q,
    jahr.filter((b) => b.sourceType === "allocation" || b.sourceType === "ausbuchung" || b.sourceType === "kasse").map((b) => b.sourceId),
  );
  const loanIds = [...new Set([...zielVon.values()].flatMap((z) => (z.loanId ? [z.loanId] : [])))];
  const anlageDarlehen = new Set(
    loanIds.length === 0
      ? []
      : (
          await q
            .select({ id: schema.loans.id })
            .from(schema.loans)
            .where(and(inArray(schema.loans.id, loanIds), eq(schema.loans.purpose, "anlagevermoegen")))
        ).map((r) => r.id),
  );

  // Was die Zahlungen ausgleichen, gesammelt für alle Rechnungen und Belege des Jahres statt je Posten (#542, Schritt 9)
  const rechnungIds = [...new Set([...zielVon.values()].flatMap((z) => (z.invoiceId ? [z.invoiceId] : [])))];
  const belegIds = [...new Set([...zielVon.values()].flatMap((z) => (!z.invoiceId && z.documentId ? [z.documentId] : [])))];
  const gebuchtVon = { invoice: await buchungenJe(q, "invoice", rechnungIds), document: await buchungenJe(q, "document", belegIds) };
  const ausgleicheVon = await ausgleichsBuchungenJe(q, rechnungIds);
  const nebenbuchVon = await belegNebenbuecher(q, belegIds);
  const anlagen = new Set<string>();
  for (const block of bloecke(belegIds))
    for (const r of await q
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(and(inArray(schema.documents.id, block), eq(schema.documents.category, "anlage"))))
      anlagen.add(r.id);

  const summe = leereEuerAusJournal();
  let uebernommen = 0;
  const ursprung = new Map<string, Ursprung>();
  const ursprungVon = async (typ: "invoice" | "document", id: string, kr: Kontenrahmen): Promise<Ursprung> => {
    const key = `${typ}|${id}`;
    const vorhanden = ursprung.get(key);
    if (vorhanden) return vorhanden;
    const gebucht = gebuchtVon[typ].get(id) ?? [];
    const kontenrahmen = gebucht[0]?.kontenrahmen ?? kr;
    const alle = gebucht.flatMap((b) => b.zeilen);
    const istUebernommen = gebucht.length === 0 || alle.some((z) => z.account === ACCOUNTS[kontenrahmen].saldenvortrag);
    // Aus Lexoffice übernommen: verteilt wird auf die Zeilen, die Haben gebucht hätte
    const ersatz = istUebernommen ? await uebernommeneZeilen(q, typ, id, kontenrahmen) : null;
    const zeilen = ersatz?.zeilen ?? alle.filter((z) => !offenerPosten(kontenrahmen, z));
    const gesamt = ersatz ? ersatz.gesamt : alle.filter((z) => offenerPosten(kontenrahmen, z)).reduce((s, z) => s + z.debit - z.credit, 0);
    const herkunft: EuerHerkunft = typ === "document" && anlagen.has(id) ? "anlage" : "sonst";
    const u: Ursprung = {
      uebernommen: istUebernommen,
      kontenrahmen,
      zeilen,
      gesamt,
      herkunft,
      ...(typ === "invoice" && gesamt !== 0 ? { anteile: rechnungsAnteile(kontenrahmen, zeilen, gesamt, ausgleicheVon.get(id) ?? []) } : {}),
      ...(typ === "document" ? { beleg: nebenbuchVon.get(id) } : {}),
    };
    ursprung.set(key, u);
    return u;
  };

  const monate = Array.from({ length: 12 }, () => leereEuerAusJournal());
  for (const b of jahr) {
    const beitrag = await wirkung(b);
    dazu(summe, beitrag);
    dazu(monate[Number(b.date.slice(5, 7)) - 1]!, beitrag);
  }
  return { summe, uebernommen, monate };

  /** Was eine Buchung in der EÜR bewirkt */
  async function wirkung(b: Buchung): Promise<EuerAusJournal> {
    const summe = leereEuerAusJournal();
    const kr = b.kontenrahmen;
    const ziel = zielVon.get(b.sourceId);
    const herkunft: EuerHerkunft =
      b.sourceType === "pauschale"
        ? "pauschale"
        : b.sourceType === "asset"
          ? "asset"
          : ziel?.loanId && anlageDarlehen.has(ziel.loanId)
            ? "darlehenAnlagevermoegen"
            : "sonst";
    const ausgeglichen = offen(b);
    const hatOffenenPosten = b.zeilen.some((z) => offenerPosten(kr, z));
    // Rechnung bzw. Beleg auf Ziel: wirkt erst mit der Zahlung
    if (hatOffenenPosten && (b.sourceType === "invoice" || b.sourceType === "document" || b.sourceType === "asset")) return summe;
    if (ausbuchungOhneZahlung(b)) return summe;
    // Eigene Zeilen der Buchung (Kursdifferenz, Umbuchung der Umsatzsteuer, die sich aufhebt) nach ihren Konten
    const eigene = b.zeilen.filter((z) => !offenerPosten(kr, z));
    const umkehr = b.sourceType === "allocation" && b.reversesId !== null;
    // Rücknahme in derselben EÜR-Zeile: Eine aufgehobene Zahlung ist keine echte Finanzamtserstattung und umgekehrt.
    // Amtliche Anleitung EÜR 2025, Zeilen 18 und 58: https://www.elster.de/eportal/helpGlobal?themaGlobal=help_euer_ufa_77_2025
    dazu(
      summe,
      euerAusZeilen(
        kr,
        umkehr
          ? alsZeilen(
              eigene,
              eigene.map((z) => z.credit - z.debit),
            )
          : eigene,
        herkunft,
      ),
      umkehr ? -1 : 1,
    );
    if (!hatOffenenPosten || ausgeglichen === 0) return summe;
    const typ = ziel?.invoiceId ? "invoice" : ziel?.documentId ? "document" : null;
    const zielId = ziel?.invoiceId ?? ziel?.documentId;
    if (!typ || !zielId) return summe;
    const u = await ursprungVon(typ, zielId, kr);
    if (u.uebernommen) uebernommen++;
    // Storniert: nichts mehr offen, Zahlung und Gegenbuchung heben sich auf
    if (u.gesamt === 0) return summe;
    const anteil = u.anteile?.get(b.id);
    if (anteil) euerAusZeilen(u.kontenrahmen, alsZeilen(u.zeilen, anteil), u.herkunft, summe);
    // Teilzahlung auf einen Beleg mit Privatanteil oder ohne Vorsteuerabzug: gerundet wie computeEuer
    else if (u.beleg && -ausgeglichen !== u.gesamt) belegTeilzahlung(year, u.beleg, ausgeglichen, summe);
    // Beleg: jede Zahlung für sich (paidTaxShares)
    else euerAusZeilen(u.kontenrahmen, zahlungsAnteil(u.kontenrahmen, u.zeilen, u.gesamt, -ausgeglichen), u.herkunft, summe);
    return summe;
  }
}
