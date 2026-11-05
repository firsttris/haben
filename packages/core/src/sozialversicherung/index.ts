import { fehlendeJahre } from "../jahressperre.ts";
import { formatEuro } from "../money.ts";
import { imUebergangsbereich, regulaer, uebergang } from "./beschaeftigt.ts";
import { minijob } from "./minijob.ts";
import { KEINE, mitSummen, type NichtUnterstuetzteMerkmale, type SvBeitraege, type SvEingabe, type SvErgebnis } from "./typen.ts";
import { SV_2026, type SvJahr, type SvJahreswerte } from "./werte.ts";

export type {
  Anteile as SvAnteile,
  Beschaeftigt as SvBeschaeftigt,
  GesellschafterGeschaeftsfuehrer as SvGesellschafterGeschaeftsfuehrer,
  Krankenversicherung as SvKrankenversicherung,
  Minijob as SvMinijob,
  Pflegemerkmale as SvPflegemerkmale,
  SvBeitraege,
  SvEingabe,
  SvErgebnis,
  UmlageSaetze as SvUmlageSaetze,
} from "./typen.ts";
export type { SvJahreswerte } from "./werte.ts";

/**
 * Beiträge zur Sozialversicherung für einen Monat, mit Jahressperre wie bei der Lohnsteuer: Für ein Jahr ohne
 * hinterlegte Rechengrößen und Sätze rechnet Haben nicht, auch nicht mit denen des Vorjahres. Falsche Beiträge
 * schuldet der Arbeitgeber nach (§ 28e SGB IV).
 */
const SV_JAHRE: Readonly<Record<number, SvJahr>> = { 2026: SV_2026 };

/** Jahre mit hinterlegten Werten */
export const SOZIALVERSICHERUNG_JAHRE: readonly number[] = Object.keys(SV_JAHRE).map(Number);

/** Werte und Quellen eines Jahres, oder null, wenn es nicht hinterlegt ist */
export const sozialversicherungJahr = (jahr: number): SvJahr | null => SV_JAHRE[jahr] ?? null;

type Fehler = Extract<SvErgebnis, { ok: false }>;
const fehler = (grund: Fehler["grund"], meldung: string): Fehler => ({ ok: false, grund, meldung });

const ganzNichtNegativ = (n: number) => Number.isSafeInteger(n) && n >= 0;

/** Wertebereich der Eingaben; gibt die erste Beanstandung zurück */
function pruefe(e: SvEingabe): string | null {
  const pruefungen: [boolean, string][] = [
    [ganzNichtNegativ(e.entgelt), "Das Entgelt muss ein ganzer, nicht negativer Betrag in Cent sein"],
    [e.einmalzahlung === undefined || ganzNichtNegativ(e.einmalzahlung), "Die Einmalzahlung muss ein ganzer, nicht negativer Betrag in Cent sein"],
    [e.svTage === undefined || (Number.isInteger(e.svTage) && e.svTage >= 1 && e.svTage <= 30), "Die SV-Tage müssen eine ganze Zahl von 1 bis 30 sein"],
    [
      e.personengruppe !== "beschaeftigt" || e.regelmaessigesEntgelt === undefined || ganzNichtNegativ(e.regelmaessigesEntgelt),
      "Das regelmäßige Entgelt muss ein ganzer, nicht negativer Betrag in Cent sein",
    ],
  ];
  if (e.personengruppe === "beschaeftigt") {
    const { kv, pflege, umlagen } = e;
    pruefungen.push(
      [kv.art === "privat" || ganzNichtNegativ(kv.zusatzbeitrag), "Der Zusatzbeitrag muss ein ganzer, nicht negativer Satz in Basispunkten sein"],
      [
        (umlagen.u1 === null || ganzNichtNegativ(umlagen.u1)) && ganzNichtNegativ(umlagen.u2),
        "Die Umlagesätze müssen ganze, nicht negative Sätze in Basispunkten sein",
      ],
      [ganzNichtNegativ(pflege.kinderUnter25), "Die Zahl der Kinder unter 25 muss eine ganze, nicht negative Zahl sein"],
      [!(pflege.kinderlosenzuschlag && pflege.kinderUnter25 > 0), "Mit Kindern fällt kein Zuschlag für Kinderlose an"],
    );
  }
  return pruefungen.find(([gilt]) => !gilt)?.[1] ?? null;
}

const NICHT_UNTERSTUETZT: Record<keyof NichtUnterstuetzteMerkmale, string> = {
  mehrfachbeschaeftigung: "Mehrfachbeschäftigung",
  kurzfristig: "kurzfristige Beschäftigung",
  auszubildend: "Auszubildende",
  privathaushalt: "Minijob im Privathaushalt",
  einmalzahlung: "Einmalzahlung",
  svTage: "Teilmonat",
};

/** Gesetzte Merkmale, die Haben nicht rechnet; 0, false und 30 SV-Tage zählen nicht */
function nichtUnterstuetzt(e: SvEingabe): string[] {
  const gesetzt = (Object.keys(NICHT_UNTERSTUETZT) as (keyof NichtUnterstuetzteMerkmale)[]).filter((name) => {
    const wert = e[name];
    if (name === "svTage") return wert !== undefined && wert !== 30;
    return wert !== undefined && wert !== false && wert !== 0;
  });
  return gesetzt.map((name) => NICHT_UNTERSTUETZT[name]);
}

/**
 * Sachsen im Übergangsbereich: § 2 Abs. 2 BVV nennt für den Anteil des Beschäftigten nur den halben Satz nach
 * § 55 Abs. 1 SGB XI, § 58 Abs. 5 SGB XI für den Arbeitgeber einen um einen Punkt verminderten Satz; wie beides
 * zusammen gerundet und aufgeteilt wird, belegt Haben noch mit keinem Rechenbeispiel.
 */
function nichtUnterstuetztImUebergang(e: SvEingabe, w: SvJahreswerte): string[] {
  // Ein Monat bis zur Geringfügigkeitsgrenze in einer versicherungspflichtigen Beschäftigung ist kein Minijob; er wird nach
  // § 2 Abs. 2 Satz 2 und 5 BVV mit F × Entgelt bemessen und braucht das regelmäßige Entgelt aus der Lohnabrechnung
  if (e.personengruppe === "beschaeftigt" && e.entgelt > 0 && e.entgelt <= w.geringfuegigkeitsgrenze) {
    return [`einem Monatsentgelt bis ${formatEuro(w.geringfuegigkeitsgrenze)} in versicherungspflichtiger Beschäftigung`];
  }
  // Ein Monat in einem anderen Bereich als das regelmäßige Entgelt (etwa über 2.000 € in einem Midijob oder darunter in
  // einer Beschäftigung über 2.000 €): Ob der Übergangsbereich gilt, entscheidet das regelmäßige Entgelt (§ 20 Abs. 2
  // SGB IV), nicht der Monat. Dafür hat Haben noch keine belegten Beispielrechnungen, also nicht rechnen
  if (e.personengruppe === "beschaeftigt" && e.regelmaessigesEntgelt !== undefined && bereich(e.regelmaessigesEntgelt, w) !== bereich(e.entgelt, w)) {
    return [`einem Monatsentgelt außerhalb des Bereichs des regelmäßigen Entgelts von ${formatEuro(e.regelmaessigesEntgelt)}`];
  }
  if (e.personengruppe !== "beschaeftigt" || !imUebergangsbereich(e.entgelt, w) || e.kv.art === "privat") return [];
  return e.sachsen ? ["Pflegeversicherung in Sachsen im Übergangsbereich"] : [];
}

/** Bereich eines Monatsentgelts: bis zur Geringfügigkeitsgrenze, im Übergangsbereich oder darüber */
function bereich(entgelt: number, w: SvJahreswerte): "geringfuegig" | "uebergang" | "darueber" {
  if (entgelt <= w.geringfuegigkeitsgrenze) return "geringfuegig";
  return imUebergangsbereich(entgelt, w) ? "uebergang" : "darueber";
}

/** Entgelt passt nicht zur Personengruppe */
function grenzeVerletzt(e: SvEingabe, w: SvJahreswerte): string | null {
  const grenze = formatEuro(w.geringfuegigkeitsgrenze);
  if (e.personengruppe === "minijob" && e.entgelt > w.geringfuegigkeitsgrenze) return `Ein Minijob endet bei ${grenze} im Monat`;
  return null;
}

/** Gesellschafter-Geschäftsführer ohne SV-Pflicht: keine Beiträge, keine Umlagen (siehe `GesellschafterGeschaeftsfuehrer`) */
const ohneSv = (): SvBeitraege =>
  mitSummen({
    personengruppe: "ggf",
    bemessung: { kvPv: 0, rvAv: 0, arbeitnehmer: null },
    kv: KEINE,
    kvZusatz: KEINE,
    pv: KEINE,
    rv: KEINE,
    av: KEINE,
    umlagen: { u1: 0, u2: 0, insolvenzgeld: 0 },
    pauschsteuer: 0,
  });

function rechne(e: SvEingabe, w: SvJahreswerte): SvBeitraege {
  if (e.personengruppe === "ggf") return ohneSv();
  if (e.personengruppe === "minijob") return minijob(e, w);
  return imUebergangsbereich(e.entgelt, w) ? uebergang(e, w) : regulaer(e, w);
}

/**
 * Arbeitnehmer- und Arbeitgeberanteile zur Sozialversicherung, Umlagen und Minijob-Pauschsteuer für einen
 * Lohnzahlungszeitraum (Monat) des Jahres. Fehler kommen als Wert zurück: ein Jahr ohne Werte, ein Fall, den
 * Haben nicht rechnet, oder eine Eingabe außerhalb des Wertebereichs.
 */
export function sozialversicherung(jahr: number, eingabe: SvEingabe): SvErgebnis {
  const sv = SV_JAHRE[jahr];
  if (!sv) return fehler("nicht-hinterlegt", `Die Sozialversicherungswerte ${jahr} sind noch nicht hinterlegt.`);
  const ungueltig = pruefe(eingabe) ?? grenzeVerletzt(eingabe, sv.werte);
  if (ungueltig) return fehler("ungueltig", `${ungueltig}.`);
  const offen = [...nichtUnterstuetzt(eingabe), ...nichtUnterstuetztImUebergang(eingabe, sv.werte)];
  if (offen.length > 0) return fehler("nicht-unterstuetzt", `Sozialversicherung mit ${offen.join(", ")} ist nicht unterstützt.`);
  return { ok: true, ...rechne(eingabe, sv.werte) };
}

/** Jahre, deren Werte am Tag `heute` fehlen: das laufende Jahr und ab Dezember auch das folgende */
export function fehlendeSozialversicherungJahre(heute: Date): number[] {
  return fehlendeJahre(heute, SOZIALVERSICHERUNG_JAHRE);
}
