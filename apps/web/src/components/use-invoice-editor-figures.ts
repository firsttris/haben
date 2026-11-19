import type { TaxTreatment } from "@haben/core";
import { useMemo } from "react";
import { useSubmitCheck } from "../lib/use-submit-check.ts";
import type { ContactChoice } from "./ContactCombobox.tsx";
import type { SavedContact } from "./ContactForm.tsx";
import { toSkontoRows } from "./SkontoFields.tsx";
import { editorFieldErrors, editorLines, editorNumber, editorPayment } from "./invoice-editor-figures.ts";
import type { InvoiceEditorState } from "./use-invoice-editor-state.ts";

// Aus dem Eingabestand abgeleitet: Summen, Nummer, Fälligkeit, Prüfung der Felder; dazu die Auswahl, die weitere Felder mitsetzt

export function useInvoiceEditorFigures(state: InvoiceEditorState) {
  const { contactId, contacts, setAttempted } = state;
  const contact = contacts.find((c) => c.id === contactId) ?? null;
  const contactChoices: ContactChoice[] = useMemo(
    () => contacts.map((c) => ({ id: c.id, name: c.name, ort: c.ort, nummer: c.kundennummer, ustId: c.ustId, isCustomer: c.isCustomer, isSupplier: false })),
    [contacts],
  );
  const lineFigures = editorLines(state);
  const number = editorNumber(state, contact);
  const payment = editorPayment(state, lineFigures, number.term, number.termValid);
  const { form, error, check } = useSubmitCheck(editorFieldErrors(state, number, payment));
  /** Wie check, dazu die Markierungen an Positionen und Skonto, die bisher erst nach einem Versuch erschienen */
  const pruefe = (ohne: readonly string[] = []) => {
    setAttempted(true);
    return check(ohne);
  };
  const choices = editorChoices(state, lineFigures.schluss, payment.lastschrift, number);

  return { contact, contactChoices, ...lineFigures, ...number, ...payment, form, error, pruefe, ...choices };
}

export type InvoiceEditorFigures = InvoiceEditorState & ReturnType<typeof useInvoiceEditorFigures>;

/** Auswahl, die weitere Felder mitsetzt: Steuer, Kunde, Art, Angebot und abgezogene Abschläge */
function editorChoices(state: InvoiceEditorState, schluss: boolean, lastschrift: boolean, { term, termValid }: { term: number; termValid: boolean }) {
  const { abschlaege, companySkonto, contactId, contacts, deducts, kind, mandates, quoteId, quotes, touch } = state;
  const {
    setContactId,
    setContactPersonId,
    setDeducts,
    setFormat,
    setLanguage,
    setLines,
    setMandateId,
    setQuoteId,
    setSkontoRows,
    setTaxTreatment,
    setVariant,
  } = state;
  /** Schlussrechnung zu einem Angebot: dessen Abschläge vorschlagen, sonst alle offenen des Kunden */
  const suggestedDeducts = (forQuote: string, forContact = contactId) =>
    abschlaege.filter((a) => a.contactId === forContact && (!forQuote || a.quoteId === forQuote)).map((a) => a.id);

  function chooseTreatment(value: TaxTreatment) {
    touch(setTaxTreatment)(value);
    // Ohne Steuerausweis stehen alle Positionen auf 0 %
    if (value !== "regulaer") setLines((prev) => prev.map((line) => ({ ...line, taxRate: 0 })));
  }

  /** saved: gerade im Dialog angelegt, steht also noch nicht in contacts */
  function chooseContact(value: string, saved?: SavedContact) {
    touch(setContactId)(value);
    // Ein Ansprechpartner gehört zu genau einem Kunden
    if (value !== contactId) setContactPersonId("");
    const chosen = saved ?? contacts.find((c) => c.id === value);
    if (chosen?.defaultFormat) setFormat(chosen.defaultFormat);
    else if (chosen?.leitwegId) setFormat("xrechnung-cii");
    if (chosen) setLanguage(chosen.language ?? "de");
    // Skonto des Kunden, sonst aus den Firmendaten; Fristen über das Zahlungsziel hinaus entfallen (wie defaultSkonto)
    if (chosen && kind === "rechnung") {
      setSkontoRows(toSkontoRows((chosen.skonto ?? companySkonto).filter((s) => !termValid || s.days <= term)));
    }
    // Ein Mandat gehört zu genau einem Kunden: das jüngste gültige des neuen
    if (lastschrift) setMandateId(mandates.find((m) => m.contactId === value)?.id ?? "");
    // Ein Angebot gehört zu genau einem Kunden
    const keptQuote = quotes.some((q) => q.id === quoteId && q.contactId === value) ? quoteId : "";
    setQuoteId(keptQuote);
    // Schlussrechnung: alle offenen Abschläge des neuen Kunden (bzw. des Angebots) vorschlagen
    setDeducts(suggestedDeducts(keptQuote, value));
  }

  function chooseVariant(value: "abschlag" | "schluss" | null) {
    touch(setVariant)(value);
    if (value === "schluss" && deducts.length === 0) setDeducts(suggestedDeducts(quoteId));
  }

  function chooseQuote(value: string) {
    touch(setQuoteId)(value);
    if (schluss) setDeducts(suggestedDeducts(value));
  }

  function toggleDeduct(abschlagId: string, on: boolean) {
    touch(setDeducts)(on ? [...deducts, abschlagId] : deducts.filter((d) => d !== abschlagId));
  }

  return { chooseContact, chooseQuote, chooseTreatment, chooseVariant, toggleDeduct };
}
