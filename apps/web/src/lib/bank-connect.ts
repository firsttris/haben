/** Vorgabe für „Umsätze abrufen ab“ beim Verbinden einer Bank: der Jahresbeginn */
export function defaultFetchFrom(today: string): string {
  return `${today.slice(0, 4)}-01-01`;
}

/**
 * Der Tag, den das Formular beim Verbinden mitschickt. Die Vorgabe geht nicht mit: Ohne gewählten Tag schließt der
 * erste Abruf nahtlos an Umsätze aus einer Datei an, auch wenn die im Vorjahr enden; mit dem Jahresbeginn fehlten
 * die Wochen dazwischen still. Nur ein selbst geänderter Tag (Umzug unter dem Jahr) gilt.
 */
export function fetchFromForConnect(value: string, today: string): string | null {
  return !value || value === defaultFetchFrom(today) ? null : value;
}
