import type { BwaZeileDefinition } from "./bwa.ts";
import { kostenartOf, type Kostenart } from "./bwa-kostenart.ts";
import type { Cents } from "./money.ts";
import type { Kontenrahmen } from "./posting.ts";
import { carriesForward } from "./vortrag.ts";

/*
 * Kurzfristige Erfolgsrechnung (#1380) nach dem Aufbau der DATEV BWA-Form 01 (Musterauswertung BWA, DATEV 2016) für GmbH
 * und UG: periodengerecht wie die GuV aus den Salden der Erfolgskonten nach Buchungsdatum. Jedes Erfolgskonto steht nach
 * seiner Kostenart (bwa-kostenart.ts) in genau einer Zeile; ein Erfolgskonto ohne Kostenart (Lücke im Kontenrahmen) steht
 * unter „Kontenklasse unbesetzt“. Die Konten der Ergebnisverwendung fehlen wie in der GuV. Über ein Jahr ist das vorläufige
 * Ergebnis deshalb das Jahresergebnis der GuV (hgb-abschluss.ts), plus was unter „Kontenklasse unbesetzt“ steht; dort fehlt
 * es als nicht zugeordnet.
 */

/** Zeilen der Form 01 mit Beträgen, ohne Summen */
export const FORM01_ZEILEN = [
  "umsatzerloese",
  "bestandsveraenderungen",
  "eigenleistungen",
  "material",
  "sonstigeErloese",
  "personal",
  "raum",
  "betrieblicheSteuern",
  "versicherungen",
  "besondereKosten",
  "kfz",
  "werbeReise",
  "warenabgabe",
  "abschreibungen",
  "instandhaltung",
  "sonstigeKosten",
  "zinsaufwand",
  "neutralAufwand",
  "zinsertrag",
  "neutralErtrag",
  "kalkulatorisch",
  "unbesetzt",
  "ertragsteuern",
] as const;

export type Form01Zeile = (typeof FORM01_ZEILEN)[number];

export type Form01Summe =
  | "gesamtleistung"
  | "rohertrag"
  | "betrieblicherRohertrag"
  | "gesamtkosten"
  | "betriebsergebnis"
  | "neutralerAufwand"
  | "neutralerErtrag"
  | "ergebnisVorSteuern"
  | "vorlaeufigesErgebnis";

/** Zeilen der Form 01 in der Reihenfolge der Auswertung, die Abkürzungen der DATEV-Form ausgeschrieben */
export const FORM01: readonly BwaZeileDefinition<Form01Zeile, Form01Summe>[] = [
  { key: "umsatzerloese", label: "Umsatzerlöse", art: "zeile" },
  { key: "bestandsveraenderungen", label: "Bestandsveränderungen fertiger und unfertiger Erzeugnisse", art: "zeile" },
  { key: "eigenleistungen", label: "Aktivierte Eigenleistungen", art: "zeile" },
  { key: "gesamtleistung", label: "Gesamtleistung", art: "summe" },
  { key: "material", label: "Material- und Wareneinkauf", art: "zeile" },
  { key: "rohertrag", label: "Rohertrag", art: "summe" },
  { key: "sonstigeErloese", label: "Sonstige betriebliche Erlöse", art: "zeile" },
  { key: "betrieblicherRohertrag", label: "Betrieblicher Rohertrag", art: "summe" },
  { key: "personal", label: "Personalkosten", art: "zeile" },
  { key: "raum", label: "Raumkosten", art: "zeile" },
  { key: "betrieblicheSteuern", label: "Betriebliche Steuern", art: "zeile" },
  { key: "versicherungen", label: "Versicherungen und Beiträge", art: "zeile" },
  { key: "besondereKosten", label: "Besondere Kosten", art: "zeile" },
  { key: "kfz", label: "Kfz-Kosten (ohne Kfz-Steuer)", art: "zeile" },
  { key: "werbeReise", label: "Werbe- und Reisekosten", art: "zeile" },
  { key: "warenabgabe", label: "Kosten der Warenabgabe", art: "zeile" },
  { key: "abschreibungen", label: "Abschreibungen", art: "zeile" },
  { key: "instandhaltung", label: "Reparatur und Instandhaltung", art: "zeile" },
  { key: "sonstigeKosten", label: "Sonstige Kosten", art: "zeile" },
  { key: "gesamtkosten", label: "Gesamtkosten", art: "summe" },
  { key: "betriebsergebnis", label: "Betriebsergebnis", art: "ergebnis" },
  { key: "zinsaufwand", label: "Zinsaufwand", art: "zeile" },
  { key: "neutralAufwand", label: "Sonstiger neutraler Aufwand", art: "zeile" },
  { key: "neutralerAufwand", label: "Neutraler Aufwand", art: "summe" },
  { key: "zinsertrag", label: "Zinserträge", art: "zeile" },
  { key: "neutralErtrag", label: "Sonstiger neutraler Ertrag", art: "zeile" },
  { key: "kalkulatorisch", label: "Verrechnete kalkulatorische Kosten", art: "zeile" },
  { key: "neutralerErtrag", label: "Neutraler Ertrag", art: "summe" },
  { key: "unbesetzt", label: "Kontenklasse unbesetzt", art: "zeile" },
  { key: "ergebnisVorSteuern", label: "Ergebnis vor Steuern", art: "ergebnis" },
  { key: "ertragsteuern", label: "Steuern vom Einkommen und Ertrag", art: "zeile" },
  { key: "vorlaeufigesErgebnis", label: "Vorläufiges Ergebnis", art: "ergebnis" },
];

/**
 * Zeile der Form 01 je Kostenart. Fremdleistungen stehen in der DATEV-Form beim Material- und Wareneinkauf. „Besondere
 * Kosten“ nennt der Kontenrahmen nicht als Gruppe; die Zeile bleibt leer.
 */
const JE_KOSTENART: Record<Kostenart, Form01Zeile> = {
  erloese: "umsatzerloese",
  bestandsveraenderungen: "bestandsveraenderungen",
  eigenleistungen: "eigenleistungen",
  material: "material",
  fremdleistungen: "material",
  sonstigeErloese: "sonstigeErloese",
  personal: "personal",
  raum: "raum",
  betrieblicheSteuern: "betrieblicheSteuern",
  versicherungen: "versicherungen",
  kfz: "kfz",
  werbeReise: "werbeReise",
  warenabgabe: "warenabgabe",
  abschreibungen: "abschreibungen",
  instandhaltung: "instandhaltung",
  sonstigeKosten: "sonstigeKosten",
  zinsaufwand: "zinsaufwand",
  neutralAufwand: "neutralAufwand",
  zinsertrag: "zinsertrag",
  neutralErtrag: "neutralErtrag",
  kalkulatorisch: "kalkulatorisch",
  ertragsteuern: "ertragsteuern",
};

/**
 * Zeilen, deren Betrag der Haben-Saldo ist (Erträge und Leistung positiv); die übrigen zeigen den Soll-Saldo als Aufwand.
 * Verrechnete kalkulatorische Kosten stehen im Haben eines Aufwandskontos und zählen zum neutralen Ertrag. „Kontenklasse
 * unbesetzt“ zählt wie ein Ertrag: positiv erhöht es das Ergebnis.
 */
const HABEN: ReadonlySet<Form01Zeile> = new Set([
  "umsatzerloese",
  "bestandsveraenderungen",
  "eigenleistungen",
  "sonstigeErloese",
  "zinsertrag",
  "neutralErtrag",
  "kalkulatorisch",
  "unbesetzt",
]);

/** Kostenarten der Form 01, die die Gesamtkosten bilden; Bezugsgröße der Anteile in `bwa-kennzahlen.ts` */
export const FORM01_KOSTEN: readonly Form01Zeile[] = [
  "personal",
  "raum",
  "betrieblicheSteuern",
  "versicherungen",
  "besondereKosten",
  "kfz",
  "werbeReise",
  "warenabgabe",
  "abschreibungen",
  "instandhaltung",
  "sonstigeKosten",
];

/**
 * Konten der Ergebnisverwendung nach dem Jahresergebnis (§ 158 AktG; § 275 Abs. 4 HGB: Veränderungen der Gewinnrücklagen erst
 * nach dem Posten „Jahresüberschuss/Jahresfehlbetrag“), ohne GuV-Posten (hgb.ts); DATEV-Kontenrahmen 2026.
 * Einstellungen in und Entnahmen aus Rücklagen, Gewinn- und Verlustvortrag, Vorabausschüttung und Ertrag aus der
 * Kapitalherabsetzung ändern das Ergebnis nicht, sie verteilen es.
 */
const ERGEBNISVERWENDUNG: Record<Kontenrahmen, readonly (readonly [von: string, bis: string])[]> = {
  SKR03: [
    ["2480", "2489"], // S. 15, Einstellungen in Rücklagen, Änderung steuerlicher Ausgleichsposten
    ["2495", "2499"], // S. 16, Einstellungen in Kapital- und Gewinnrücklagen
    ["2745", "2745"], // S. 17, „Ertrag aus der Kapitalherabsetzung“
    ["2795", "2799"], // S. 18, Entnahmen aus Kapital- und Gewinnrücklagen
    ["2840", "2870"], // S. 18, Entnahmen aus Rücklagen, Gewinn- und Verlustvortrag, 2870 „Vorabausschüttung“
  ],
  SKR04: [
    ["7700", "7790"], // S. 29, Gewinn- und Verlustvortrag, Entnahmen und Einstellungen, 7790 „Vorabausschüttung“
  ],
};

const ergebnisverwendung = (kontenrahmen: Kontenrahmen, account: string) =>
  ERGEBNISVERWENDUNG[kontenrahmen].some(([von, bis]) => account >= von && account <= bis);

/**
 * Zeile der Form 01 für ein Konto; null für Bestandskonten, Vortragskonten der Klasse 9, Personenkonten und die Konten der
 * Ergebnisverwendung. Ein eigenes
 * Sachkonto (#270) löst der Aufrufer vorher auf das Konto seiner Elternkategorie auf, wie bei `kostenartOf`.
 */
export function form01Zeile(kontenrahmen: Kontenrahmen, account: string): Form01Zeile | null {
  if (!/^\d{4}$/.test(account) || carriesForward(kontenrahmen, account) || ergebnisverwendung(kontenrahmen, account)) return null;
  const kostenart = kostenartOf(kontenrahmen, account);
  return kostenart ? JE_KOSTENART[kostenart] : "unbesetzt";
}

/** Betrag eines Saldos (Soll − Haben) in seiner Zeile: Erträge mit Haben-Saldo positiv, Aufwand mit Soll-Saldo */
export const form01Betrag = (zeile: Form01Zeile, saldo: Cents): Cents => (HABEN.has(zeile) ? -saldo : saldo);

/** Saldo eines Kontos im Zeitraum */
export interface Form01Saldo {
  kontenrahmen: Kontenrahmen;
  /** Das Konto, nach dem die Zeile bestimmt wird: bei einem eigenen Sachkonto das der Elternkategorie */
  account: string;
  /** Soll − Haben */
  saldo: Cents;
}

export type Form01Werte = Record<Form01Zeile | Form01Summe, Cents>;

/** Die Form 01 aus den Salden der Konten in einem Zeitraum; Bestandskonten zählen nicht */
export function form01(salden: readonly Form01Saldo[]): Form01Werte {
  const w = Object.fromEntries(FORM01.map((d) => [d.key, 0])) as Form01Werte;
  for (const { kontenrahmen, account, saldo } of salden) {
    const zeile = form01Zeile(kontenrahmen, account);
    if (zeile) w[zeile] += form01Betrag(zeile, saldo);
  }
  w.gesamtleistung = w.umsatzerloese + w.bestandsveraenderungen + w.eigenleistungen;
  w.rohertrag = w.gesamtleistung - w.material;
  w.betrieblicherRohertrag = w.rohertrag + w.sonstigeErloese;
  w.gesamtkosten = FORM01_KOSTEN.reduce((s, z) => s + w[z], 0);
  w.betriebsergebnis = w.betrieblicherRohertrag - w.gesamtkosten;
  w.neutralerAufwand = w.zinsaufwand + w.neutralAufwand;
  w.neutralerErtrag = w.zinsertrag + w.neutralErtrag + w.kalkulatorisch;
  w.ergebnisVorSteuern = w.betriebsergebnis - w.neutralerAufwand + w.neutralerErtrag + w.unbesetzt;
  w.vorlaeufigesErgebnis = w.ergebnisVorSteuern - w.ertragsteuern;
  return w;
}
