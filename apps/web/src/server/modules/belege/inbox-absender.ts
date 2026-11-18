/**
 * Absenderfreigabe für das Postfach: Einträge sind eine Adresse (`rechnung@lieferant.example`) oder eine
 * Domain (`lieferant.example` oder `@lieferant.example`). Groß- und Kleinschreibung zählt nicht.
 * Untergeordnete Domains sind nicht mitgemeint. Eine leere Liste lässt jeden Absender zu.
 */
export function normalizeSenders(entries: string[]): string[] {
  const out = new Set<string>();
  for (const entry of entries) {
    const value = entry.trim().toLowerCase().replace(/^<|>$/g, "");
    if (value) out.add(value);
  }
  return [...out];
}

export function senderAllowed(address: string | undefined, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const from = (address ?? "").trim().toLowerCase();
  const at = from.lastIndexOf("@");
  if (at <= 0) return false;
  const domain = from.slice(at + 1);
  return allowed.some((entry) => (entry.includes("@") && !entry.startsWith("@") ? entry === from : entry.replace(/^@/, "") === domain));
}
