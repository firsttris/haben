import {
  computeInvoice,
  convertPrice,
  CURRENCY_CODE,
  discountedLineAmount,
  discountInput,
  documentDiscountProblem,
  lineDiscountProblem,
  orderRateAmounts,
  parseDiscount,
  planSchedule,
  quoteLineKindProblem,
  type Discount,
  type PaymentPlanRow,
  type PlanTemplate,
  type QuoteLineKind,
  formatDecimal,
  formatEuro,
  counterCircle,
  formatDocumentNumber,
  formatQuantity,
  invoiceDueDate,
  LINE_DETAIL_MAX,
  parseEuro,
  parseExchangeRate,
  parseQuantity,
  skontoFristen,
  skontoProblem,
  TAX_TREATMENTS,
  treatmentNote,
  UNITS,
  type Bundesland,
  type InvoiceLineInput,
  type PriceMode,
  type SkontoStufe,
  type TaxTreatment,
  type UnitLabel,
} from "@haben/core";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { formatDate } from "../lib/format.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { downloadFrom } from "../lib/download.ts";
import { useAction } from "../lib/use-action.ts";
import { FORMAT_LABEL, FORMATS, invoiceTitle, type KIND_TITLE } from "../lib/invoice.ts";
import { finalizeInvoiceDraft, removeInvoiceDraft, saveInvoiceDraft } from "../server/functions/invoices.ts";
import { finalizeQuoteDraft, removeQuoteDraft, saveQuoteDraft } from "../server/functions/quotes.ts";
import { saveArticle } from "../server/functions/articles.ts";
import type { DraftInput } from "../server/modules/rechnungen/index.ts";
import { ContactDialog } from "./ContactDialog.tsx";
import type { SavedContact } from "./ContactForm.tsx";
import { Icon } from "./Icon.tsx";
import { InvoicePreview, type PreviewSeller } from "./InvoicePreview.tsx";
import { LineExtras } from "./LineExtras.tsx";
import { parsePlanRows, PaymentPlanFields, toPlanRows } from "./PaymentPlanFields.tsx";
import { parseSkontoRows, SkontoFields, toSkontoRows } from "./SkontoFields.tsx";
import { TextBlockField, type TextBlockOption } from "./TextBlockField.tsx";

interface ContactOption {
  id: string;
  name: string;
  ort: string;
  strasse: string;
  plz: string;
  kundennummer: string | null;
  defaultFormat: DraftInput["format"] | null;
  leitwegId: string;
  language: "de" | "en";
  /** Eigenes Skonto des Kunden; null = Vorgabe aus den Firmendaten */
  skonto: SkontoStufe[] | null;
  /** Nur Kunden stehen zur Auswahl; ein schon gewählter Kontakt bleibt sichtbar */
  isCustomer: boolean;
  /** Für den Hinweis auf eine Dublette beim Anlegen im Dialog */
  ustId: string;
}

interface ArticleOption {
  id: string;
  number: string;
  /** Bezeichnung, eine Zeile */
  description: string;
  /** Text unter der Bezeichnung, mehrzeilig */
  detail: string;
  unit: string;
  unitPrice: number;
  taxRate: number;
  /** Preis inklusive Umsatzsteuer */
  priceIncludesTax: boolean;
}

/** Abschlagsrechnung, die eine Schlussrechnung abziehen kann */
export interface AbschlagOption {
  id: string;
  contactId: string | null;
  /** Angebot, zu dem der Abschlag gehört */
  quoteId: string | null;
  number: string;
  issueDate: string;
  gross: number;
  rates: { rate: number; base: number; tax: number }[];
  taxTreatment: TaxTreatment;
  priceMode: PriceMode;
}

/** Festgeschriebenes Angebot, zu dem eine Abschlags- oder Schlussrechnung gehören kann */
export interface QuoteOption {
  id: string;
  contactId: string | null;
  number: string;
  issueDate: string;
}

interface LineState {
  key: number;
  description: string;
  /** Mehrzeilige Beschreibung unter der Bezeichnung */
  detail: string;
  quantity: string;
  unit: UnitLabel;
  unitPrice: string;
  taxRate: 1900 | 700 | 0;
  /** Positionsrabatt wie eingegeben, „10 %“ oder „50,00“ */
  discount: string;
  /** Nur im Angebot: optional oder Alternative zur Hauptposition davor */
  kind: QuoteLineKind | null;
}

/** Position im Entwurf; im Angebot zusätzlich die Art */
type EditorLine = DraftInput["lines"][number] & { kind?: QuoteLineKind | null };

/** Werte beim Öffnen; beim Angebot zusätzlich Gültigkeit und Zahlungsplan */
export type EditorInitial = Omit<DraftInput, "lines"> & {
  lines: EditorLine[];
  validUntil?: string;
  paymentPlan?: PaymentPlanRow[];
  paymentPlanInConfirmation?: boolean;
};

let nextKey = 1;

/** Bezeichnungen vergleichen, ohne dass Zeilenumbrüche und doppelte Leerzeichen zählen */
const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();

function toLineState(line: EditorLine): LineState {
  return {
    key: nextKey++,
    description: line.description,
    detail: line.detail ?? "",
    quantity: formatQuantity(line.quantity),
    unit: line.unit,
    unitPrice: line.unitPrice === 0 ? "" : formatDecimal(line.unitPrice),
    taxRate: line.taxRate,
    discount: discountInput(line.discount),
    kind: line.kind ?? null,
  };
}

/** Leere Zeile mit Einheit und Satz der letzten */
const emptyLine = (unit: UnitLabel, taxRate: 1900 | 700 | 0): LineState => ({
  key: nextKey++,
  description: "",
  detail: "",
  quantity: "1",
  unit,
  unitPrice: "",
  taxRate,
  discount: "",
  kind: null,
});

type ParsedLine = InvoiceLineInput & { detail: string; discount: Discount | null; kind: QuoteLineKind | null; valid: boolean; discountError: boolean };

function parseLine(line: LineState): ParsedLine {
  const quantity = parseQuantity(line.quantity);
  const unitPrice = parseEuro(line.unitPrice);
  const discount = parseDiscount(line.discount);
  const parsed = {
    description: line.description.trim(),
    detail: line.detail.trim(),
    quantity: quantity ?? 0,
    unit: line.unit,
    unitPrice: unitPrice ?? 0,
    taxRate: line.taxRate,
    discount: discount === "ungültig" ? null : discount,
    kind: line.kind,
  };
  const discountError = discount === "ungültig" || lineDiscountProblem(parsed) !== null;
  return {
    ...parsed,
    discountError,
    valid: quantity !== null && quantity > 0 && unitPrice !== null && line.description.trim() !== "" && !discountError,
  };
}

export function InvoiceEditor({
  id,
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
  corrects,
  bundesland,
  kleinunternehmer,
  articles = [],
  textBlocks = [],
  abschlaege = [],
  quotes = [],
  tageskurs = false,
  rateInfo = null,
  companySkonto = [],
  attachments = null,
  planTemplates = [],
  keptDeductions = [],
}: {
  id: string | null;
  kind: keyof typeof KIND_TITLE;
  /** Beim Angebot zusätzlich Gültigkeit und Zahlungsplan; Zahlungsziel und Format spielen dort keine Rolle */
  initial: EditorInitial;
  contacts: ContactOption[];
  seller: PreviewSeller;
  sellerIssues: string[];
  /** GmbH und UG: fehlende Pflichtangaben für Geschäftsbriefe (§ 35a GmbHG); nur ein Hinweis, keine Sperre */
  letterIssues?: string[];
  issues: string[];
  /** Letzte vergebene Nummer je Kreis: Jahr, 0 = durchlaufender Zähler */
  numberCounters: Record<number, number>;
  /** Nummernformat aus den Einstellungen, z. B. "RE-{JJJJ}-{MM}-{NNN}" */
  numberFormat: string;
  /** Zähler läuft über den Jahreswechsel weiter (#328) */
  numberRunning?: boolean;
  corrects: { number: string | null; issueDate: string } | null;
  /** Für die Fälligkeit: Feiertage im Bundesland */
  bundesland: Bundesland | null;
  kleinunternehmer: boolean;
  /** Artikelkatalog zum Einfügen von Positionen */
  articles?: ArticleOption[];
  /** Kopf- und Fußtexte zum Einfügen */
  textBlocks?: TextBlockOption[];
  /** Offene Abschlagsrechnungen für die Schlussrechnung */
  abschlaege?: AbschlagOption[];
  /** Festgeschriebene Angebote, für den Bezug von Abschlags- und Schlussrechnungen */
  quotes?: QuoteOption[];
  /** Tageskurs vom Finanzamt gestattet: dann mit Kursdatum */
  tageskurs?: boolean;
  /** Gespeicherter Kurs mit Herkunft, z. B. „1 EUR = 1,0812 USD (USt-Umrechnungskurs 09/2026)“ */
  rateInfo?: string | null;
  /** Skonto aus den Firmendaten, wenn der gewählte Kunde kein eigenes hat */
  companySkonto?: SkontoStufe[];
  /** Abschnitt für zusätzliche Anhänge (#272); nur bei einem gespeicherten Rechnungsentwurf */
  attachments?: ReactNode;
  /** Vorlagen für den Zahlungsplan im Angebot, aus den Einstellungen */
  planTemplates?: PlanTemplate[];
  /** Korrektur einer Schlussrechnung: die übernommenen Abzüge, fest; Haben behält sie beim Speichern */
  keptDeductions?: { description: string; quantity: number; unit: UnitLabel; unitPrice: number; taxRate: 1900 | 700 | 0; deductionOf: string }[];
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const save = useServerFn(saveInvoiceDraft);
  const finalize = useServerFn(finalizeInvoiceDraft);
  const remove = useServerFn(removeInvoiceDraft);
  const saveQuote = useServerFn(saveQuoteDraft);
  const finalizeQuote = useServerFn(finalizeQuoteDraft);
  const removeQuote = useServerFn(removeQuoteDraft);
  const storeArticle = useServerFn(saveArticle);
  const quote = kind === "angebot";
  /** Rechnung oder Angebot, an dem Kunde und Steuer noch frei wählbar sind */
  const editable = kind === "rechnung" || quote;

  const [contactId, setContactId] = useState(initial.contactId ?? "");
  const [newContactOpen, setNewContactOpen] = useState(false);
  const [issueDate, setIssueDate] = useState(initial.issueDate);
  const [serviceFrom, setServiceFrom] = useState(initial.serviceFrom ?? "");
  const [serviceTo, setServiceTo] = useState(initial.serviceTo ?? "");
  const [paymentTermDays, setPaymentTermDays] = useState(String(initial.paymentTermDays));
  const [validUntil, setValidUntil] = useState(initial.validUntil ?? "");
  const [format, setFormat] = useState(initial.format);
  const [intro, setIntro] = useState(initial.intro ?? "");
  const [note, setNote] = useState(initial.note);
  const [taxTreatment, setTaxTreatment] = useState<TaxTreatment>(initial.taxTreatment ?? "regulaer");
  const [priceMode, setPriceMode] = useState<PriceMode>(initial.priceMode ?? "netto");
  const [exemptionReason, setExemptionReason] = useState(initial.exemptionReason ?? "");
  const [language, setLanguage] = useState<"de" | "en">(initial.language ?? "de");
  const [currency, setCurrency] = useState(initial.currency ?? "EUR");
  const [exchangeRate, setExchangeRate] = useState(initial.exchangeRate ?? "");
  const [exchangeRateDate, setExchangeRateDate] = useState(initial.exchangeRateDate ?? "");
  const [variant, setVariant] = useState<"abschlag" | "schluss" | null>(initial.variant ?? null);
  const [deducts, setDeducts] = useState<string[]>(initial.deducts ?? []);
  const [quoteId, setQuoteId] = useState(initial.quoteId ?? "");
  const [lines, setLines] = useState<LineState[]>(() => initial.lines.map(toLineState));
  const [skontoRows, setSkontoRows] = useState(() => toSkontoRows(initial.skonto ?? []));
  const [discountText, setDiscountText] = useState(() => discountInput(initial.discount));
  const [planRows, setPlanRows] = useState(() => toPlanRows(initial.paymentPlan ?? []));
  const [planInConfirmation, setPlanInConfirmation] = useState(initial.paymentPlanInConfirmation ?? false);
  const [dirty, setDirty] = useState(id === null);
  /** Fehler einer Position erst zeigen, wenn sie verlassen oder gespeichert wurde, nicht schon beim Öffnen */
  const [touched, setTouched] = useState<Set<number>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const showError = (key: number) => attempted || touched.has(key);
  const markTouched = (key: number) => setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  const { busy, notice, setNotice, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // „Festschreiben“ steht im festen Seitenkopf und lässt sich auch weit unten klicken: die Rückfrage ins Fenster
  // holen, sonst schriebe der zweite Klick fest, ohne dass der Hinweis zu sehen war
  const confirmBanner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirming) confirmBanner.current?.scrollIntoView({ block: "nearest" });
  }, [confirming]);

  const contact = contacts.find((c) => c.id === contactId) ?? null;
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
  const nextNumber = formatDocumentNumber(numberFormat, numberDate, (numberCounters[circle] ?? 0) + 1);
  const validUntilOk = Boolean(validUntil) && validUntil >= (issueDate || initial.issueDate);
  // Skonto nur auf Rechnungen in Euro, die der Kunde bezahlt; nicht auf Storno, Korrektur und Angebot
  const skontoAllowed = kind === "rechnung" && !foreign;
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
  const allValid =
    parsed.every((l) => l.valid) &&
    (quote ? validUntilOk : termValid) &&
    skontoIssue === null &&
    discountIssue === null &&
    kindIssue === null &&
    !planIssue &&
    Boolean(issueDate) &&
    (taxTreatment !== "steuerfrei" || exemptionReason.trim() !== "");

  function touch<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
      setConfirming(false);
      setConfirmingDelete(false);
    };
  }

  function updateLine(key: number, patch: Partial<LineState>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    setDirty(true);
    setConfirming(false);
    setConfirmingDelete(false);
  }

  /** Preis eines Artikels für diese Rechnung: netto oder brutto umgerechnet, wenn der Artikel anders gepflegt ist */
  function articlePrice(article: ArticleOption): string {
    if (special) return formatDecimal(article.unitPrice);
    return formatDecimal(convertPrice(article.unitPrice, article.taxRate, article.priceIncludesTax ? "brutto" : "netto", grossPrices ? "brutto" : "netto"));
  }

  /** Tippt man die Bezeichnung eines Artikels (Vorschlag aus dem Katalog), übernimmt die Position dessen Text, Einheit, Preis und Steuersatz */
  function changeDescription(line: LineState, description: string) {
    const article = !sameText(line.description, description) ? articles.find((a) => sameText(a.description, description)) : undefined;
    updateLine(
      line.key,
      article
        ? {
            description: article.description,
            // Ein Artikel ohne Text lässt einen schon eingegebenen Text der Position stehen
            detail: article.detail || line.detail,
            unit: article.unit as UnitLabel,
            unitPrice: articlePrice(article),
            taxRate: special ? 0 : (article.taxRate as 1900 | 700 | 0),
          }
        : { description },
    );
  }

  /** Position als Artikel in den Katalog übernehmen; die Position selbst bleibt unverändert */
  function storeAsArticle(p: ParsedLine) {
    void run(async () => {
      await storeArticle({
        data: {
          id: null,
          article: { description: p.description, detail: p.detail, unit: p.unit, unitPrice: p.unitPrice, taxRate: p.taxRate, priceIncludesTax: grossPrices },
        },
      });
      await router.invalidate();
    }, `„${p.description}“ ist jetzt im Artikelkatalog.`);
  }

  /** Position aus dem Katalog; ersetzt eine noch leere einzige Zeile, sonst wird angehängt */
  function insertArticle(articleId: string) {
    const article = articles.find((a) => a.id === articleId);
    if (!article) return;
    const line: LineState = {
      ...emptyLine(article.unit as UnitLabel, special ? 0 : (article.taxRate as 1900 | 700 | 0)),
      description: article.description,
      detail: article.detail,
      unitPrice: articlePrice(article),
    };
    setLines((prev) => (prev.length === 1 && !prev[0]!.description.trim() && !prev[0]!.unitPrice.trim() ? [line] : [...prev, line]));
    setDirty(true);
    setConfirming(false);
  }

  function chooseTreatment(value: TaxTreatment) {
    touch(setTaxTreatment)(value);
    // Ohne Steuerausweis stehen alle Positionen auf 0 %
    if (value !== "regulaer") setLines((prev) => prev.map((line) => ({ ...line, taxRate: 0 })));
  }

  /** saved: gerade im Dialog angelegt, steht also noch nicht in contacts */
  function chooseContact(value: string, saved?: SavedContact) {
    touch(setContactId)(value);
    const chosen = saved ?? contacts.find((c) => c.id === value);
    if (chosen?.defaultFormat) setFormat(chosen.defaultFormat);
    else if (chosen?.leitwegId) setFormat("xrechnung-cii");
    if (chosen) setLanguage(chosen.language ?? "de");
    // Skonto des Kunden, sonst aus den Firmendaten; Fristen über das Zahlungsziel hinaus entfallen (wie defaultSkonto)
    if (chosen && kind === "rechnung") {
      setSkontoRows(toSkontoRows((chosen.skonto ?? companySkonto).filter((s) => !termValid || s.days <= term)));
    }
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

  function draft(): DraftInput {
    return {
      contactId: contactId || null,
      issueDate,
      serviceFrom: serviceFrom || null,
      serviceTo: serviceTo || null,
      paymentTermDays: term,
      skonto: skonto.stufen,
      format,
      intro,
      note,
      taxTreatment,
      exemptionReason: special ? exemptionReason : "",
      priceMode: grossPrices ? "brutto" : "netto",
      language,
      variant: kind === "rechnung" ? variant : null,
      deducts: schluss ? deducted.map((a) => a.id) : [],
      quoteId: kind === "rechnung" && quoteId ? quoteId : null,
      currency: currencyCode,
      exchangeRate: foreign && exchangeRate.trim() ? exchangeRate : null,
      exchangeRateDate: foreign && exchangeRate.trim() && exchangeRateDate ? exchangeRateDate : null,
      discount,
      lines: parsed.filter((l) => l.valid).map(({ valid: _valid, discountError: _error, kind: _kind, ...line }) => line),
    };
  }

  async function persist(): Promise<string> {
    const {
      paymentTermDays: _term,
      skonto: _skonto,
      format: _format,
      currency: _currency,
      exchangeRate: _rate,
      exchangeRateDate: _rateDate,
      quoteId: _quote,
      ...common
    } = draft();
    const quoteLines = parsed.filter((l) => l.valid).map(({ valid: _valid, discountError: _error, ...line }) => line);
    const result = quote
      ? await saveQuote({
          data: {
            id,
            draft: { ...common, lines: quoteLines, validUntil, paymentPlan: plan.rows, paymentPlanInConfirmation: plan.rows.length > 0 && planInConfirmation },
          },
        })
      : await save({ data: { id, draft: draft() } });
    setDirty(false);
    return result.id;
  }

  const openSaved = (savedId: string) =>
    quote ? navigate({ to: "/angebote/$id", params: { id: savedId } }) : navigate({ to: "/rechnungen/$id", params: { id: savedId } });

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    void run(async () => {
      const savedId = await persist();
      if (id === null) {
        await openSaved(savedId);
      } else {
        await router.invalidate();
        setNotice({ tone: "ok", text: "Entwurf gespeichert." });
      }
    });
  };

  const onFinalize = () => {
    setAttempted(true);
    if (!confirming) {
      setConfirming(true);
      return;
    }
    void run(async () => {
      const savedId = dirty || id === null ? await persist() : id;
      await (quote ? finalizeQuote({ data: savedId }) : finalize({ data: savedId }));
      setConfirming(false);
      if (id === null) await openSaved(savedId);
      else await router.invalidate();
    });
  };

  // Entwurf als PDF aus dem gespeicherten Stand: Ungespeichertes erst speichern, damit das PDF zeigt, was im Formular steht
  const onDraftPdf = () => {
    setAttempted(true);
    void run(async () => {
      const saving = dirty || id === null;
      const savedId = saving ? await persist() : id;
      await downloadFrom(`/api/entwurf/${quote ? "angebot" : "rechnung"}/${savedId}?download`, quote ? "Angebot-Entwurf.pdf" : "Rechnung-Entwurf.pdf");
      if (id === null) {
        await openSaved(savedId);
      } else if (saving) {
        await router.invalidate();
        setNotice({ tone: "ok", text: "Entwurf gespeichert, das PDF ist heruntergeladen." });
      }
    });
  };

  // Wie beim Festschreiben: erst nachfragen, der zweite Klick löscht
  const onDelete = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    void run(async () => {
      if (id) await (quote ? removeQuote({ data: id }) : remove({ data: id }));
      await (quote ? navigate({ to: "/angebote" }) : navigate({ to: "/rechnungen" }));
    });
  };

  const blocking = [...sellerIssues.map((i) => `Firmendaten: ${i}`), ...(dirty ? [] : issues.filter((i) => !i.startsWith("Firmendaten")))];

  return (
    <>
      <ContactDialog
        open={newContactOpen}
        title="Neuen Kunden anlegen"
        prefill={{ isCustomer: true, isSupplier: false }}
        existing={contacts}
        onSaved={(saved) => {
          chooseContact(saved.id, saved);
          // Die Liste der Kunden neu laden; die Eingaben im Entwurf bleiben, der Editor wird nicht neu aufgebaut
          void router.invalidate();
        }}
        onPickExisting={(id) => chooseContact(id)}
        onClose={() => setNewContactOpen(false)}
      />
      <div className="page-head">
        <div>
          <div className="eyebrow">{quote ? <Link to="/angebote">Angebote</Link> : <Link to="/rechnungen">Rechnungen</Link>} › Entwurf</div>
          <h1>
            {title} {nextNumber}
          </h1>
        </div>
        <div className="actions editor-actions">
          <button
            type="button"
            className="btn"
            disabled={busy || !allValid || !contactId}
            onClick={onDraftPdf}
            title={contactId ? "PDF mit dem Vermerk ENTWURF, ohne Nummer; es wird nichts gebucht oder versendet" : "Erst einen Kunden wählen"}
          >
            {dirty ? "Speichern und als PDF" : "Entwurf als PDF"}
          </button>
          <button type="submit" form="invoice-form" className="btn" disabled={busy || !allValid || !dirty}>
            Entwurf speichern
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !allValid} onClick={onFinalize}>
            {confirming ? "Jetzt festschreiben" : "Festschreiben"}
          </button>
        </div>
      </div>

      {blocking.length > 0 && (
        <div className="banner" role="status">
          <Icon name="alert" />
          <span>
            Vor dem Festschreiben: {blocking.join(", ")}. {sellerIssues.length > 0 && <Link to="/einstellungen">Firmendaten ergänzen</Link>}
          </span>
        </div>
      )}
      {letterIssues.length > 0 && (
        <div className="banner" role="status" id="letter-issues">
          <Icon name="alert" />
          <span>
            Pflichtangaben für Geschäftsbriefe unvollständig (§ 35a GmbHG): {letterIssues.join(", ")}. Festschreiben geht trotzdem, der Fuß nennt dann nur, was
            eingetragen ist. <Link to="/einstellungen">Firmendaten ergänzen</Link>
          </span>
        </div>
      )}
      {confirming && (
        <div className="banner" role="alert" ref={confirmBanner}>
          <Icon name="alert" />
          <span>
            {quote
              ? `Das Angebot bekommt die Nummer ${nextNumber} und sein PDF. Danach ist es nicht mehr änderbar; für ein geändertes Angebot kopierst du es. Gebucht wird nichts.`
              : `Die Rechnung bekommt die Nummer ${nextNumber}, PDF und XML werden erzeugt und gebucht. Danach ist sie nicht mehr änderbar; Korrekturen laufen über Storno oder Rechnungskorrektur.`}{" "}
            Noch einmal klicken zum Festschreiben.
          </span>
        </div>
      )}
      <NoticeBanner notice={notice} />

      <div className="editor-grid">
        <form id="invoice-form" className="stack" onSubmit={onSave}>
          <section className="card" aria-label={quote ? "Angebotsdaten" : "Rechnungsdaten"}>
            <div className="form-grid">
              {kind === "rechnung" && (
                <label className="field" style={{ gridColumn: "1 / -1" }}>
                  Rechnungsart
                  <select
                    value={variant ?? ""}
                    onChange={(e) => chooseVariant((e.target.value || null) as "abschlag" | "schluss" | null)}
                    aria-describedby="variant-hint"
                  >
                    <option value="">Rechnung</option>
                    <option value="abschlag">Abschlagsrechnung</option>
                    <option value="schluss">Schlussrechnung</option>
                  </select>
                  {variant && (
                    <span id="variant-hint" className="small">
                      {variant === "abschlag"
                        ? "Über einen Teil der Leistung, z. B. 30 % bei Auftrag; wird gebucht wie eine Rechnung."
                        : "Über die gesamte Leistung; die gewählten Abschlagsrechnungen werden mit Netto und Umsatzsteuer abgezogen."}
                    </span>
                  )}
                </label>
              )}
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                Kunde
                <select value={contactId} onChange={(e) => chooseContact(e.target.value)} disabled={!editable}>
                  <option value="">Bitte wählen</option>
                  {contacts
                    .filter((c) => c.isCustomer || c.id === contactId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.ort ? ` · ${c.ort}` : ""}
                      </option>
                    ))}
                </select>
              </label>
              {editable && (
                <div style={{ gridColumn: "1 / -1" }}>
                  <button type="button" className="btn" onClick={() => setNewContactOpen(true)}>
                    Neuen Kontakt anlegen
                  </button>
                </div>
              )}
              {kind === "rechnung" && (variant || quoteId) && (
                <label className="field" style={{ gridColumn: "1 / -1" }}>
                  Angebot
                  <select value={quoteId} onChange={(e) => chooseQuote(e.target.value)} disabled={!editable} aria-describedby="quote-hint">
                    <option value="">Ohne Angebot</option>
                    {customerQuotes.map((q) => (
                      <option key={q.id} value={q.id}>
                        Angebot {q.number} vom {formatDate(q.issueDate)}
                      </option>
                    ))}
                  </select>
                  <span id="quote-hint" className="small">
                    {contactId
                      ? "Die Schlussrechnung zu einem Angebot zieht nur dessen Abschläge ab; auf der Seite des Angebots stehen alle Rechnungen dazu."
                      : "Zur Auswahl stehen die festgeschriebenen Angebote des gewählten Empfängers."}
                  </span>
                </label>
              )}
              <label className="field">
                {quote ? "Angebotsdatum" : "Rechnungsdatum"}
                <input type="date" value={issueDate} onChange={(e) => touch(setIssueDate)(e.target.value)} required />
              </label>
              {quote ? (
                <label className="field">
                  Gültig bis
                  <input
                    type="date"
                    value={validUntil}
                    min={issueDate || undefined}
                    onChange={(e) => touch(setValidUntil)(e.target.value)}
                    aria-invalid={!validUntilOk}
                    required
                  />
                </label>
              ) : (
                <label className="field">
                  Zahlungsziel in Tagen
                  <input
                    inputMode="numeric"
                    value={paymentTermDays}
                    onChange={(e) => touch(setPaymentTermDays)(e.target.value)}
                    aria-invalid={!termValid}
                    aria-describedby="due-hint"
                  />
                  <span id="due-hint" className="small">
                    fällig {formatDate(dueDate)}
                  </span>
                </label>
              )}
              {skontoAllowed && (
                <SkontoFields
                  id="invoice-skonto"
                  rows={skontoRows}
                  onChange={touch(setSkontoRows)}
                  problem={attempted || skonto.valid ? skontoIssue : null}
                  describe={(stufe) => {
                    const [frist] = skontoFristen([stufe], issueDate || initial.issueDate, previewGross);
                    return frist ? `bis ${formatDate(frist.until)}: ${formatEuro(frist.amount)} Skonto, zu zahlen ${formatEuro(frist.payable)}` : null;
                  }}
                />
              )}
              <label className="field">
                Leistung von
                <input type="date" value={serviceFrom} onChange={(e) => touch(setServiceFrom)(e.target.value)} />
              </label>
              <label className="field">
                Leistung bis
                <input type="date" value={serviceTo} onChange={(e) => touch(setServiceTo)(e.target.value)} />
              </label>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                Sprache
                <select
                  value={language}
                  onChange={(e) => touch(setLanguage)(e.target.value as "de" | "en")}
                  disabled={!editable}
                  aria-describedby="language-hint"
                >
                  <option value="de">Deutsch</option>
                  <option value="en">Englisch</option>
                </select>
                <span id="language-hint" className="small">
                  Texte im PDF und in der E-Mail; die E-Rechnung selbst bleibt maschinenlesbar wie gehabt.
                </span>
              </label>
              {kind === "rechnung" && (
                <>
                  <label className="field">
                    Währung
                    <input
                      value={currency}
                      onChange={(e) => touch(setCurrency)(e.target.value.toUpperCase().slice(0, 3))}
                      list="invoice-currency-codes"
                      maxLength={3}
                      className="mono"
                      aria-invalid={!CURRENCY_CODE.test(currencyCode)}
                      aria-describedby={foreign ? "invoice-currency-hint" : undefined}
                    />
                    <datalist id="invoice-currency-codes">
                      {["EUR", "USD", "GBP", "CHF", "PLN", "SEK", "DKK", "JPY"].map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </label>
                  {foreign && (
                    <label className="field">
                      Kurs: 1 EUR = … {CURRENCY_CODE.test(currencyCode) ? currencyCode : ""}
                      <input
                        className="mono"
                        inputMode="decimal"
                        value={exchangeRate}
                        placeholder="leer = USt-Umrechnungskurs"
                        onChange={(e) => touch(setExchangeRate)(e.target.value)}
                        aria-invalid={exchangeRate.trim() !== "" && parseExchangeRate(exchangeRate) === null}
                        aria-describedby="invoice-currency-hint"
                      />
                    </label>
                  )}
                  {foreign && tageskurs && (
                    <label className="field">
                      Kursdatum
                      <input type="date" value={exchangeRateDate} onChange={(e) => touch(setExchangeRateDate)(e.target.value)} />
                    </label>
                  )}
                  {foreign && (
                    <span id="invoice-currency-hint" className="small" style={{ gridColumn: "1 / -1" }}>
                      {rateInfo && <strong>{rateInfo}. </strong>}
                      Preise und Summen in {currencyCode || "der Fremdwährung"}; die Umsatzsteuer steht zusätzlich in Euro auf der Rechnung (§ 14 Abs. 4 Nr. 8
                      UStG). Gebucht wird in Euro. Ohne eigenen Kurs nimmt Haben den Umsatzsteuer-Umrechnungskurs des Leistungsmonats, sobald das BMF ihn
                      veröffentlicht hat. Kein GiroCode, keine Abschlags- oder Schlussrechnung, keine Mahnung aus Haben.
                    </span>
                  )}
                </>
              )}
              {!quote && (
                <label className="field" style={{ gridColumn: "1 / -1" }}>
                  E-Rechnungsformat
                  <select value={format} onChange={(e) => touch(setFormat)(e.target.value as DraftInput["format"])}>
                    {FORMATS.map((f) => (
                      <option key={f} value={f}>
                        {FORMAT_LABEL[f]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                Umsatzsteuer
                <select
                  value={taxTreatment}
                  onChange={(e) => chooseTreatment(e.target.value as TaxTreatment)}
                  disabled={!editable || kleinunternehmer}
                  aria-describedby="treatment-hint"
                >
                  {(Object.keys(TAX_TREATMENTS) as TaxTreatment[])
                    .filter((t) => (kleinunternehmer ? t === "kleinunternehmer" : t !== "kleinunternehmer" || taxTreatment === t))
                    .map((t) => (
                      <option key={t} value={t}>
                        {TAX_TREATMENTS[t].label}
                      </option>
                    ))}
                </select>
                {kleinunternehmer && (
                  <span id="treatment-hint" className="small">
                    In den Einstellungen als Kleinunternehmer eingetragen.
                  </span>
                )}
                {taxTreatment === "reverse_charge" && (
                  <span id="treatment-hint" className="small">
                    Nur für Leistungen an Unternehmen im EU-Ausland mit USt-IdNr.; zusätzlich in der Zusammenfassenden Meldung angeben.
                  </span>
                )}
                {taxTreatment === "ig_lieferung" && (
                  <span id="treatment-hint" className="small">
                    Nur für Ware, die zu einem Unternehmen in einem anderen EU-Land gelangt, mit dessen USt-IdNr.; Haben meldet sie in Kz 41 und in der
                    Zusammenfassenden Meldung. Den Gelangensnachweis (§ 17a UStDV), etwa die Gelangensbestätigung oder den Versandbeleg, bewahrst du zur
                    Rechnung auf.
                  </span>
                )}
                {taxTreatment === "ausfuhr" && (
                  <span id="treatment-hint" className="small">
                    Nur für Ware, die ins Drittland gelangt, mit Ausfuhrnachweis (§ 8 bis § 11 UStDV), etwa dem Ausgangsvermerk aus ATLAS. Dienstleistungen ins
                    Drittland sind „Leistung ins Nicht-EU-Ausland“.
                  </span>
                )}
              </label>
              {!special && (
                <label className="field" style={{ gridColumn: "1 / -1" }}>
                  Preise
                  <select
                    value={priceMode}
                    onChange={(e) => touch(setPriceMode)(e.target.value as PriceMode)}
                    disabled={!editable}
                    aria-describedby="price-mode-hint"
                  >
                    <option value="netto">Netto, zuzüglich Umsatzsteuer</option>
                    <option value="brutto">Brutto, inklusive Umsatzsteuer (Endpreise)</option>
                  </select>
                  <span id="price-mode-hint" className="small">
                    {grossPrices
                      ? "Endpreise für Verbraucher: Die Umsatzsteuer wird je Steuersatz aus der Summe herausgerechnet."
                      : "Üblich zwischen Unternehmen: Die Umsatzsteuer kommt auf die Einzelpreise."}
                    {!editable && " Wie in der ursprünglichen Rechnung."}
                  </span>
                </label>
              )}
              {special && (
                <label className="field" style={{ gridColumn: "1 / -1" }}>
                  {taxTreatment === "steuerfrei" ? "Befreiungsvorschrift" : "Hinweis zur Umsatzsteuer (optional)"}
                  <input
                    value={exemptionReason}
                    onChange={(e) => touch(setExemptionReason)(e.target.value)}
                    maxLength={300}
                    placeholder={TAX_TREATMENTS[taxTreatment].note ?? ""}
                    required={taxTreatment === "steuerfrei"}
                    aria-invalid={taxTreatment === "steuerfrei" && !exemptionReason.trim()}
                  />
                </label>
              )}
            </div>
            {!contacts.length && (
              <p className="small muted" style={{ margin: 0 }}>
                Noch keine Kontakte. <Link to="/kontakte/neu">Kunden anlegen</Link>
              </p>
            )}
          </section>

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

          <section className="card" aria-labelledby="lines-heading">
            <h2 id="lines-heading">Positionen</h2>
            <TextBlockField
              label="Einleitung über den Positionen (optional)"
              kind="kopf"
              value={intro}
              onChange={touch(setIntro)}
              blocks={textBlocks}
              contactId={contactId || null}
            />
            <div className="line-row head" aria-hidden="true">
              <div>Menge</div>
              <div>Einheit</div>
              <div>Einzelpreis</div>
              <div>USt</div>
              <div style={{ textAlign: "right" }}>{amountLabel}</div>
              <div />
            </div>
            {articles.length > 0 && (
              <datalist id="artikel-vorschlaege">
                {articles.map((a) => (
                  <option
                    key={a.id}
                    value={a.description}
                    label={`${a.number ? `${a.number} · ` : ""}${formatEuro(a.unitPrice)}${a.priceIncludesTax ? " brutto" : ""}/${a.unit}`}
                  />
                ))}
              </datalist>
            )}
            {lines.map((line, index) => {
              const p = parsed[index]!;
              const inCatalog = articles.some(
                (a) =>
                  sameText(a.description, p.description) &&
                  sameText(a.detail, p.detail) &&
                  a.unitPrice === p.unitPrice &&
                  a.unit === p.unit &&
                  a.priceIncludesTax === grossPrices,
              );
              return (
                <div className="line-row" key={line.key}>
                  <input
                    className="line-desc"
                    placeholder={`Beschreibung Position ${index + 1}`}
                    aria-label={`Beschreibung Position ${index + 1}`}
                    value={line.description}
                    list={articles.length > 0 ? "artikel-vorschlaege" : undefined}
                    autoComplete="off"
                    onChange={(e) => changeDescription(line, e.target.value)}
                    onBlur={() => markTouched(line.key)}
                    aria-invalid={showError(line.key) && line.description.trim() === ""}
                  />
                  <textarea
                    className="line-detail"
                    rows={line.detail ? Math.min(6, line.detail.split("\n").length) : 1}
                    placeholder="Text zur Position (optional, mehrzeilig)"
                    aria-label={`Text zu Position ${index + 1} (optional)`}
                    value={line.detail}
                    maxLength={LINE_DETAIL_MAX}
                    onChange={(e) => updateLine(line.key, { detail: e.target.value })}
                  />
                  <input
                    className="num"
                    inputMode="decimal"
                    aria-label={`Menge Position ${index + 1}`}
                    placeholder="Menge"
                    value={line.quantity}
                    onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                    onBlur={() => markTouched(line.key)}
                    aria-invalid={showError(line.key) && parseQuantity(line.quantity) === null}
                  />
                  <select
                    aria-label={`Einheit Position ${index + 1}`}
                    value={line.unit}
                    onChange={(e) => updateLine(line.key, { unit: e.target.value as UnitLabel })}
                  >
                    {Object.keys(UNITS).map((unit) => (
                      <option key={unit}>{unit}</option>
                    ))}
                  </select>
                  <input
                    className="num"
                    inputMode="decimal"
                    aria-label={`Einzelpreis Position ${index + 1} in Euro`}
                    value={line.unitPrice}
                    placeholder="0,00"
                    onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                    onBlur={() => markTouched(line.key)}
                    aria-invalid={showError(line.key) && parseEuro(line.unitPrice) === null}
                  />
                  <select
                    aria-label={`Steuersatz Position ${index + 1}`}
                    value={line.taxRate}
                    disabled={special}
                    onChange={(e) => updateLine(line.key, { taxRate: Number(e.target.value) as 1900 | 700 | 0 })}
                  >
                    <option value={1900}>19 %</option>
                    <option value={700}>7 %</option>
                    <option value={0}>0 %</option>
                  </select>
                  <div className="num line-net">
                    <span className="line-net-label">{amountLabel} </span>
                    {p.valid ? formatEuro(discountedLineAmount(p)) : "–"}
                  </div>
                  <div className="line-actions">
                    <button
                      type="button"
                      className="icon-btn icon-btn-plain"
                      aria-label={`Position ${index + 1} als Artikel speichern`}
                      title={inCatalog ? "Steht schon im Artikelkatalog" : "Als Artikel speichern"}
                      disabled={busy || !p.valid || inCatalog}
                      onClick={() => storeAsArticle(p)}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Position ${index + 1} entfernen`}
                      disabled={lines.length === 1}
                      onClick={() => {
                        setLines((prev) => prev.filter((l) => l.key !== line.key));
                        setDirty(true);
                      }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M6 6l12 12M18 6L6 18" />
                      </svg>
                    </button>
                  </div>
                  <LineExtras
                    index={index}
                    discount={line.discount}
                    discountError={showError(line.key) && p.discountError}
                    onDiscount={(value) => updateLine(line.key, { discount: value })}
                    onBlur={() => markTouched(line.key)}
                    kind={quote ? line.kind : undefined}
                    onKind={(value) => updateLine(line.key, { kind: value })}
                  />
                </div>
              );
            })}
            {kindIssue && (
              <p className="field-error" role="alert" style={{ margin: 0 }}>
                {kindIssue}.
              </p>
            )}
            <div className="actions">
              <button
                type="button"
                className="btn btn-dashed"
                onClick={() => {
                  const last = lines[lines.length - 1];
                  setLines((prev) => [...prev, emptyLine(last?.unit ?? "Std.", special ? 0 : (last?.taxRate ?? 1900))]);
                  setDirty(true);
                }}
              >
                <Icon name="plus" size={16} /> Position hinzufügen
              </button>
              {articles.length > 0 && (
                <select
                  aria-label="Aus dem Artikelkatalog einfügen"
                  value=""
                  onChange={(e) => {
                    insertArticle(e.target.value);
                    e.target.value = "";
                  }}
                  className="catalog-select"
                >
                  <option value="">Aus dem Katalog einfügen …</option>
                  {articles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.number ? `${a.number} · ` : ""}
                      {a.description} · {formatEuro(a.unitPrice)}
                      {a.priceIncludesTax ? " brutto" : ""}/{a.unit}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <label className="field">
              Gesamtrabatt (optional)
              <input
                className="mono"
                value={discountText}
                placeholder="z. B. 5 % oder 100,00"
                onChange={(e) => touch(setDiscountText)(e.target.value)}
                aria-invalid={discountIssue !== null}
                aria-describedby="discount-hint"
              />
              <span id="discount-hint" className={discountIssue ? "field-error" : "small"}>
                {discountIssue ??
                  `Auf die Summe der Positionen nach ihren Rabatten, je Steuersatz anteilig; ein Betrag gilt ${grossPrices ? "brutto" : "netto"}. Skonto bleibt davon getrennt.`}
              </span>
            </label>
            <TextBlockField
              label={quote ? "Hinweis auf dem Angebot (optional)" : "Hinweis auf der Rechnung (optional)"}
              kind="fuss"
              value={note}
              onChange={touch(setNote)}
              blocks={textBlocks}
              contactId={contactId || null}
            />
          </section>

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
              <button type="button" className="btn btn-danger" onClick={onDelete} disabled={busy}>
                {confirmingDelete ? "Entwurf endgültig löschen" : "Entwurf löschen"}
              </button>
            </div>
          )}
        </form>

        <section aria-label="Vorschau" className="stack" style={{ gap: 8 }}>
          <div className="small muted">
            Vorschau · {quote ? "PDF" : format === "zugferd" ? "PDF/A-3 mit eingebettetem XML" : "XRechnung (XML) mit PDF-Sichtkopie"}
            {language === "en" && " · Das PDF erscheint auf Englisch, die Vorschau zeigt den Aufbau."}
          </div>
          <InvoicePreview
            kind={kind}
            number={nextNumber}
            issueDate={issueDate || initial.issueDate}
            dueDate={dueDate}
            validUntil={quote ? validUntil || null : null}
            serviceFrom={serviceFrom || null}
            serviceTo={serviceTo || null}
            seller={seller}
            buyer={contact}
            lines={[...parsed.map((l) => ({ ...l, kind: quote ? l.kind : null })), ...deductionPreview]}
            discount={discountIssue ? null : discount}
            plan={planIssue ? [] : planPreview}
            intro={intro}
            note={note}
            priceMode={grossPrices ? "brutto" : "netto"}
            taxNote={treatmentNote(taxTreatment, exemptionReason)}
            corrects={corrects}
            title={title}
            skonto={skonto.stufen}
            // Auch bei einer Korrektur: Sie übernimmt Währung und Kurs der Rechnung, nur ohne eigenes Feld dafür
            currency={currencyCode !== "EUR" && CURRENCY_CODE.test(currencyCode) ? currencyCode : "EUR"}
          />
        </section>
      </div>
    </>
  );
}
