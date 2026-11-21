import { FORM43_KOSTEN, type Form43Summe, type Form43Werte, type Form43Zeile } from "./bwa.ts";
import { FORM01_KOSTEN, type Form01Summe, type Form01Werte, type Form01Zeile } from "./bwa-form01.ts";
import { roundHalfAwayFromZero, type BasisPoints, type Cents } from "./money.ts";

/*
 * Anteile und Kennzahlen der BWA (#1635) nach der DATEV-Musterauswertung BWA (2016), für Seite, Export und das MCP-Werkzeug
 * (#1517) an einer Stelle. DATEV zeigt mehrere Prozentspalten, Haben je Zeile eine (abgestimmt in #1380): Form 01 (S. 3)
 * Leistung und Material in % der Gesamtleistung, Kostenarten in % der Gesamtkosten; Form 43 (S. 32) Erlöse in % der Summe der
 * Erlöse, Kosten in % der Summe der Kosten. Neutrales, Steuern und Ergebnisse bekommen keinen Anteil, auch wo DATEV sie in
 * % der Gesamtleistung zeigt. Ist die Bezugsgröße 0 oder negativ, gibt es keinen Anteil: Ein Prozentsatz davon sagt nichts.
 */

export type BwaForm = "form43" | "form01";

type BwaWerte = Form43Werte | Form01Werte;

const LEISTUNG_01: readonly Form01Zeile[] = ["umsatzerloese", "bestandsveraenderungen", "eigenleistungen", "material", "sonstigeErloese"];

/** Bezugsgröße je Zeile; was fehlt, hat keinen Anteil */
const BASIS: { form01: Partial<Record<Form01Zeile | Form01Summe, Form01Summe>>; form43: Partial<Record<Form43Zeile | Form43Summe, Form43Summe>> } = {
  form01: {
    ...Object.fromEntries(LEISTUNG_01.map((z) => [z, "gesamtleistung"])),
    // „Betrieblicher Rohertrag“ steht in der Musterauswertung wie der Rohertrag in % der Gesamtleistung
    gesamtleistung: "gesamtleistung",
    rohertrag: "gesamtleistung",
    betrieblicherRohertrag: "gesamtleistung",
    ...Object.fromEntries(FORM01_KOSTEN.map((z) => [z, "gesamtkosten"])),
    gesamtkosten: "gesamtkosten",
  },
  form43: {
    erloese: "summeErloese",
    sonstigeErloese: "summeErloese",
    summeErloese: "summeErloese",
    ...Object.fromEntries([...FORM43_KOSTEN].map((z) => [z, "summeKosten"])),
    summeKosten: "summeKosten",
  },
};

/** Zähler in Basispunkten des Nenners, kaufmännisch gerundet wie `abweichung`; ohne Wert bei einem Nenner bis 0 */
const quote = (zaehler: Cents, nenner: Cents): BasisPoints | null => (nenner > 0 ? roundHalfAwayFromZero((zaehler * 10_000) / nenner) : null);

/** Die Zeile, auf die sich der Anteil einer Zeile bezieht; null ohne Anteil */
export function anteilBasis(form: BwaForm, key: string): string | null {
  return (BASIS[form] as Partial<Record<string, string>>)[key] ?? null;
}

/** Anteil einer Zeile an ihrer Bezugsgröße in Basispunkten (10000 = 100 %) */
export function anteil(form: BwaForm, werte: BwaWerte, key: string): BasisPoints | null {
  const basis = anteilBasis(form, key);
  const w = werte as Readonly<Record<string, Cents>>;
  return basis === null ? null : quote(w[key] ?? 0, w[basis] ?? 0);
}

export type BwaKennzahlKey = "rohertragsquote" | "personalkostenquote" | "kostenquote" | "umsatzrendite" | "aufschlag";

export interface BwaKennzahl {
  key: BwaKennzahlKey;
  label: string;
  /** Eine Zeile: was durch was geteilt ist */
  erklaerung: string;
  /** Basispunkte; null, wenn die Bezugsgröße 0 oder negativ ist */
  wert: BasisPoints | null;
}

const LABEL: Record<BwaKennzahlKey, string> = {
  rohertragsquote: "Rohertragsquote",
  personalkostenquote: "Personalkostenquote",
  kostenquote: "Kostenquote",
  umsatzrendite: "Umsatzrendite",
  aufschlag: "Aufschlag",
};

const kennzahl = (key: BwaKennzahlKey, erklaerung: string, wert: BasisPoints | null): BwaKennzahl => ({ key, label: LABEL[key], erklaerung, wert });

/**
 * Kennzahlen über der Tabelle. Form 01 wie die Musterauswertung S. 3 in % der Gesamtleistung, dazu der Aufschlag (Rohertrag
 * in % des Materials, Spalte „Aufschlag“) nur, wenn Material gebucht ist. Form 43 in % der Summe der Erlöse wie S. 32; die
 * Umsatzrendite netto ohne Umsatz- und Vorsteuer, die im Monat mit den Zahlungen an das Finanzamt schwanken (DATEV rechnet
 * das Ergebnis brutto in % der Betriebseinnahmen).
 */
export function kennzahlen(form: BwaForm, werte: BwaWerte): BwaKennzahl[] {
  if (form === "form01") {
    const w = werte as Form01Werte;
    const g = w.gesamtleistung;
    return [
      kennzahl("rohertragsquote", "Rohertrag in % der Gesamtleistung", quote(w.rohertrag, g)),
      kennzahl("personalkostenquote", "Personalkosten in % der Gesamtleistung", quote(w.personal, g)),
      kennzahl("kostenquote", "Gesamtkosten in % der Gesamtleistung", quote(w.gesamtkosten, g)),
      kennzahl("umsatzrendite", "Vorläufiges Ergebnis in % der Gesamtleistung", quote(w.vorlaeufigesErgebnis, g)),
      ...(w.material !== 0 ? [kennzahl("aufschlag", "Rohertrag in % des Material- und Wareneinkaufs", quote(w.rohertrag, w.material))] : []),
    ];
  }
  const w = werte as Form43Werte;
  const e = w.summeErloese;
  return [
    kennzahl("rohertragsquote", "Erlöse ohne Material und Fremdleistungen, in % der Erlöse", quote(e - w.material - w.fremdleistungen, e)),
    kennzahl("personalkostenquote", "Personalkosten in % der Erlöse", quote(w.personal, e)),
    kennzahl("kostenquote", "Summe der Kosten in % der Erlöse", quote(w.summeKosten, e)),
    kennzahl(
      "umsatzrendite",
      "Erlöse minus Kosten, Buchwert der Abgänge und Zinsen, ohne Umsatzsteuer, in % der Erlöse",
      quote(e - w.summeKosten - w.buchwertAnlagenabgang - w.sonstigeAufwendungen, e),
    ),
  ];
}
