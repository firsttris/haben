/** Die Datei ist kein unterstützter Kontoauszug oder ist beschädigt. */
export class StatementParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementParseError";
  }
}
