import {
  computeInvoice,
  counterCircle,
  documentDiscountProblem,
  customerNumberProblem,
  documentNumberLengthProblem,
  invoiceDueDate,
  issueDateBeforeLastFinalized,
  orderRateAmounts,
  outgoingTaxIssues,
  parseDiscount,
  planSchedule,
  quoteLineKindProblem,
  section4Note,
  skontoProblem,
  type TaxTreatment,
  type UnitLabel,
  usesCustomerNumber,
} from "@haben/core";
import { useMemo } from "react";
import { formatDate } from "../lib/format.ts";
import { useSubmitCheck } from "../lib/use-submit-check.ts";
import { parseLine, positionsFehler } from "../lib/editor-lines.ts";
import { invoiceTitle } from "../lib/invoice.ts";
import type { ContactChoice } from "./ContactCombobox.tsx";
import type { SavedContact } from "./ContactForm.tsx";
import { parsePlanRows } from "./PaymentPlanFields.tsx";
import { parseSkontoRows, toSkontoRows } from "./SkontoFields.tsx";
import { previewCustomerNumber, previewNumber } from "./invoice-editor-number.ts";
import type { InvoiceEditorState } from "./use-invoice-editor-state.ts";

// Aus dem Eingabestand abgeleitet: Summen, Nummer, Fälligkeit, Prüfung der Felder; dazu die Auswahl, die weitere Felder mitsetzt

export function useInvoiceEditorFigures(state: InvoiceEditorState) {
  const {
    abschlaege,
    advanceType,
    bundesland,
    companySkonto,
    contactId,
    contacts,
    corrects,
    currency,
    deducts,
    discountText,
    editable,
    exemptionReason,
    initial,
    issueDate,
    keptDeductions,
    kind,
    kleinunternehmer,
    lastFinalized,
    lines,
    mandates,
    numberCounters,
    numberFormat,
    numberRunning,
    paidOn,
    paidVia,
    paymentMethod,
    paymentTermDays,
    planRows,
    priceMode,
    quote,
    quoteId,
    quotes,
    serviceFrom,
    setAttempted,
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
    skontoRows,
    taxDetails,
    taxTreatment,
    touch,
    validUntil,
    variant,
  } = state;
  const contact = contacts.find((c) => c.id === contactId) ?? null;
  const contactChoices: ContactChoice[] = useMemo(
    () => contacts.map((c) => ({ id: c.id, name: c.name, ort: c.ort, nummer: c.kundennummer, ustId: c.ustId, isCustomer: c.isCustomer, isSupplier: false })),
    [contacts],
  );
  const parsed = lines.map(parseLine);
  const schluss = kind === "rechnung" && variant === "schluss";
  /** Abschlagsrechnungen des gewählten Kunden; schon gewählte bleiben sichtbar */
  const customerAbschlaege = abschlaege.filter((a) => a.contactId === contactId);
  const customerQuotes = quotes.filter((q) => q.contactId === contactId);
  /** Schlussrechnung zu einem Angebot: dessen Abschläge vorschlagen, sonst alle offenen des Kunden */
  const suggestedDeducts = (forQuote: string, forContact = contactId) =>
    abschlaege.filter((a) => a.contactId === forContact && (!forQuote || a.quoteId === forQuote)).map((a) => a.id);
  const deducted = schluss ? customerAbschlaege.filter((a) => deducts.includes(a.id)) : [];
  const special = taxTreatment !== "regulaer";
  /** Bruttopreise nur mit Steuerausweis; ohne sind netto und brutto gleich */
  const grossPrices = !special && priceMode === "brutto";
  const currencyCode = currency.trim().toUpperCase();
  const foreign = kind === "rechnung" && currencyCode !== "EUR";
  const amountLabel = grossPrices ? "Brutto" : "Netto";
  // Vorschau: je Abschlagsrechnung und Steuersatz eine negative Position, wie beim Speichern
  const deductionPreview = [
    ...deducted.flatMap((a) =>
      a.rates
        .filter((r) => r.base !== 0)
        .map((r) => ({
          description: `Abzüglich Abschlagsrechnung ${a.number} vom ${formatDate(a.issueDate)}`,
          quantity: 1000,
          unit: "Psch." as UnitLabel,
          unitPrice: -(grossPrices ? r.base + r.tax : r.base),
          taxRate: r.rate as 1900 | 700 | 0,
          valid: true,
          deductionOf: a.id,
        })),
    ),
    ...keptDeductions.map((line) => ({ ...line, valid: true })),
  ];
  const title = invoiceTitle(kind, variant);
  const term = Number(paymentTermDays);
  const termValid = Number.isInteger(term) && term >= 0 && term <= 120;
  const dueDate = invoiceDueDate(issueDate || initial.issueDate, termValid ? term : 0, bundesland);
  // Wie beim Festschreiben: Jahr und Monat aus dem Rechnungsdatum, nicht aus dem heutigen Tag
  const numberDate = issueDate || initial.issueDate;
  const circle = counterCircle(numberRunning, numberDate);
  const nextNumber = previewNumber(numberFormat, numberDate, (numberCounters[circle] ?? 0) + 1, contact, corrects);
  // Dasselbe Problem wie in buyerIssues, aber live aus dem Formular: Bei einem neuen oder geänderten Entwurf steht sonst nichts da
  const customerNumberIssue = usesCustomerNumber(numberFormat) ? customerNumberProblem(previewCustomerNumber(contact, corrects)) : null;
  // Zu lang für DATEV (Belegfeld 1, 36 Zeichen): dasselbe hält das Festschreiben auf, Angebote exportiert DATEV nicht
  const numberLengthIssue = quote ? null : documentNumberLengthProblem(nextNumber);
  const earlierThanLast = !quote ? issueDateBeforeLastFinalized(lastFinalized, numberRunning, numberDate) : null;
  const validUntilOk = Boolean(validUntil) && validUntil >= (issueDate || initial.issueDate);
  // Skonto nur auf Rechnungen in Euro, die der Kunde bezahlt; nicht auf Storno, Korrektur und Angebot
  const lastschrift = kind === "rechnung" && paymentMethod === "lastschrift";
  const alreadyPaid = kind === "rechnung" && paymentMethod === "bereits_bezahlt";
  const paidPayment = alreadyPaid && paidVia.trim() && paidOn ? { paidVia, paidOn } : null;
  // Skonto kommt bei Überweisung in Euro in Frage.
  const skontoAllowed = kind === "rechnung" && !foreign && paymentMethod === "ueberweisung";
  const skonto = parseSkontoRows(skontoAllowed ? skontoRows : []);
  const skontoIssue = !skonto.valid ? "Je Stufe einen Satz (z. B. 2) und eine Frist in Tagen angeben." : termValid ? skontoProblem(skonto.stufen, term) : null;
  const parsedDiscount = parseDiscount(discountText);
  const discount = parsedDiscount === "ungültig" ? null : parsedDiscount;
  // Optionale und alternative Positionen zählen nicht zur Summe, auch nicht für den Gesamtrabatt und den Zahlungsplan
  const counted = [...parsed.filter((l) => !quote || l.kind === null), ...deductionPreview].filter((l) => l.valid);
  const discountIssue =
    parsedDiscount === "ungültig" ? "Rabatt als Prozent (z. B. 5 %) oder Betrag (z. B. 100,00)" : documentDiscountProblem(counted, discount);
  const previewTotals = computeInvoice(counted, grossPrices ? "brutto" : "netto", discountIssue ? null : discount).totals;
  const previewGross = previewTotals.gross;
  const kindIssue = quote ? quoteLineKindProblem(parsed.map((l, i) => ({ position: i + 1, kind: l.kind }))) : null;
  const plan = parsePlanRows(quote ? planRows : []);
  const planAmounts = orderRateAmounts(previewTotals, grossPrices ? "brutto" : "netto");
  const planPreview = plan.valid && plan.rows.length > 0 ? planSchedule(plan.rows, planAmounts, grossPrices ? "brutto" : "netto") : [];
  const planIssue = !plan.valid || (plan.rows.length > 0 && planPreview.some((r) => r.rates.some((x) => x.amount < 0)));
  const taxNote = taxTreatment === "steuerfrei" ? (section4Note(taxDetails?.exemption) ?? exemptionReason) : exemptionReason;
  const taxIssues = editable ? outgoingTaxIssues(taxTreatment, taxDetails, kleinunternehmer) : [];
  // Je Feld ein Satz, solange etwas nicht stimmt; Skonto, Rabatt, Art und Zahlungsplan zeigen ihren Fehler selbst
  const { form, error, check } = useSubmitCheck({
    ...Object.fromEntries(lines.map((l) => [`pos-${l.key}`, positionsFehler(l)])),
    issueDate: issueDate ? null : "Wähle das Datum.",
    // Ohne Kunden lässt sich ein Entwurf speichern, aber nicht festschreiben und nicht als PDF ausgeben
    contact: contactId ? null : "Wähle den Kunden.",
    // Die Prüfung, ob die Teilleistung am Rechnungsdatum erbracht ist, bleibt beim Festschreiben am Server
    serviceFrom:
      kind === "rechnung" && variant === "abschlag" && advanceType === "teilleistung" && !serviceFrom
        ? "Wähle den Tag, an dem die Teilleistung erbracht wurde."
        : null,
    validUntil: quote && !validUntilOk ? "Wähle, bis wann das Angebot gilt, frühestens ab seinem Datum." : null,
    term: !quote && !alreadyPaid && !termValid ? "Trag das Zahlungsziel in ganzen Tagen von 0 bis 120 ein." : null,
    paidVia: alreadyPaid && !paidVia.trim() ? "Gib den Zahlungsdienstleister oder „bar“ an." : null,
    paidOn: alreadyPaid && !paidOn ? "Gib das Zahlungsdatum an." : null,
    skonto: skontoIssue,
    discount: discountIssue,
    kind: kindIssue,
    plan: planIssue ? "Zahlungsplan" : null,
    tax: taxIssues[0] ?? null,
    exemption: taxTreatment === "steuerfrei" && !taxNote.trim() ? "Trag die Befreiungsvorschrift ein, etwa § 4 Nr. 14 UStG." : null,
  } as Record<string, string | null>);
  /** Wie check, dazu die Markierungen an Positionen und Skonto, die bisher erst nach einem Versuch erschienen */
  const pruefe = (ohne: readonly string[] = []) => {
    setAttempted(true);
    return check(ohne);
  };

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

  return {
    alreadyPaid,
    amountLabel,
    chooseContact,
    chooseQuote,
    chooseTreatment,
    chooseVariant,
    contact,
    contactChoices,
    currencyCode,
    customerAbschlaege,
    customerNumberIssue,
    customerQuotes,
    deducted,
    deductionPreview,
    discount,
    discountIssue,
    dueDate,
    earlierThanLast,
    error,
    foreign,
    form,
    grossPrices,
    kindIssue,
    lastschrift,
    nextNumber,
    numberDate,
    numberLengthIssue,
    paidPayment,
    parsed,
    plan,
    planAmounts,
    planIssue,
    previewGross,
    pruefe,
    schluss,
    skonto,
    skontoAllowed,
    skontoIssue,
    special,
    taxNote,
    term,
    termValid,
    title,
    toggleDeduct,
    validUntilOk,
  };
}

export type InvoiceEditorFigures = InvoiceEditorState & ReturnType<typeof useInvoiceEditorFigures>;
