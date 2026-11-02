import { meinElsterWerte as werte, NUR_AUSLESEN, type MeinElsterWerte } from "@haben/elster";
import { annualXml, checkAnnual, type AnnualForm } from "./annual.ts";

/**
 * Die Werte einer Jahreserklärung zum Ausfüllen in Mein ELSTER (Erweiterung apps/elster-helfer), gelesen aus dem XML,
 * das Haben über ERiC senden würde; dieselben Prüfungen wie beim Senden gelten. Die Hersteller-ID steht nur im
 * Transferkopf, den elsterFelder verwirft; dieses XML wird nie gesendet.
 */
export async function meinElsterWerte(form: AnnualForm, year: number, today: string, now = new Date()): Promise<MeinElsterWerte> {
  const checked = await checkAnnual(form, year, today);
  const { xml } = await annualXml(form, year, checked, false, NUR_AUSLESEN);
  if (form !== "est") return werte(form, year, xml, now);
  // Mein ELSTER schreibt Anlagen je Person mit Vor- und Nachnamen: „Anlage S (Erika Muster)“
  const { a, b } = checked.company.taxpayer;
  const name = (p: { vorname: string; name: string }) => `${p.vorname} ${p.name}`.trim();
  return werte(form, year, xml, now, { personen: { A: a ? name(a) : "", B: b ? name(b) : null } });
}
