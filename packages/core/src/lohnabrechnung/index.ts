import { lohnkirchensteuer, lohnsteuer, type LohnsteuerEingabe } from "../lohnsteuer/index.ts";
import type { Cents } from "../money.ts";
import { type SvEingabe, sozialversicherung } from "../sozialversicherung/index.ts";
import type { Bestandteil, LohnabrechnungEingabe, LohnabrechnungErgebnis, LohnStammdaten } from "./typen.ts";

export { BESCHAEFTIGUNGSARTEN, KONFESSIONEN } from "./typen.ts";
export type {
  Beschaeftigungsart,
  Bestandteil,
  Konfession,
  Lohnabrechnung,
  LohnabrechnungEingabe,
  LohnabrechnungErgebnis,
  LohnKrankenversicherung,
  LohnStammdaten,
} from "./typen.ts";
export { lohnkonto, lohnkontoCsv, type Lohnkonto, type LohnkontoMitarbeiter, type LohnkontoZeile } from "./lohnkonto.ts";

/*
 * Lohnabrechnung eines Monats aus den Stammdaten eines Mitarbeiters. Gerechnet wird nur mit den Rechenkernen
 * `lohnsteuer` (PAP des BMF), `lohnkirchensteuer` und `sozialversicherung`; hier entstehen nur deren Eingaben aus den
 * Stammdaten und die Summen der Abrechnung nach § 1 Abs. 2 der Entgeltbescheinigungsverordnung (EBV,
 * https://www.gesetze-im-internet.de/entgbv/__1.html). Was Haben nicht sicher kann, kommt als Fehlerwert zurück
 * und wird nicht gerechnet (docs/lohn-plan.md, „Vorgehen“).
 */

type Fehler = Extract<LohnabrechnungErgebnis, { ok: false }>;
const fehler = (grund: Fehler["grund"], meldung: string): Fehler => ({ ok: false, grund, meldung });

const ganzNichtNegativ = (n: number) => Number.isSafeInteger(n) && n >= 0;
const zwei = (n: number) => String(n).padStart(2, "0");

/** Erster und letzter Tag des Monats, JJJJ-MM-TT */
export function monatsgrenzen(jahr: number, monat: number): { erster: string; letzter: string } {
  const tage = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
  return { erster: `${jahr}-${zwei(monat)}-01`, letzter: `${jahr}-${zwei(monat)}-${zwei(tage)}` };
}

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** „Oktober 2026“ */
export const monatsname = (jahr: number, monat: number): string => `${MONATE[monat - 1]} ${jahr}`;

/**
 * Nur ganze Monate: Ein Teilmonat braucht anteilige Beitragsbemessungsgrenzen (SV-Tage) und bei der Lohnsteuer
 * Kalendertage als Lohnzahlungszeitraum; beides rechnet Haben noch nicht.
 */
function pruefeZeitraum(e: LohnabrechnungEingabe): Fehler | null {
  if (!Number.isInteger(e.jahr) || !Number.isInteger(e.monat) || e.monat < 1 || e.monat > 12) return fehler("ungueltig", "Der Monat ist ungültig.");
  const { erster, letzter } = monatsgrenzen(e.jahr, e.monat);
  const { eintritt, austritt } = e.stammdaten;
  const name = monatsname(e.jahr, e.monat);
  if (eintritt > letzter || (austritt !== null && austritt < erster)) return fehler("ungueltig", `Im ${name} besteht keine Beschäftigung.`);
  if (eintritt > erster || (austritt !== null && austritt < letzter)) {
    return fehler("nicht-unterstuetzt", `Ein Teilmonat (Eintritt oder Austritt im ${name}) ist nicht unterstützt.`);
  }
  return null;
}

/** Fälle, die Haben je Beschäftigungsart nicht rechnet; gibt die erste Beanstandung zurück */
function nichtUnterstuetzt(s: LohnStammdaten): string | null {
  const pruefungen: [boolean, string][] = [
    [s.steuerklasse === 6, "Steuerklasse VI (weiteres Dienstverhältnis)"],
    [s.art === "ggf" && s.kv.art === "privat" && s.kv.arbeitgeberzuschuss > 0, "einem Zuschuss zur Krankenversicherung für Gesellschafter-Geschäftsführer"],
    [s.art === "minijob" && !s.minijob.pauschsteuer, "einem Minijob mit Lohnsteuer nach den ELStAM statt Pauschsteuer"],
    [s.art === "beschaeftigt" && s.kv.art === "privat", "privat krankenversicherten Beschäftigten (Zuschuss nach § 257 SGB V)"],
  ];
  const offen = pruefungen.find(([gilt]) => gilt)?.[1];
  return offen ? `Die Abrechnung mit ${offen} ist nicht unterstützt.` : null;
}

function pruefeBetraege(s: LohnStammdaten, entgelt: Cents): string | null {
  const pruefungen: [boolean, string][] = [
    [ganzNichtNegativ(s.monatsgehalt) && s.monatsgehalt > 0, "Das Monatsgehalt muss ein positiver Betrag in Cent sein"],
    [ganzNichtNegativ(entgelt) && entgelt > 0, "Das Entgelt des Monats muss ein positiver Betrag in Cent sein"],
    [
      s.kv.art === "gesetzlich" || (ganzNichtNegativ(s.kv.basisbeitrag) && ganzNichtNegativ(s.kv.arbeitgeberzuschuss)),
      "Die Beiträge zur privaten Versicherung müssen ganze Beträge in Cent sein",
    ],
  ];
  return pruefungen.find(([gilt]) => !gilt)?.[1] ?? null;
}

/** Zahl der Beitragsabschläge in der Pflegeversicherung für das 2. bis 5. Kind unter 25 (PVA im PAP) */
const pva = (kinderUnter25: number) => Math.min(Math.max(kinderUnter25 - 1, 0), 4) as 0 | 1 | 2 | 3 | 4;

/** Eingabe des PAP für einen Monat: ohne SV-Pflicht ohne Renten- und Arbeitslosenversicherung (KRV, ALV) */
function lohnsteuerEingabe(e: LohnabrechnungEingabe, entgelt: Cents): LohnsteuerEingabe {
  const s = e.stammdaten;
  const ohneSv = s.art === "ggf" ? 1 : 0;
  const kv =
    s.kv.art === "privat"
      ? { PKV: 1 as const, PKPV: s.kv.basisbeitrag, PKPVAGZ: s.kv.arbeitgeberzuschuss }
      : {
          PKV: 0 as const,
          KVZ: s.kv.zusatzbeitrag,
          PVS: e.bundesland === "SN" ? (1 as const) : (0 as const),
          PVZ: s.pflege.kinderlosenzuschlag ? (1 as const) : (0 as const),
          PVA: pva(s.pflege.kinderUnter25),
        };
  return {
    LZZ: 2,
    RE4: entgelt,
    STKL: s.steuerklasse,
    ZKF: s.kinderfreibetraege,
    KRV: ohneSv,
    ALV: ohneSv,
    R: s.konfession ? 1 : 0,
    ...(s.faktor !== 1000 ? { f: s.faktor } : {}),
    ...kv,
  };
}

function svEingabe(e: LohnabrechnungEingabe, entgelt: Cents): SvEingabe {
  const s = e.stammdaten;
  if (s.art === "ggf") return { personengruppe: "ggf", entgelt };
  if (s.art === "minijob") {
    return {
      personengruppe: "minijob",
      entgelt,
      gesetzlichKrankenversichert: s.kv.art === "gesetzlich",
      rvBefreit: s.minijob.rvBefreit,
      pauschsteuer: s.minijob.pauschsteuer,
      u1: s.umlagen.u1 !== null,
    };
  }
  return {
    personengruppe: "beschaeftigt",
    entgelt,
    regelmaessigesEntgelt: s.monatsgehalt,
    kv: s.kv.art === "gesetzlich" ? { art: "gesetzlich", zusatzbeitrag: s.kv.zusatzbeitrag } : { art: "privat" },
    pflege: s.pflege,
    sachsen: e.bundesland === "SN",
    umlagen: s.umlagen,
  };
}

const BEZEICHNUNG = { ggf: "Geschäftsführergehalt", minijob: "Lohn Minijob", beschaeftigt: "Gehalt" } as const;

function bestandteil(s: LohnStammdaten, entgelt: Cents): Bestandteil {
  const pauschal = s.art === "minijob";
  return {
    bezeichnung: BEZEICHNUNG[s.art],
    betrag: entgelt,
    laufend: true,
    steuerpflichtig: !pauschal,
    pauschalBesteuert: pauschal,
    svPflichtig: s.art !== "ggf",
    gesamtbrutto: true,
  };
}

/** Steuern auf den Arbeitslohn; im Minijob mit Pauschsteuer keine (die trägt der Arbeitgeber, `sv.pauschsteuer`) */
function steuern(e: LohnabrechnungEingabe, entgelt: Cents): Fehler | { lohnsteuer: Cents; soli: Cents; kirchensteuer: Cents } {
  if (e.stammdaten.art === "minijob") return { lohnsteuer: 0, soli: 0, kirchensteuer: 0 };
  const lst = lohnsteuer(e.jahr, lohnsteuerEingabe(e, entgelt));
  if (!lst.ok) return lst;
  const kirchensteuer = e.stammdaten.konfession ? lohnkirchensteuer(lst.BK, e.bundesland) : 0;
  return { lohnsteuer: lst.LSTLZZ, soli: lst.SOLZLZZ, kirchensteuer };
}

const STUFE = { ggf: "A", minijob: "B", beschaeftigt: "C" } as const;

/**
 * Abrechnung eines ganzen Monats mit laufendem Entgelt. Sonstige Bezüge, Sachbezüge, Dienstwagen, Teilmonate und die
 * übrigen Fälle aus `nichtUnterstuetzt` gibt es nicht; die Rechenkerne lehnen ihre eigenen Fälle selbst ab.
 */
export function lohnabrechnung(e: LohnabrechnungEingabe): LohnabrechnungErgebnis {
  const s = e.stammdaten;
  const entgelt = e.entgelt ?? s.monatsgehalt;
  const zeitraum = pruefeZeitraum(e);
  if (zeitraum) return zeitraum;
  const ungueltig = pruefeBetraege(s, entgelt);
  if (ungueltig) return fehler("ungueltig", `${ungueltig}.`);
  const offen = nichtUnterstuetzt(s);
  if (offen) return fehler("nicht-unterstuetzt", offen);
  const sv = sozialversicherung(e.jahr, svEingabe(e, entgelt));
  if (!sv.ok) return sv;
  const st = steuern(e, entgelt);
  if ("ok" in st) return st;
  const { ok: _, ...beitraege } = sv;
  const pauschal = s.art === "minijob";
  const netto = entgelt - st.lohnsteuer - st.soli - st.kirchensteuer - beitraege.arbeitnehmer;
  const zuschuss = s.kv.art === "privat" ? s.kv.arbeitgeberzuschuss : 0;
  return {
    ok: true,
    stufe: STUFE[s.art],
    gegenpruefen: s.art === "beschaeftigt",
    bestandteile: [bestandteil(s, entgelt)],
    brutto: entgelt,
    steuerBrutto: pauschal ? 0 : entgelt,
    svBrutto: s.art === "ggf" ? 0 : entgelt,
    pauschalBrutto: pauschal ? entgelt : 0,
    ...st,
    sv: beitraege,
    netto,
    auszahlung: netto + zuschuss,
    steuertage: 30,
    svTage: s.art === "ggf" ? 0 : 30,
    hinweise:
      s.art === "beschaeftigt"
        ? ["Entwurf, gegenprüfen: Abrechnungen mit Sozialversicherung sind noch nicht gegen ein Lohnprogramm oder die Steuerberatung gegengerechnet."]
        : [],
  };
}
