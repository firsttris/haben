/*
 * Firmen wechseln (#504): Jede Firma ist eine eigene Instanz von Haben mit eigener Adresse. HABEN_FIRMEN nennt sie,
 * damit die Navigation zwischen ihnen verlinkt. Haben kennt dabei nur Namen und Adressen, keine Daten der anderen.
 * Ohne Serverbezug: env.ts prüft die Angabe beim Start, getAuthState gibt dem Inhaber die anderen Firmen. Die Regeln
 * für Namen und Adressen stehen in @haben/core, weil das Portal (apps/portal) dieselben prüft.
 */
import { type Firma, parseFirmen } from "@haben/core";
import type { Rolle } from "./rollen.ts";

export { type Firma, parseFirmen } from "@haben/core";

/**
 * Die Firmen, zu denen eine Sitzung wechseln kann: alle außer der eigenen, die Haben an der eigenen Adresse
 * (BETTER_AUTH_URL) erkennt. Nur für den Inhaber: Die Steuerberatung kann in jeder Instanz einen eigenen Zugang
 * haben oder keinen und erfährt nicht, welche anderen Firmen es gibt.
 */
export function andereFirmen(text: string | undefined, eigeneAdresse: string, rolle: Rolle): Firma[] {
  const ergebnis = parseFirmen(text ?? "");
  if (rolle !== "inhaber" || "fehler" in ergebnis || !URL.canParse(eigeneAdresse)) return [];
  const eigene = new URL(eigeneAdresse).origin;
  return ergebnis.firmen.filter((firma) => firma.url !== eigene);
}
