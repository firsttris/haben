import { elsterFelder, NUR_AUSLESEN, type ElsterFeld } from "@haben/elster";
import { annualXml, checkAnnual, type AnnualForm } from "./annual.ts";

export const MEIN_ELSTER_FORMAT = "haben-mein-elster";

/**
 * Die Werte einer Jahreserklärung zum Ausfüllen in Mein ELSTER (Erweiterung apps/elster-helfer). `formular` und
 * `jahr` passen zum Pfad der Formulare in Mein ELSTER: /eportal/interpreter/eingabe/euer-2025/…
 */
export interface MeinElsterWerte {
  format: typeof MEIN_ELSTER_FORMAT;
  version: 1;
  formular: AnnualForm;
  jahr: number;
  erstellt: string;
  felder: ElsterFeld[];
}

/**
 * Liest die Felder aus dem XML, das Haben über ERiC senden würde; dieselben Prüfungen wie beim Senden gelten. Die
 * Hersteller-ID steht nur im Transferkopf, den elsterFelder verwirft; dieses XML wird nie gesendet.
 */
export async function meinElsterWerte(form: AnnualForm, year: number, today: string, now = new Date()): Promise<MeinElsterWerte> {
  const checked = await checkAnnual(form, year, today);
  const { xml } = await annualXml(form, year, checked, false, NUR_AUSLESEN);
  return { format: MEIN_ELSTER_FORMAT, version: 1, formular: form, jahr: year, erstellt: now.toISOString(), felder: elsterFelder(xml) };
}
