import { Link } from "@tanstack/react-router";
import { Icon } from "./Icon.tsx";
import { InvoiceCopyButton } from "./InvoiceCopyButton.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { PreviewButton, type DocumentPreview } from "./DocumentPreview.tsx";
import type { InvoiceEditorModel } from "./use-invoice-editor.ts";

// Kopf des Editors mit Titel und Knöpfen, darunter die Hinweise vor dem Festschreiben

export function InvoiceEditorHead({ editor, preview }: { editor: InvoiceEditorModel; preview: DocumentPreview }) {
  const {
    alreadyPaid,
    busy,
    copySource,
    customerNumberIssue,
    dirty,
    issues,
    kind,
    letterIssues,
    nextNumber,
    notice,
    numberLengthIssue,
    onDraftPdf,
    onFinalize,
    prepareCopy,
    quote,
    run,
    sellerIssues,
    title,
  } = editor;
  const currentSellerIssues = alreadyPaid || (!quote && kind !== "rechnung") ? sellerIssues.filter((i) => i !== "IBAN fehlt") : sellerIssues;
  const blocking = [
    ...new Set([
      ...currentSellerIssues.map((i) => `Firmendaten: ${i}`),
      ...(customerNumberIssue ? [customerNumberIssue.replace(/\.$/, "")] : []),
      ...(numberLengthIssue ? [numberLengthIssue.replace(/\.$/, "")] : []),
      ...(dirty ? [] : issues.filter((i) => !i.startsWith("Firmendaten"))),
    ]),
  ];
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{quote ? <Link to="/angebote">Angebote</Link> : <Link to="/rechnungen">Rechnungen</Link>} › Entwurf</div>
          <h1>
            {title} {nextNumber}
          </h1>
        </div>
        <div className="actions editor-actions">
          <PreviewButton preview={preview} />
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={onDraftPdf}
            title="PDF mit dem Vermerk ENTWURF, ohne Nummer; es wird nichts gebucht oder versendet"
          >
            {dirty ? "Speichern und als PDF" : "Entwurf als PDF"}
          </button>
          <button type="submit" form="invoice-form" className="btn" disabled={busy || !dirty}>
            Entwurf speichern
          </button>
          <InvoiceCopyButton invoice={copySource} action={{ busy, run }} prepare={prepareCopy} />
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onFinalize}>
            Festschreiben
          </button>
        </div>
      </div>

      {blocking.length > 0 && (
        <div className="banner" role="status">
          <Icon name="alert" />
          <span>
            Vor dem Festschreiben: {blocking.join(", ")}.{" "}
            {currentSellerIssues.length > 0 && (
              <Link to="/einstellungen" search={{ bereich: "firma" }}>
                Firmendaten ergänzen
              </Link>
            )}
          </span>
        </div>
      )}
      {letterIssues.length > 0 && (
        <div className="banner" role="status" id="letter-issues">
          <Icon name="alert" />
          <span>
            Pflichtangaben für Geschäftsbriefe unvollständig (§ 35a GmbHG): {letterIssues.join(", ")}. Festschreiben geht trotzdem, der Fuß nennt dann nur, was
            eingetragen ist.{" "}
            <Link to="/einstellungen" search={{ bereich: "firma" }} hash="company-register">
              Firmendaten ergänzen
            </Link>
          </span>
        </div>
      )}
      <NoticeBanner notice={notice} />
    </>
  );
}
