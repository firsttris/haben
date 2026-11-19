import { distinctVatRates, CURRENCY_CODE, formatEuro } from "@haben/core";
import { useRef } from "react";
import { formatDate } from "../lib/format.ts";
import { useLoadedState } from "../lib/use-loaded-state.ts";
import { ActionBar } from "./ActionBar.tsx";
import { DesignPanel, useDesignDraft } from "./DesignPanel.tsx";
import { PreviewButton, PreviewLayout, useDocumentPreview } from "./DocumentPreview.tsx";
import { Icon } from "./Icon.tsx";
import { InvoiceEditorPreview } from "./InvoiceEditorPreview.tsx";
import { useInvoiceCopy } from "./InvoiceCopyButton.tsx";
import { MoreActionsMenu } from "./MoreActionsMenu.tsx";
import { PaymentPlanFields } from "./PaymentPlanFields.tsx";
import { InvoiceEditorDetails } from "./InvoiceEditorDetails.tsx";
import { InvoiceEditorDialogs } from "./InvoiceEditorDialogs.tsx";
import { InvoiceEditorHead } from "./InvoiceEditorHead.tsx";
import { InvoiceEditorLines } from "./InvoiceEditorLines.tsx";
import type { InvoiceEditorProps } from "./invoice-editor-types.ts";
import { useInvoiceEditor } from "./use-invoice-editor.ts";

export type { AbschlagOption, EditorInitial, QuoteOption } from "./invoice-editor-types.ts";
export { previewNumber } from "./invoice-editor-number.ts";

export function InvoiceEditor(props: InvoiceEditorProps) {
  const editor = useInvoiceEditor(props);
  const {
    alreadyPaid,
    attachments,
    busy,
    contactId,
    copySource,
    contactPersonId,
    corrects,
    currencyCode,
    customerAbschlaege,
    deductionPreview,
    deducts,
    dirty,
    discount,
    discountIssue,
    dueDate,
    form,
    format,
    grossPrices,
    id,
    initial,
    intro,
    issueDate,
    kind,
    language,
    lastschrift,
    mandateId,
    nextNumber,
    note,
    onDraftPdf,
    onFinalize,
    onSave,
    paidPayment,
    parsed,
    plan,
    planAmounts,
    planInConfirmation,
    planIssue,
    planRows,
    planTemplates,
    prepareCopy,
    propertyRetention,
    quote,
    references,
    run,
    schluss,
    seller,
    serviceFrom,
    serviceTo,
    setConfirmingDelete,
    setPlanInConfirmation,
    setPlanRows,
    skonto,
    special,
    taxDetails,
    taxNote,
    taxTreatment,
    term,
    termValid,
    toggleDeduct,
    touch,
    validUntil,
    variant,
  } = editor;
  const barPreviewBtn = useRef<HTMLButtonElement>(null);
  const onCopy = useInvoiceCopy(copySource, { busy, run }, prepareCopy);
  const preview = useDocumentPreview();
  const designDraft = useDesignDraft(seller.design);
  const [logo, setLogo] = useLoadedState(seller.logo ?? null);

  return (
    <>
      <InvoiceEditorDialogs editor={editor} />
      <InvoiceEditorHead editor={editor} preview={preview} />

      <PreviewLayout
        preview={preview}
        design={{
          panel: <DesignPanel draft={designDraft} vatRates={distinctVatRates(parsed.filter((l) => l.valid))} logo={logo} onLogoChanged={setLogo} />,
          onClosed: designDraft.discard,
        }}
        label="Vorschau"
        caption={quote ? "PDF" : format === "zugferd" ? "PDF/A-3 mit eingebettetem XML" : "XRechnung (XML) mit PDF-Sichtkopie"}
        sheet={
          <InvoiceEditorPreview
            alreadyPaid={alreadyPaid}
            revision={logo}
            input={{
              kind,
              number: nextNumber,
              issueDate: issueDate || initial.issueDate,
              dueDate,
              validUntil: quote ? validUntil || null : null,
              serviceFrom: serviceFrom || null,
              serviceTo: serviceTo || null,
              paymentTermDays: termValid ? term : 0,
              contactId: contactId || null,
              contactPersonId: contactPersonId || null,
              ...references,
              lines: [...parsed, ...deductionPreview],
              discount: discountIssue ? null : discount,
              plan: planIssue ? [] : plan.rows,
              intro,
              note,
              propertyRetention: !quote && propertyRetention,
              taxTreatment,
              taxDetails,
              exemptionReason: special ? taxNote : "",
              priceMode: grossPrices ? "brutto" : "netto",
              language,
              variant: kind === "rechnung" ? variant : null,
              corrects: corrects ?? null,
              // Auch bei einer Korrektur: Sie übernimmt Währung und Kurs der Rechnung, nur ohne eigenes Feld dafür
              currency: currencyCode !== "EUR" && CURRENCY_CODE.test(currencyCode) ? currencyCode : "EUR",
              skonto: skonto.stufen,
              sepaMandateId: lastschrift ? mandateId || null : null,
              ...(paidPayment ? { paidPayment } : {}),
              design: designDraft.changes,
            }}
          />
        }
      >
        <form ref={form} id="invoice-form" className="stack" onSubmit={onSave} noValidate>
          <InvoiceEditorDetails editor={editor} />

          {schluss && (
            <section className="card" aria-labelledby="deducts-heading">
              <h2 id="deducts-heading">Abschlagsrechnungen abziehen</h2>
              {!contactId ? (
                <p className="small muted" style={{ margin: 0 }}>
                  Erst den Kunden wählen.
                </p>
              ) : customerAbschlaege.length === 0 ? (
                <p className="small muted" style={{ margin: 0 }}>
                  Für diesen Kunden gibt es keine offenen festgeschriebenen Abschlagsrechnungen.
                </p>
              ) : (
                customerAbschlaege.map((a) => (
                  <label key={a.id} className="checkbox">
                    <input type="checkbox" checked={deducts.includes(a.id)} onChange={(e) => toggleDeduct(a.id, e.target.checked)} />
                    <span>
                      Abschlagsrechnung {a.number} vom {formatDate(a.issueDate)} · {formatEuro(a.gross)}
                    </span>
                  </label>
                ))
              )}
              <p className="small muted" style={{ margin: 0 }}>
                Unter Positionen steht die gesamte Leistung. Die Abzüge erscheinen auf der Rechnung als eigene Positionen mit Netto und Umsatzsteuer der
                Abschlagsrechnung (§ 14 Abs. 5 UStG).
              </p>
            </section>
          )}

          <InvoiceEditorLines editor={editor} />

          {quote && (
            <section className="card" aria-labelledby="plan-heading">
              <h2 id="plan-heading">Zahlungsplan</h2>
              <p className="small muted" style={{ margin: 0 }}>
                Optional: in welchen Teilen der Auftrag abgerechnet wird, etwa 30 % bei Auftragserteilung, 40 % bei Lieferung und der Rest mit der
                Schlussrechnung. Der Plan steht im Angebots-PDF; aus jeder Zeile entsteht später mit einem Klick die Abschlagsrechnung.
              </p>
              <PaymentPlanFields
                id="quote-plan"
                rows={planRows}
                onChange={touch(setPlanRows)}
                templates={planTemplates}
                amounts={planAmounts}
                priceMode={grossPrices ? "brutto" : "netto"}
                taxed={!special}
              />
              {planRows.length > 0 && (
                <label className="checkbox">
                  <input type="checkbox" checked={planInConfirmation} onChange={(e) => touch(setPlanInConfirmation)(e.target.checked)} />
                  <span>Zahlungsplan auch in der Auftragsbestätigung</span>
                </label>
              )}
            </section>
          )}

          {attachments}

          <div className="banner banner-info">
            <Icon name="info" />
            <span>
              {quote
                ? "Nach dem Festschreiben bekommt das Angebot seine Nummer und ist nicht mehr änderbar. Nimmt der Kunde an, machst du daraus mit einem Klick eine Rechnung."
                : "Nach dem Festschreiben bekommt die Rechnung ihre endgültige Nummer und ist nicht mehr änderbar. Korrekturen laufen über eine Stornorechnung oder Rechnungskorrektur."}
            </span>
          </div>
          {id && (
            <div className="actions">
              <button type="button" className="btn btn-danger" onClick={() => setConfirmingDelete(true)} disabled={busy}>
                Entwurf löschen
              </button>
            </div>
          )}
        </form>
      </PreviewLayout>
      <ActionBar>
        <MoreActionsMenu
          items={[
            {
              key: "pdf",
              label: dirty ? "Speichern und als PDF" : "Entwurf als PDF",
              icon: "invoice",
              disabled: busy,
              onSelect: onDraftPdf,
            },
            // Am Handy ist die Leiste mit Vorschau, Speichern und Festschreiben voll; im Seitenkopf steht der Knopf
            ...(onCopy ? [{ key: "kopieren", label: "Kopieren", icon: "plus" as const, disabled: busy, onSelect: onCopy }] : []),
          ]}
        />
        {/* triggerRef bleibt der Knopf im Kopf: Anheften, Ausblenden und Schließen geben den Fokus dorthin zurück, und
            anheften lässt sich nur am Laptop. Die Überblendung am Handy merkt sich den Knopf in der Leiste als Auslöser;
            Safari fokussiert Knöpfe beim Tippen nicht, deshalb hier ausdrücklich */}
        <PreviewButton
          preview={{
            ...preview,
            triggerRef: barPreviewBtn,
            openOverlay: () => {
              barPreviewBtn.current?.focus({ preventScroll: true });
              preview.openOverlay();
            },
          }}
        />
        <button type="submit" form="invoice-form" className="btn" disabled={busy || !dirty}>
          Entwurf speichern
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onFinalize}>
          Festschreiben
        </button>
      </ActionBar>
    </>
  );
}
