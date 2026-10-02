/** Liest das TransferTicket aus der Serverantwort. */
export function parseTransferTicket(serverResponseXml: string): string | undefined {
  const match = /<(?:\w+:)?TransferTicket>\s*([^<]*?)\s*<\/(?:\w+:)?TransferTicket>/.exec(serverResponseXml);
  return match?.[1] || undefined;
}
