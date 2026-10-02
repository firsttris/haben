import { formatDecimal, formatEuro, parseEuro, taxOf, type ExpenseCategory } from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { DocumentStatus, SOURCE_LABEL } from "../../../components/DocumentStatus.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { errorMessage, formatDateTime } from "../../../lib/format.ts";
import {
  bookDocumentFn,
  deleteDocumentFn,
  getDocumentDetail,
  reextractDocument,
  saveDocument,
} from "../../../server/functions/documents.ts";

export const Route = createFileRoute("/_app/belege/$id")({
  loader: ({ params }) => getDocumentDetail({ data: params.id }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.document.supplierName || "Beleg"} · Haben` }],
  }),
  component: DocumentPage,
});

type Detail = Awaited<ReturnType<typeof getDocumentDetail>>;
type Rate = 1900 | 700 | 0;

interface AmountState {
  key: number;
  taxRate: Rate;
  net: string;
  tax: string;
  taxTouched: boolean;
}

let nextKey = 1;

function DocumentPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const { document: doc } = data;
  const running = doc.extractionStatus === "laeuft";

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void router.invalidate(), 2500);
    return () => clearInterval(timer);
  }, [running, router]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/belege">Belege</Link> › {doc.filename}
          </div>
          <h1>{doc.supplierName || "Neuer Beleg"}</h1>
        </div>
        <div className="actions">
          <DocumentStatus status={doc.status} extractionStatus={doc.extractionStatus} />
          <a className="btn" href={`/api/beleg/${doc.id}?download`}>
            Original herunterladen
          </a>
        </div>
      </div>
      <div className="editor-grid">
        <Preview doc={doc} />
        {/* key: nach dem Auslesen oder Speichern mit den neuen Werten aufsetzen */}
        <DocumentForm key={`${doc.id}-${String(doc.updatedAt)}`} data={data} />
      </div>
    </>
  );
}

function Preview({ doc }: { doc: Detail["document"] }) {
  const src = `/api/beleg/${doc.id}`;
  if (doc.mimeType === "application/pdf") {
    return <iframe className="doc-preview" src={src} title={`Beleg ${doc.filename}`} />;
  }
  if (doc.mimeType.startsWith("image/") && doc.mimeType !== "image/heic") {
    return <img className="doc-image" src={src} alt={`Beleg ${doc.filename}`} />;
  }
  return (
    <section className="card">
      <p className="muted" style={{ margin: 0 }}>
        Für {doc.mimeType === "application/xml" ? "XML-Rechnungen" : "dieses Format"} gibt es keine Vorschau.{" "}
        <a href={src} target="_blank" rel="noreferrer">
          Datei öffnen
        </a>
      </p>
    </section>
  );
}

function DocumentForm({ data }: { data: Detail }) {
  const { document: doc, amounts, categories, issues, aiAvailable } = data;
  const router = useRouter();
  const navigate = useNavigate();
  const save = useServerFn(saveDocument);
  const book = useServerFn(bookDocumentFn);
  const remove = useServerFn(deleteDocumentFn);
  const reextract = useServerFn(reextractDocument);
  const locked = doc.status === "gebucht";
  const running = doc.extractionStatus === "laeuft";

  const [supplierName, setSupplierName] = useState(doc.supplierName);
  const [supplierUstId, setSupplierUstId] = useState(doc.supplierUstId);
  const [invoiceNumber, setInvoiceNumber] = useState(doc.invoiceNumber);
  const [documentDate, setDocumentDate] = useState(doc.documentDate ?? "");
  const [dueDate, setDueDate] = useState(doc.dueDate ?? "");
  const [category, setCategory] = useState(doc.category ?? "");
  const [payment, setPayment] = useState(doc.payment);
  const [note, setNote] = useState(doc.note);
  const [rows, setRows] = useState<AmountState[]>(() =>
    (amounts.length > 0 ? amounts : [{ taxRate: 1900, net: 0, tax: 0 }]).map((a) => ({
      key: nextKey++,
      taxRate: a.taxRate as Rate,
      net: a.net === 0 && amounts.length === 0 ? "" : formatDecimal(a.net),
      tax: a.tax === 0 && amounts.length === 0 ? "" : formatDecimal(a.tax),
      taxTouched: amounts.length > 0,
    })),
  );
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const parsed = rows.map((r) => ({ taxRate: r.taxRate, net: parseEuro(r.net || "0"), tax: parseEuro(r.tax || "0") }));
  const valid = parsed.every((p) => p.net !== null && p.tax !== null) && new Set(rows.map((r) => r.taxRate)).size === rows.length;
  const gross = valid ? parsed.reduce((s, p) => s + p.net! + p.tax!, 0) : null;

  function touch<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
      setConfirming(false);
    };
  }

  function updateRow(key: number, patch: Partial<AmountState>) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...patch };
        // Steuer aus dem Netto vorschlagen, bis sie von Hand geändert wurde
        if (!next.taxTouched && ("net" in patch || "taxRate" in patch)) {
          const net = parseEuro(next.net || "0");
          next.tax = net === null ? next.tax : formatDecimal(taxOf(net, next.taxRate));
        }
        return next;
      }),
    );
    setDirty(true);
    setConfirming(false);
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

  async function persist() {
    await save({
      data: {
        id: doc.id,
        document: {
          supplierName,
          supplierUstId,
          invoiceNumber,
          documentDate: documentDate || null,
          dueDate: dueDate || null,
          category: (category || null) as ExpenseCategory | null,
          payment,
          note,
          amounts: parsed.filter((p) => p.net !== 0 || p.tax !== 0).map((p) => ({ taxRate: p.taxRate, net: p.net!, tax: p.tax! })),
        },
      },
    });
    setDirty(false);
  }

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await persist();
      await router.invalidate();
    });
  };

  const onBook = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    void run(async () => {
      if (dirty) await persist();
      await book({ data: doc.id });
      setConfirming(false);
      await router.invalidate();
    });
  };

  const onDelete = () =>
    run(async () => {
      await remove({ data: doc.id });
      await navigate({ to: "/belege" });
    });

  const onReextract = () =>
    run(async () => {
      await reextract({ data: doc.id });
      await router.invalidate();
    });

  return (
    <form className="stack" onSubmit={onSave}>
      {running && (
        <div className="banner banner-info" role="status">
          <Icon name="info" />
          <span>Die KI liest den Beleg gerade aus. Die Felder füllen sich gleich.</span>
        </div>
      )}
      {doc.extractionError && !locked && (
        <div className={`banner ${doc.extractionStatus === "fehler" ? "banner-danger" : ""}`} role="status">
          <Icon name="alert" />
          <span>{doc.extractionError}</span>
        </div>
      )}
      {doc.extractedBy && doc.extractedBy !== "manuell" && !locked && !running && (
        <p className="small muted" style={{ margin: 0 }}>
          Vorbefüllt aus {SOURCE_LABEL[doc.extractedBy]}. Bitte prüfen und bestätigen.
        </p>
      )}
      {locked && (
        <div className="banner banner-ok" role="status">
          <Icon name="check" />
          <span>Gebucht {doc.lockedAt ? formatDateTime(doc.lockedAt) : ""}. Der Beleg ist festgeschrieben.</span>
        </div>
      )}

      <fieldset className="card" disabled={locked || running} style={{ margin: 0 }}>
        <legend className="visually-hidden">Belegdaten</legend>
        <div className="form-grid">
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            Lieferant
            <input value={supplierName} onChange={(e) => touch(setSupplierName)(e.target.value)} />
          </label>
          <label className="field">
            Rechnungsnummer
            <input value={invoiceNumber} onChange={(e) => touch(setInvoiceNumber)(e.target.value)} />
          </label>
          <label className="field">
            USt-IdNr. des Lieferanten
            <input value={supplierUstId} onChange={(e) => touch(setSupplierUstId)(e.target.value)} />
          </label>
          <label className="field">
            Belegdatum
            <input type="date" value={documentDate} onChange={(e) => touch(setDocumentDate)(e.target.value)} />
          </label>
          <label className="field">
            Fällig am
            <input type="date" value={dueDate} onChange={(e) => touch(setDueDate)(e.target.value)} />
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            Kategorie
            <select value={category} onChange={(e) => touch(setCategory)(e.target.value)}>
              <option value="">Bitte wählen</option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="card" disabled={locked || running} style={{ margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 16, padding: 0, marginBottom: 4 }}>Beträge je Steuersatz</legend>
        {rows.map((row, index) => (
          <div className="amount-row" key={row.key}>
            <label className="field">
              Satz
              <select value={row.taxRate} onChange={(e) => updateRow(row.key, { taxRate: Number(e.target.value) as Rate })}>
                <option value={1900}>19 %</option>
                <option value={700}>7 %</option>
                <option value={0}>0 %</option>
              </select>
            </label>
            <label className="field">
              Netto
              <input
                className="mono"
                inputMode="decimal"
                value={row.net}
                placeholder="0,00"
                onChange={(e) => updateRow(row.key, { net: e.target.value })}
                aria-invalid={parsed[index]!.net === null}
              />
            </label>
            <label className="field">
              Vorsteuer
              <input
                className="mono"
                inputMode="decimal"
                value={row.tax}
                placeholder="0,00"
                onChange={(e) => updateRow(row.key, { tax: e.target.value, taxTouched: true })}
                aria-invalid={parsed[index]!.tax === null}
              />
            </label>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Zeile ${index + 1} entfernen`}
              disabled={rows.length === 1}
              onClick={() => {
                setRows((prev) => prev.filter((r) => r.key !== row.key));
                setDirty(true);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-dashed"
            disabled={rows.length >= 3}
            onClick={() => {
              const used = new Set(rows.map((r) => r.taxRate));
              const rate = ([1900, 700, 0] as Rate[]).find((r) => !used.has(r)) ?? 0;
              setRows((prev) => [...prev, { key: nextKey++, taxRate: rate, net: "", tax: "", taxTouched: false }]);
            }}
          >
            + Steuersatz
          </button>
          <div>
            <span className="muted small">Gesamt </span>
            <span className="mono" style={{ fontWeight: 600 }}>
              {gross === null ? "–" : formatEuro(gross)}
            </span>
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Gutschriften mit Minus eingeben.</p>
      </fieldset>

      <fieldset className="card" disabled={locked || running} style={{ margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 16, padding: 0, marginBottom: 4 }}>Bezahlung</legend>
        <label className="checkbox">
          <input type="radio" name="payment" checked={payment === "bank"} onChange={() => touch(setPayment)("bank")} />
          Über das Geschäftskonto (Zuordnung beim Bankabgleich)
        </label>
        <label className="checkbox">
          <input type="radio" name="payment" checked={payment === "privat"} onChange={() => touch(setPayment)("privat")} />
          Privat bezahlt (Privateinlage)
        </label>
        <label className="field">
          Notiz
          <textarea value={note} onChange={(e) => touch(setNote)(e.target.value)} maxLength={2000} />
        </label>
      </fieldset>

      {!locked && issues.length > 0 && !dirty && (
        <div className="banner" role="status">
          <Icon name="alert" />
          <span>Vor dem Buchen: {issues.join(", ")}.</span>
        </div>
      )}
      {confirming && (
        <div className="banner" role="alert">
          <Icon name="alert" />
          <span>Der Beleg wird gebucht und festgeschrieben; danach ist er nicht mehr änderbar. Noch einmal klicken zum Buchen.</span>
        </div>
      )}
      {notice && (
        <div className={`banner banner-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"}>
          {notice.text}
        </div>
      )}
      {!locked && (
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={onBook} disabled={busy || running || !valid}>
            {confirming ? "Jetzt buchen" : "Bestätigen und buchen"}
          </button>
          <button type="submit" className="btn" disabled={busy || running || !valid || !dirty}>
            Speichern
          </button>
          {aiAvailable && doc.mimeType !== "application/xml" && doc.mimeType !== "image/heic" && (
            <button type="button" className="btn" onClick={onReextract} disabled={busy || running}>
              Mit KI neu auslesen
            </button>
          )}
          <button type="button" className="btn btn-dashed" onClick={onDelete} disabled={busy || running}>
            Löschen
          </button>
        </div>
      )}
    </form>
  );
}
