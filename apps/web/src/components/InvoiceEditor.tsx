import {
  formatDecimal,
  formatEuro,
  formatInvoiceNumber,
  formatQuoteNumber,
  formatQuantity,
  invoiceDueDate,
  lineNet,
  parseEuro,
  parseQuantity,
  TAX_TREATMENTS,
  treatmentNote,
  UNITS,
  type Bundesland,
  type InvoiceLineInput,
  type TaxTreatment,
  type UnitLabel,
} from "@haben/core";
import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { errorMessage } from "../lib/format.ts";
import {
  finalizeInvoiceDraft,
  removeInvoiceDraft,
  saveInvoiceDraft,
} from "../server/functions/invoices.ts";
import { finalizeQuoteDraft, removeQuoteDraft, saveQuoteDraft } from "../server/functions/quotes.ts";
import type { DraftInput } from "../server/invoices.ts";
import { Icon } from "./Icon.tsx";
import { InvoicePreview, type PreviewSeller } from "./InvoicePreview.tsx";

interface ContactOption {
  id: string;
  name: string;
  ort: string;
  strasse: string;
  plz: string;
  kundennummer: string | null;
  defaultFormat: DraftInput["format"] | null;
  leitwegId: string;
}

interface ArticleOption {
  id: string;
  number: string;
  description: string;
  unit: string;
  unitPrice: number;
  taxRate: number;
}

interface LineState {
  key: number;
  description: string;
  quantity: string;
  unit: UnitLabel;
  unitPrice: string;
  taxRate: 1900 | 700 | 0;
}

const FORMATS: { value: DraftInput["format"]; label: string }[] = [
  { value: "zugferd", label: "ZUGFeRD · EN 16931 (PDF mit XML)" },
  { value: "xrechnung-cii", label: "XRechnung 3.0 (CII)" },
  { value: "xrechnung-ubl", label: "XRechnung 3.0 (UBL)" },
];

const KIND_TITLE = { rechnung: "Rechnung", storno: "Stornorechnung", korrektur: "Rechnungskorrektur", angebot: "Angebot" } as const;

let nextKey = 1;

function toLineState(line: DraftInput["lines"][number]): LineState {
  return {
    key: nextKey++,
    description: line.description,
    quantity: formatQuantity(line.quantity),
    unit: line.unit,
    unitPrice: line.unitPrice === 0 ? "" : formatDecimal(line.unitPrice),
    taxRate: line.taxRate,
  };
}

function parseLine(line: LineState): InvoiceLineInput & { valid: boolean } {
  const quantity = parseQuantity(line.quantity);
  const unitPrice = parseEuro(line.unitPrice);
  return {
    description: line.description.trim(),
    quantity: quantity ?? 0,
    unit: line.unit,
    unitPrice: unitPrice ?? 0,
    taxRate: line.taxRate,
    valid: quantity !== null && quantity > 0 && unitPrice !== null && line.description.trim() !== "",
  };
}

export function InvoiceEditor({
  id,
  kind,
  initial,
  contacts,
  seller,
  sellerIssues,
  issues,
  numberCounters,
  corrects,
  bundesland,
  kleinunternehmer,
  articles = [],
}: {
  id: string | null;
  kind: keyof typeof KIND_TITLE;
  /** Beim Angebot zusätzlich die Gültigkeit; Zahlungsziel und Format spielen dort keine Rolle */
  initial: DraftInput & { validUntil?: string };
  contacts: ContactOption[];
  seller: PreviewSeller;
  sellerIssues: string[];
  issues: string[];
  /** Letzte vergebene Nummer je Jahr */
  numberCounters: Record<number, number>;
  corrects: { number: string | null; issueDate: string } | null;
  /** Für die Fälligkeit: Feiertage im Bundesland */
  bundesland: Bundesland | null;
  kleinunternehmer: boolean;
  /** Artikelkatalog zum Einfügen von Positionen */
  articles?: ArticleOption[];
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const save = useServerFn(saveInvoiceDraft);
  const finalize = useServerFn(finalizeInvoiceDraft);
  const remove = useServerFn(removeInvoiceDraft);
  const saveQuote = useServerFn(saveQuoteDraft);
  const finalizeQuote = useServerFn(finalizeQuoteDraft);
  const removeQuote = useServerFn(removeQuoteDraft);
  const quote = kind === "angebot";
  /** Rechnung oder Angebot, an dem Kunde und Steuer noch frei wählbar sind */
  const editable = kind === "rechnung" || quote;

  const [contactId, setContactId] = useState(initial.contactId ?? "");
  const [issueDate, setIssueDate] = useState(initial.issueDate);
  const [serviceFrom, setServiceFrom] = useState(initial.serviceFrom ?? "");
  const [serviceTo, setServiceTo] = useState(initial.serviceTo ?? "");
  const [paymentTermDays, setPaymentTermDays] = useState(String(initial.paymentTermDays));
  const [validUntil, setValidUntil] = useState(initial.validUntil ?? "");
  const [format, setFormat] = useState(initial.format);
  const [note, setNote] = useState(initial.note);
  const [taxTreatment, setTaxTreatment] = useState<TaxTreatment>(initial.taxTreatment ?? "regulaer");
  const [exemptionReason, setExemptionReason] = useState(initial.exemptionReason ?? "");
  const [lines, setLines] = useState<LineState[]>(() => initial.lines.map(toLineState));
  const [dirty, setDirty] = useState(id === null);
  /** Fehler einer Position erst zeigen, wenn sie verlassen oder gespeichert wurde, nicht schon beim Öffnen */
  const [touched, setTouched] = useState<Set<number>>(() => new Set());
  const [attempted, setAttempted] = useState(false);
  const showError = (key: number) => attempted || touched.has(key);
  const markTouched = (key: number) => setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const contact = contacts.find((c) => c.id === contactId) ?? null;
  const parsed = lines.map(parseLine);
  const term = Number(paymentTermDays);
  const termValid = Number.isInteger(term) && term >= 0 && term <= 120;
  const dueDate = invoiceDueDate(issueDate || initial.issueDate, termValid ? term : 0, bundesland);
  const special = taxTreatment !== "regulaer";
  const numberYear = Number((issueDate || initial.issueDate).slice(0, 4));
  const nextNumber = (quote ? formatQuoteNumber : formatInvoiceNumber)(numberYear, (numberCounters[numberYear] ?? 0) + 1);
  const validUntilOk = Boolean(validUntil) && validUntil >= (issueDate || initial.issueDate);
  const allValid =
    parsed.every((l) => l.valid) &&
    (quote ? validUntilOk : termValid) &&
    Boolean(issueDate) &&
    (taxTreatment !== "steuerfrei" || exemptionReason.trim() !== "");

  function touch<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
      setConfirming(false);
    };
  }

  function updateLine(key: number, patch: Partial<LineState>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    setDirty(true);
    setConfirming(false);
  }

  /** Position aus dem Katalog; ersetzt eine noch leere einzige Zeile, sonst wird angehängt */
  function insertArticle(articleId: string) {
    const article = articles.find((a) => a.id === articleId);
    if (!article) return;
    const line: LineState = {
      key: nextKey++,
      description: article.description,
      quantity: "1",
      unit: article.unit as UnitLabel,
      unitPrice: formatDecimal(article.unitPrice),
      taxRate: special ? 0 : (article.taxRate as 1900 | 700 | 0),
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

  function chooseContact(value: string) {
    touch(setContactId)(value);
    const chosen = contacts.find((c) => c.id === value);
    if (chosen?.defaultFormat) setFormat(chosen.defaultFormat);
    else if (chosen?.leitwegId) setFormat("xrechnung-cii");
  }

  function draft(): DraftInput {
    return {
      contactId: contactId || null,
      issueDate,
      serviceFrom: serviceFrom || null,
      serviceTo: serviceTo || null,
      paymentTermDays: term,
      format,
      note,
      taxTreatment,
      exemptionReason: special ? exemptionReason : "",
      lines: parsed.filter((l) => l.valid).map(({ valid: _valid, ...line }) => line),
    };
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await work();
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  async function persist(): Promise<string> {
    const { paymentTermDays: _term, format: _format, ...common } = draft();
    const result = quote ? await saveQuote({ data: { id, draft: { ...common, validUntil } } }) : await save({ data: { id, draft: draft() } });
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

  const onDelete = () =>
    run(async () => {
      if (id) await (quote ? removeQuote({ data: id }) : remove({ data: id }));
      await (quote ? navigate({ to: "/angebote" }) : navigate({ to: "/rechnungen" }));
    });

  const blocking = [...sellerIssues.map((i) => `Firmendaten: ${i}`), ...(dirty ? [] : issues.filter((i) => !i.startsWith("Firmendaten")))];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            {quote ? <Link to="/angebote">Angebote</Link> : <Link to="/rechnungen">Rechnungen</Link>} › Entwurf
          </div>
          <h1>
            {KIND_TITLE[kind]} {nextNumber}
          </h1>
        </div>
        <div className="actions">
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
            Vor dem Festschreiben: {blocking.join(", ")}.{" "}
            {sellerIssues.length > 0 && <Link to="/einstellungen">Firmendaten ergänzen</Link>}
          </span>
        </div>
      )}
      {confirming && (
        <div className="banner" role="alert">
          <Icon name="alert" />
          <span>
            {quote
              ? `Das Angebot bekommt die Nummer ${nextNumber} und sein PDF. Danach ist es nicht mehr änderbar; für ein geändertes Angebot kopierst du es. Gebucht wird nichts.`
              : `Die Rechnung bekommt die Nummer ${nextNumber}, PDF und XML werden erzeugt und gebucht. Danach ist sie nicht mehr änderbar; Korrekturen laufen über Storno oder Rechnungskorrektur.`}{" "}
            Noch einmal klicken zum Festschreiben.
          </span>
        </div>
      )}
      {notice && (
        <div className={`banner banner-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"}>
          {notice.text}
        </div>
      )}

      <div className="editor-grid">
        <form id="invoice-form" className="stack" onSubmit={onSave}>
          <section className="card" aria-label={quote ? "Angebotsdaten" : "Rechnungsdaten"}>
            <div className="form-grid">
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                Kunde
                <select value={contactId} onChange={(e) => chooseContact(e.target.value)} disabled={!editable}>
                  <option value="">Bitte wählen</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.ort ? ` · ${c.ort}` : ""}
                    </option>
                  ))}
                </select>
              </label>
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
                  fällig {dueDate.split("-").reverse().join(".")}
                </span>
              </label>
              )}
              <label className="field">
                Leistung von
                <input type="date" value={serviceFrom} onChange={(e) => touch(setServiceFrom)(e.target.value)} />
              </label>
              <label className="field">
                Leistung bis
                <input type="date" value={serviceTo} onChange={(e) => touch(setServiceTo)(e.target.value)} />
              </label>
              {!quote && (
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                E-Rechnungsformat
                <select value={format} onChange={(e) => touch(setFormat)(e.target.value as DraftInput["format"])}>
                  {FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
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
              </label>
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

          <section className="card" aria-labelledby="lines-heading">
            <h2 id="lines-heading">Positionen</h2>
            <div className="line-row head" aria-hidden="true">
              <div>Menge</div>
              <div>Einheit</div>
              <div>Einzelpreis</div>
              <div>USt</div>
              <div style={{ textAlign: "right" }}>Netto</div>
              <div />
            </div>
            {lines.map((line, index) => {
              const p = parsed[index]!;
              return (
                <div className="line-row" key={line.key}>
                  <input
                    className="line-desc"
                    placeholder={`Beschreibung Position ${index + 1}`}
                    aria-label={`Beschreibung Position ${index + 1}`}
                    value={line.description}
                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                    onBlur={() => markTouched(line.key)}
                    aria-invalid={showError(line.key) && line.description.trim() === ""}
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
                    placeholder="Einzelpreis"
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
                    <span className="line-net-label">Netto </span>
                    {p.valid ? formatEuro(lineNet(p.quantity, p.unitPrice)) : "–"}
                  </div>
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
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              );
            })}
            <div className="actions">
              <button
                type="button"
                className="btn btn-dashed"
                onClick={() => {
                  const last = lines[lines.length - 1];
                  setLines((prev) => [
                    ...prev,
                    { key: nextKey++, description: "", quantity: "1", unit: last?.unit ?? "Std.", unitPrice: "", taxRate: special ? 0 : (last?.taxRate ?? 1900) },
                  ]);
                  setDirty(true);
                }}
              >
                + Position hinzufügen
              </button>
              {articles.length > 0 && (
                <select
                  aria-label="Aus dem Artikelkatalog einfügen"
                  value=""
                  onChange={(e) => {
                    insertArticle(e.target.value);
                    e.target.value = "";
                  }}
                  style={{ maxWidth: 320 }}
                >
                  <option value="">Aus dem Katalog einfügen …</option>
                  {articles.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.number ? `${a.number} · ` : ""}
                      {a.description.split("\n")[0]} · {formatEuro(a.unitPrice)}/{a.unit}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <label className="field">
              {quote ? "Hinweis auf dem Angebot (optional)" : "Hinweis auf der Rechnung (optional)"}
              <textarea value={note} onChange={(e) => touch(setNote)(e.target.value)} maxLength={2000} />
            </label>
          </section>

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
                Entwurf löschen
              </button>
            </div>
          )}
        </form>

        <section aria-label="Vorschau" className="stack" style={{ gap: 8 }}>
          <div className="small muted">
            Vorschau · {quote ? "PDF" : format === "zugferd" ? "PDF/A-3 mit eingebettetem XML" : "XRechnung (XML) mit PDF-Sichtkopie"}
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
            lines={parsed}
            note={note}
            taxNote={treatmentNote(taxTreatment, exemptionReason)}
            corrects={corrects}
          />
        </section>
      </div>
    </>
  );
}
