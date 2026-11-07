/**
 * Telefonnummer eines Kontakts (#322): Haben schreibt sie, wie sie eingegeben wurde, nur ohne doppelte Leerzeichen.
 * Eine bestimmte Form (E.164, DIN 5008) erzwingt Haben nicht, sie steht auf keiner Rechnung und wählt keine Nummer.
 */
export const MAX_TELEFON_LENGTH = 40;

export function normalizeTelefon(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Fehlertext für das Formular und den CSV-Import, null = in Ordnung; leer ist erlaubt */
export function telefonProblem(value: string): string | null {
  const nummer = normalizeTelefon(value);
  if (!nummer) return null;
  if (nummer.length > MAX_TELEFON_LENGTH) return `Telefon: höchstens ${MAX_TELEFON_LENGTH} Zeichen`;
  if (!/^[0-9+()/.\- ]+$/.test(nummer)) return "Telefon: nur Ziffern, Leerzeichen und + ( ) / - .";
  if (!/\d/.test(nummer)) return "Telefon: ohne Ziffern";
  return null;
}
