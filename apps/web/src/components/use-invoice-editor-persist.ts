import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { FormEvent } from "react";
import { downloadFrom } from "../lib/download.ts";
import type { UmsatzgrenzeBestaetigung } from "../lib/kleinunternehmer.ts";
import { finalizeInvoiceDraft, removeInvoiceDraft, saveInvoiceDraft } from "../server/functions/invoices.ts";
import { finalizeQuoteDraft, removeQuoteDraft, saveQuoteDraft } from "../server/functions/quotes.ts";
import type { DraftInput } from "../server/modules/rechnungen/index.ts";
import type { InvoiceEditorFigures } from "./use-invoice-editor-figures.ts";

// Speichern, Festschreiben, Entwurf als PDF, Kopieren und Löschen

export function useInvoiceEditorPersist(editor: InvoiceEditorFigures) {
  const { dirty, id, initialId, kind, pruefe, quote, reload, run, setDirty, setNotice, variant } = editor;
  const navigate = useNavigate();
  const save = useServerFn(saveInvoiceDraft);
  const remove = useServerFn(removeInvoiceDraft);
  const saveQuote = useServerFn(saveQuoteDraft);
  const removeQuote = useServerFn(removeQuoteDraft);

  const draft = () => draftInput(editor);

  async function persist(): Promise<string> {
    const result = quote ? await saveQuote({ data: { id, draft: quoteDraftInput(editor) } }) : await save({ data: { id, draft: draft() } });
    setDirty(false);
    return result.id;
  }

  const openSaved = (savedId: string) =>
    quote ? navigate({ to: "/angebote/$id", params: { id: savedId } }) : navigate({ to: "/rechnungen/$id", params: { id: savedId } });

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    if (!pruefe(["contact"])) return;
    void run(async () => {
      const savedId = await persist();
      if (initialId === null) {
        await openSaved(savedId);
      } else {
        await reload();
        setNotice({ tone: "ok", text: "Entwurf gespeichert." });
      }
    });
  };

  const { onFinalize, finalizeNow, finalizeSaved } = useInvoiceEditorFinalize(editor, persist, openSaved);

  // Entwurf als PDF aus dem gespeicherten Stand: Ungespeichertes erst speichern, damit das PDF zeigt, was im Formular steht
  const onDraftPdf = () => {
    if (!pruefe()) return;
    void run(async () => {
      const saving = dirty || id === null;
      const savedId = saving ? await persist() : id;
      await downloadFrom(`/api/entwurf/${quote ? "angebot" : "rechnung"}/${savedId}?download`, quote ? "Angebot-Entwurf.pdf" : "Rechnung-Entwurf.pdf");
      if (initialId === null) {
        await openSaved(savedId);
      } else if (saving) {
        await reload();
        setNotice({ tone: "ok", text: "Entwurf gespeichert, das PDF ist heruntergeladen." });
      }
    });
  };

  // Kopieren aus dem gespeicherten Stand wie beim PDF: Ungespeichertes erst speichern, damit die Kopie zeigt, was im Formular steht
  // Nur ein gespeicherter Rechnungsentwurf; ob die Art sich kopieren lässt, entscheidet useInvoiceCopy
  const copySource = !quote && initialId ? { id: initialId, kind, variant } : null;
  const prepareCopy = async () => {
    if (!pruefe()) return null;
    return dirty ? persist() : initialId;
  };

  const deleteNow = () => {
    void run(async () => {
      if (id) await (quote ? removeQuote({ data: id }) : remove({ data: id }));
      await (quote ? navigate({ to: "/angebote" }) : navigate({ to: "/rechnungen" }));
    });
  };

  return { deleteNow, draft, finalizeNow, finalizeSaved, onDraftPdf, onFinalize, onSave, copySource, prepareCopy };
}

/** Festschreiben, bei Rechnungen mit der Rückfrage zur Kleinunternehmergrenze */
function useInvoiceEditorFinalize(editor: InvoiceEditorFigures, persist: () => Promise<string>, openSaved: (savedId: string) => Promise<void>) {
  const { dirty, id, initialId, pruefe, quote, reload, run, setConfirming, setNeuerEntwurf, setUmsatzwarnung } = editor;
  const finalize = useServerFn(finalizeInvoiceDraft);
  const finalizeQuote = useServerFn(finalizeQuoteDraft);

  const onFinalize = () => {
    if (pruefe()) setConfirming(true);
  };

  const finalizeNow = () => {
    void run(async () => {
      const savedId = dirty || id === null ? await persist() : id;
      if (quote) {
        await finalizeQuote({ data: savedId });
        if (initialId === null) await openSaved(savedId);
        else await reload();
        return;
      }
      if (initialId === null) setNeuerEntwurf(savedId);
      await finalizeSaved(savedId);
    });
  };

  async function finalizeSaved(savedId: string, bestaetigt?: UmsatzgrenzeBestaetigung) {
    const result = await finalize({ data: { id: savedId, bestaetigt } });
    if (result.status === "umsatzgrenze") {
      setUmsatzwarnung(result);
      return;
    }
    if (initialId === null) await openSaved(result.id);
    else await reload();
  }

  return { onFinalize, finalizeNow, finalizeSaved };
}

/** Entwurf einer Rechnung, wie ihn saveInvoiceDraft speichert */
function draftInput(editor: InvoiceEditorFigures): DraftInput {
  const { advanceType, alreadyPaid, contactId, contactPersonId, currencyCode, deducted, discount, exchangeRate, exchangeRateDate, foreign } = editor;
  const { format, grossPrices, initial, intro, issueDate, kind, language, lastschrift, mandateId, note, paidOn, paidVia, parsed } = editor;
  const { paymentMethod, propertyRetention, quote, quoteId, references, schluss, serviceFrom, serviceTo, skonto, special } = editor;
  const { taxDetails, taxNote, taxTreatment, term, termValid, variant } = editor;
  return {
    contactId: contactId || null,
    contactPersonId: contactPersonId || null,
    issueDate,
    serviceFrom: serviceFrom || null,
    serviceTo: serviceTo || null,
    paymentTermDays: termValid ? term : initial.paymentTermDays,
    skonto: skonto.stufen,
    format,
    intro,
    note,
    propertyRetention: !quote && propertyRetention,
    ...references,
    taxTreatment,
    taxDetails,
    exemptionReason: special ? taxNote : "",
    priceMode: grossPrices ? "brutto" : "netto",
    language,
    variant: kind === "rechnung" ? variant : null,
    advanceType: kind === "rechnung" && variant === "abschlag" ? advanceType : null,
    deducts: schluss ? deducted.map((a) => a.id) : [],
    quoteId: kind === "rechnung" && quoteId ? quoteId : null,
    currency: currencyCode,
    exchangeRate: foreign && exchangeRate.trim() ? exchangeRate : null,
    exchangeRateDate: foreign && exchangeRate.trim() && exchangeRateDate ? exchangeRateDate : null,
    discount,
    paymentMethod: kind === "rechnung" ? paymentMethod : "ueberweisung",
    sepaMandateId: lastschrift ? mandateId || null : null,
    paidVia: alreadyPaid ? paidVia : null,
    paidOn: alreadyPaid ? paidOn || null : null,
    lines: parsed.filter((l) => l.valid).map(({ valid: _valid, discountError: _error, kind: _kind, ...line }) => line),
  };
}

/** Entwurf eines Angebots: der Rechnungsentwurf ohne Zahlungsangaben, mit Gültigkeit und Zahlungsplan */
function quoteDraftInput(editor: InvoiceEditorFigures) {
  const { parsed, plan, planInConfirmation, validUntil } = editor;
  const {
    paymentTermDays: _term,
    skonto: _skonto,
    format: _format,
    currency: _currency,
    exchangeRate: _rate,
    exchangeRateDate: _rateDate,
    quoteId: _quote,
    paymentMethod: _method,
    sepaMandateId: _mandate,
    paidVia: _paidVia,
    paidOn: _paidOn,
    propertyRetention: _propertyRetention,
    ...common
  } = draftInput(editor);
  const quoteLines = parsed.filter((l) => l.valid).map(({ valid: _valid, discountError: _error, ...line }) => line);
  return { ...common, lines: quoteLines, validUntil, paymentPlan: plan.rows, paymentPlanInConfirmation: plan.rows.length > 0 && planInConfirmation };
}
