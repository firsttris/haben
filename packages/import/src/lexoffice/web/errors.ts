/** Die Sicherung aus der Web-Oberfläche ist unlesbar oder ein Beleg darin unvollständig; die Meldung ist für den Nutzer. */
export class LexwareWebExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LexwareWebExportError";
  }
}
