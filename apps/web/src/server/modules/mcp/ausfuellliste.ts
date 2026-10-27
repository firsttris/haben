import { csvDecimal, type UstvaFigures } from "@haben/core";

/*
 * Ausfüllliste für die Umsatzsteuer-Voranmeldung in Mein ELSTER (#124): die Kennzahlen in der Reihenfolge des
 * Formulars, mit Bezeichnung und dem Wert so, wie man ihn eintippt. Maßgeblich ist die Kennzahl; Abschnitte und
 * Bezeichnungen folgen dem amtlichen Vordruck und können in Mein ELSTER leicht anders lauten.
 */

type Feld = keyof Omit<UstvaFigures, "tax81" | "tax86" | "kz83">;

const FELDER: { kz: Feld; abschnitt: string; bezeichnung: string; volleEuro: boolean }[] = [
  { kz: "kz81", abschnitt: "Lieferungen und sonstige Leistungen", bezeichnung: "Steuerpflichtige Umsätze zum Steuersatz von 19 Prozent, Bemessungsgrundlage", volleEuro: true },
  { kz: "kz86", abschnitt: "Lieferungen und sonstige Leistungen", bezeichnung: "Steuerpflichtige Umsätze zum Steuersatz von 7 Prozent, Bemessungsgrundlage", volleEuro: true },
  { kz: "kz48", abschnitt: "Steuerfreie Lieferungen und sonstige Leistungen", bezeichnung: "Steuerfreie Umsätze ohne Vorsteuerabzug (§ 4 UStG)", volleEuro: true },
  { kz: "kz46", abschnitt: "Leistungsempfänger als Steuerschuldner (§ 13b UStG)", bezeichnung: "Sonstige Leistungen eines im übrigen Gemeinschaftsgebiet ansässigen Unternehmers (§ 13b Abs. 1 UStG), Bemessungsgrundlage", volleEuro: true },
  { kz: "kz47", abschnitt: "Leistungsempfänger als Steuerschuldner (§ 13b UStG)", bezeichnung: "Steuer zu Kz 46", volleEuro: false },
  { kz: "kz84", abschnitt: "Leistungsempfänger als Steuerschuldner (§ 13b UStG)", bezeichnung: "Andere Leistungen (§ 13b Abs. 2 UStG), Bemessungsgrundlage", volleEuro: true },
  { kz: "kz85", abschnitt: "Leistungsempfänger als Steuerschuldner (§ 13b UStG)", bezeichnung: "Steuer zu Kz 84", volleEuro: false },
  { kz: "kz21", abschnitt: "Ergänzende Angaben zu Umsätzen", bezeichnung: "Nicht steuerbare sonstige Leistungen an Unternehmer im übrigen Gemeinschaftsgebiet (§ 18b Satz 1 Nr. 2 UStG)", volleEuro: true },
  { kz: "kz45", abschnitt: "Ergänzende Angaben zu Umsätzen", bezeichnung: "Übrige nicht steuerbare Umsätze (Leistungsort nicht im Inland)", volleEuro: true },
  { kz: "kz66", abschnitt: "Abziehbare Vorsteuerbeträge", bezeichnung: "Vorsteuerbeträge aus Rechnungen von anderen Unternehmern (§ 15 Abs. 1 Satz 1 Nr. 1 UStG)", volleEuro: false },
  { kz: "kz67", abschnitt: "Abziehbare Vorsteuerbeträge", bezeichnung: "Vorsteuerbeträge aus Leistungen im Sinne des § 13b UStG (§ 15 Abs. 1 Satz 1 Nr. 4 UStG)", volleEuro: false },
];

/** Eingabe wie in Mein ELSTER: Dezimalkomma, ohne Tausenderpunkt; Bemessungsgrundlagen in vollen Euro */
const eingabe = (cents: number, volleEuro: boolean) => (volleEuro ? String(cents / 100) : csvDecimal(cents));

export function ustvaAusfuellliste(figures: UstvaFigures, berichtigt: boolean) {
  return {
    felder: [
      ...(berichtigt ? [{ kz: 10, abschnitt: "Allgemeine Angaben", bezeichnung: "Berichtigte Anmeldung", eingabe: "1" }] : []),
      ...FELDER.filter((f) => figures[f.kz] !== 0).map((f) => ({
        kz: Number(f.kz.slice(2)),
        abschnitt: f.abschnitt,
        bezeichnung: f.bezeichnung,
        eingabe: eingabe(figures[f.kz], f.volleEuro),
      })),
    ],
    /** Rechnet Mein ELSTER selbst; nur vergleichen */
    zumVergleich: [
      ...(figures.kz81 !== 0 ? [{ bezeichnung: "Steuer zu Kz 81", wert: csvDecimal(figures.tax81) }] : []),
      ...(figures.kz86 !== 0 ? [{ bezeichnung: "Steuer zu Kz 86", wert: csvDecimal(figures.tax86) }] : []),
      { bezeichnung: figures.kz83 < 0 ? "Kz 83 Verbleibender Überschuss" : "Kz 83 Verbleibende Umsatzsteuer-Vorauszahlung", wert: csvDecimal(figures.kz83) },
    ],
  };
}
