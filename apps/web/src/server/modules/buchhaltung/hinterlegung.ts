import {
  abschluss,
  feststellungFehler,
  hinterlegungBilanz,
  hinterlegungFrist,
  hinterlegungMaengel,
  isKapitalgesellschaft,
  type Abschluss,
  type HinterlegungAngaben,
  type HinterlegungBilanz,
  type HinterlegungFirma,
} from "@haben/core";
import { buildHinterlegungPdf } from "@haben/einvoice";
import { z } from "zod";
import { UserError } from "../../errors.ts";
import { loadCompany, type Company } from "../stammdaten/index.ts";
import { ledgerRange, saldenliste } from "./ledger.ts";

/*
 * Bilanz einer GmbH oder UG zur Hinterlegung beim Unternehmensregister (§ 326 Abs. 2 HGB), als PDF. Die Vorjahresspalte
 * (§ 265 Abs. 2 HGB) kommt aus der Spalte „Eröffnung“ der Saldenliste: Die Salden zum 1. Januar sind die Schlussbilanz
 * des Vorjahres (Bilanzidentität, § 252 Abs. 1 Nr. 1 HGB), ob vorgetragen oder per Eröffnungsbuchung übernommen.
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

/** Bilanz des Jahres und, wenn es Salden zum 1. Januar gibt, die des Vorjahres */
async function bilanzen(year: number, company: Company): Promise<{ report: Abschluss; vorjahr: Abschluss | null }> {
  const rows = (await saldenliste(ledgerRange(year))).filter((r) => r.kontenrahmen === company.kontenrahmen);
  const report = abschluss(
    company.kontenrahmen,
    rows.map((r) => ({ account: r.account, saldo: r.saldo })),
  );
  const eroeffnung = rows.filter((r) => r.eroeffnung !== 0).map((r) => ({ account: r.account, saldo: r.eroeffnung }));
  return { report, vorjahr: eroeffnung.length > 0 ? abschluss(company.kontenrahmen, eroeffnung) : null };
}

/** Frist und Mängel für die Seite; null, wo es keine Hinterlegung gibt (Einzelunternehmen, laufendes Jahr) */
export async function hinterlegungStand(year: number, today: string): Promise<HinterlegungStand | null> {
  const company = await loadCompany();
  if (!isKapitalgesellschaft(company.rechtsform) || `${year}-12-31` >= today) return null;
  const { report, vorjahr } = await bilanzen(year, company);
  const frist = hinterlegungFrist(year);
  return { frist, fristAbgelaufen: frist < today, maengel: hinterlegungMaengel(firmaOf(company), report, vorjahr), vorjahr: vorjahr !== null };
}

/** Die Bilanz zur Hinterlegung mit den Angaben; wirft HinterlegungError, solange etwas fehlt */
export async function hinterlegungBilanzFuer(year: number, angaben: HinterlegungAngaben, today: string): Promise<HinterlegungBilanz> {
  const company = await loadCompany();
  if (!isKapitalgesellschaft(company.rechtsform)) throw new HinterlegungError("Hinterlegen beim Unternehmensregister gibt es nur für GmbH und UG.");
  if (`${year}-12-31` >= today) throw new HinterlegungError(`Das Jahr ${year} ist noch nicht vorbei.`);
  const fehler = feststellungFehler(year, angaben.festgestelltAm, today);
  if (fehler) throw new HinterlegungError(fehler);
  const firma = firmaOf(company);
  const { report, vorjahr } = await bilanzen(year, company);
  const maengel = hinterlegungMaengel(firma, report, vorjahr);
  if (maengel.length > 0) throw new HinterlegungError(maengel.join(" "));
  return hinterlegungBilanz({ year, firma, report, vorjahr, angaben });
}

/** PDF der Bilanz zur Hinterlegung */
export async function hinterlegungPdf(year: number, angaben: HinterlegungAngaben, today: string): Promise<{ filename: string; pdf: Uint8Array }> {
  const bilanz = await hinterlegungBilanzFuer(year, angaben, today);
  return { filename: `Bilanz-${year}-Hinterlegung.pdf`, pdf: buildHinterlegungPdf(bilanz, today) };
}
