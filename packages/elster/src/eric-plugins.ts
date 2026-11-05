import { existsSync } from "node:fs";
import { ericPluginPath } from "./eric.ts";

/**
 * Hat das ERiC unter ericHome das Prüf-Plugin zu einer Datenart-Version? Jahresversionen (UStVA_2027 →
 * libcheckUStVA_2027.so) und Taxonomien der E-Bilanz (Bilanz_6.10 → libcheckBilanz_6_10.so) bringt erst eine neuere
 * ERiC-Version mit (Datenartversionmatrix im Paket); ERiC 44 etwa kennt Bilanz_6.10 nicht. Andere Datenart-Versionen
 * gelten als vorhanden.
 */
export function hatJahresPlugin(ericHome: string, datenartVersion: string | undefined): boolean {
  const plugin = pluginName(datenartVersion ?? "");
  return plugin === null || existsSync(`${ericPluginPath(ericHome)}/libcheck${plugin}.so`);
}

function pluginName(datenartVersion: string): string | null {
  const jahr = /^(UStVA|USt|EUER|ESt|KapEStA)_(\d{4})$/.exec(datenartVersion);
  if (jahr) return `${jahr[1]}_${jahr[2]}`;
  const bilanz = /^Bilanz_(\d+)\.(\d+)$/.exec(datenartVersion);
  return bilanz ? `Bilanz_${bilanz[1]}_${bilanz[2]}` : null;
}
