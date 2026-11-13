/** Liest das TransferTicket aus der Serverantwort. */
export function parseTransferTicket(serverResponseXml: string): string | undefined {
  const match = /<(?:\w+:)?TransferTicket>\s*([^<]*?)\s*<\/(?:\w+:)?TransferTicket>/.exec(serverResponseXml);
  return match?.[1] || undefined;
}

/**
 * Muster für ein von Hand eingetragenes Transferticket. Amtlich ist es eine 32-stellige ETID
 * (`TransferTicketSType` in `ElsterBasisSchema/Schema/headerbasis_datentypen.xsd` der ERiC-Dokumentation 45.1.5.0:
 * `[0-9a-km-z]{2}[0-9]{3}[0-9a-km-z]{27}`). Haben prüft bewusst toleranter (Groß- und Kleinbuchstaben, Ziffern, Bindestrich
 * und Punkt, 4 bis 64 Zeichen), damit jedes amtliche Ticket passt und nur Tippfehler und Leerzeichen auffallen.
 */
export const TRANSFERTICKET_MUSTER = /^[A-Za-z0-9][A-Za-z0-9.-]{3,63}$/;

/**
 * Was gegen ein Transferticket spricht, oder null. Beide Vermerke, Voranmeldung und Jahreserklärung, prüfen damit gleich
 * und nennen dieselbe Meldung.
 */
export function transferticketProblem(ticket: string): string | null {
  if (!TRANSFERTICKET_MUSTER.test(ticket.trim())) return "Bitte das Transferticket aus dem Übermittlungsprotokoll angeben (Buchstaben und Ziffern).";
  return null;
}
