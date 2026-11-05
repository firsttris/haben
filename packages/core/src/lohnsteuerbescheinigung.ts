import { naechsterWerktag } from "./holidays.ts";
import type { Konfession, LohnStammdaten } from "./lohnabrechnung/typen.ts";
import type { Cents } from "./money.ts";
import type { SvBeitraege } from "./sozialversicherung/index.ts";
import type { Bundesland } from "./steuernummer.ts";

/*
 * Elektronische Lohnsteuerbescheinigung (§ 41b EStG, https://www.gesetze-im-internet.de/estg/__41b.html) je Arbeitnehmer
 * und Kalenderjahr aus den festgeschriebenen, nicht stornierten Abrechnungen. Zeilen nach dem amtlichen Muster des
 * Ausdrucks (BMF-Schreiben vom 29.8.2025 für 2026,
 * https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Lohnsteuer/2025-08-29-ausdruck-elektr-lstbesch-2026.html)
 * und den Elementen der Schnittstelle Lohnsteuerbescheinigung 2025 (lstb202501.xsd im ERiC-Paket).
 *
 * Bescheinigt werden nur Fälle, die Haben abrechnet; was darüber hinausginge, ist „nicht unterstützt“ statt still falsch:
 * - Zeile 3 ist der steuerpflichtige Arbeitslohn der Abrechnungen (Sachbezüge, sonstige Bezüge und steuerfreie Bezüge
 *   rechnet Haben nicht; Zeilen 8 bis 21 bleiben leer).
 * - Zeilen 22a und 23a: Anteile zur gesetzlichen Rentenversicherung; 25 bis 27: die vom Lohn einbehaltenen Beiträge zur
 *   Kranken-, Pflege- und Arbeitslosenversicherung. Zeile 24 (steuerfreie Zuschüsse nach § 3 Nr. 62 EStG) kommt nicht vor:
 *   Haben rechnet keinen Zuschuss. Liegt das Entgelt über der Beitragsbemessungsgrenze der Krankenversicherung, kann die
 *   Versicherung freiwillig sein; dann gälten für Zeilen 24 bis 26 andere Regeln, deshalb ist das nicht unterstützt.
 * - Minijobs mit Pauschsteuer bekommen keine Bescheinigung (§ 41b Abs. 6 EStG).
 * - Der Großbuchstabe U (Zeile 2, § 41 Abs. 1 Satz 5 EStG) kommt nicht vor: Haben verlangt für jeden Monat der
 *   Beschäftigung im Jahr eine Abrechnung; fehlt ein Monat, ist die Bescheinigung nicht fertig.
 */

/** Was aus einer festgeschriebenen, nicht stornierten Abrechnung in die Bescheinigung eingeht */
export interface LstbAbrechnung {
  /** Lohnzahlungszeitraum, 1 bis 12; laufender Arbeitslohn gehört in das Jahr, in dem er endet (§ 38a Abs. 1 Satz 2 EStG) */
  monat: number;
  /** Stand der Stammdaten, mit dem abgerechnet wurde */
  stammdaten: LohnStammdaten;
  steuerBrutto: Cents;
  svBrutto: Cents;
  lohnsteuer: Cents;
  soli: Cents;
  kirchensteuer: Cents;
  sv: Pick<SvBeitraege, "kv" | "kvZusatz" | "pv" | "rv" | "av" | "bemessung">;
}

export interface LstbEingabe {
  jahr: number;
  /** Beginn und Ende der Beschäftigung laut Stammdaten, JJJJ-MM-TT */
  eintritt: string;
  austritt: string | null;
  abrechnungen: readonly LstbAbrechnung[];
  /** Monate des Jahres mit einem Entwurf, der noch nicht festgeschrieben ist */
  entwuerfe: readonly number[];
  heute: string;
}

/** Besteuerungsmerkmale ab einem Tag; ändern sie sich im Jahr, gibt es mehrere (Schnittstelle: höchstens 24) */
export interface LstbMerkmale {
  gueltigAb: string;
  steuerklasse: number;
  /** Faktor in Tausendsteln, 1000 ohne */
  faktor: number;
  /** Zahl der Kinderfreibeträge in Tausendsteln */
  kinderfreibetraege: number;
  konfession: Konfession | null;
}

/** Bescheinigte Werte in Cent, benannt nach den Zeilen des amtlichen Musters */
export interface LstbWerte {
  jahr: number;
  /** Zeile 1: Bescheinigungszeitraum, JJJJ-MM-TT */
  von: string;
  bis: string;
  /** Zeile 3 */
  bruttoarbeitslohn: Cents;
  /** Zeilen 4 bis 6 */
  lohnsteuer: Cents;
  soli: Cents;
  kirchensteuer: Cents;
  /** Zeilen 22a und 23a: gesetzliche Rentenversicherung */
  rvArbeitgeber: Cents;
  rvArbeitnehmer: Cents;
  /** Zeilen 25 bis 27 */
  kvArbeitnehmer: Cents;
  pvArbeitnehmer: Cents;
  avArbeitnehmer: Cents;
  /**
   * Private Basiskranken- und Pflege-Pflichtversicherung: Monatsbeitrag im letzten Lohnzahlungszeitraum (ab 2026 in der
   * linken Spalte des Ausdrucks, § 39 Abs. 4 Nr. 4 Buchst. b EStG) und Summe des Jahres (Zeile 28 bis 2025); null ohne
   */
  pkvBasis: { letzterMonat: Cents; jahr: Cents } | null;
  merkmale: LstbMerkmale[];
}

export type LstbErgebnis =
  | { status: "bereit"; werte: LstbWerte }
  /** Keine Bescheinigung nötig: keine Abrechnung oder nur pauschal besteuerter Arbeitslohn */
  | { status: "keine"; meldung: string }
  /** Noch nicht: Entwürfe, fehlende Monate oder das Lohnkonto ist noch nicht abzuschließen */
  | { status: "offen"; meldung: string }
  | { status: "nicht-unterstuetzt"; meldung: string };

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const pad = (n: number) => String(n).padStart(2, "0");
const letzterTag = (jahr: number, monat: number) => `${jahr}-${pad(monat)}-${pad(new Date(Date.UTC(jahr, monat, 0)).getUTCDate())}`;
const datumText = (iso: string) => iso.split("-").reverse().join(".");

const merkmaleVon = (s: LohnStammdaten) => ({
  steuerklasse: s.steuerklasse,
  faktor: s.faktor,
  kinderfreibetraege: s.kinderfreibetraege,
  konfession: s.konfession,
});
const gleicheMerkmale = (a: Omit<LstbMerkmale, "gueltigAb">, b: Omit<LstbMerkmale, "gueltigAb">) =>
  a.steuerklasse === b.steuerklasse && a.faktor === b.faktor && a.kinderfreibetraege === b.kinderfreibetraege && a.konfession === b.konfession;

const entwurfOffen = (monate: readonly number[]): LstbErgebnis => ({
  status: "offen",
  meldung: `Für ${monate.map((m) => MONATE[m - 1]).join(", ")} gibt es einen Entwurf; erst festschreiben oder löschen.`,
});

const pauschal = (a: LstbAbrechnung) => a.stammdaten.art === "minijob" && a.stammdaten.minijob.pauschsteuer;

/** Was gegen eine Bescheinigung spricht, die Haben sicher ausstellen kann; null, wenn nichts */
function nichtUnterstuetzt(a: LstbAbrechnung): string | null {
  const s = a.stammdaten;
  const monat = `${MONATE[a.monat - 1]}`;
  if (s.art === "minijob") return `Ein Minijob ohne Pauschsteuer (${monat}) bescheinigt Haben nicht.`;
  if (s.faktor !== 1000) return `Das Faktorverfahren (${monat}) bescheinigt Haben nicht.`;
  if (s.kv.art === "privat" && s.kv.arbeitgeberzuschuss > 0)
    return `Einen Zuschuss zur privaten Krankenversicherung (${monat}) bescheinigt Haben nicht (Zeile 24).`;
  // Über der BBG der KV (zugleich besondere Jahresarbeitsentgeltgrenze, § 6 Abs. 7 SGB V) kann die Versicherung freiwillig sein
  if (s.art === "beschaeftigt" && a.sv.bemessung.kvPv < a.svBrutto) {
    return `Im ${monat} liegt das Entgelt über der Beitragsbemessungsgrenze der Krankenversicherung; ob die Versicherung freiwillig ist (Zeilen 24 bis 26), weiß Haben nicht.`;
  }
  return null;
}

/**
 * Die Lohnsteuerbescheinigung eines Arbeitnehmers für ein Jahr, oder warum es (noch) keine gibt. Fertig ist sie erst nach
 * Abschluss des Lohnkontos: am Ende des Jahres oder mit dem Austritt (§ 41b Abs. 1 Satz 1 EStG).
 */
export function lohnsteuerbescheinigung(e: LstbEingabe): LstbErgebnis {
  const { jahr } = e;
  const abrechnungen = [...e.abrechnungen].sort((a, b) => a.monat - b.monat);
  if (abrechnungen.length === 0) {
    if (e.entwuerfe.length > 0) return entwurfOffen(e.entwuerfe);
    return { status: "keine", meldung: `Für ${jahr} ist keine Abrechnung festgeschrieben.` };
  }
  if (abrechnungen.every(pauschal)) {
    return { status: "keine", meldung: "Pauschal besteuerter Arbeitslohn (Minijob) wird nicht bescheinigt (§ 41b Abs. 6 EStG)." };
  }
  if (abrechnungen.some(pauschal)) {
    return {
      status: "nicht-unterstuetzt",
      meldung: "Im Jahr wechseln pauschal besteuerte und nach den ELStAM besteuerte Monate; das bescheinigt Haben nicht.",
    };
  }
  for (const a of abrechnungen) {
    const grund = nichtUnterstuetzt(a);
    if (grund) return { status: "nicht-unterstuetzt", meldung: grund };
  }
  if (new Set(abrechnungen.map((a) => a.monat)).size !== abrechnungen.length) {
    return { status: "nicht-unterstuetzt", meldung: "Für einen Monat gibt es mehr als eine gültige Abrechnung." };
  }

  // Zeile 1: Dauer des Dienstverhältnisses im Jahr; Haben rechnet nur ganze Monate
  // Datumstexte JJJJ-MM-TT: der spätere von Eintritt und Jahresbeginn
  const von = [e.eintritt, `${jahr}-01-01`].sort().at(-1)!;
  const bis = e.austritt && e.austritt < `${jahr}-12-31` ? e.austritt : `${jahr}-12-31`;
  if (von.slice(0, 4) !== String(jahr) || bis.slice(0, 4) !== String(jahr) || von > bis) {
    return { status: "nicht-unterstuetzt", meldung: `Eintritt und Austritt passen nicht zu den Abrechnungen ${jahr}.` };
  }
  const ersterMonat = Number(von.slice(5, 7));
  const letzterMonat = Number(bis.slice(5, 7));
  if (!von.endsWith("-01") || bis !== letzterTag(jahr, letzterMonat)) {
    return { status: "nicht-unterstuetzt", meldung: "Eintritt oder Austritt im Lauf eines Monats bescheinigt Haben nicht." };
  }
  const ausserhalb = abrechnungen.find((a) => a.monat < ersterMonat || a.monat > letzterMonat);
  if (ausserhalb) return { status: "nicht-unterstuetzt", meldung: `Die Abrechnung für ${MONATE[ausserhalb.monat - 1]} liegt außerhalb der Beschäftigung.` };
  if (e.entwuerfe.length > 0) return entwurfOffen(e.entwuerfe);
  if (e.heute <= bis) {
    return {
      status: "offen",
      meldung: `Das Lohnkonto wird erst nach dem ${datumText(bis)} abgeschlossen; danach lässt sich bescheinigen (§ 41b Abs. 1 Satz 1 EStG).`,
    };
  }

  const fehlend = Array.from({ length: letzterMonat - ersterMonat + 1 }, (_, i) => ersterMonat + i).filter((m) => !abrechnungen.some((a) => a.monat === m));
  if (fehlend.length > 0) {
    return {
      status: "offen",
      meldung: `Für ${fehlend.map((m) => MONATE[m - 1]).join(", ")} fehlt eine festgeschriebene Abrechnung. Monate ohne Arbeitslohn (Großbuchstabe U) bescheinigt Haben nicht.`,
    };
  }
  const summe = (f: (a: LstbAbrechnung) => Cents) => abrechnungen.reduce((s, a) => s + f(a), 0);
  const merkmale: LstbMerkmale[] = [];
  for (const a of abrechnungen) {
    const m = merkmaleVon(a.stammdaten);
    const vorher = merkmale.at(-1);
    if (!vorher || !gleicheMerkmale(vorher, m)) merkmale.push({ gueltigAb: a.monat === ersterMonat ? von : `${jahr}-${pad(a.monat)}-01`, ...m });
  }
  const pkv = abrechnungen.map((a) => (a.stammdaten.kv.art === "privat" ? a.stammdaten.kv.basisbeitrag : 0));
  const letzte = abrechnungen.at(-1)!;
  return {
    status: "bereit",
    werte: {
      jahr,
      von,
      bis,
      bruttoarbeitslohn: summe((a) => a.steuerBrutto),
      lohnsteuer: summe((a) => a.lohnsteuer),
      soli: summe((a) => a.soli),
      kirchensteuer: summe((a) => a.kirchensteuer),
      rvArbeitgeber: summe((a) => a.sv.rv.ag),
      rvArbeitnehmer: summe((a) => a.sv.rv.an),
      kvArbeitnehmer: summe((a) => a.sv.kv.an + a.sv.kvZusatz.an),
      pvArbeitnehmer: summe((a) => a.sv.pv.an),
      avArbeitnehmer: summe((a) => a.sv.av.an),
      pkvBasis: pkv.some((b) => b > 0)
        ? { letzterMonat: letzte.stammdaten.kv.art === "privat" ? letzte.stammdaten.kv.basisbeitrag : 0, jahr: pkv.reduce((s, b) => s + b, 0) }
        : null,
      merkmale,
    },
  };
}

/** JSON mit sortierten Schlüsseln: Postgres speichert jsonb in eigener Reihenfolge */
function kanonisch(wert: unknown): string {
  if (Array.isArray(wert)) return `[${wert.map(kanonisch).join(",")}]`;
  if (wert && typeof wert === "object") {
    return `{${Object.keys(wert)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${kanonisch((wert as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(wert);
}

/** Stimmen zwei Bescheinigungen überein (auch aus der Datenbank gelesen)? Dann gibt es nichts zu korrigieren. */
export function lstbWerteGleich(a: LstbWerte, b: LstbWerte): boolean {
  return kanonisch(a) === kanonisch(b);
}

/**
 * Frist der Übermittlung: letzter Tag im Februar des Folgejahres (§ 93c Abs. 1 Nr. 1 AO), verschoben auf den nächsten
 * Werktag (§ 108 Abs. 3 AO). Nach einem Austritt darf früher übermittelt werden, die Frist bleibt dieselbe.
 */
export function lstbFrist(jahr: number, bundesland: Bundesland | null): string {
  return naechsterWerktag(letzterTag(jahr + 1, 2), bundesland);
}

/**
 * Bundesweit eindeutige Kennung einer Mitteilung (KmId, höchstens 100 Zeichen aus Buchstaben, Satzzeichen und Ziffern,
 * allg_KmId_ab2020SType): aufgebaut wie in den Beispielen zur Schnittstelle („2025-LST-<IdNr>-<TTMMTTMM>-<StNr>-<OM>-NEU“),
 * dazu eine laufende Nummer je Arbeitgeber und Arbeitnehmer, damit auch nach einem Storno jede Mitteilung eine neue hat.
 */
export function lstbKmId(k: {
  jahr: number;
  idnr: string;
  von: string;
  bis: string;
  steuernummer13: string;
  ordnungsmerkmal: string;
  art: "Neu" | "Korrektur" | "Storno";
  nummer: number;
}): string {
  const ttmm = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}`;
  const art = { Neu: "NEU", Korrektur: "KOR", Storno: "STO" }[k.art];
  return `${k.jahr}-LST-${k.idnr}-${ttmm(k.von)}${ttmm(k.bis)}-${k.steuernummer13}-${k.ordnungsmerkmal}-${art}-${String(k.nummer).padStart(3, "0")}`;
}
