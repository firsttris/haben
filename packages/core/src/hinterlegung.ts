import { VERMERK, type BilanzVermerk } from "./bilanzvermerke.ts";
import { BILANZ_POSTEN, type Abschluss, type BilanzPosten } from "./hgb.ts";
import type { Cents } from "./money.ts";

/*
 * Bilanz einer Kleinstkapitalgesellschaft zur Hinterlegung beim Unternehmensregister (§ 326 Abs. 2 HGB): Statt den
 * Jahresabschluss offenzulegen, reicht sie nur die Bilanz zur dauerhaften Hinterlegung ein, spätestens ein Jahr nach dem
 * Abschlussstichtag (§ 325 Abs. 1a HGB). Hier stehen nur Daten; das PDF setzt @haben/einvoice daraus.
 *
 * Was auf das Blatt gehört:
 * - Firma, Sitz, Registergericht und Registernummer (§ 264 Abs. 1a HGB),
 * - die verkürzte Bilanz (§ 266 Abs. 1 Satz 4 HGB) mit den Beträgen des Vorjahres (§ 265 Abs. 2 HGB); Posten ohne Betrag
 *   in beiden Jahren entfallen (§ 265 Abs. 8 HGB),
 * - ein durch Verluste aufgebrauchtes Eigenkapital als „Nicht durch Eigenkapital gedeckter Fehlbetrag“ am Schluss der
 *   Aktivseite (§ 268 Abs. 3 HGB),
 * - ohne Anhang die Angaben unter der Bilanz (§ 264 Abs. 1 Satz 5 HGB): Haftungsverhältnisse (§ 268 Abs. 7, § 251 HGB)
 *   und Vorschüsse und Kredite an Mitglieder der Geschäftsführung (§ 285 Nr. 9 Buchst. c HGB). Die dritte Angabe dort,
 *   eigene Aktien nach § 160 Abs. 3 Satz 2 AktG, gilt nur für die Aktiengesellschaft, nicht für GmbH und UG,
 * - unter den Posten die Vermerke zu Restlaufzeiten (§ 268 Abs. 4 Satz 1, Abs. 5 Satz 1 HGB) und gegenüber
 *   Gesellschaftern (§ 42 Abs. 3 GmbHG), mit Vorjahr; gerechnet in bilanzvermerke.ts,
 * - das Datum der Feststellung (§ 328 Abs. 1a Satz 1 HGB, für die Hinterlegung nach § 328 Abs. 5 entsprechend); vor der
 *   Feststellung durch die Gesellschafter wird nicht hinterlegt.
 *
 * Das Eigenkapital steht als ein Posten, ohne gezeichnetes Kapital: § 42 Abs. 1 GmbHG schreibt vor, das Stammkapital als
 * gezeichnetes Kapital auszuweisen, „allerdings bestehen größenabhängige Erleichterungen für die Gliederungstiefe. So
 * reicht bei Kleinst-GmbHs der Ausweis des zusammengefassten Eigenkapitals aus“ (Müller/Reinke, Haufe, „Gesellschaft mit
 * beschränkter Haftung: Rechnungslegung“, 7.3.1 Eigenkapital, Rz. 68).
 *
 * Quellen: Gesetzestexte unter https://www.gesetze-im-internet.de/hgb/ (§§ 264, 265, 266, 267a, 268, 274a, 285, 325,
 * 326, 328) und https://www.gesetze-im-internet.de/gmbhg/__42.html, abgerufen am 04.11.2026; zum Einreichen die
 * Allgemeinen Nutzungsbedingungen für das Unternehmensregister (https://www.publikations-plattform.de/order/D088.pdf), die
 * für Geschäftsjahre ab 2022 gelten.
 */

export interface HinterlegungFirma {
  name: string;
  /** Sitz laut Gesellschaftsvertrag */
  sitz: string;
  /** z. B. „Amtsgericht Bremen“ */
  registergericht: string;
  /** z. B. „HRB 12345 HB“ */
  registernummer: string;
}

export interface HinterlegungAngaben {
  /** Haftungsverhältnisse nach § 268 Abs. 7, § 251 HGB; leer = keine */
  haftungsverhaeltnisse: string;
  /** Vorschüsse und Kredite an Geschäftsführer nach § 285 Nr. 9 Buchst. c HGB; leer = keine */
  organkredite: string;
  /** Tag der Feststellung durch die Gesellschafter (§ 46 Nr. 1 GmbHG), JJJJ-MM-TT */
  festgestelltAm: string;
}

export interface HinterlegungZeile {
  label: string;
  betrag: Cents;
  /** null = keine Vorjahresspalte (erstes Geschäftsjahr) */
  vorjahr: Cents | null;
  /** Davon-Vermerk unter dem Posten davor */
  vermerk?: true;
}

export interface HinterlegungAngabe {
  titel: string;
  text: string;
}

export interface HinterlegungBilanz {
  firma: HinterlegungFirma;
  /** Abschlussstichtag, JJJJ-MM-TT */
  stichtag: string;
  /** Stichtag des Vorjahres; null = keine Vorjahresspalte */
  vorjahresstichtag: string | null;
  aktiva: HinterlegungZeile[];
  passiva: HinterlegungZeile[];
  summeAktiva: HinterlegungZeile;
  summePassiva: HinterlegungZeile;
  /** Angaben unter der Bilanz anstelle des Anhangs */
  angaben: HinterlegungAngabe[];
  /** Tag der Feststellung, JJJJ-MM-TT */
  feststellung: string;
}

const AKTIVA: readonly BilanzPosten[] = ["aktiva.A", "aktiva.B", "aktiva.C", "aktiva.D", "aktiva.E"];
const PASSIVA: readonly BilanzPosten[] = ["passiva.A", "passiva.B", "passiva.C", "passiva.D", "passiva.E"];
export const FEHLBETRAG_LABEL = "Nicht durch Eigenkapital gedeckter Fehlbetrag";

/** Letzter Tag der Hinterlegung: ein Jahr nach dem Stichtag 31.12. (§ 325 Abs. 1a Satz 1 HGB) */
export function hinterlegungFrist(year: number): string {
  return `${year + 1}-12-31`;
}

/** Bilanzbeträge mit § 268 Abs. 3 HGB: negatives Eigenkapital steht als Fehlbetrag auf der Aktivseite, das Eigenkapital mit null */
function ausweis(report: Abschluss): { posten: Record<BilanzPosten, Cents>; fehlbetrag: Cents } {
  const eigenkapital = report.bilanz["passiva.A"];
  if (eigenkapital >= 0) return { posten: report.bilanz, fehlbetrag: 0 };
  return { posten: { ...report.bilanz, "passiva.A": 0 }, fehlbetrag: -eigenkapital };
}

const summe = (posten: Record<BilanzPosten, Cents>, seite: readonly BilanzPosten[]) => seite.reduce((s, p) => s + posten[p], 0);

/**
 * Was der Hinterlegung entgegensteht: fehlende Pflichtangaben nach § 264 Abs. 1a HGB und eine Bilanz, deren Seiten nicht
 * gleich sind (nicht zugeordnete Konten, unvollständige Eröffnung). Leer = die Datei lässt sich erzeugen.
 */
export function hinterlegungMaengel(firma: HinterlegungFirma, report: Abschluss, vorjahr: Abschluss | null): string[] {
  const maengel: string[] = [];
  if (!firma.name.trim()) maengel.push("Der Name der Gesellschaft fehlt in den Firmendaten.");
  if (!firma.sitz.trim()) maengel.push("Der Sitz der Gesellschaft fehlt in den Firmendaten.");
  if (!firma.registergericht.trim()) maengel.push("Das Registergericht fehlt in den Firmendaten.");
  if (!firma.registernummer.trim()) maengel.push("Die Handelsregisternummer fehlt in den Firmendaten.");
  if (report.aktiva !== report.passiva) maengel.push("Aktiva und Passiva sind nicht gleich; erst die offenen Punkte des Abschlusses klären.");
  if (vorjahr && vorjahr.aktiva !== vorjahr.passiva) maengel.push("Aktiva und Passiva des Vorjahres sind nicht gleich; die Eröffnung ist unvollständig.");
  return maengel;
}

export interface HinterlegungVermerke {
  jahr: readonly BilanzVermerk[];
  /** null = keine Vorjahresspalte */
  vorjahr: readonly BilanzVermerk[] | null;
}

const VERMERK_FOLGE: readonly string[] = Object.values(VERMERK);

/** Vermerke unter einem Posten: jeder, den eines der beiden Jahre hat, in fester Reihenfolge */
function vermerkZeilen(posten: BilanzPosten, vermerke: HinterlegungVermerke): HinterlegungZeile[] {
  const betrag = (liste: readonly BilanzVermerk[], label: string) => liste.find((v) => v.posten === posten && v.label === label)?.betrag ?? 0;
  const labels = new Set([...vermerke.jahr, ...(vermerke.vorjahr ?? [])].filter((v) => v.posten === posten).map((v) => v.label));
  return VERMERK_FOLGE.filter((label) => labels.has(label)).map((label) => ({
    label,
    betrag: betrag(vermerke.jahr, label),
    vorjahr: vermerke.vorjahr ? betrag(vermerke.vorjahr, label) : null,
    vermerk: true,
  }));
}

/** Zeilen einer Seite: Posten mit Betrag in einem der beiden Jahre; das Eigenkapital immer (§ 265 Abs. 8 HGB), je mit Vermerken */
function zeilen(
  seite: readonly BilanzPosten[],
  jahr: Record<BilanzPosten, Cents>,
  vorjahr: Record<BilanzPosten, Cents> | null,
  vermerke: HinterlegungVermerke,
): HinterlegungZeile[] {
  return seite
    .filter((p) => p === "passiva.A" || jahr[p] !== 0 || (vorjahr?.[p] ?? 0) !== 0)
    .flatMap((p) => [{ label: BILANZ_POSTEN[p], betrag: jahr[p], vorjahr: vorjahr ? vorjahr[p] : null }, ...vermerkZeilen(p, vermerke)]);
}

const keine = (text: string) => (text.trim() ? text.trim() : "Keine.");

/** Fehler im Tag der Feststellung: nach dem Stichtag und nicht in der Zukunft; null = in Ordnung */
export function feststellungFehler(year: number, festgestelltAm: string, today: string): string | null {
  if (festgestelltAm <= `${year}-12-31`) return "Festgestellt wird der Abschluss nach dem Bilanzstichtag.";
  if (festgestelltAm > today) return "Der Tag der Feststellung liegt in der Zukunft; hinterlegt wird erst nach der Feststellung.";
  return null;
}

/**
 * Die Bilanz zur Hinterlegung aus dem Abschluss des Jahres und dem des Vorjahres (null im ersten Geschäftsjahr). Die
 * Angaben unter der Bilanz kommen von der Nutzerin; ohne Eingabe steht dort „Keine.“, Haben erfindet nichts.
 */
export function hinterlegungBilanz(input: {
  year: number;
  firma: HinterlegungFirma;
  report: Abschluss;
  vorjahr: Abschluss | null;
  angaben: HinterlegungAngaben;
  /** Vermerke beider Jahre; ohne keine */
  vermerke?: HinterlegungVermerke;
}): HinterlegungBilanz {
  const { year, firma, angaben } = input;
  const vermerke = input.vermerke ?? { jahr: [], vorjahr: input.vorjahr ? [] : null };
  const jahr = ausweis(input.report);
  const vorjahr = input.vorjahr ? ausweis(input.vorjahr) : null;
  const aktiva = zeilen(AKTIVA, jahr.posten, vorjahr?.posten ?? null, vermerke);
  if (jahr.fehlbetrag !== 0 || (vorjahr?.fehlbetrag ?? 0) !== 0) {
    aktiva.push({ label: FEHLBETRAG_LABEL, betrag: jahr.fehlbetrag, vorjahr: vorjahr ? vorjahr.fehlbetrag : null });
  }
  return {
    firma: {
      name: firma.name.trim(),
      sitz: firma.sitz.trim(),
      registergericht: firma.registergericht.trim(),
      registernummer: firma.registernummer.trim(),
    },
    stichtag: `${year}-12-31`,
    vorjahresstichtag: vorjahr ? `${year - 1}-12-31` : null,
    aktiva,
    passiva: zeilen(PASSIVA, jahr.posten, vorjahr?.posten ?? null, vermerke),
    summeAktiva: {
      label: "Summe Aktiva",
      betrag: summe(jahr.posten, AKTIVA) + jahr.fehlbetrag,
      vorjahr: vorjahr ? summe(vorjahr.posten, AKTIVA) + vorjahr.fehlbetrag : null,
    },
    summePassiva: {
      label: "Summe Passiva",
      betrag: summe(jahr.posten, PASSIVA),
      vorjahr: vorjahr ? summe(vorjahr.posten, PASSIVA) : null,
    },
    angaben: [
      { titel: "Haftungsverhältnisse (§ 268 Abs. 7, § 251 HGB)", text: keine(angaben.haftungsverhaeltnisse) },
      { titel: "Vorschüsse und Kredite an Mitglieder der Geschäftsführung (§ 285 Nr. 9 Buchst. c HGB)", text: keine(angaben.organkredite) },
    ],
    feststellung: angaben.festgestelltAm,
  };
}
