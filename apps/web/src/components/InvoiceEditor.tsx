import {
  addDays,
  formatDecimal,
  formatEuro,
  formatQuantity,
  lineNet,
  parseEuro,
  parseQuantity,
  UNITS,
  type InvoiceLineInput,
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

const KIND_TITLE = { rechnung: "Rechnung", storno: "Stornorechnung", korrektur: "Rechnungskorrektur" } as const;

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
  nextNumber,
  corrects,
}: {
  id: string | null;
  kind: keyof typeof KIND_TITLE;
  initial: DraftInput;
  contacts: ContactOption[];
  seller: PreviewSeller;
  sellerIssues: string[];
  issues: string[];
  nextNumber: string;
  corrects: { number: string | null; issueDate: string } | null;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const save = useServerFn(saveInvoiceDraft);
  const finalize = useServerFn(finalizeInvoiceDraft);
  const remove = useServerFn(removeInvoiceDraft);

  const [contactId, setContactId] = useState(initial.contactId ?? "");
  const [issueDate, setIssueDate] = useState(initial.issueDate);
  const [serviceFrom, setServiceFrom] = useState(initial.serviceFrom ?? "");
  const [serviceTo, setServiceTo] = useState(initial.serviceTo ?? "");
  const [paymentTermDays, setPaymentTermDays] = useState(String(initial.paymentTermDays));
  const [format, setFormat] = useState(initial.format);
  const [note, setNote] = useState(initial.note);
  const [lines, setLines] = useState<LineState[]>(() => initial.lines.map(toLineState));
  const [dirty, setDirty] = useState(id === null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const contact = contacts.find((c) => c.id === contactId) ?? null;
  const parsed = lines.map(parseLine);
  const term = Number(paymentTermDays);
  const termValid = Number.isInteger(term) && term >= 0 && term <= 120;
  const dueDate = addDays(issueDate || initial.issueDate, termValid ? term : 0);
  const allValid = parsed.every((l) => l.valid) && termValid && Boolean(issueDate);

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
    const result = await save({ data: { id, draft: draft() } });
    setDirty(false);
    return result.id;
  }

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const savedId = await persist();
      if (id === null) {
        await navigate({ to: "/rechnungen/$id", params: { id: savedId } });
      } else {
        await router.invalidate();
        setNotice({ tone: "ok", text: "Entwurf gespeichert." });
      }
    });
  };

  const onFinalize = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    void run(async () => {
      const savedId = dirty || id === null ? await persist() : id;
      await finalize({ data: savedId });
      setConfirming(false);
      if (id === null) await navigate({ to: "/rechnungen/$id", params: { id: savedId } });
      else await router.invalidate();
    });
  };

  const onDelete = () =>
    run(async () => {
      if (id) await remove({ data: id });
      await navigate({ to: "/rechnungen" });
    });

  const blocking = [...sellerIssues.map((i) => `Firmendaten: ${i}`), ...(dirty ? [] : issues.filter((i) => !i.startsWith("Firmendaten")))];

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/rechnungen">Rechnungen</Link> › Entwurf
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
            Die Rechnung bekommt die Nummer {nextNumber}, PDF und XML werden erzeugt und gebucht. Danach ist sie nicht mehr
            änderbar; Korrekturen laufen über Storno oder Rechnungskorrektur. Noch einmal klicken zum Festschreiben.
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
          <section className="card" aria-label="Rechnungsdaten">
            <div className="form-grid">
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                Kunde
                <select value={contactId} onChange={(e) => chooseContact(e.target.value)} disabled={kind !== "rechnung"}>
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
                Rechnungsdatum
                <input type="date" value={issueDate} onChange={(e) => touch(setIssueDate)(e.target.value)} required />
              </label>
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
              <label className="field">
                Leistung von
                <input type="date" value={serviceFrom} onChange={(e) => touch(setServiceFrom)(e.target.value)} />
              </label>
              <label className="field">
                Leistung bis
                <input type="date" value={serviceTo} onChange={(e) => touch(setServiceTo)(e.target.value)} />
              </label>
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
                    aria-invalid={line.description.trim() === ""}
                  />
                  <input
                    className="num"
                    inputMode="decimal"
                    aria-label={`Menge Position ${index + 1}`}
                    value={line.quantity}
                    onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                    aria-invalid={parseQuantity(line.quantity) === null}
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
                    aria-invalid={parseEuro(line.unitPrice) === null}
                  />
                  <select
                    aria-label={`Steuersatz Position ${index + 1}`}
                    value={line.taxRate}
                    onChange={(e) => updateLine(line.key, { taxRate: Number(e.target.value) as 1900 | 700 | 0 })}
                  >
                    <option value={1900}>19 %</option>
                    <option value={700}>7 %</option>
                    <option value={0}>0 %</option>
                  </select>
                  <div className="num line-net">{p.valid ? formatEuro(lineNet(p.quantity, p.unitPrice)) : "–"}</div>
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
                    { key: nextKey++, description: "", quantity: "1", unit: last?.unit ?? "Std.", unitPrice: "", taxRate: last?.taxRate ?? 1900 },
                  ]);
                  setDirty(true);
                }}
              >
                + Position hinzufügen
              </button>
            </div>
            <label className="field">
              Hinweis auf der Rechnung (optional)
              <textarea value={note} onChange={(e) => touch(setNote)(e.target.value)} maxLength={2000} />
            </label>
          </section>

          <div className="banner banner-info">
            <Icon name="info" />
            <span>
              Nach dem Festschreiben bekommt die Rechnung ihre endgültige Nummer und ist nicht mehr änderbar. Korrekturen laufen über
              eine Stornorechnung oder Rechnungskorrektur.
            </span>
          </div>
          {id && (
            <div className="actions">
              <button type="button" className="btn btn-dashed" onClick={onDelete} disabled={busy}>
                Entwurf löschen
              </button>
            </div>
          )}
        </form>

        <section aria-label="Vorschau" className="stack" style={{ gap: 8 }}>
          <div className="small muted">
            Vorschau · {format === "zugferd" ? "PDF/A-3 mit eingebettetem XML" : "XRechnung (XML) mit PDF-Sichtkopie"}
          </div>
          <InvoicePreview
            kind={kind}
            number={nextNumber}
            issueDate={issueDate || initial.issueDate}
            dueDate={dueDate}
            serviceFrom={serviceFrom || null}
            serviceTo={serviceTo || null}
            seller={seller}
            buyer={contact}
            lines={parsed}
            note={note}
            corrects={corrects}
          />
        </section>
      </div>
    </>
  );
}
