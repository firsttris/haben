import type { FintsProdukt } from "@haben/import";
import pkg from "../../../../../../package.json" with { type: "json" };
import { BankError } from "./bank-error.ts";
import { env } from "../../env.ts";

/*
 * Produktregistrierung für FinTS (#654). Die Nummer kommt nur aus FINTS_PRODUKT_ID: Die Deutsche Kreditwirtschaft
 * vergibt sie je Produkt und Hersteller, sie darf nur im registrierten Produkt stehen und nicht im veröffentlichten
 * Quellcode (Antwort der DK, Speicherstadt/haben#654). Wer Haben betreibt, registriert sich selbst. Ohne Nummer bleibt
 * FinTS aus.
 */

/** FinTS-Produktversion an..5 (HKVVB): Haupt- und Nebenversion von Haben, etwa „0.9“ */
export function fintsProduktVersion(version: string): string {
  return version.split(".").slice(0, 2).join(".").slice(0, 5);
}

export function fintsProdukt(): FintsProdukt | null {
  const id = env().FINTS_PRODUKT_ID;
  return id ? { id, version: fintsProduktVersion(pkg.version) } : null;
}

export function fintsConfigured(): boolean {
  return fintsProdukt() !== null;
}

export function fintsProduktOderFehler(): FintsProdukt {
  const produkt = fintsProdukt();
  if (!produkt) throw new BankError("FinTS ist nicht eingerichtet: Der Betreiber trägt die Registrierungsnummer in FINTS_PRODUKT_ID ein.");
  return produkt;
}
