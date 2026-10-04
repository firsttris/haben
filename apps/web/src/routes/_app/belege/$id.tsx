import {
  ASSET_KINDS,
  ASSET_METHODS,
  formatDecimal,
  formatEuro,
  parseEuro,
  taxOf,
  type AssetKind,
  type AssetMethod,
  type ExpenseCategory,
} from "@haben/core";
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

/** USt-IdNr. aus einem anderen EU-Land (ohne DE); Griechenland hat EL */
const EU_VAT_PREFIX = /^(AT|BE|BG|CY|CZ|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[0-9A-Z]{2,12}$/;

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
    return (
      <>
        <iframe className="doc-preview" src={src} title={`Beleg ${doc.filename}`} />
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
  const [privateShare, setPrivateShare] = useState(doc.privateShare ? String(doc.privateShare) : "");
  // Angaben zur Anlage bei Kategorie „anlage“; Vorschläge laut AfA-Tabelle
  const [assetName, setAssetName] = useState(doc.asset?.name ?? "");
  const [assetKind, setAssetKind] = useState<AssetKind>(doc.asset?.kind ?? "edv");
  const [assetMethod, setAssetMethod] = useState<AssetMethod>(doc.asset?.method ?? "digital");
  const [assetYears, setAssetYears] = useState(doc.asset?.usefulLifeMonths ? String(doc.asset.usefulLifeMonths / 12) : "");
  const [note, setNote] = useState(doc.note);
  const [reverseCharge, setReverseCharge] = useState<"eu" | "drittland" | null>(doc.reverseCharge ?? null);
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const parsed = rows.map((r) => ({ taxRate: r.taxRate, net: parseEuro(r.net || "0"), tax: parseEuro(r.tax || "0") }));
  const privateShareValue = category === "anlage" ? 0 : Number(privateShare || 0);
  const privateShareValid = Number.isInteger(privateShareValue) && privateShareValue >= 0 && privateShareValue <= 100;
  const valid =
    parsed.every((p) => p.net !== null && p.tax !== null) && new Set(rows.map((r) => r.taxRate)).size === rows.length && privateShareValid;
  // § 13b: gezahlt wird netto, die Steuer geht ans Finanzamt
  const gross = valid ? parsed.reduce((s, p) => s + p.net! + (reverseCharge ? 0 : p.tax!), 0) : null;
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
          privateShare: privateShareValue,
          reverseCharge,
          asset:
            category === "anlage"
              ? {
                  name: assetName.trim() || supplierName.trim() || "Anlage",
                  kind: assetKind,
                  method: assetMethod,
                  usefulLifeMonths: assetMethod === "linear" && Number(assetYears) > 0 ? Math.round(Number(assetYears.replace(",", ".")) * 12) : null,
                }
              : null,
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

  // Wie beim Buchen: erst nachfragen, der zweite Klick löscht
  const onDelete = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setConfirming(false);
      return;
    }
    void run(async () => {
      await remove({ data: doc.id });
      await navigate({ to: "/belege" });
    });
  };

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
              {reverseCharge ? "Steuer § 13b" : "Vorsteuer"}
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
            <span className="muted small">{reverseCharge ? "Zu zahlen (netto) " : "Gesamt "}</span>
            <span className="mono" style={{ fontWeight: 600 }}>
              {gross === null ? "–" : formatEuro(gross)}
            </span>
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
          <button type="button" className="btn btn-danger" onClick={onDelete} disabled={busy || running}>
            {confirmingDelete ? "Endgültig löschen" : "Löschen"}
          </button>
        </div>
      )}
    </form>
  );
}
