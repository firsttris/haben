/*
 * Arten und Statustexte archivierter Auftragsdokumente (legacy_order_documents), für Server und Oberfläche an einer Stelle.
 * Status kommt unverändert aus der Quelle: sevDesk als Zahl oder Wort, FastBill (estimate.get) als Wort.
 */
export const ORDER_KINDS = { AN: "Angebot", AB: "Auftragsbestätigung", LI: "Lieferschein" } as const;

export const ORDER_STATUSES: Record<string, string> = {
  "100": "Entwurf",
  "200": "Ausgegeben / versendet",
  "300": "Abgelehnt",
  "500": "Angenommen",
  "750": "Teilweise berechnet",
  "1000": "Vollständig berechnet",
  draft: "Entwurf",
  open: "Offen",
  declined: "Geschlossen / abgelehnt",
  accepted: "Angenommen",
  partlyInvoiced: "Teilweise berechnet",
  invoiced: "Vollständig berechnet",
  // FastBill
  created: "Erstellt",
  sent: "Versendet",
  negotiation: "In Verhandlung",
  rejected: "Abgelehnt",
};

/** Wer die Quelle eines Auftragsdokuments ist, für Überschriften wie „Angebot aus FastBill“ */
export function orderSourceName(source: string, importName?: string): string {
  if (source === "import") return importName || "JSON-Import";
  return source === "fastbill" ? "FastBill" : "sevDesk";
}
