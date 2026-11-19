import {
  computeInvoice,
  circleKey,
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
  type UnitLabel,
  usesCustomerNumber,
} from "@haben/core";
import { formatDate } from "../lib/format.ts";
import { parseLine, positionsFehler } from "../lib/editor-lines.ts";
import { invoiceTitle } from "../lib/invoice.ts";
import type { InvoiceEditorProps } from "./invoice-editor-types.ts";
import { parsePlanRows } from "./PaymentPlanFields.tsx";
import { parseSkontoRows } from "./SkontoFields.tsx";
import { previewCustomerNumber, previewNumber } from "./invoice-editor-number.ts";
import type { InvoiceEditorState } from "./use-invoice-editor-state.ts";

// Aus dem Eingabestand des Editors gerechnet, ohne React: Positionen und Abzüge, Nummer und Fälligkeit, Zahlung und Summen,
// Fehler je Feld (useInvoiceEditorFigures)

/** Gelesene Positionen, gewählte Abschläge und ihre Abzugspositionen, Steuer- und Preisart, Währung, Titel */
export function editorLines(state: InvoiceEditorState) {
  const { abschlaege, contactId, currency, deducts, keptDeductions, kind, lines, priceMode, quotes, taxTreatment, variant } = state;
  const parsed = lines.map(parseLine);
  const schluss = kind === "rechnung" && variant === "schluss";
  /** Abschlagsrechnungen des gewählten Kunden; schon gewählte bleiben sichtbar */
  const customerAbschlaege = abschlaege.filter((a) => a.contactId === contactId);
  const customerQuotes = quotes.filter((q) => q.contactId === contactId);
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
  return { parsed, schluss, customerAbschlaege, customerQuotes, deducted, special, grossPrices, currencyCode, foreign, amountLabel, deductionPreview, title };
}

/** Zahlungsziel, Fälligkeit, nächste Nummer und was an Datum und Nummer nicht stimmt */
export function editorNumber(state: InvoiceEditorState, contact: InvoiceEditorProps["contacts"][number] | null) {
  const {
    bundesland,
    corrects,
    initial,
    issueDate,
    lastFinalized,
    numberCounters,
    numberFormat,
    numberRunning,
    numberPerCustomer,
    paymentTermDays,
    quote,
    validUntil,
  } = state;
  const { contactId, kind, taxTreatment } = state;
  const term = Number(paymentTermDays);
  const termValid = Number.isInteger(term) && term >= 0 && term <= 120;
  const dueDate = invoiceDueDate(issueDate || initial.issueDate, termValid ? term : 0, bundesland);
  // Wie beim Festschreiben: Jahr und Monat aus dem Rechnungsdatum, nicht aus dem heutigen Tag
  const numberDate = issueDate || initial.issueDate;
  const circle = counterCircle(numberRunning, numberDate);
  // Der Kreis der Vorschau: Storno und Korrektur folgen dem Kreis des Originals, sonst beim Zähler je Kunde der
  // Kreis des gewählten Kunden (#1426)
  const circleContactId = corrects ? (corrects.numberContactId ?? null) : numberPerCustomer && contactId ? contactId : null;
  const nextNumber = previewNumber(numberFormat, numberDate, (numberCounters[circleKey(circle, circleContactId)] ?? 0) + 1, contact, corrects);
  // Dasselbe Problem wie in buyerIssues, aber live aus dem Formular: Bei einem neuen oder geänderten Entwurf steht sonst nichts da
  const customerNumberIssue = usesCustomerNumber(numberFormat) ? customerNumberProblem(previewCustomerNumber(contact, corrects)) : null;
  // Zu lang für DATEV (Belegfeld 1, 36 Zeichen): dasselbe hält das Festschreiben auf, Angebote exportiert DATEV nicht
  const numberLengthIssue = quote ? null : documentNumberLengthProblem(nextNumber);
  const earlierThanLast = !quote ? issueDateBeforeLastFinalized(lastFinalized, numberRunning, numberDate, circleContactId) : null;
  // Vor dem Festschreiben die USt-IdNr. beim BZSt bestätigen (#1385)
  const ustIdPruefen =
    kind === "rechnung" && (taxTreatment === "reverse_charge" || taxTreatment === "ig_lieferung") ? { contactId, behandlung: taxTreatment } : null;
  const validUntilOk = Boolean(validUntil) && validUntil >= (issueDate || initial.issueDate);
  return { term, termValid, dueDate, numberDate, nextNumber, customerNumberIssue, numberLengthIssue, earlierThanLast, ustIdPruefen, validUntilOk };
}

/** Zahlungsweg, Skonto, Rabatt, Summen, Zahlungsplan und Steuerhinweis */
export function editorPayment(
  state: InvoiceEditorState,
  { parsed, deductionPreview, grossPrices, foreign }: ReturnType<typeof editorLines>,
  term: number,
  termValid: boolean,
) {
  const {
    discountText,
    editable,
    exemptionReason,
    kind,
    kleinunternehmer,
    paidOn,
    paidVia,
    paymentMethod,
    planRows,
    quote,
    skontoRows,
    taxDetails,
    taxTreatment,
  } = state;
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
  return {
    lastschrift,
    alreadyPaid,
    paidPayment,
    skontoAllowed,
    skonto,
    skontoIssue,
    discount,
    discountIssue,
    previewGross,
    kindIssue,
    plan,
    planAmounts,
    planIssue,
    taxNote,
    taxIssues,
  };
}

/** Je Feld ein Satz, solange etwas nicht stimmt; Skonto, Rabatt, Art und Zahlungsplan zeigen ihren Fehler selbst */
export function editorFieldErrors(
  state: InvoiceEditorState,
  { validUntilOk, termValid }: ReturnType<typeof editorNumber>,
  payment: ReturnType<typeof editorPayment>,
): Record<string, string | null> {
  const { advanceType, contactId, issueDate, kind, lines, paidOn, paidVia, quote, serviceFrom, taxTreatment, variant } = state;
  const { alreadyPaid, skontoIssue, discountIssue, kindIssue, planIssue, taxIssues, taxNote } = payment;
  return {
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
  };
}
