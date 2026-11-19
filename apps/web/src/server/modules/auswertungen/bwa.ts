import {
  FORM43,
  abweichung,
  euerZeileLabel,
  euerZeilenKonto,
  form43,
  form43Anteile,
  imZeitraum,
  isKapitalgesellschaft,
  jahreVon,
  kumuliert,
  vergleichszeitraum,
  vorjahreszeitraum,
  type BasisPoints,
  type BwaEuerPosten,
  type Cents,
  type Form43Anteil,
  type Form43Summe,
  type Form43Zeile,
  type Vergleich,
  type Zeitraum,
} from "@haben/core";
import { inArray, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { listAssets } from "../buchhaltung/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { euerAusJournal } from "./euer-journal.ts";
import { bloecke, type EuerBeitraege } from "./euer-journal-buchungen.ts";

/*
 * BWA (#1380): rechnet aus denselben Beträgen wie die EÜR aus dem Journal (euerAusJournal), je Buchung mit Datum, und ordnet
 * sie nach dem Aufbau der DATEV-Auswertungen (packages/core/src/bwa.ts). Bucht nichts. Einzelunternehmen bekommen die
 * Einnahmen-Ausgaben-BWA (Form 43) nach Zufluss und Abfluss.
 */

export interface BwaZeileWerte {
  key: Form43Zeile | Form43Summe;
  label: string;
  art: "zeile" | "summe" | "ergebnis";
  betrag: Cents;
  kumuliert: Cents;
  vergleich: Cents | null;
  vergleichKumuliert: Cents | null;
  abweichung: { betrag: Cents; prozent: BasisPoints | null } | null;
}

export interface BwaBericht {
  /** GmbH und UG bilanzieren; ihre BWA (Form 01) rechnet periodengerecht und fehlt hier noch */
  kapitalgesellschaft: boolean;
  zeitraum: Zeitraum;
  kumuliert: Zeitraum;
  vergleich: Zeitraum | null;
  /** Kumulierter Vergleich nur mit dem Vorjahr; „seit Jahresbeginn“ der Vorperiode wäre ein anderes Jahr */
  vergleichKumuliert: Zeitraum | null;
  zeilen: BwaZeileWerte[];
  /** Jahre im Zeitraum, deren AfA noch nicht gebucht ist: Die BWA zeigt bis dahin keine Abschreibungen aus dem Anlagenverzeichnis */
  afaOffen: number[];
}

/** Die Wirkung aller Buchungen der Jahre in der EÜR, je Buchung mit Datum und Ausgleich */
async function euerPosten(jahre: readonly number[], q: Db | Tx): Promise<BwaEuerPosten[]> {
  const posten: BwaEuerPosten[] = [];
  const sammeln: EuerBeitraege = (b, beitrag) => {
    if (Object.keys(beitrag.zeilen).length === 0 && beitrag.bewirtungNichtAbziehbar === 0 && beitrag.gewerbesteuerNichtAbziehbar === 0) return;
    posten.push({
      datum: b.date,
      kontenrahmen: b.kontenrahmen,
      zeilen: beitrag.zeilen,
      bewirtungNichtAbziehbar: beitrag.bewirtungNichtAbziehbar,
      gewerbesteuerNichtAbziehbar: beitrag.gewerbesteuerNichtAbziehbar,
      quelle: {
        buchungId: b.id,
        sourceType: b.sourceType,
        sourceId: b.sourceId,
        rechnungId: b.invoiceId ?? (b.sourceType === "invoice" ? b.sourceId : null),
        belegId: b.documentId ?? (b.sourceType === "document" ? b.sourceId : null),
      },
    });
  };
  for (const jahr of jahre) await euerAusJournal(jahr, q, undefined, false, sammeln);
  return posten;
}

/** Die Anteile an den Zeilen der Form 43 in allen Jahren, die einer der Zeiträume berührt */
async function anteile(zeitraeume: readonly (Zeitraum | null)[], q: Db | Tx): Promise<Form43Anteil[]> {
  const jahre = [...new Set(zeitraeume.flatMap((z) => (z ? jahreVon(z) : [])))].sort();
  return (await euerPosten(jahre, q)).flatMap(form43Anteile);
}

export async function bwaBericht(zeitraum: Zeitraum, vergleich: Vergleich, q: Db | Tx = db): Promise<BwaBericht> {
  const kapitalgesellschaft = isKapitalgesellschaft((await loadCompany(q)).rechtsform);
  const kum = kumuliert(zeitraum);
  const vgl = vergleichszeitraum(zeitraum, vergleich);
  const vglKum = vergleich === "vorjahr" ? kumuliert(vorjahreszeitraum(zeitraum)) : null;
  const alle = kapitalgesellschaft ? [] : await anteile([zeitraum, kum, vgl, vglKum], q);
  const werte = form43(alle, zeitraum);
  const werteKum = form43(alle, kum);
  const werteVgl = vgl ? form43(alle, vgl) : null;
  const werteVglKum = vglKum ? form43(alle, vglKum) : null;
  const afaOffen: number[] = [];
  // Alle Jahre des Zeitraums; kumuliert liegt im letzten davon
  for (const jahr of jahreVon(zeitraum)) if ((await listAssets(jahr, q)).some((a) => a.pending)) afaOffen.push(jahr);
  return {
    kapitalgesellschaft,
    zeitraum,
    kumuliert: kum,
    vergleich: vgl,
    vergleichKumuliert: vglKum,
    afaOffen,
    zeilen: FORM43.map((d) => ({
      key: d.key,
      label: d.label,
      art: d.art,
      betrag: werte[d.key],
      kumuliert: werteKum[d.key],
      vergleich: werteVgl ? werteVgl[d.key] : null,
      vergleichKumuliert: werteVglKum ? werteVglKum[d.key] : null,
      abweichung: werteVgl ? abweichung(werte[d.key], werteVgl[d.key]) : null,
    })),
  };
}

export interface BwaVorgang {
  datum: string;
  betrag: Cents;
  sourceType: string;
  sourceId: string;
  rechnungId: string | null;
  belegId: string | null;
  /** Rechnungsnummer und Kunde bzw. Lieferant und Belegnummer; leer ohne Rechnung und Beleg */
  text: string;
}

export interface BwaGruppe {
  /** Zeile der EÜR mit ihrem Konto (bei Kategorien und Pauschalen) */
  euerZeile: string;
  label: string;
  konto: string | null;
  betrag: Cents;
  vorgaenge: BwaVorgang[];
}

/** Was in einer Zeile der Form 43 im Zeitraum steht: je Zeile der EÜR die Buchungen, mit Rechnung bzw. Beleg */
export async function bwaZeileDetails(zeitraum: Zeitraum, zeile: Form43Zeile, q: Db | Tx = db): Promise<BwaGruppe[]> {
  const treffer = (await anteile([zeitraum], q)).filter((a) => a.zeile === zeile && imZeitraum(zeitraum, a.datum));
  const texte = await vorgangTexte(treffer, q);
  const gruppen = new Map<string, BwaGruppe>();
  for (const a of treffer) {
    const gruppe: BwaGruppe = gruppen.get(a.euerZeile) ?? {
      euerZeile: a.euerZeile,
      label: euerZeileLabel(a.euerZeile),
      konto: a.euerZeile === "nichtAbziehbar" ? null : euerZeilenKonto(a.kontenrahmen, a.euerZeile),
      betrag: 0,
      vorgaenge: [],
    };
    gruppe.betrag += a.betrag;
    const { sourceType, sourceId, rechnungId, belegId } = a.quelle;
    gruppe.vorgaenge.push({
      datum: a.datum,
      betrag: a.betrag,
      sourceType,
      sourceId,
      rechnungId,
      belegId,
      text: (rechnungId && texte.get(rechnungId)) || (belegId && texte.get(belegId)) || "",
    });
    gruppen.set(a.euerZeile, gruppe);
  }
  const ergebnis = [...gruppen.values()].sort((a, b) => Math.abs(b.betrag) - Math.abs(a.betrag));
  for (const g of ergebnis) g.vorgaenge.sort((a, b) => a.datum.localeCompare(b.datum) || a.betrag - b.betrag);
  return ergebnis;
}

/** Rechnungsnummer und Kunde bzw. Lieferant und Belegnummer je ID */
async function vorgangTexte(treffer: readonly Form43Anteil[], q: Db | Tx): Promise<Map<string, string>> {
  const texte = new Map<string, string>();
  const rechnungen = [...new Set(treffer.flatMap((a) => (a.quelle.rechnungId ? [a.quelle.rechnungId] : [])))];
  const belege = [...new Set(treffer.flatMap((a) => (a.quelle.belegId ? [a.quelle.belegId] : [])))];
  const i = schema.invoices;
  const c = schema.contacts;
  for (const block of bloecke(rechnungen))
    for (const r of await q
      .select({ id: i.id, nummer: i.number, kunde: sql<string | null>`coalesce(${i.buyer} ->> 'name', ${c.name})` })
      .from(i)
      .leftJoin(c, sql`${c.id} = ${i.contactId}`)
      .where(inArray(i.id, block)))
      texte.set(r.id, [r.nummer ?? "Entwurf", r.kunde].filter(Boolean).join(" · "));
  const d = schema.documents;
  for (const block of bloecke(belege))
    for (const r of await q.select({ id: d.id, lieferant: d.supplierName, nummer: d.invoiceNumber, datei: d.filename }).from(d).where(inArray(d.id, block)))
      texte.set(r.id, [r.lieferant || r.datei, r.nummer].filter(Boolean).join(" · "));
  return texte;
}
