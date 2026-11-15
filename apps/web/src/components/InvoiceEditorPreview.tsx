import { renderDocumentPreview } from "../server/functions/invoices.ts";
import type { DocumentPreviewInput } from "../server/modules/rechnungen/index.ts";
import { RenderedSheet } from "./RenderedSheet.tsx";

type EditorPreviewInput = Omit<DocumentPreviewInput, "lines"> & {
  lines: (DocumentPreviewInput["lines"][number] & { valid: boolean })[];
};

export function InvoiceEditorPreview({ input, alreadyPaid, revision }: { input: EditorPreviewInput; alreadyPaid: boolean; revision: string | null }) {
  if (alreadyPaid && !input.paidPayment) {
    return (
      <p className="muted" role="status">
        Gib für die Vorschau an, wann und wie die Rechnung bezahlt wurde.
      </p>
    );
  }

  const quote = input.kind === "angebot";
  const lines = input.lines
    .filter((line) => line.valid)
    .map(({ description, detail, itemNumber, quantity, unit, unitPrice, taxRate, discount, kind, deductionOf }) => ({
      description,
      detail: detail ?? "",
      itemNumber: itemNumber ?? "",
      quantity,
      unit,
      unitPrice,
      taxRate,
      discount: discount ?? null,
      kind: quote ? (kind ?? null) : null,
      ...(deductionOf ? { deductionOf } : {}),
    }));
  return (
    <RenderedSheet
      label={quote ? "Vorschau des Angebots" : "Vorschau der Rechnung"}
      render={renderDocumentPreview}
      revision={revision}
      input={{ ...input, lines }}
    />
  );
}
