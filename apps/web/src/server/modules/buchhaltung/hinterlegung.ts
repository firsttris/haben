import {
  feststellungFehler,
  hinterlegungBilanz,
  hinterlegungFrist,
  hinterlegungMaengel,
  isKapitalgesellschaft,
  type HinterlegungAngaben,
  type HinterlegungBilanz,
  type HinterlegungFirma,
} from "@haben/core";
import { buildHinterlegungPdf } from "@haben/einvoice";
import { z } from "zod";
import { UserError } from "../../errors.ts";
import { loadCompany, type Company } from "../stammdaten/index.ts";
import { jahresBilanzen } from "./bilanzen.ts";
import { bilanzVermerkeFuer } from "./restlaufzeiten.ts";

/*
 * Bilanz einer GmbH oder UG zur Hinterlegung beim Unternehmensregister (§ 326 Abs. 2 HGB), als PDF, mit Vorjahresspalte
 * (bilanzen.ts) und den Vermerken zu Restlaufzeiten und Gesellschaftern (restlaufzeiten.ts). Ohne bestätigte
 * Restlaufzeiten gibt es keine Datei: Die Vermerke sind Pflicht (§ 268 Abs. 4 und 5 HGB).
 */

export class HinterlegungError extends UserError {}

export const hinterlegungAngabenSchema = z.object({
  haftungsverhaeltnisse: z.string().trim().max(2000).default(""),
  organkredite: z.string().trim().max(2000).default(""),
  festgestelltAm: z.iso.date("Tag der Feststellung fehlt"),
});

export interface HinterlegungStand {
  /** Letzter Tag der Hinterlegung, JJJJ-MM-TT */
  frist: string;
  fristAbgelaufen: boolean;
  /** Was der Datei entgegensteht; leer = sie lässt sich erzeugen */
  maengel: string[];
  /** Hat die Bilanz eine Vorjahresspalte? Ohne: erstes Geschäftsjahr in Haben */
  vorjahr: boolean;
}

function firmaOf(company: Company): HinterlegungFirma {
  return { name: company.name, sitz: company.sitz || company.ort, registergericht: company.registergericht, registernummer: company.registernummer };
}

/** Frist und Mängel für die Seite; null, wo es keine Hinterlegung gibt (Einzelunternehmen, laufendes Jahr) */
export async function hinterlegungStand(year: number, today: string): Promise<HinterlegungStand | null> {
  const company = await loadCompany();
  if (!isKapitalgesellschaft(company.rechtsform) || `${year}-12-31` >= today) return null;
  const { report, vorjahr } = await jahresBilanzen(year, company.kontenrahmen);
  const vermerke = await bilanzVermerkeFuer(year, company.kontenrahmen);
  const frist = hinterlegungFrist(year);
  return {
    frist,
    fristAbgelaufen: frist < today,
    maengel: [...hinterlegungMaengel(firmaOf(company), report, vorjahr), ...vermerke.maengel],
    vorjahr: vorjahr !== null,
  };
}

/** Die Bilanz zur Hinterlegung mit den Angaben; wirft HinterlegungError, solange etwas fehlt */
export async function hinterlegungBilanzFuer(year: number, angaben: HinterlegungAngaben, today: string): Promise<HinterlegungBilanz> {
  const company = await loadCompany();
  if (!isKapitalgesellschaft(company.rechtsform)) throw new HinterlegungError("Hinterlegen beim Unternehmensregister gibt es nur für GmbH und UG.");
  if (`${year}-12-31` >= today) throw new HinterlegungError(`Das Jahr ${year} ist noch nicht vorbei.`);
  const fehler = feststellungFehler(year, angaben.festgestelltAm, today);
  if (fehler) throw new HinterlegungError(fehler);
  const firma = firmaOf(company);
  const { report, vorjahr } = await jahresBilanzen(year, company.kontenrahmen);
  const { maengel: offen, ...vermerke } = await bilanzVermerkeFuer(year, company.kontenrahmen);
  const maengel = [...hinterlegungMaengel(firma, report, vorjahr), ...offen];
  if (maengel.length > 0) throw new HinterlegungError(maengel.join(" "));
  return hinterlegungBilanz({ year, firma, report, vorjahr, angaben, vermerke });
}

/** PDF der Bilanz zur Hinterlegung */
export async function hinterlegungPdf(year: number, angaben: HinterlegungAngaben, today: string): Promise<{ filename: string; pdf: Uint8Array }> {
  const bilanz = await hinterlegungBilanzFuer(year, angaben, today);
  return { filename: `Bilanz-${year}-Hinterlegung.pdf`, pdf: buildHinterlegungPdf(bilanz, today) };
}
