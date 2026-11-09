/**
 * DATEV-Personenkonten am Kontakt (#327): Debitor für Kunden, Kreditor für Lieferanten, getrennt von Kunden- und
 * Lieferantennummer. Bereiche bei vierstelligen Sachkonten, wie sie Haben im DATEV-Export schreibt (Sachkontenlänge 4):
 * DATEV-Kontenrahmen SKR 03 und SKR 04, gültig für 2026, jeweils Seite 36 „Personenkonten“ (10000–69999 Debitoren,
 * 70000–99999 Kreditoren). Andere Längen lehnt Haben ab, statt Nummern zu kürzen.
 */

export type PersonenkontoRolle = "debitor" | "kreditor";

export const PERSONENKONTO_BEREICH: Record<PersonenkontoRolle, { von: number; bis: number }> = {
  debitor: { von: 10000, bis: 69999 },
  kreditor: { von: 70000, bis: 99999 },
};

export const PERSONENKONTO_LABEL: Record<PersonenkontoRolle, string> = { debitor: "Debitor", kreditor: "Kreditor" };

/** Meldung, wenn die Nummer nicht im Bereich der Rolle liegt; null = in Ordnung */
export function personenkontoProblem(rolle: PersonenkontoRolle, nr: number): string | null {
  const { von, bis } = PERSONENKONTO_BEREICH[rolle];
  if (Number.isInteger(nr) && nr >= von && nr <= bis) return null;
  return `${PERSONENKONTO_LABEL[rolle]}: ${von} bis ${bis} (fünfstellig, nach DATEV-Kontenrahmen)`;
}

/** Nummer aus einem Textfeld oder einer CSV-Zelle; leer = keine Nummer */
export function parsePersonenkonto(rolle: PersonenkontoRolle, raw: string): { ok: true; value: number | null } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  if (!/^\d+$/.test(text)) return { ok: false, error: `${PERSONENKONTO_LABEL[rolle]}: „${text}“ ist keine Nummer` };
  const value = Number(text);
  const problem = personenkontoProblem(rolle, value);
  return problem ? { ok: false, error: problem } : { ok: true, value };
}
