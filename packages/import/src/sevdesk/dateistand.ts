/*
 * Dateistand eines Belegs aus sevDesk (#345): Was erwartet Haben an Dateien, und was folgt, wenn der Abruf weniger liefert?
 *
 * Belegt in Buchhaltung 1.0 (test-fixtures/sevdesk/buchhaltung-1.0/dateistand.json, README dort):
 * - Ein Beleg nennt seine Datei nur in `document`. Weitere Anhänge nennt die API nicht (kein getDocuments, GET /Document
 *   mit dem Beleg als object oder baseObject ist leer).
 * - Ein leeres `document` unterscheidet sich in keinem Feld von einer entfernten Datei. Es beweist also nicht, dass es nie
 *   eine Datei gab; „ohne Datei“ bleibt offen, bis eine Person es in sevDesk geprüft und bestätigt hat.
 * - Jede fertige Rechnung und Gutschrift hat ein PDF (Eintrag mit baseObject in GET /Document). Ein fehlendes PDF ist
 *   deshalb immer ein fehlgeschlagener Abruf, nie „ohne Datei“.
 */

/** Was ein Beleg an Dateien mitbringen muss */
export type SevFileExpectation =
  /** Rechnung und Gutschrift: das PDF ist Pflicht */
  | { kind: "pdf" }
  /** Beleg mit `document`: genau diese Datei */
  | { kind: "verweis"; documentId: string }
  /** Beleg ohne `document`; aus einer Vorlage (origin) kann deren Datei folgen */
  | { kind: "keine"; templateId: string | null };

export function sevFileExpectation(kind: "invoice" | "creditnote" | "voucher", raw: object): SevFileExpectation {
  if (kind !== "voucher") return { kind: "pdf" };
  const { document, origin } = raw as { document?: unknown; origin?: { objectName?: unknown } | null };
  const documentId = refId(document);
  if (documentId) return { kind: "verweis", documentId };
  return { kind: "keine", templateId: origin?.objectName === "Voucher" ? refId(origin) : null };
}

/** Feststellung nach dem Abruf; null heißt: alles Erwartete ist da */
export interface SevFileFinding {
  state: "ohne_datei" | "abruf_fehlgeschlagen" | "anhang_fehlt";
  role: "pdf" | "xml" | "anhang" | null;
  sourceFileId: string | null;
  message: string;
}

export function sevFileFinding(
  expectation: SevFileExpectation,
  result: { main: boolean; mainError?: string | null; xmlError?: string | null },
): SevFileFinding | null {
  if (expectation.kind === "keine") {
    if (result.main) return null;
    return {
      state: "ohne_datei",
      role: null,
      sourceFileId: null,
      message: expectation.templateId
        ? `sevDesk nennt keine Datei; auch die Vorlage ${expectation.templateId} lieferte keine passende.`
        : "sevDesk nennt keine Datei. Das beweist nicht, dass es nie eine gab.",
    };
  }
  if (!result.main) {
    const reason = result.mainError ?? "sevDesk gab die Datei nicht heraus";
    return expectation.kind === "pdf"
      ? { state: "abruf_fehlgeschlagen", role: "pdf", sourceFileId: null, message: `PDF fehlt: ${reason}` }
      : { state: "abruf_fehlgeschlagen", role: "anhang", sourceFileId: expectation.documentId, message: `Datei ${expectation.documentId} fehlt: ${reason}` };
  }
  if (result.xmlError) return { state: "anhang_fehlt", role: "xml", sourceFileId: null, message: `XML der E-Rechnung fehlt: ${result.xmlError}` };
  return null;
}

function refId(ref: unknown): string | null {
  const id = (ref as { id?: unknown } | null | undefined)?.id;
  return id == null || id === "" ? null : String(id);
}
