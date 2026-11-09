import type { ReactNode } from "react";
import { customFooterRuns, footerValues, type LetterheadOptions } from "@haben/core";
import { FormattedRuns } from "./FormattedText.tsx";
import type { PreviewSeller } from "./InvoicePreview.tsx";

/** Fuß des Blatts wie im PDF (footerData): automatisch oder eigene Spalten; trägt das Briefpapier ihn selbst, entfällt er */
export function SheetFooter({ seller, options, needsVatId }: { seller: PreviewSeller; options: LetterheadOptions; needsVatId: boolean }) {
  if (seller.background && options.footerHidden) return null;
  const automaticFooter = [
    [seller.name || "[Firmenname]", seller.strasse, `${seller.plz} ${seller.ort}`.trim(), seller.email],
    [
      seller.bank,
      seller.kontoinhaber && seller.kontoinhaber !== seller.name && `Kontoinhaber ${seller.kontoinhaber}`,
      `IBAN ${seller.iban || "[IBAN]"}`,
      seller.bic && `BIC ${seller.bic}`,
    ],
    [seller.steuernummer && `Steuernummer ${seller.steuernummer}`, seller.ustId && `USt-IdNr. ${seller.ustId}`],
  ].map((column) => column.filter(Boolean));
  const footer: ReactNode[][] = options.footerColumns
    ? customFooterRuns(options.footerColumns, footerValues(seller), { needsVatId }).map((column) =>
        column.map((runs, index) => <FormattedRuns key={index} runs={runs} />),
      )
    : automaticFooter;
  return (
    <div className="sheet-foot" style={{ gridTemplateColumns: `repeat(${footer.length}, minmax(0, 1fr))` }}>
      {footer.map((column, index) => (
        <div key={index}>
          {column.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      ))}
      {seller.legal && <div className="sheet-foot-legal">{seller.legal}</div>}
    </div>
  );
}
