import { formatDecimal, type HinterlegungBilanz, type HinterlegungZeile } from "@haben/core";
import { formatDate } from "./format.ts";
import { renderHinterlegungPdf } from "./pdf.ts";

/*
 * Bilanz einer Kleinstkapitalgesellschaft als PDF zur Hinterlegung beim Unternehmensregister (§ 326 Abs. 2 HGB). Die
 * Inhalte rechnet hinterlegungBilanz in @haben/core; hier wird nur formatiert.
 *
 * Warum PDF: Für Geschäftsjahre ab 2022 nimmt das Unternehmensregister über die Publikations-Plattform
 * (https://www.publikations-plattform.de) XML/XBRL nach der XSD oder dem Webformular des Bundesanzeiger Verlags direkt an;
 * Word, RTF, Excel und PDF konvertiert es gegen ein Entgelt je sichtbarem Zeichen (Allgemeine Nutzungsbedingungen für das
 * Unternehmensregister §§ 8, 9, https://www.publikations-plattform.de/order/D088.pdf; Entgelte
 * https://www.publikations-plattform.de/order/D051Preisliste.pdf). Ein PDF muss les-, kopier- und druckbar sein, den
 * ganzen Text enthalten, unverschlüsselt und ohne JavaScript und Formulare sein und auf A4 passen. Das XSD des Betreibers
 * ist nicht öffentlich; ein PDF/A mit echtem Text (Typst, wie die Rechnung) erfüllt das und kostet nur die Konvertierung.
 */

const betrag = (cents: number | null) => (cents === null ? "" : formatDecimal(cents));
const zeile = (z: HinterlegungZeile) => ({ label: z.label, betrag: betrag(z.betrag), vorjahr: betrag(z.vorjahr) });

/** Druckfertige Texte für templates/hinterlegung.typ */
export function hinterlegungPdfData(bilanz: HinterlegungBilanz) {
  const { firma } = bilanz;
  return {
    docTitle: `Bilanz zum ${formatDate(bilanz.stichtag)} – ${firma.name}`,
    author: firma.name,
    firma: firma.name,
    kopf: [`Sitz: ${firma.sitz}`, `Registergericht: ${firma.registergericht}, ${firma.registernummer}`],
    title: `Bilanz zum ${formatDate(bilanz.stichtag)}`,
    spalten: {
      jahr: formatDate(bilanz.stichtag),
      vorjahr: bilanz.vorjahresstichtag ? formatDate(bilanz.vorjahresstichtag) : null,
    },
    aktiva: bilanz.aktiva.map(zeile),
    passiva: bilanz.passiva.map(zeile),
    summeAktiva: zeile(bilanz.summeAktiva),
    summePassiva: zeile(bilanz.summePassiva),
    angabenTitel: "Angaben unter der Bilanz (§ 264 Abs. 1 Satz 5 HGB)",
    angaben: bilanz.angaben,
    hinweis:
      "Die Gesellschaft ist eine Kleinstkapitalgesellschaft (§\u00a0267a HGB). Ein Anhang wird nicht aufgestellt (§\u00a0264 Abs.\u00a01 Satz\u00a05 HGB).",
    feststellung: `Der Jahresabschluss wurde am ${formatDate(bilanz.feststellung)} festgestellt.`,
  };
}

/** PDF/A-3b; `today` ist das Erstellungsdatum in den Metadaten */
export function buildHinterlegungPdf(bilanz: HinterlegungBilanz, today: string): Uint8Array {
  return renderHinterlegungPdf(hinterlegungPdfData(bilanz), today);
}
