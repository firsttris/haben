import type { Ausfuehren } from "./ausfuehren.ts";

/** Alles, was die Befehle von außen brauchen; die Tests setzen Nachbauten ein */
export interface Kontext {
  /** Ablage der Instanzen, absolut */
  basis: string;
  /** deploy/ im Checkout: compose.yml und compose.env.example als Vorlagen */
  vorlagen: string;
  ausfuehren: Ausfuehren;
  /** Umgebung der Shell; an docker geht davon nur die Positivliste aus ausfuehren.ts */
  shell: Record<string, string | undefined>;
  /** HTTP-Status einer Adresse ohne Weiterleitungen, null wenn sie nicht antwortet */
  abrufen: (url: string) => Promise<number | null>;
  schlafen: (ms: number) => Promise<void>;
  /** Wartezeit auf eine gesunde App und Abstand der Prüfungen, in Sekunden */
  warten: number;
  takt: number;
  /** Eine Zeile auf die Standardausgabe */
  aus: (zeile: string) => void;
}

/** Bricht den Befehl mit einer Meldung ab; der Einstieg schreibt sie als „Fehler: …“ und endet mit Exit-Code 1 */
export function abbrechen(meldung: string): never {
  throw Object.assign(new Error(meldung), { name: "Abbruch" });
}
