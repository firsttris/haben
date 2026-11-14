import { gruppenAus } from "@haben/core";
import type { Rolle } from "../lib/rollen.ts";

/*
 * Gruppenentscheidung im SSO-Modus, ohne Server- oder Datenbankbezug. Erwartet ein Array aus Zeichenketten, wie es etwa
 * Authelia über UserInfo liefert (https://www.authelia.com/integration/openid-connect/openid-connect-1.0-claims/#groups).
 */

export interface GroupConfig {
  /** Name genau eines Claims, wörtlich nachgeschlagen, nie als Pfad ausgewertet */
  claim: string;
  inhaber: string;
  steuerberatung: string;
}

/** fehlt: kein Claim; ungueltig: kein Array aus Zeichenketten; keine: keine passende Gruppe; beide: beide Haben-Gruppen */
export type GroupRejection = "fehlt" | "ungueltig" | "keine" | "beide";

export type GroupDecision = { ok: true; role: Rolle } | { ok: false; reason: GroupRejection };

/**
 * Rolle aus den Gruppen der UserInfo-Antwort: exakt und groß-/kleinschreibungssensitiv, fremde Gruppen zählen nicht.
 * Genau eine der beiden Haben-Gruppen gibt Zugang, alles andere verweigert ihn.
 */
export function decideRole(profile: Record<string, unknown>, config: GroupConfig): GroupDecision {
  // Dieselbe Auswertung des Claims wie im Portal (apps/portal)
  const ergebnis = gruppenAus(profile, config.claim);
  if ("fehler" in ergebnis) return { ok: false, reason: ergebnis.fehler };
  const groups = ergebnis.gruppen;
  const inhaber = groups.includes(config.inhaber);
  const steuerberatung = groups.includes(config.steuerberatung);
  if (inhaber && steuerberatung) return { ok: false, reason: "beide" };
  if (inhaber) return { ok: true, role: "inhaber" };
  if (steuerberatung) return { ok: true, role: "steuerberatung" };
  return { ok: false, reason: "keine" };
}

/** Höchstens 15 Minuten gilt eine Haben-Berechtigung, ohne Verlängerung durch Aktivität */
export const SSO_PROOF_MS = 15 * 60_000;
