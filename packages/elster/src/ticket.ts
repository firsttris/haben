/** Liest das TransferTicket aus der Serverantwort. */
export function parseTransferTicket(serverResponseXml: string): string | undefined {
  const match = /<(?:\w+:)?TransferTicket>\s*([^<]*?)\s*<\/(?:\w+:)?TransferTicket>/.exec(serverResponseXml);
  return match?.[1] || undefined;
}

/**
 * Muster eines Transfertickets aus dem Übermittlungsprotokoll: Buchstaben und Ziffern, dazwischen Bindestrich und Punkt.
 * Ein Ticket steht dort so, wie ELSTER es vergeben hat; das Muster hält Tippfehler und eingefügte Leerzeichen fest.
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
