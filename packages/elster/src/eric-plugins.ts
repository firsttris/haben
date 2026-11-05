import { existsSync } from "node:fs";
import { ericPluginPath } from "./eric.ts";

/**
 * Hat das ERiC unter ericHome das Prüf-Plugin zu einer Jahres-Datenart-Version (z. B. UStVA_2027 → libcheckUStVA_2027.so)?
 * Für die Tests mit echtem ERiC: Neue Jahre bringt erst eine neuere ERiC-Version mit (Datenartversionmatrix im Paket).
 * Andere Datenart-Versionen gelten als vorhanden.
 */
export function hatJahresPlugin(ericHome: string, datenartVersion: string | undefined): boolean {
  // Die Lohnsteuerbescheinigung hat ein Plugin ohne Jahr; welche Jahre es kennt, steht in LSTB_SCHNITTSTELLEN (lstb.ts)
  if (datenartVersion === "ElsterLohn") return existsSync(`${ericPluginPath(ericHome)}/libcheckElsterLohn.so`);
  const jahr = /^(UStVA|USt|EUER|ESt|KapEStA|LStA)_(\d{4})$/.exec(datenartVersion ?? "");
  if (!jahr) return true;
  return existsSync(`${ericPluginPath(ericHome)}/libcheck${jahr[1]}_${jahr[2]}.so`);
}
