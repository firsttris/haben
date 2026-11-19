import { discountInput, type InvoicePaymentMethod, type OutgoingTaxDetails, type PriceMode, type TaxTreatment } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useAction } from "../lib/use-action.ts";
import type { UmsatzgrenzeBestaetigung } from "../lib/kleinunternehmer.ts";
import { type LineState, toLineState } from "../lib/editor-lines.ts";
import type { ArticlePrefill } from "./ArticleForm.tsx";
import { orderReferenceValues } from "./OrderReferenceFields.tsx";
import { toPlanRows } from "./PaymentPlanFields.tsx";
import { toSkontoRows } from "./SkontoFields.tsx";
import type { InvoiceEditorProps } from "./invoice-editor-types.ts";

// Eingabestand des Editors: Props mit Vorgaben, Felder, Dialoge und die Markierung „geändert“

export function useInvoiceEditorState(props: InvoiceEditorProps) {
  const { id: initialId, kind, initial, action: sharedAction } = props;
  const [neuerEntwurf, setNeuerEntwurf] = useState<string | null>(null);
  const id = initialId ?? neuerEntwurf;
  const router = useRouter();
  /**
   * Neu laden und warten, bis der neue Stand angezeigt wird. Ohne `sync` endet invalidate schon mit den alten Daten und
   * lädt im Hintergrund nach; die Seite baut den Editor danach mit dem neuen `updatedAt` neu auf und verwirft, was
   * inzwischen geschah, etwa den Dialog von „Festschreiben“. So bleiben die Knöpfe gesperrt, bis der Editor neu steht
   */
  const reload = () => router.invalidate({ sync: true });
  const quote = kind === "angebot";
  /** Rechnung oder Angebot, an dem Kunde und Steuer noch frei wählbar sind */
  const editable = kind === "rechnung" || quote;

  const kopf = useKopfFelder(initial);
  const steuer = useSteuerFelder(initial);
  const zahlung = useZahlungFelder(initial);
  const { setLines } = zahlung;
  const [dirty, setDirty] = useState(id === null);
  /** Fehler einer Position erst zeigen, wenn sie verlassen oder gespeichert wurde, nicht schon beim Öffnen */
  const [touched, setTouched] = useState<Set<number>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const showError = (key: number) => attempted || touched.has(key);
  const markTouched = (key: number) => setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  const ownAction = useAction();
  const { busy, notice, setNotice, run } = sharedAction ?? ownAction;
  const [confirming, setConfirming] = useState(false);
  const [umsatzwarnung, setUmsatzwarnung] = useState<({ id: string } & UmsatzgrenzeBestaetigung) | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function touch<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
    };
  }

  function updateLine(key: number, patch: Partial<LineState>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    setDirty(true);
  }

  return {
    ...editorProps(props),
    ...kopf,
    ...steuer,
    ...zahlung,
    id,
    initialId,
    reload,
    quote,
    editable,
    dirty,
    setDirty,
    attempted,
    setAttempted,
    showError,
    markTouched,
    busy,
    notice,
    setNotice,
    run,
    confirming,
    setConfirming,
    umsatzwarnung,
    setUmsatzwarnung,
    confirmingDelete,
    setConfirmingDelete,
    setNeuerEntwurf,
    touch,
    updateLine,
  };
}

export type InvoiceEditorState = ReturnType<typeof useInvoiceEditorState>;

/** Props des Editors mit ihren Vorgaben, ohne id und action */
function editorProps({
  kind,
  initial,
  contacts,
  seller,
  sellerIssues,
  letterIssues = [],
  issues,
  numberCounters,
  numberFormat,
  numberRunning = false,
  numberPerCustomer = false,
  lastFinalized = {},
  corrects,
  bundesland,
  kleinunternehmer,
  articles = [],
  textBlocks = [],
  units = [],
  abschlaege = [],
  quotes = [],
  tageskurs = false,
  rateInfo = null,
  companySkonto = [],
  attachments = null,
  planTemplates = [],
  mandates = [],
  contactPersons = [],
  keptDeductions = [],
}: InvoiceEditorProps) {
  return {
    kind,
    initial,
    contacts,
    seller,
    sellerIssues,
    letterIssues,
    issues,
    numberCounters,
    numberFormat,
    numberRunning,
    numberPerCustomer,
    lastFinalized,
    corrects,
    bundesland,
    kleinunternehmer,
    articles,
    textBlocks,
    units,
    abschlaege,
    quotes,
    tageskurs,
    rateInfo,
    companySkonto,
    attachments,
    planTemplates,
    mandates,
    contactPersons,
    keptDeductions,
  };
}

/** Kunde, Daten, Format, Texte und Bezüge; dazu die Dialoge „Neuer Kunde“ und „Neuer Artikel“ */
function useKopfFelder(initial: InvoiceEditorProps["initial"]) {
  const [contactId, setContactId] = useState(initial.contactId ?? "");
  const [contactPersonId, setContactPersonId] = useState(initial.contactPersonId ?? "");
  /** Offener Dialog „Neuer Kunde“ mit dem vorgetragenen Namen; null = geschlossen */
  const [newContactName, setNewContactName] = useState<string | null>(null);
  /** Offener Dialog „Neuer Artikel“ und die Position, die ihn danach übernimmt */
  const [newArticle, setNewArticle] = useState<{ lineKey: number; prefill: ArticlePrefill } | null>(null);
  const [issueDate, setIssueDate] = useState(initial.issueDate);
  const [serviceFrom, setServiceFrom] = useState(initial.serviceFrom ?? "");
  const [serviceTo, setServiceTo] = useState(initial.serviceTo ?? "");
  const [paymentTermDays, setPaymentTermDays] = useState(String(initial.paymentTermDays));
  const [validUntil, setValidUntil] = useState(initial.validUntil ?? "");
  const [format, setFormat] = useState(initial.format);
  const [intro, setIntro] = useState(initial.intro ?? "");
  const [references, setReferences] = useState(() => orderReferenceValues(initial));
  const [note, setNote] = useState(initial.note);
  const [propertyRetention, setPropertyRetention] = useState(initial.propertyRetention ?? false);
  return {
    contactId,
    setContactId,
    contactPersonId,
    setContactPersonId,
    newContactName,
    setNewContactName,
    newArticle,
    setNewArticle,
    issueDate,
    setIssueDate,
    serviceFrom,
    setServiceFrom,
    serviceTo,
    setServiceTo,
    paymentTermDays,
    setPaymentTermDays,
    validUntil,
    setValidUntil,
    format,
    setFormat,
    intro,
    setIntro,
    references,
    setReferences,
    note,
    setNote,
    propertyRetention,
    setPropertyRetention,
  };
}

/** Steuer, Preise, Sprache, Währung, Abschläge und Angebot */
function useSteuerFelder(initial: InvoiceEditorProps["initial"]) {
  const [taxTreatment, setTaxTreatment] = useState<TaxTreatment>(initial.taxTreatment ?? "regulaer");
  const [priceMode, setPriceMode] = useState<PriceMode>(initial.priceMode ?? "netto");
  const [exemptionReason, setExemptionReason] = useState(initial.exemptionReason ?? "");
  const [taxDetails, setTaxDetails] = useState<OutgoingTaxDetails | null>(initial.taxDetails ?? null);
  const [language, setLanguage] = useState<"de" | "en">(initial.language ?? "de");
  const [currency, setCurrency] = useState(initial.currency ?? "EUR");
  const [exchangeRate, setExchangeRate] = useState(initial.exchangeRate ?? "");
  const [exchangeRateDate, setExchangeRateDate] = useState(initial.exchangeRateDate ?? "");
  const [variant, setVariant] = useState<"abschlag" | "schluss" | null>(initial.variant ?? null);
  const [advanceType, setAdvanceType] = useState<"anzahlung" | "teilleistung">(initial.advanceType ?? "anzahlung");
  const [deducts, setDeducts] = useState<string[]>(initial.deducts ?? []);
  const [quoteId, setQuoteId] = useState(initial.quoteId ?? "");
  return {
    taxTreatment,
    setTaxTreatment,
    priceMode,
    setPriceMode,
    exemptionReason,
    setExemptionReason,
    taxDetails,
    setTaxDetails,
    language,
    setLanguage,
    currency,
    setCurrency,
    exchangeRate,
    setExchangeRate,
    exchangeRateDate,
    setExchangeRateDate,
    variant,
    setVariant,
    advanceType,
    setAdvanceType,
    deducts,
    setDeducts,
    quoteId,
    setQuoteId,
  };
}

/** Positionen, Skonto, Zahlungsweg, Rabatt und Zahlungsplan */
function useZahlungFelder(initial: InvoiceEditorProps["initial"]) {
  const [lines, setLines] = useState<LineState[]>(() => initial.lines.map(toLineState));
  const [skontoRows, setSkontoRows] = useState(() => toSkontoRows(initial.skonto ?? []));
  const [paymentMethod, setPaymentMethod] = useState<InvoicePaymentMethod>(initial.paymentMethod ?? "ueberweisung");
  const [paidVia, setPaidVia] = useState(initial.paidVia ?? "");
  const [paidOn, setPaidOn] = useState(initial.paidOn ?? "");
  const [mandateId, setMandateId] = useState(initial.sepaMandateId ?? "");
  const [discountText, setDiscountText] = useState(() => discountInput(initial.discount));
  const [planRows, setPlanRows] = useState(() => toPlanRows(initial.paymentPlan ?? []));
  const [planInConfirmation, setPlanInConfirmation] = useState(initial.paymentPlanInConfirmation ?? false);
  return {
    lines,
    setLines,
    skontoRows,
    setSkontoRows,
    paymentMethod,
    setPaymentMethod,
    paidVia,
    setPaidVia,
    paidOn,
    setPaidOn,
    mandateId,
    setMandateId,
    discountText,
    setDiscountText,
    planRows,
    setPlanRows,
    planInConfirmation,
    setPlanInConfirmation,
  };
}
