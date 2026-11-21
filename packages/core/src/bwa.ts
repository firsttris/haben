import { kostenartOf, type Kostenart } from "./bwa-kostenart.ts";
import { imZeitraum, type Zeitraum } from "./bwa-zeitraum.ts";
import { EUER_LABELS, type EuerLineKey } from "./euer.ts";
import type { BasisPoints, Cents } from "./money.ts";
import { roundHalfAwayFromZero } from "./money.ts";
import { PAUSCHALE_KONTEN, PAUSCHALE_LABEL, type PauschaleArt } from "./pauschalen.ts";
import { EXPENSE_CATEGORIES, type ExpenseCategory, type Kontenrahmen } from "./posting.ts";

/*
 * Einnahmen-Ausgaben-BWA (#1380) nach dem Aufbau der DATEV BWA-Form 43 (Musterauswertung BWA, DATEV 2016): Betriebseinnahmen
 * und Betriebsausgaben nach Zufluss und Abfluss (§ 4 Abs. 3, § 11 EStG), Einnahmen mit Umsatzsteuer, Ausgaben mit Vorsteuer,
 * wie die EÜR. Grundlage sind dieselben Beträge wie in der EÜR aus dem Journal (`euerAusZeilen`), je Buchung mit Datum; die
 * BWA ordnet nur anders: nach Kostenart statt nach Zeile der Anlage EÜR.
 *
 * Anders als die EÜR zeigt die BWA die nicht abziehbaren Ausgaben (30 % der Bewirtung, Gewerbesteuer, nicht abziehbare
 * Nebenleistungen) als Kosten, betriebswirtschaftlich sind sie Aufwand. Die Überleitung darunter führt zum Gewinn der EÜR.
 * Die Zeilen „Erhaltene/Geleistete Anzahlungen“ und „Zugang Forderungen/Verbindlichkeiten“ der DATEV-Form entfallen: Haben
 * rechnet nur nach Zahlung, Anzahlungen stehen bei den Erlösen bzw. Kosten, zu denen sie gehören.
 */

/** Zeilen der Form 43 mit Beträgen, ohne Summen */
export const FORM43_ZEILEN = [
  "erloese",
  "sonstigeErloese",
  "umsatzsteuer",
  "ustErstattung",
  "material",
  "fremdleistungen",
  "personal",
  "raum",
  "steuernVersicherungenBeitraege",
  "kfz",
  "werbeReise",
  "warenabgabe",
  "instandhaltung",
  "abschreibungen",
  "verschiedeneKosten",
  "buchwertAnlagenabgang",
  "sonstigeAufwendungen",
  "vorsteuer",
  "ustZahlung",
] as const;

export type Form43Zeile = (typeof FORM43_ZEILEN)[number];

export type Form43Summe = "summeErloese" | "summeEinnahmen" | "summeKosten" | "summeAusgaben" | "ergebnis" | "nichtAbziehbar" | "gewinnEuer";

export interface BwaZeileDefinition<Z extends string, S extends string> {
  key: Z | S;
  label: string;
  /** Zeile mit Beträgen, Zwischensumme oder Ergebnis */
  art: "zeile" | "summe" | "ergebnis";
}

/** Zeilen der Form 43 in der Reihenfolge der Auswertung */
export const FORM43: readonly BwaZeileDefinition<Form43Zeile, Form43Summe>[] = [
  { key: "erloese", label: "Erlöse aus betrieblicher Tätigkeit", art: "zeile" },
  { key: "sonstigeErloese", label: "Sonstige Erlöse", art: "zeile" },
  { key: "summeErloese", label: "Summe der Erlöse", art: "summe" },
  { key: "umsatzsteuer", label: "Umsatzsteuer", art: "zeile" },
  { key: "ustErstattung", label: "Umsatzsteuer-Erstattung", art: "zeile" },
  { key: "summeEinnahmen", label: "Summe der Betriebseinnahmen", art: "summe" },
  { key: "material", label: "Material- und Wareneinkauf", art: "zeile" },
  { key: "fremdleistungen", label: "Fremdleistungen", art: "zeile" },
  { key: "personal", label: "Personalkosten", art: "zeile" },
  { key: "raum", label: "Raumkosten", art: "zeile" },
  { key: "steuernVersicherungenBeitraege", label: "Steuern, Versicherungen, Beiträge", art: "zeile" },
  { key: "kfz", label: "Fahrzeugkosten", art: "zeile" },
  { key: "werbeReise", label: "Werbe- und Reisekosten", art: "zeile" },
  { key: "warenabgabe", label: "Kosten der Warenabgabe", art: "zeile" },
  { key: "instandhaltung", label: "Instandhaltung und Werkzeuge", art: "zeile" },
  { key: "abschreibungen", label: "Abschreibungen", art: "zeile" },
  { key: "verschiedeneKosten", label: "Verschiedene Kosten", art: "zeile" },
  { key: "summeKosten", label: "Summe der Kosten", art: "summe" },
  { key: "buchwertAnlagenabgang", label: "Buchwert der Anlagenabgänge", art: "zeile" },
  { key: "sonstigeAufwendungen", label: "Zinsen und sonstige Aufwendungen", art: "zeile" },
  { key: "vorsteuer", label: "Vorsteuer", art: "zeile" },
  { key: "ustZahlung", label: "Umsatzsteuer-Zahlungen", art: "zeile" },
  { key: "summeAusgaben", label: "Summe der Betriebsausgaben", art: "summe" },
  { key: "ergebnis", label: "Vorläufiges betriebswirtschaftliches Ergebnis", art: "ergebnis" },
  { key: "nichtAbziehbar", label: "+ nicht abziehbare Ausgaben (Bewirtung 30 %, Gewerbesteuer)", art: "zeile" },
  { key: "gewinnEuer", label: "Gewinn laut EÜR", art: "ergebnis" },
];

const EINNAHMEN: ReadonlySet<Form43Zeile> = new Set(["erloese", "sonstigeErloese", "umsatzsteuer", "ustErstattung"]);
/** Kostenzeilen der Form 43, die die Summe der Kosten bilden; Bezugsgröße der Anteile in `bwa-kennzahlen.ts` */
export const FORM43_KOSTEN: ReadonlySet<Form43Zeile> = new Set([
  "material",
  "fremdleistungen",
  "personal",
  "raum",
  "steuernVersicherungenBeitraege",
  "kfz",
  "werbeReise",
  "warenabgabe",
  "instandhaltung",
  "abschreibungen",
  "verschiedeneKosten",
]);

/** Zeile der Form 43 je Kostenart eines Kontos */
const JE_KOSTENART: Record<Kostenart, Form43Zeile> = {
  erloese: "erloese",
  sonstigeErloese: "sonstigeErloese",
  material: "material",
  fremdleistungen: "fremdleistungen",
  personal: "personal",
  raum: "raum",
  betrieblicheSteuern: "steuernVersicherungenBeitraege",
  versicherungen: "steuernVersicherungenBeitraege",
  kfz: "kfz",
  werbeReise: "werbeReise",
  warenabgabe: "warenabgabe",
  instandhaltung: "instandhaltung",
  abschreibungen: "abschreibungen",
  sonstigeKosten: "verschiedeneKosten",
  // Was Form 01 gesondert zeigt, fasst Form 43 zusammen: Erträge bei den sonstigen Erlösen, neutrale Aufwendungen und Zinsen
  // bei den sonstigen Aufwendungen, die Steuern vom Einkommen und Ertrag bei den Steuern
  bestandsveraenderungen: "sonstigeErloese",
  eigenleistungen: "sonstigeErloese",
  zinsertrag: "sonstigeErloese",
  neutralErtrag: "sonstigeErloese",
  zinsaufwand: "sonstigeAufwendungen",
  neutralAufwand: "sonstigeAufwendungen",
  // Verrechnete kalkulatorische Kosten gleichen die kalkulatorischen Kosten aus, die bei den verschiedenen Kosten stehen
  kalkulatorisch: "verschiedeneKosten",
  ertragsteuern: "steuernVersicherungenBeitraege",
};

/** Zeile der Form 43 für die Kostenart eines Kontos */
export const form43KostenartZeile = (kostenart: Kostenart): Form43Zeile => JE_KOSTENART[kostenart];

/** Zeilen der EÜR ohne eigenes Konto */
const FESTE_ZEILEN: Partial<Record<EuerLineKey, Form43Zeile>> = {
  einnahmenKleinunternehmer: "erloese",
  einnahmenSteuerpflichtig: "erloese",
  einnahmenSteuerfrei: "erloese",
  privateKfz: "sonstigeErloese",
  sachentnahmen: "sonstigeErloese",
  kursgewinne: "sonstigeErloese",
  vereinnahmteUst: "umsatzsteuer",
  ustEntnahmen: "umsatzsteuer",
  erstatteteUst: "ustErstattung",
  personal: "personal",
  steuerNebenleistungen: "steuernVersicherungenBeitraege",
  schuldzinsen: "sonstigeAufwendungen",
  schuldzinsenAnlage: "sonstigeAufwendungen",
  kursverluste: "sonstigeAufwendungen",
  afa: "abschreibungen",
  gwg: "abschreibungen",
  sammelposten: "abschreibungen",
  restbuchwert: "buchwertAnlagenabgang",
  vorsteuer: "vorsteuer",
  gezahlteUst: "ustZahlung",
};

/** Konto, auf dem eine Zeile der EÜR für eine Kategorie bzw. Pauschale gebucht ist; null für die festen Zeilen */
export function euerZeilenKonto(kontenrahmen: Kontenrahmen, key: EuerLineKey): string | null {
  if (key.startsWith("ausgabe:")) return EXPENSE_CATEGORIES[key.slice(8) as ExpenseCategory][kontenrahmen];
  if (key.startsWith("pauschale:")) return PAUSCHALE_KONTEN[key.slice(10) as PauschaleArt][kontenrahmen].konto;
  return null;
}

/** Bezeichnung einer Zeile der EÜR bzw. des nicht abziehbaren Teils, wie in der EÜR */
export function euerZeileLabel(key: EuerLineKey | "nichtAbziehbar"): string {
  if (key === "nichtAbziehbar") return "Nicht abziehbarer Teil (Bewirtung 30 %, Gewerbesteuer, Nebenleistungen)";
  if (key.startsWith("ausgabe:")) return EXPENSE_CATEGORIES[key.slice(8) as ExpenseCategory].label;
  if (key.startsWith("pauschale:")) return PAUSCHALE_LABEL[key.slice(10) as PauschaleArt];
  return EUER_LABELS[key as keyof typeof EUER_LABELS];
}

/**
 * Zeile der Form 43 für eine Zeile der EÜR. Kategorien und Pauschalen nach der Kostenart ihres Kontos; „Hardware“ ist ein
 * sofort abgeschriebenes geringwertiges Wirtschaftsgut (§ 6 Abs. 2 EStG) und steht deshalb bei den Abschreibungen.
 */
export function form43Zeile(kontenrahmen: Kontenrahmen, key: EuerLineKey): Form43Zeile {
  const fest = FESTE_ZEILEN[key];
  if (fest) return fest;
  if (key === "ausgabe:hardware") return "abschreibungen";
  const konto = euerZeilenKonto(kontenrahmen, key);
  const kostenart = konto === null ? null : kostenartOf(kontenrahmen, konto);
  // Ohne Kostenart (ein Konto, das es im Rahmen nicht als Erfolgskonto gibt) unter den verschiedenen Kosten statt verloren
  return kostenart ? form43KostenartZeile(kostenart) : "verschiedeneKosten";
}

/** Woher ein Betrag kommt: die Buchung und, bei einer Zahlung, die Rechnung bzw. der Beleg, den sie ausgleicht */
export interface BwaQuelle {
  buchungId: string;
  sourceType: string;
  sourceId: string;
  rechnungId: string | null;
  belegId: string | null;
}

/** Was eine Buchung in der EÜR bewirkt, mit ihrem Datum: die Eingabe der Form 43 */
export interface BwaEuerPosten {
  datum: string;
  kontenrahmen: Kontenrahmen;
  zeilen: Partial<Record<EuerLineKey, Cents>>;
  bewirtungNichtAbziehbar: Cents;
  gewerbesteuerNichtAbziehbar: Cents;
  quelle: BwaQuelle;
}

/** Ein Betrag einer Zeile der Form 43: aus welcher Zeile der EÜR und welcher Buchung */
export interface Form43Anteil {
  zeile: Form43Zeile;
  /** Zeile der EÜR; „nichtAbziehbar“ für den nicht abziehbaren Teil */
  euerZeile: EuerLineKey | "nichtAbziehbar";
  betrag: Cents;
  datum: string;
  kontenrahmen: Kontenrahmen;
  quelle: BwaQuelle;
}

/** Die Anteile eines Postens an den Zeilen der Form 43 */
export function form43Anteile(p: BwaEuerPosten): Form43Anteil[] {
  const anteile: Form43Anteil[] = [];
  const add = (zeile: Form43Zeile, euerZeile: Form43Anteil["euerZeile"], betrag: Cents) => {
    if (betrag !== 0) anteile.push({ zeile, euerZeile, betrag, datum: p.datum, kontenrahmen: p.kontenrahmen, quelle: p.quelle });
  };
  for (const [key, betrag] of Object.entries(p.zeilen) as [EuerLineKey, Cents][]) add(form43Zeile(p.kontenrahmen, key), key, betrag);
  // Nicht abziehbar: bei der Kostenart, zu der die Ausgabe gehört, und gleich hoch in der Überleitung
  add(form43Zeile(p.kontenrahmen, "ausgabe:bewirtung"), "nichtAbziehbar", p.bewirtungNichtAbziehbar);
  add("steuernVersicherungenBeitraege", "nichtAbziehbar", p.gewerbesteuerNichtAbziehbar);
  return anteile;
}

export type Form43Werte = Record<Form43Zeile | Form43Summe, Cents>;

/** Die Form 43 aus den Anteilen im Zeitraum */
export function form43(anteile: readonly Form43Anteil[], zeitraum: Zeitraum): Form43Werte {
  const w = Object.fromEntries(FORM43.map((d) => [d.key, 0])) as Form43Werte;
  for (const a of anteile) {
    if (!imZeitraum(zeitraum, a.datum)) continue;
    w[a.zeile] += a.betrag;
    if (a.euerZeile === "nichtAbziehbar") w.nichtAbziehbar += a.betrag;
  }
  const summe = (zeilen: ReadonlySet<Form43Zeile>) => [...zeilen].reduce((s, z) => s + w[z], 0);
  w.summeErloese = w.erloese + w.sonstigeErloese;
  w.summeEinnahmen = summe(EINNAHMEN);
  w.summeKosten = summe(FORM43_KOSTEN);
  w.summeAusgaben = w.summeKosten + w.buchwertAnlagenabgang + w.sonstigeAufwendungen + w.vorsteuer + w.ustZahlung;
  w.ergebnis = w.summeEinnahmen - w.summeAusgaben;
  w.gewinnEuer = w.ergebnis + w.nichtAbziehbar;
  return w;
}

/** Abweichung zum Vergleich in Cent und in Basispunkten des Vergleichsbetrags; ohne Prozent, wenn der Vergleich 0 ist */
export function abweichung(betrag: Cents, vergleich: Cents): { betrag: Cents; prozent: BasisPoints | null } {
  const differenz = betrag - vergleich;
  return { betrag: differenz, prozent: vergleich === 0 ? null : roundHalfAwayFromZero((differenz * 10_000) / Math.abs(vergleich)) };
}
