import {
  ASSET_KINDS,
  ASSET_METHODS,
  convertForeignAmounts,
  CURRENCY_CODE,
  formatDecimal,
  formatEuro,
  formatExchangeRate,
  parseEuro,
  parseExchangeRate,
  taxOf,
  type AssetKind,
  type AssetMethod,
  type ExpenseCategory,
} from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { z } from "zod/mini";
import { DocumentStatus, SOURCE_LABEL } from "../../../components/DocumentStatus.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { formatDateTime, parseUsefulLifeMonths } from "../../../lib/format.ts";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { useAction } from "../../../lib/use-action.ts";
import {
  bookDocumentFn,
  deleteDocumentFn,
  getDocumentDetail,
  reextractDocument,
  saveDocument,
} from "../../../server/functions/documents.ts";

export const Route = createFileRoute("/_app/belege/$id")({
  /** geprueft: nach dem Buchen war kein Beleg mehr „Zu prüfen“ */
  validateSearch: z.object({ geprueft: z.optional(z.boolean()) }),
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

/** USt-IdNr. aus einem anderen EU-Land (ohne DE); Griechenland hat EL */
const EU_VAT_PREFIX = /^(AT|BE|BG|CY|CZ|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[0-9A-Z]{2,12}$/;

const CONTINUE_KEY = "haben-belege-weiter";

/** Voreinstellung „nach dem Buchen weiter“: an, solange nichts anderes gemerkt ist; ohne Speicher (privates Fenster) einfach an */
function readContinuePreference(): boolean {
  if (continueFallback !== null) return continueFallback;
  try {
    return window.localStorage.getItem(CONTINUE_KEY) !== "nein";
  } catch {
    return true;
  }
}

const continueListeners = new Set<() => void>();
/** Ohne Speicher (privates Fenster) gilt die Wahl, bis die Seite neu geladen wird */
let continueFallback: boolean | null = null;

function subscribeContinuePreference(listener: () => void) {
  continueListeners.add(listener);
  return () => continueListeners.delete(listener);
}

function writeContinuePreference(value: boolean) {
  try {
    window.localStorage.setItem(CONTINUE_KEY, value ? "ja" : "nein");
  } catch {
    continueFallback = value;
  }
  for (const listener of continueListeners) listener();
}

function DocumentPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const { geprueft } = Route.useSearch();
  const { document: doc, navigation } = data;
  const running = doc.extractionStatus === "laeuft";
  // Das Formular meldet ungespeicherte Änderungen; beim Wechsel des Belegs setzt es sich mit false neu auf
  const [dirty, setDirty] = useState(false);
  // Ungespeicherte Änderungen: erst nachfragen, der zweite Klick wechselt und verwirft sie
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null);
  const pendingId = pending?.from === doc.id ? pending.to : null;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void router.invalidate(), 2500);
    return () => clearInterval(timer);
  }, [running, router]);

  /** Zu einem anderen Beleg oder ("liste") zurück zur Liste; bei ungespeicherten Änderungen erst nachfragen */
  function go(id: string | null) {
    if (!id) return;
    if (dirty && pendingId !== id) {
      setPending({ from: doc.id, to: id });
      return;
    }
    if (id === "liste") void navigate({ to: "/belege" });
    else void navigate({ to: "/belege/$id", params: { id } });
  }

  // J/K bzw. Pfeiltasten springen zum nächsten bzw. vorigen Beleg, wie im Bankabgleich
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.closest("input, select, textarea, [contenteditable]") || event.metaKey || event.ctrlKey || event.altKey) return;
      // Esc bricht zuerst eine Rückfrage im Formular ab (DocumentForm hört in der Capture-Phase und ruft preventDefault)
      if (event.key === "Escape" && event.defaultPrevented) return;
      const id =
        event.key === "j" || event.key === "ArrowRight"
          ? navigation.nextId
          : event.key === "k" || event.key === "ArrowLeft"
            ? navigation.previousId
            : event.key === "Escape"
              ? "liste"
              : null;
      if (!id) return;
      event.preventDefault();
      go(id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Auf dem Handy: nach links wischen zum nächsten, nach rechts zum vorigen Beleg (nicht in Eingabefeldern, nicht beim Scrollen)
  useEffect(() => {
    let start: { x: number; y: number } | null = null;
    function onStart(event: TouchEvent) {
      const target = event.target as HTMLElement;
      const touch = event.touches[0];
      start = event.touches.length === 1 && touch && !target.closest("input, select, textarea, [contenteditable]") ? { x: touch.clientX, y: touch.clientY } : null;
    }
    function onEnd(event: TouchEvent) {
      const touch = event.changedTouches[0];
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      start = null;
      if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) / 2) return;
      go(dx < 0 ? navigation.nextId : navigation.previousId);
    }
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  });

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
          {navigation.position > 0 && (
            <div className="doc-nav" role="group" aria-label="Zwischen Belegen wechseln">
              <button type="button" className="btn" onClick={() => go(navigation.previousId)} disabled={!navigation.previousId} title="Vorheriger Beleg (K)">
                ‹ Vorheriger
              </button>
              <span className="small muted">
                {navigation.position} von {navigation.total}
              </span>
              <button type="button" className="btn" onClick={() => go(navigation.nextId)} disabled={!navigation.nextId} title="Nächster Beleg (J)">
                Nächster ›
              </button>
            </div>
          )}
          {data.assetId && (
            <Link to="/anlagen/$id" params={{ id: data.assetId }} className="btn">
              Zur Anlage
            </Link>
          )}
          <a className="btn" href={`/api/beleg/${doc.id}?download`}>
            Original herunterladen
          </a>
        </div>
      </div>
      {pendingId && (
        <div className="banner" role="alert">
          <Icon name="alert" />
          <span>Der Beleg hat ungespeicherte Änderungen. Noch einmal klicken, um ohne Speichern zu wechseln.</span>
        </div>
      )}
      {geprueft && doc.status === "gebucht" && (
        <div className="banner banner-ok" role="status">
          <Icon name="check" />
          <span>
            Alle Belege geprüft: Es ist keiner mehr offen. <Link to="/belege">Zur Liste</Link>
          </span>
        </div>
      )}
      <div className="editor-grid doc-editor">
        <Preview doc={doc} />
        {/* key: nach dem Auslesen oder Speichern mit den neuen Werten aufsetzen */}
        <DocumentForm key={`${doc.id}-${String(doc.updatedAt)}`} data={data} onDirtyChange={setDirty} />
      </div>
    </>
  );
}

function Preview({ doc }: { doc: Detail["document"] }) {
  const src = `/api/beleg/${doc.id}`;
  if (doc.mimeType === "application/pdf") {
    return (
      <>
        <iframe className="doc-preview" src={`${src}#view=Fit`} title={`Beleg ${doc.filename}`} />
        <a className="btn pdf-open" href={src} target="_blank" rel="noreferrer">
          PDF öffnen
        </a>
      </>
    );
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

function DocumentForm({ data, onDirtyChange }: { data: Detail; onDirtyChange: (dirty: boolean) => void }) {
  const { document: doc, amounts, categories, issues, aiAvailable, navigation } = data;
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
  const [privateShare, setPrivateShare] = useState(doc.privateShare ? String(doc.privateShare) : "");
  // Angaben zur Anlage bei Kategorie „anlage“; Vorschläge laut AfA-Tabelle
  const [assetName, setAssetName] = useState(doc.asset?.name ?? "");
  const [assetKind, setAssetKind] = useState<AssetKind>(doc.asset?.kind ?? "edv");
  const [assetMethod, setAssetMethod] = useState<AssetMethod>(doc.asset?.method ?? "digital");
  const [assetYears, setAssetYears] = useState(doc.asset?.usefulLifeMonths ? String(doc.asset.usefulLifeMonths / 12) : "");
  const [note, setNote] = useState(doc.note);
  const [reverseCharge, setReverseCharge] = useState<"eu" | "drittland" | null>(doc.reverseCharge ?? null);
  const [currency, setCurrency] = useState(doc.currency);
  const [exchangeRate, setExchangeRate] = useState(doc.exchangeRate ? formatExchangeRate(doc.exchangeRate) : "");
  // Bei Fremdwährung stehen in den Zeilen die Beträge laut Beleg; Euro rechnet Haben mit dem Kurs aus
  const [rows, setRows] = useState<AmountState[]>(() =>
    (amounts.length > 0 ? amounts : [{ taxRate: 1900, net: 0, tax: 0, originalNet: null, originalTax: null }]).map((a) => {
      const net = doc.currency === "EUR" ? a.net : (a.originalNet ?? 0);
      const tax = doc.currency === "EUR" ? a.tax : (a.originalTax ?? 0);
      return {
        key: nextKey++,
        taxRate: a.taxRate as Rate,
        net: net === 0 && amounts.length === 0 ? "" : formatDecimal(net),
        tax: tax === 0 && amounts.length === 0 ? "" : formatDecimal(tax),
        taxTouched: amounts.length > 0,
      };
    }),
  );
  const [dirty, setDirty] = useState(false);
  const { busy, notice, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Nach dem Buchen zum nächsten offenen Beleg oder hierbleiben (etwa für den Bankabgleich); gemerkt im Browser
  // Der Server kennt die Wahl nicht und rendert „an“; im Browser gilt der gemerkte Wert
  const continueAfterBooking = useSyncExternalStore(subscribeContinuePreference, readContinuePreference, () => true);

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const parsed = rows.map((r) => ({ taxRate: r.taxRate, net: parseEuro(r.net || "0"), tax: parseEuro(r.tax || "0") }));
  const privateShareValue = category === "anlage" ? 0 : Number(privateShare || 0);
  const privateShareValid = Number.isInteger(privateShareValue) && privateShareValue >= 0 && privateShareValue <= 100;
  const currencyCode = currency.trim().toUpperCase();
  const foreign = currencyCode !== "EUR";
  const rate = exchangeRate.trim() ? parseExchangeRate(exchangeRate) : null;
  const currencyValid = CURRENCY_CODE.test(currencyCode) && (!foreign || !exchangeRate.trim() || rate !== null);
  const valid =
    parsed.every((p) => p.net !== null && p.tax !== null) &&
    new Set(rows.map((r) => r.taxRate)).size === rows.length &&
    privateShareValid &&
    currencyValid;
  // § 13b: gezahlt wird netto, die Steuer geht ans Finanzamt
  const gross = valid ? parsed.reduce((s, p) => s + p.net! + (reverseCharge ? 0 : p.tax!), 0) : null;
  // Fremdwährung: dieselbe Umrechnung wie beim Speichern, damit die Vorschau mit dem Gebuchten übereinstimmt
  const euroRows =
    valid && foreign && rate
      ? convertForeignAmounts(parsed.map((p) => ({ taxRate: p.taxRate, originalNet: p.net!, originalTax: p.tax! })), rate, Boolean(reverseCharge))
      : null;
  const euroGross = euroRows ? euroRows.reduce((s, e) => s + e.net + (reverseCharge ? 0 : e.tax), 0) : null;
  // Lieferant mit USt-IdNr. aus einem anderen EU-Land und keine Steuer auf dem Beleg: vermutlich § 13b
  const looksLikeReverseCharge =
    !reverseCharge && EU_VAT_PREFIX.test(supplierUstId.replace(/\s/g, "").toUpperCase()) && parsed.every((p) => p.tax === 0) && parsed.some((p) => p.net);

  function chooseReverseCharge(value: "eu" | "drittland" | null) {
    touch(setReverseCharge)(value);
    // Die Steuer steht nicht auf der Rechnung; Haben rechnet sie aus dem Netto, 0 % gibt es bei § 13b nicht
    if (value) {
      setRows((prev) =>
        prev.map((row) => {
          const taxRate = row.taxRate === 0 ? 1900 : row.taxRate;
          const net = parseEuro(row.net || "0");
          return { ...row, taxRate, taxTouched: false, tax: net === null ? row.tax : formatDecimal(taxOf(net, taxRate)) };
        }),
      );
    }
  }

  function touch<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
      setConfirming(false);
      setConfirmingDelete(false);
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
    setConfirmingDelete(false);
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
          privateShare: privateShareValue,
          reverseCharge,
          currency: currencyCode,
          exchangeRate: foreign ? exchangeRate : null,
          asset:
            category === "anlage"
              ? {
                  name: assetName.trim() || supplierName.trim() || "Anlage",
                  kind: assetKind,
                  method: assetMethod,
                  usefulLifeMonths: assetMethod === "linear" ? parseUsefulLifeMonths(assetYears) : null,
                }
              : null,
          amounts: parsed
            .filter((p) => p.net !== 0 || p.tax !== 0)
            .map((p) =>
              foreign
                ? { taxRate: p.taxRate, net: 0, tax: 0, originalNet: p.net!, originalTax: p.tax! }
                : { taxRate: p.taxRate, net: p.net!, tax: p.tax! },
            ),
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
      // Weiter zum nächsten Beleg „Zu prüfen“; der gebuchte rückt in der Liste zu den gebuchten nach hinten
      if (continueAfterBooking && navigation.nextOpenId) {
        await navigate({ to: "/belege/$id", params: { id: navigation.nextOpenId } });
        return;
      }
      await router.invalidate();
      // Keiner mehr offen: Meldung mit Link zur Liste
      if (continueAfterBooking) await navigate({ to: "/belege/$id", params: { id: doc.id }, search: { geprueft: true }, replace: true });
    });
  };

  // Wie beim Buchen: erst nachfragen, der zweite Klick löscht
  const onDelete = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setConfirming(false);
      return;
    }
    void run(async () => {
      await remove({ data: doc.id });
      // Weiter zum nächsten Beleg „Zu prüfen“; sind keine mehr offen, zurück zur Liste statt auf einen gebuchten
      const next = navigation.nextOpenId;
      await navigate(next ? { to: "/belege/$id", params: { id: next } } : { to: "/belege" });
    });
  };

  // Strg+Enter (Mac: Cmd+Enter) wie ein Klick auf „Bestätigen und buchen“, auch aus einem Eingabefeld;
  // Esc bricht eine offene Rückfrage ab
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (locked) return;
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        if (!busy && !running && valid) onBook();
      } else if (event.key === "Escape" && (confirming || confirmingDelete)) {
        event.preventDefault();
        setConfirming(false);
        setConfirmingDelete(false);
      }
    }
    // capture: läuft immer vor dem Esc-Handler der Seite, egal in welcher Reihenfolge die Listener neu angemeldet werden
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
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
            <select
              value={category}
              onChange={(e) => {
                touch(setCategory)(e.target.value);
                // Vorgabe aus den Firmendaten, z. B. Telefon 20 %
                const preset = data.privateShares[e.target.value];
                setPrivateShare(preset ? String(preset) : "");
              }}
            >
              <option value="">Bitte wählen</option>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          {category === "anlage" && (
            <>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                Bezeichnung der Anlage
                <input value={assetName} onChange={(e) => touch(setAssetName)(e.target.value)} placeholder="z. B. VW Passat, MacBook Pro" maxLength={200} />
              </label>
              <label className="field">
                Art
                <select
                  value={assetKind}
                  onChange={(e) => {
                    const kind = e.target.value as AssetKind;
                    touch(setAssetKind)(kind);
                    setAssetMethod(ASSET_KINDS[kind].method);
                    const years = ASSET_KINDS[kind].usefulLifeYears;
                    if (years && ASSET_KINDS[kind].method === "linear") setAssetYears(String(years));
                  }}
                >
                  {Object.entries(ASSET_KINDS).map(([value, k]) => (
                    <option key={value} value={value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Abschreibung
                <select value={assetMethod} onChange={(e) => touch(setAssetMethod)(e.target.value as AssetMethod)}>
                  {Object.entries(ASSET_METHODS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {assetMethod === "linear" && (
                <label className="field">
                  Nutzungsdauer in Jahren
                  <input inputMode="decimal" value={assetYears} onChange={(e) => touch(setAssetYears)(e.target.value)} />
                </label>
              )}
              <p className="small muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
                Beim Buchen entsteht die Anlage im <Link to="/anlagen">Anlagenverzeichnis</Link>; abgeschrieben wird ab dem Belegdatum.
              </p>
            </>
          )}
        </div>
      </fieldset>

      <fieldset className="card" disabled={locked || running} style={{ margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 16, padding: 0, marginBottom: 4 }}>Beträge je Steuersatz</legend>
        <label className="field">
          Umsatzsteuer auf dem Beleg
          <select
            value={reverseCharge ?? ""}
            onChange={(e) => chooseReverseCharge((e.target.value || null) as "eu" | "drittland" | null)}
            aria-describedby="rc-hint"
          >
            <option value="">Mit deutscher Umsatzsteuer (Vorsteuer)</option>
            <option value="eu">§ 13b: Leistung eines Unternehmers aus dem EU-Ausland</option>
            <option value="drittland">§ 13b: Leistung eines Unternehmers aus dem Drittland</option>
          </select>
          {reverseCharge ? (
            <span id="rc-hint" className="small">
              Die Rechnung weist keine deutsche Umsatzsteuer aus (Reverse Charge). Die Steuer schuldest du; Haben rechnet sie aus dem
              Netto, meldet sie in Kz {reverseCharge === "eu" ? "46/47" : "84/85"} und zieht sie zugleich als Vorsteuer ab (Kz 67).
              Bezahlt wird nur der Nettobetrag.
            </span>
          ) : (
            looksLikeReverseCharge && (
              <span id="rc-hint" className="small">
                Lieferant aus dem EU-Ausland ohne Umsatzsteuer auf der Rechnung, etwa Google, Microsoft oder AWS? Dann ist es meist § 13b.
              </span>
            )
          )}
        </label>
        <div className="form-grid">
          <label className="field">
            Währung
            <input
              value={currency}
              onChange={(e) => touch(setCurrency)(e.target.value.toUpperCase().slice(0, 3))}
              list="currency-codes"
              maxLength={3}
              aria-invalid={!CURRENCY_CODE.test(currencyCode)}
              aria-describedby={foreign ? "currency-hint" : undefined}
            />
            <datalist id="currency-codes">
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
                placeholder="z. B. 1,0812"
                onChange={(e) => touch(setExchangeRate)(e.target.value)}
                aria-invalid={exchangeRate.trim() !== "" && rate === null}
                aria-describedby="currency-hint"
              />
            </label>
          )}
          {foreign && (
            <span id="currency-hint" className="small" style={{ gridColumn: "1 / -1" }}>
              Beträge unten in {currencyCode || "der Fremdwährung"}, wie auf dem Beleg. Haben rechnet sie mit dem Kurs in Euro um und bucht nur
              Euro. Für die Umsatzsteuer gilt der Umsatzsteuer-Umrechnungskurs des BMF für den Monat der Leistung (§ 16 Abs. 6 UStG); bei § 13b
              wird die Steuer aus dem umgerechneten Netto berechnet.
            </span>
          )}
        </div>
        {rows.map((row, index) => (
          <div className="amount-row" key={row.key}>
            <label className="field">
              Satz
              <select value={row.taxRate} onChange={(e) => updateRow(row.key, { taxRate: Number(e.target.value) as Rate })}>
                <option value={1900}>19 %</option>
                <option value={700}>7 %</option>
                {!reverseCharge && <option value={0}>0 %</option>}
              </select>
            </label>
            <label className="field">
              {foreign ? `Netto ${currencyCode}` : "Netto"}
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
              {reverseCharge ? "Steuer § 13b" : "Vorsteuer"}
              {foreign ? ` ${currencyCode}` : ""}
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
          <div style={{ textAlign: "right" }}>
            <span className="muted small">{reverseCharge ? "Zu zahlen (netto) " : "Gesamt "}</span>
            <span className="mono" style={{ fontWeight: 600 }}>
              {gross === null ? "–" : foreign ? `${formatDecimal(gross)} ${currencyCode}` : formatEuro(gross)}
            </span>
            {foreign && (
              <div className="small" aria-live="polite">
                {euroRows ? (
                  <>
                    in Euro{" "}
                    <span className="mono" style={{ fontWeight: 600 }}>
                      {formatEuro(euroGross!)}
                    </span>
                    {euroRows.length > 0 && (
                      <span className="muted">
                        {" "}
                        ({euroRows.map((e) => `${e.taxRate / 100} %: ${formatDecimal(e.net)} + ${formatDecimal(e.tax)}`).join(" · ")})
                      </span>
                    )}
                  </>
                ) : (
                  <span className="muted">in Euro erst mit Kurs</span>
                )}
              </div>
            )}
          </div>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Gutschriften mit Minus eingeben.</p>
        {category !== "anlage" && (
          <label className="field" style={{ maxWidth: 220 }}>
            Privatanteil in %
            <input
              inputMode="numeric"
              value={privateShare}
              placeholder="0"
              onChange={(e) => touch(setPrivateShare)(e.target.value.replace(/\D/g, "").slice(0, 3))}
              aria-invalid={!privateShareValid}
              aria-describedby="private-share-hint"
            />
            <span id="private-share-hint" className="small">
              Z. B. beim Handyvertrag: nur der betriebliche Teil wird Ausgabe und Vorsteuer.
            </span>
          </label>
        )}
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
        <label className="checkbox">
          <input type="radio" name="payment" checked={payment === "kasse"} onChange={() => touch(setPayment)("kasse")} />
          Bar aus der Kasse (Zeile im Kassenbuch)
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
      {confirmingDelete && (
        <div className="banner" role="alert">
          <Icon name="alert" />
          <span>Der Beleg und seine Datei werden gelöscht. Zum Löschen noch einmal auf „Endgültig löschen“ klicken.</span>
        </div>
      )}
      <NoticeBanner notice={notice} />
      {!locked && (
        <div className="actions doc-actions">
          <button type="button" className="btn btn-primary" onClick={onBook} disabled={busy || running || !valid} title="Strg+Enter">
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
          <button type="button" className="btn btn-danger" onClick={onDelete} disabled={busy || running}>
            {confirmingDelete ? "Endgültig löschen" : "Löschen"}
          </button>
          <label className="checkbox small" style={{ flexBasis: "100%" }}>
            <input
              type="checkbox"
              checked={continueAfterBooking}
              onChange={(e) => writeContinuePreference(e.target.checked)}
            />
            Nach dem Buchen zum nächsten offenen Beleg
          </label>
          <span className="small muted pointer-fine" style={{ flexBasis: "100%" }}>
            Tastatur: Strg+Enter bucht, J und K wechseln den Beleg, Esc führt zurück zur Liste.
          </span>
        </div>
      )}
    </form>
  );
}
