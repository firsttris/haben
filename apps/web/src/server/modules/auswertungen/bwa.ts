import {
  FORM01,
  FORM43,
  abweichung,
  anteil,
  euerZeileLabel,
  euerZeilenKonto,
  form43,
  form43Anteile,
  imZeitraum,
  isKapitalgesellschaft,
  jahreVon,
  kennzahlen,
  kumuliert,
  vergleichszeitraum,
  vorjahreszeitraum,
  zerlegeAbweichung,
  type BasisPoints,
  type BwaEuerPosten,
  type BwaForm,
  type BwaKennzahl,
  type Cents,
  type Form01Summe,
  type Form01Werte,
  type Form01Zeile,
  type Form43Anteil,
  type Form43Summe,
  type Form43Werte,
  type Form43Zeile,
  type Vergleich,
  type Warum,
  type WarumPosten,
  type Zeitraum,
} from "@haben/core";
import { inArray, sql } from "drizzle-orm";
import { db, schema, type Db, type Tx } from "../../db/index.ts";
import { listAssets } from "../buchhaltung/index.ts";
import { loadCompany } from "../stammdaten/index.ts";
import { euerAusJournal } from "./euer-journal.ts";
import { bloecke, type EuerBeitraege } from "./euer-journal-buchungen.ts";
import { form01Werte } from "./bwa-form01.ts";

/*
 * BWA (#1380): rechnet aus denselben Beträgen wie die EÜR aus dem Journal (euerAusJournal), je Buchung mit Datum, und ordnet
 * sie nach dem Aufbau der DATEV-Auswertungen (packages/core/src/bwa.ts). Bucht nichts. Einzelunternehmen bekommen die
 * Einnahmen-Ausgaben-BWA (Form 43) nach Zufluss und Abfluss, GmbH und UG die Kurzfristige Erfolgsrechnung (Form 01)
 * periodengerecht aus den Salden der Konten (bwa-form01.ts).
 */

export interface BwaZeileWerte {
  key: Form43Zeile | Form43Summe | Form01Zeile | Form01Summe;
  label: string;
  art: "zeile" | "summe" | "ergebnis";
  betrag: Cents;
  kumuliert: Cents;
  vergleich: Cents | null;
  vergleichKumuliert: Cents | null;
  abweichung: { betrag: Cents; prozent: BasisPoints | null } | null;
  /** Anteil an der Bezugsgröße (#1635), etwa Kosten in % der Summe der Kosten; null ohne Anteil */
  anteil: BasisPoints | null;
  anteilKumuliert: BasisPoints | null;
}

/** Kennzahlen je Spalte (#1635); ohne Vergleich null */
export interface BwaKennzahlen {
  zeitraum: BwaKennzahl[];
  kumuliert: BwaKennzahl[];
  vergleich: BwaKennzahl[] | null;
  vergleichKumuliert: BwaKennzahl[] | null;
}

export interface BwaBericht {
  /** GmbH und UG bilanzieren: Form 01 periodengerecht statt Form 43 nach Zufluss und Abfluss */
  kapitalgesellschaft: boolean;
  zeitraum: Zeitraum;
  kumuliert: Zeitraum;
  vergleich: Zeitraum | null;
  /** Kumulierter Vergleich nur mit dem Vorjahr; „seit Jahresbeginn“ der Vorperiode wäre ein anderes Jahr */
  vergleichKumuliert: Zeitraum | null;
  zeilen: BwaZeileWerte[];
  kennzahlen: BwaKennzahlen;
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

/** Die Zeilen einer Form mit den Beträgen und Anteilen je Spalte und ihre Kennzahlen; ohne Vergleich null */
function zeilenWerte(
  form: BwaForm,
  [werte, werteKum, werteVgl, werteVglKum]: readonly (Form43Werte | Form01Werte | null)[],
): { zeilen: BwaZeileWerte[]; kennzahlen: BwaKennzahlen } {
  const spalte = (x: Form43Werte | Form01Werte | null | undefined, key: string) => (x ? (x as Readonly<Record<string, Cents>>)[key]! : null);
  const definitionen: readonly { key: string; label: string; art: BwaZeileWerte["art"] }[] = form === "form01" ? FORM01 : FORM43;
  const kennzahlenVon = (x: Form43Werte | Form01Werte | null | undefined) => (x ? kennzahlen(form, x) : null);
  const zeilen = definitionen.map((d) => {
    const betrag = spalte(werte, d.key)!;
    const vergleich = spalte(werteVgl, d.key);
    return {
      key: d.key as BwaZeileWerte["key"],
      label: d.label,
      art: d.art,
      betrag,
      kumuliert: spalte(werteKum, d.key)!,
      vergleich,
      vergleichKumuliert: spalte(werteVglKum, d.key),
      abweichung: vergleich === null ? null : abweichung(betrag, vergleich),
      anteil: anteil(form, werte!, d.key),
      anteilKumuliert: anteil(form, werteKum!, d.key),
    };
  });
  return {
    zeilen,
    kennzahlen: {
      zeitraum: kennzahlenVon(werte)!,
      kumuliert: kennzahlenVon(werteKum)!,
      vergleich: kennzahlenVon(werteVgl),
      vergleichKumuliert: kennzahlenVon(werteVglKum),
    },
  };
}

export async function bwaBericht(zeitraum: Zeitraum, vergleich: Vergleich, q: Db | Tx = db): Promise<BwaBericht> {
  const kapitalgesellschaft = isKapitalgesellschaft((await loadCompany(q)).rechtsform);
  const kum = kumuliert(zeitraum);
  const vgl = vergleichszeitraum(zeitraum, vergleich);
  const vglKum = vergleich === "vorjahr" ? kumuliert(vorjahreszeitraum(zeitraum)) : null;
  const zeitraeume = [zeitraum, kum, vgl, vglKum];
  let spalten: { zeilen: BwaZeileWerte[]; kennzahlen: BwaKennzahlen };
  if (kapitalgesellschaft) spalten = zeilenWerte("form01", await form01Werte(zeitraeume, q));
  else {
    const alle = await anteile(zeitraeume, q);
    spalten = zeilenWerte(
      "form43",
      zeitraeume.map((z) => (z ? form43(alle, z) : null)),
    );
  }
  const afaOffen: number[] = [];
  // Alle Jahre des Zeitraums; kumuliert liegt im letzten davon
  for (const jahr of jahreVon(zeitraum)) if ((await listAssets(jahr, q)).some((a) => a.pending)) afaOffen.push(jahr);
  return { kapitalgesellschaft, zeitraum, kumuliert: kum, vergleich: vgl, vergleichKumuliert: vglKum, afaOffen, ...spalten };
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
  const angaben = await quellenAngaben(treffer, q);
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
      text: angabeZu(angaben, a.quelle)?.text ?? "",
    });
    gruppen.set(a.euerZeile, gruppe);
  }
  const ergebnis = [...gruppen.values()].sort((a, b) => Math.abs(b.betrag) - Math.abs(a.betrag));
  for (const g of ergebnis) g.vorgaenge.sort((a, b) => a.datum.localeCompare(b.datum) || a.betrag - b.betrag);
  return ergebnis;
}

/** Was Haben zu einer Rechnung bzw. einem Beleg anzeigt: der Text des Vorgangs und der Kontakt */
interface QuellenAngabe {
  /** Rechnungsnummer und Kunde bzw. Lieferant und Belegnummer */
  text: string;
  kontakt: WarumPosten["kontakt"];
}

/**
 * Text und Kontakt je Rechnung bzw. Beleg, gesammelt in Blöcken geladen. Kunde einer Rechnung ist der Name auf der Rechnung,
 * sonst der des Kontakts; Lieferant eines Belegs der verknüpfte Kontakt, sonst der Name am Beleg ohne Kontakt. Ein aus
 * Lexware Office übernommener Vorgang ohne Kontakt gehört über den archivierten Beleg zum Kontakt (wie auf der Kontaktseite,
 * belege/lieferant-belege.ts). Namen und USt-IdNr. von Vorgang und Kontakt fassen in „Warum?“ denselben Lieferanten bzw.
 * Kunden zusammen (lieferantGruppen, #1514).
 */
async function quellenAngaben(treffer: readonly Form43Anteil[], q: Db | Tx): Promise<Map<string, QuellenAngabe>> {
  const angaben = new Map<string, QuellenAngabe>();
  const rechnungen = [...new Set(treffer.flatMap((a) => (a.quelle.rechnungId ? [a.quelle.rechnungId] : [])))];
  const belege = [...new Set(treffer.flatMap((a) => (a.quelle.belegId ? [a.quelle.belegId] : [])))];
  const i = schema.invoices;
  const c = schema.contacts;
  const v = schema.lexofficeVouchers;
  const kontakt = { kontaktName: c.name, kontaktUstId: c.ustId };
  for (const block of bloecke(rechnungen))
    for (const r of await q
      .select({
        id: i.id,
        nummer: i.number,
        kontaktId: sql<string | null>`coalesce(${i.contactId}, ${v.contactId})`,
        kunde: sql<string | null>`coalesce(nullif(${i.buyer} ->> 'name', ''), ${c.name})`,
        ustId: sql<string | null>`${i.buyer} ->> 'ustId'`,
        ...kontakt,
      })
      .from(i)
      .leftJoin(v, sql`${v.id} = ${i.lexofficeVoucherId}`)
      .leftJoin(c, sql`${c.id} = coalesce(${i.contactId}, ${v.contactId})`)
      .where(inArray(i.id, block)))
      angaben.set(r.id, {
        text: [r.nummer ?? "Entwurf", r.kunde].filter(Boolean).join(" · "),
        kontakt: { id: r.kontaktId, name: r.kunde ?? "", namen: [r.kontaktName ?? ""], ustIds: [r.ustId ?? "", r.kontaktUstId ?? ""] },
      });
  const d = schema.documents;
  for (const block of bloecke(belege))
    for (const r of await q
      .select({
        id: d.id,
        lieferant: d.supplierName,
        nummer: d.invoiceNumber,
        datei: d.filename,
        ustId: d.supplierUstId,
        kontaktId: sql<string | null>`coalesce(${d.supplierContactId}, ${v.contactId})`,
        ...kontakt,
      })
      .from(d)
      .leftJoin(v, sql`${v.id} = ${d.lexofficeVoucherId}`)
      .leftJoin(c, sql`${c.id} = coalesce(${d.supplierContactId}, ${v.contactId})`)
      .where(inArray(d.id, block)))
      angaben.set(r.id, {
        text: [r.lieferant || r.datei, r.nummer].filter(Boolean).join(" · "),
        kontakt: {
          id: r.kontaktId,
          name: (r.kontaktId && r.kontaktName) || r.lieferant,
          namen: [r.lieferant],
          ustIds: [r.ustId, r.kontaktUstId ?? ""],
        },
      });
  return angaben;
}

const angabeZu = (angaben: ReadonlyMap<string, QuellenAngabe>, { rechnungId, belegId }: Form43Anteil["quelle"]) =>
  (rechnungId ? angaben.get(rechnungId) : undefined) ?? (belegId ? angaben.get(belegId) : undefined);

/**
 * „Warum?“ (#1380): die Abweichung einer Zeile der Form 43 zum Vergleichszeitraum nach Kontakt, die fünf größten einzeln.
 * Ein Vorgang ist eine Buchung; ihre Anteile aus mehreren Zeilen der EÜR (etwa zwei Steuersätze) zählen zusammen. Ohne
 * Vergleich und für GmbH und UG (ihre Form 01 rechnet aus Salden, nicht je Vorgang) null.
 */
export async function bwaWarum(zeitraum: Zeitraum, vergleich: Vergleich, zeile: Form43Zeile, q: Db | Tx = db): Promise<Warum | null> {
  const vgl = vergleichszeitraum(zeitraum, vergleich);
  if (!vgl || isKapitalgesellschaft((await loadCompany(q)).rechtsform)) return null;
  const treffer = (await anteile([zeitraum, vgl], q)).filter((a) => a.zeile === zeile && (imZeitraum(zeitraum, a.datum) || imZeitraum(vgl, a.datum)));
  const angaben = await quellenAngaben(treffer, q);
  const jeBuchung = new Map<string, WarumPosten>();
  for (const a of treffer) {
    const schluessel = `${a.quelle.buchungId}|${a.quelle.rechnungId}|${a.quelle.belegId}`;
    const p = jeBuchung.get(schluessel) ?? { datum: a.datum, betrag: 0, kontakt: angabeZu(angaben, a.quelle)?.kontakt ?? { id: null, name: "" } };
    p.betrag += a.betrag;
    jeBuchung.set(schluessel, p);
  }
  return zerlegeAbweichung([...jeBuchung.values()], zeitraum, vgl, { hoechstens: 5 });
}
