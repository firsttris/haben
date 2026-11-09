import { PERSONENKONTO_LABEL, type PersonenkontoRolle } from "@haben/core";
import type { DatevExportEntry } from "./datev-export.ts";

/**
 * Personenkonten im DATEV-Buchungsstapel (#327, Entwurf in #270): Das Journal von Haben bucht offene Posten auf den
 * Sammelkonten (Forderungen bzw. Verbindlichkeiten aus Lieferungen und Leistungen). Für den Export setzt diese Funktion
 * die Nummer des Kontakts der Quelle ein: Rechnung → Debitor des Kunden, Beleg → Kreditor des Lieferanten, Zahlung und
 * Ausbuchung über die zugeordnete Rechnung bzw. den Beleg. Maßgeblich ist die Herkunft, nicht das Vorzeichen; jede
 * Zeile wird ersetzt, nicht ergänzt, so steht jeder Betrag nur einmal im Stapel. Fehlt eine Angabe, lehnt der Export
 * mit der Liste der Vorgänge ab, statt still auf das Sammelkonto zu buchen. Ausgenommen sind Buchung und Gegenbuchung
 * (Storno), die beide im Stapel stehen: Ohne Personenkonto bleiben sie auf dem Sammelkonto und heben sich dort auf, so
 * gibt Storno und Neuerfassung eines gebuchten Belegs ohne Lieferanten den Export frei. Eröffnungsbuchungen (Restsaldo
 * aus der Vorgänger-Buchhaltung, etwa aus einem DATEV-Stapel) bleiben ebenfalls auf dem Sammelkonto; so entschieden in
 * #452, weil sie keine Rechnung und keinen Beleg haben.
 */

export interface PersonenkontoBezug {
  /** Wie die Ablehnung den Vorgang nennt, etwa „Rechnung RE-2026-0001“ */
  vorgang: string;
  /** Debitor für Rechnungen und alles dazu, Kreditor für Belege */
  rolle: PersonenkontoRolle;
  /** Kontakt der Quelle; null = Vorgang ohne Kontakt */
  kontakt: { name: string; nummer: number | null } | null;
}

export interface Sammelkonten {
  forderungen: string;
  verbindlichkeiten: string;
}

export type PersonenkontenErgebnis<T extends DatevExportEntry> =
  | { entries: T[]; verwendet: { rolle: PersonenkontoRolle; nummer: number }[] }
  | { probleme: string[] };

const OHNE_KONTAKT: Record<PersonenkontoRolle, string> = { debitor: "ohne Kunden aus den Kontakten", kreditor: "ohne Lieferanten aus den Kontakten" };
const QUELLE: Record<PersonenkontoRolle, string> = { debitor: "Rechnung", kreditor: "Beleg" };
const deDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** Personenkonto einer Buchung oder die Meldung, warum es fehlt; null = die Buchung berührt kein Sammelkonto */
function personenkonto(
  entry: DatevExportEntry,
  bezug: PersonenkontoBezug | null,
  sammelkonten: Sammelkonten,
): { rolle: PersonenkontoRolle; nummer: number } | string | null {
  const rollen = new Set(
    entry.lines.flatMap((l): PersonenkontoRolle[] =>
      l.account === sammelkonten.forderungen ? ["debitor"] : l.account === sammelkonten.verbindlichkeiten ? ["kreditor"] : [],
    ),
  );
  if (rollen.size === 0) return null;
  for (const rolle of rollen) {
    if (bezug?.rolle === rolle) continue;
    const konto = rolle === "debitor" ? sammelkonten.forderungen : sammelkonten.verbindlichkeiten;
    return `${bezug?.vorgang ?? `Buchung vom ${deDate(entry.date)} „${entry.description}“`}: Konto ${konto} ohne ${QUELLE[rolle]}`;
  }
  const rolle = bezug!.rolle;
  if (!bezug!.kontakt) return `${bezug!.vorgang}: ${OHNE_KONTAKT[rolle]}`;
  if (bezug!.kontakt.nummer === null) return `${bezug!.vorgang}: „${bezug!.kontakt.name}“ hat keinen ${PERSONENKONTO_LABEL[rolle]}`;
  return { rolle, nummer: bezug!.kontakt.nummer };
}

/** Kennung der Buchung und der Buchung, die sie storniert; aus journal_entries.id und reverses_id */
export interface Gegenbuchung {
  id?: string;
  reversesId?: string | null;
  /** Eröffnungsbuchung (source_type eroeffnung): bleibt auf dem Sammelkonto */
  eroeffnung?: boolean;
}

/** Buchungen, deren Gegenbuchung bzw. Original ebenfalls im Stapel steht */
function stornoPaare(entries: readonly Gegenbuchung[]): Set<string> {
  const ids = new Set(entries.flatMap((e) => (e.id ? [e.id] : [])));
  const paare = new Set<string>();
  for (const e of entries) {
    if (e.id && e.reversesId && ids.has(e.reversesId)) paare.add(e.id).add(e.reversesId);
  }
  return paare;
}

export function personenkontenEinsetzen<T extends DatevExportEntry & Gegenbuchung & { bezug: PersonenkontoBezug | null }>(
  entries: readonly T[],
  sammelkonten: Sammelkonten,
): PersonenkontenErgebnis<T> {
  const probleme: string[] = [];
  const verwendet = new Map<string, { rolle: PersonenkontoRolle; nummer: number }>();
  const paare = stornoPaare(entries);
  const result = entries.map((entry) => {
    if (entry.eroeffnung) return entry;
    const konto = personenkonto(entry, entry.bezug, sammelkonten);
    if (konto === null) return entry;
    if (typeof konto === "string") {
      if (!(entry.id && paare.has(entry.id)) && !probleme.includes(konto)) probleme.push(konto);
      return entry;
    }
    verwendet.set(`${konto.rolle}:${konto.nummer}`, konto);
    const sammelkonto = konto.rolle === "debitor" ? sammelkonten.forderungen : sammelkonten.verbindlichkeiten;
    return { ...entry, lines: entry.lines.map((l) => (l.account === sammelkonto ? { ...l, account: String(konto.nummer) } : l)) };
  });
  return probleme.length > 0 ? { probleme } : { entries: result, verwendet: [...verwendet.values()] };
}
