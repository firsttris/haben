import type { Bundesland, Horizont, Kontenrahmen, Rechtsform, Versteuerung } from "@haben/core";
import { horizontEnde } from "@haben/core";
import { kleinunternehmerHistory, loadCompany, versteuerungForYear, type Company } from "../stammdaten/index.ts";

/** Was jeder Adapter braucht: Stichtag, Ende des Horizonts und die Firmendaten, die Termine und Steuer bestimmen */
export interface Kontext {
  heute: string;
  /** Letzter Tag des Horizonts, einschließlich */
  bis: string;
  bundesland: Bundesland | null;
  rechtsform: Rechtsform;
  kontenrahmen: Kontenrahmen;
  taxpayer: Company["taxpayer"];
  /** Ist- oder Sollversteuerung im Jahr eines Tages */
  versteuerung: (datum: string) => Versteuerung;
  /** Kleinunternehmer am Tag: keine Umsatzsteuer, keine Vorsteuer */
  kleinunternehmer: (datum: string) => boolean;
}

export async function ladeKontext(heute: string, horizont: Horizont): Promise<Kontext> {
  const bis = horizontEnde(heute, horizont);
  const [company, ku] = await Promise.all([loadCompany(), kleinunternehmerHistory()]);
  const jahre = Array.from({ length: Number(bis.slice(0, 4)) - Number(heute.slice(0, 4)) + 1 }, (_, i) => Number(heute.slice(0, 4)) + i);
  const versteuerung = new Map(await Promise.all(jahre.map(async (jahr) => [jahr, await versteuerungForYear(jahr)] as const)));
  return {
    heute,
    bis,
    bundesland: company.bundesland,
    rechtsform: company.rechtsform,
    kontenrahmen: company.kontenrahmen,
    taxpayer: company.taxpayer,
    // Ein Jahr außerhalb des Horizonts kommt nur bei Posten vor heute vor; dort gilt das Jahr von heute
    versteuerung: (datum) => versteuerung.get(Number(datum.slice(0, 4))) ?? versteuerung.get(Number(heute.slice(0, 4)))!,
    kleinunternehmer: ku,
  };
}
