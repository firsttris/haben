/**
 * Mehrere E-Mail-Adressen in einem Feld, etwa zentraler Rechnungseingang und Freigeber beim Kunden:
 * durch Komma oder Semikolon getrennt, höchstens MAX_EMAIL_RECIPIENTS.
 */
export const MAX_EMAIL_RECIPIENTS = 5;

/** Einzelne Adressen, ohne Leerzeichen und leere Einträge */
export function splitEmails(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Einheitlich mit Komma und Leerzeichen getrennt, wie im Empfängerfeld des Versands */
export function joinEmails(list: string[]): string {
  return list.join(", ");
}

/** Erste Adresse: für die E-Rechnung, die nur eine elektronische Adresse des Käufers kennt (BT-49) */
export function firstEmail(value: string | null | undefined): string {
  return splitEmails(value)[0] ?? "";
}
