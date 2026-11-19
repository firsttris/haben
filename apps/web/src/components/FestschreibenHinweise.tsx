import { formatDate } from "../lib/format.ts";
import { UstIdVorFestschreiben } from "./UstIdVorFestschreiben.tsx";

/**
 * Hinweise in der Rückfrage zum Festschreiben einer Rechnung: Rechnungsdatum vor der zuletzt festgeschriebenen und, bei
 * Reverse Charge oder innergemeinschaftlicher Lieferung, die Bestätigung der USt-IdNr. beim BZSt (ustId, #1385).
 * Eigene Komponente, damit InvoiceEditor nicht weiter wächst.
 */
export function FestschreibenHinweise({
  open,
  earlierThanLast,
  numberDate,
  ustId,
}: {
  open: boolean;
  earlierThanLast: { number: string; issueDate: string } | null;
  numberDate: string;
  ustId: { contactId: string; behandlung: "reverse_charge" | "ig_lieferung" } | null;
}) {
  return (
    <>
      {earlierThanLast && (
        <div className="banner banner-warn" role="status">
          Das Rechnungsdatum ({formatDate(numberDate)}) liegt vor der zuletzt festgeschriebenen Rechnung {earlierThanLast.number} vom{" "}
          {formatDate(earlierThanLast.issueDate)}.
        </div>
      )}
      {ustId && <UstIdVorFestschreiben open={open} contactId={ustId.contactId} behandlung={ustId.behandlung} />}
    </>
  );
}
