import {
  ASSET_KINDS,
  ASSET_METHODS,
  convertForeignAmounts,
  CURRENCY_CODE,
  describeExchangeRate,
  formatDecimal,
  formatEuro,
  formatExchangeRate,
  parseEuro,
  parseExchangeRate,
  taxOf,
  type AssetKind,
  type AssetMethod,
  usesUsefulLife,
  type ExpenseCategory,
  type SelfAssessedTax,
  isKapitalgesellschaft,
  elektroAvailable,
  ownerLabels,
} from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { z } from "zod/mini";
import { DocumentCancellation } from "../../../components/DocumentCancellation.tsx";
import { BelegVerrechnung } from "../../../components/BelegVerrechnung.tsx";
import { DocumentSplits, parseSplitRows, splitRow, type SplitRowState } from "../../../components/DocumentSplits.tsx";
import { EigenesKontoWahl, passendesKonto } from "../../../components/EigenesKontoWahl.tsx";
import { DocumentStatus, SOURCE_LABEL } from "../../../components/DocumentStatus.tsx";
import { IbanCheck } from "../../../components/IbanCheck.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { ContactCombobox, savedAsChoice, type ContactChoice } from "../../../components/ContactCombobox.tsx";
import { NewContactDialog } from "../../../components/NewContactDialog.tsx";
import { formatDate, formatDateTime, parseUsefulLifeMonths } from "../../../lib/format.ts";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { useAction } from "../../../lib/use-action.ts";
import { bookDocumentFn, deleteDocumentFn, getDocumentDetail, reextractDocument, saveDocument } from "../../../server/functions/documents.ts";
import { ConfirmDialog, isDialogOpen } from "../../../components/ConfirmDialog.tsx";
import { Field } from "../../../components/Field.tsx";

/** Bezahlung früherer Belege desselben Lieferanten, für den Hinweis unter „Bezahlung“ (#295) */
function paymentHintText(payment: "bank" | "privat" | "kasse", gesellschaft: boolean): string {
  if (payment === "bank") return "über das Geschäftskonto bezahlt";
  if (payment === "kasse") return "bar aus der Kasse bezahlt";
  return gesellschaft ? "vom Gesellschafter ausgelegt" : "privat bezahlt";
}

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
  const inhaber = Route.useRouteContext().user.role === "inhaber";
  const { document: doc, navigation } = data;
  const running = doc.extractionStatus === "laeuft";
  // Das Formular meldet ungespeicherte Änderungen; beim Wechsel des Belegs setzt es sich mit false neu auf
  const [dirty, setDirty] = useState(false);
  // Ungespeicherte Änderungen: erst nachfragen, der Dialog wechselt und verwirft sie
  const [pending, setPending] = useState<{ from: string; to: string } | null>(null);
  const pendingId = pending?.from === doc.id ? pending.to : null;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void router.invalidate(), 2500);
    return () => clearInterval(timer);
  }, [running, router]);

  function leaveTo(id: string) {
    if (id === "liste") void navigate({ to: "/belege" });
    else void navigate({ to: "/belege/$id", params: { id } });
  }

  /** Zu einem anderen Beleg oder ("liste") zurück zur Liste; bei ungespeicherten Änderungen erst nachfragen */
  function go(id: string | null) {
    if (!id) return;
    if (dirty) setPending({ from: doc.id, to: id });
    else leaveTo(id);
  }

  // J/K bzw. Pfeiltasten springen zum nächsten bzw. vorigen Beleg, wie im Bankabgleich
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (isDialogOpen() || target.closest("input, select, textarea, [contenteditable]") || event.metaKey || event.ctrlKey || event.altKey) return;
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
      start =
        event.touches.length === 1 && touch && !isDialogOpen() && !target.closest("input, select, textarea, [contenteditable]")
          ? { x: touch.clientX, y: touch.clientY }
          : null;
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
          <DocumentStatus status={doc.status} extractionStatus={doc.extractionStatus} cancelled={data.cancellation !== null} />
          {navigation.position > 0 && (
            <div className="doc-nav" role="group" aria-label="Zwischen Belegen wechseln">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => go(navigation.previousId)}
                disabled={!navigation.previousId}
                title="Vorheriger Beleg (K)"
              >
                <Icon name="chevron-left" size={16} />
                Vorheriger
              </button>
              <span className="small muted">
                {navigation.position} von {navigation.total}
              </span>
              <button type="button" className="btn btn-ghost" onClick={() => go(navigation.nextId)} disabled={!navigation.nextId} title="Nächster Beleg (J)">
                Nächster
                <Icon name="chevron-right" size={16} />
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
      <ConfirmDialog
        open={pendingId !== null}
        title="Ohne Speichern wechseln?"
        confirmLabel="Ohne Speichern wechseln"
        danger
        onConfirm={() => pendingId && leaveTo(pendingId)}
        onClose={() => setPending(null)}
      >
        <p>Der Beleg hat ungespeicherte Änderungen. Beim Wechsel gehen sie verloren.</p>
      </ConfirmDialog>
      {data.sepaTransfers.map((t) => (
        <div key={t.endToEndId} className="banner" role="status">
          <Icon name="bank" />
          <span>
            Überweisung erzeugt am {formatDateTime(t.createdAt)}: {formatEuro(t.amount)}
            {t.skonto > 0 ? ` nach ${formatEuro(t.skonto)} Skonto` : ""}, Ausführung {formatDate(t.executionDate)}, Referenz {t.endToEndId}. Bezahlt ist der
            Beleg, sobald der <Link to="/bank">Bankabgleich</Link> die Abbuchung zuordnet.
          </span>
        </div>
      ))}
      <IbanCheck
        documentId={doc.id}
        check={data.ibanCheck}
        canDecide={inhaber && doc.lockedAt !== null}
        booked={doc.lockedAt !== null}
        hasContact={doc.supplierContactId !== null}
      />
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
        <div className="stack">
          {/* key: nach dem Auslesen oder Speichern mit den neuen Werten aufsetzen */}
          <DocumentForm key={`${doc.id}-${String(doc.updatedAt)}`} data={data} onDirtyChange={setDirty} />
          {/* Außerhalb des Formulars: Enter im Feld „Grund“ speichert nicht */}
          {inhaber && <DocumentCancellation key={`storno-${doc.id}`} data={data} />}
          <BelegVerrechnung key={`verrechnung-${doc.id}`} documentId={doc.id} supplier={doc.supplierName} readOnly={!inhaber} />
        </div>
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
  const { document: doc, amounts, splits, categories, ownAccounts, issues, aiAvailable, navigation } = data;
  const router = useRouter();
  const navigate = useNavigate();
  const save = useServerFn(saveDocument);
  const book = useServerFn(bookDocumentFn);
  const remove = useServerFn(deleteDocumentFn);
  const reextract = useServerFn(reextractDocument);
  const locked = doc.status === "gebucht";
  // Die Steuerberatung sieht den Beleg wie einen gebuchten: alle Felder gesperrt, keine Knöpfe
  const inhaber = Route.useRouteContext().user.role === "inhaber";
  const readOnly = locked || !inhaber;
  const running = doc.extractionStatus === "laeuft";
  // Alte Entwürfe können noch manuell eingegebene Steuer enthalten; festgeschriebene Beträge bleiben unverändert.
  const calculateInitialTax = !readOnly && !running && Boolean(doc.reverseCharge);

  const [supplierName, setSupplierName] = useState(doc.supplierName);
  const [supplierUstId, setSupplierUstId] = useState(doc.supplierUstId);
  const [supplierContactId, setSupplierContactId] = useState<string | null>(doc.supplierContactId);
  /** Getippter Name, wenn der Dialog für einen neuen Lieferanten offen ist; null = geschlossen */
  const [newSupplierName, setNewSupplierName] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState(doc.invoiceNumber);
  const [documentDate, setDocumentDate] = useState(doc.documentDate ?? "");
  const [dueDate, setDueDate] = useState(doc.dueDate ?? "");
  const [category, setCategory] = useState(doc.category ?? "");
  // Eigenes Sachkonto statt des Kontos der Kategorie (#270); leer = das Konto der Kategorie
  const [ownAccountId, setOwnAccountId] = useState(doc.ownAccountId ?? "");
  const [payment, setPayment] = useState(doc.payment);
  const [privateShare, setPrivateShare] = useState(doc.privateShare ? String(doc.privateShare) : "");
  // Angaben zur Anlage bei Kategorie „anlage“; Vorschläge laut AfA-Tabelle
  const [assetName, setAssetName] = useState(doc.asset?.name ?? "");
  const [assetKind, setAssetKind] = useState<AssetKind>(doc.asset?.kind ?? "edv");
  const [assetMethod, setAssetMethod] = useState<AssetMethod>(doc.asset?.method ?? "digital");
  const [assetYears, setAssetYears] = useState(doc.asset?.usefulLifeMonths ? String(doc.asset.usefulLifeMonths / 12) : "");
  const [note, setNote] = useState(doc.note);
  const [reverseCharge, setReverseCharge] = useState<SelfAssessedTax | null>(doc.reverseCharge ?? null);
  const [currency, setCurrency] = useState(doc.currency);
  const [exchangeRate, setExchangeRate] = useState(doc.exchangeRate ? formatExchangeRate(doc.exchangeRate) : "");
  const [exchangeRateDate, setExchangeRateDate] = useState(doc.exchangeRateSource === "ust" ? "" : (doc.exchangeRateDate ?? ""));
  // Bei Fremdwährung stehen in den Zeilen die Beträge laut Beleg; Euro rechnet Haben mit dem Kurs aus
  const [rows, setRows] = useState<AmountState[]>(() =>
    (amounts.length > 0 ? amounts : [{ taxRate: 1900, net: 0, tax: 0, originalNet: null, originalTax: null }]).map((a) => {
      const net = doc.currency === "EUR" ? a.net : (a.originalNet ?? 0);
      const tax = calculateInitialTax ? taxOf(net, a.taxRate) : doc.currency === "EUR" ? a.tax : (a.originalTax ?? 0);
      return {
        key: nextKey++,
        taxRate: a.taxRate as Rate,
        net: net === 0 && amounts.length === 0 ? "" : formatDecimal(net),
        tax: tax === 0 && amounts.length === 0 ? "" : formatDecimal(tax),
        taxTouched: amounts.length > 0,
      };
    }),
  );
  // Aufteilung auf mehrere Kategorien (#271); leer = die Kategorie gilt für den ganzen Beleg
  const [splitRows, setSplitRows] = useState<SplitRowState[]>(() =>
    splits.map((s) => splitRow(s.category as ExpenseCategory, s.taxRate as Rate, formatDecimal(s.net), s.ownAccountId ?? "")),
  );
  const splitting = splitRows.length > 0;
  const [dirty, setDirty] = useState(
    () => calculateInitialTax && amounts.some((a, index) => parseEuro(rows[index]!.tax) !== (doc.currency === "EUR" ? a.tax : (a.originalTax ?? 0))),
  );
  const { busy, notice, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // Nach dem Buchen zum nächsten offenen Beleg oder hierbleiben (etwa für den Bankabgleich); gemerkt im Browser
  // Der Server kennt die Wahl nicht und rendert „an“; im Browser gilt der gemerkte Wert
  const continueAfterBooking = useSyncExternalStore(subscribeContinuePreference, readContinuePreference, () => true);

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const parsed = rows.map((r) => ({ taxRate: r.taxRate, net: parseEuro(r.net || "0"), tax: parseEuro(r.tax || "0") }));
  // Mit Aufteilung gibt es (noch) keinen Privatanteil, siehe Grenzen in docs/belege.md
  const privateShareValue = category === "anlage" || splitting ? 0 : Number(privateShare || 0);
  const privateShareValid = Number.isInteger(privateShareValue) && privateShareValue >= 0 && privateShareValue <= 100;
  const currencyCode = currency.trim().toUpperCase();
  const foreign = currencyCode !== "EUR";
  const rate = exchangeRate.trim() ? parseExchangeRate(exchangeRate) : null;
  const currencyValid = CURRENCY_CODE.test(currencyCode) && (!foreign || !exchangeRate.trim() || rate !== null);
  const parsedSplits = splitting ? parseSplitRows(splitRows) : [];
  const valid =
    parsed.every((p) => p.net !== null && p.tax !== null) &&
    new Set(rows.map((r) => r.taxRate)).size === rows.length &&
    privateShareValid &&
    currencyValid &&
    parsedSplits !== null;
  // Aufteilen geht mit deutscher Umsatzsteuer und mit § 13b (#508), in Euro
  const splitBlocked = reverseCharge === "ig_erwerb" ? "innergemeinschaftlichem Erwerb" : foreign ? "Fremdwährung" : null;
  // § 13b: gezahlt wird netto, die Steuer geht ans Finanzamt
  const gross = valid ? parsed.reduce((s, p) => s + p.net! + (reverseCharge ? 0 : p.tax!), 0) : null;
  // Fremdwährung: dieselbe Umrechnung wie beim Speichern, damit die Vorschau mit dem Gebuchten übereinstimmt
  const euroRows =
    valid && foreign && rate
      ? convertForeignAmounts(
          parsed.map((p) => ({ taxRate: p.taxRate, originalNet: p.net!, originalTax: p.tax! })),
          rate,
          Boolean(reverseCharge),
        )
      : null;
  const euroGross = euroRows ? euroRows.reduce((s, e) => s + e.net + (reverseCharge ? 0 : e.tax), 0) : null;
  // Lieferant mit USt-IdNr. aus einem anderen EU-Land und keine Steuer auf dem Beleg: vermutlich § 13b
  const looksLikeReverseCharge =
    !reverseCharge && EU_VAT_PREFIX.test(supplierUstId.replace(/\s/g, "").toUpperCase()) && parsed.every((p) => p.tax === 0) && parsed.some((p) => p.net);

  function chooseReverseCharge(value: SelfAssessedTax | null) {
    touch(setReverseCharge)(value);
    // Die Steuer steht nicht auf der Rechnung; Haben rechnet sie aus dem Netto, 0 % gibt es bei § 13b und beim Erwerb nicht
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

  /** Aufteilen: je Betragszeile eine Zeile mit der bisherigen Kategorie, dazu eine leere zum Verteilen */
  function startSplitting() {
    const first = category === "anlage" ? "" : (category as ExpenseCategory | "");
    const fromAmounts = rows.map((row, i) => splitRow(i === 0 ? first : "", row.taxRate, row.net, i === 0 ? ownAccountId : ""));
    touch(setSplitRows)([...fromAmounts, splitRow("", rows[0]?.taxRate ?? 1900, "")]);
  }

  function touch<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setDirty(true);
    };
  }

  function updateRow(key: number, patch: Partial<AmountState>) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...patch };
        // Selbst geschuldete Steuer immer berechnen; Vorsteuer laut Beleg nur bis zur manuellen Änderung vorschlagen.
        if ((reverseCharge || !next.taxTouched) && ("net" in patch || "taxRate" in patch)) {
          const net = parseEuro(next.net || "0");
          next.tax = net === null ? next.tax : formatDecimal(taxOf(net, next.taxRate));
        }
        return next;
      }),
    );
    setDirty(true);
  }

  /** Gewählter Kontakt: Name und USt-IdNr. übernehmen; „frei eingetragen“ lässt die Felder stehen */
  function pickSupplier(supplier: ContactChoice | null) {
    setSupplierContactId(supplier?.id ?? null);
    if (!supplier) return;
    setSupplierName(supplier.name);
    setSupplierUstId(supplier.ustId);
  }

  /** Wer den Namen von Hand ändert, meint einen anderen Lieferanten: die Verknüpfung fällt weg */
  function typeSupplierName(name: string) {
    setSupplierName(name);
    if (supplierContactId && data.suppliers.find((s) => s.id === supplierContactId)?.name !== name) setSupplierContactId(null);
  }

  async function persist() {
    await save({
      data: {
        id: doc.id,
        document: {
          supplierName,
          supplierUstId,
          supplierContactId,
          invoiceNumber,
          documentDate: documentDate || null,
          dueDate: dueDate || null,
          category: splitting ? null : ((category || null) as ExpenseCategory | null),
          ownAccountId: splitting ? null : passendesKonto(ownAccounts, category, ownAccountId) || null,
          payment,
          note,
          privateShare: privateShareValue,
          reverseCharge,
          currency: currencyCode,
          exchangeRate: foreign ? exchangeRate : null,
          exchangeRateDate: foreign && exchangeRate.trim() && exchangeRateDate ? exchangeRateDate : null,
          asset:
            category === "anlage"
              ? {
                  name: assetName.trim() || supplierName.trim() || "Anlage",
                  kind: assetKind,
                  method: assetMethod,
                  usefulLifeMonths: usesUsefulLife(assetMethod) ? parseUsefulLifeMonths(assetYears) : null,
                }
              : null,
          splits: parsedSplits ?? [],
          amounts: parsed
            .filter((p) => p.net !== 0 || p.tax !== 0)
            .map((p) =>
              foreign ? { taxRate: p.taxRate, net: 0, tax: 0, originalNet: p.net!, originalTax: p.tax! } : { taxRate: p.taxRate, net: p.net!, tax: p.tax! },
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

  const bookNow = () => {
    void run(async () => {
      if (dirty) await persist();
      await book({ data: doc.id });
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

  const deleteNow = () => {
    void run(async () => {
      await remove({ data: doc.id });
      // Weiter zum nächsten Beleg „Zu prüfen“; sind keine mehr offen, zurück zur Liste statt auf einen gebuchten
      const next = navigation.nextOpenId;
      await navigate(next ? { to: "/belege/$id", params: { id: next } } : { to: "/belege" });
    });
  };

  // Strg+Enter (Mac: Cmd+Enter) wie ein Klick auf „Bestätigen und buchen“, auch aus einem Eingabefeld; gebucht wird
  // erst im Dialog, nicht mit einem zweiten Strg+Enter, das den Hinweis überginge
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (readOnly || isDialogOpen()) return;
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        if (!busy && !running && valid) setConfirming(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
      {data.dauerbeleg && (
        <p className="small" style={{ margin: 0 }}>
          Aus dem Dauerbeleg{" "}
          <Link to="/dauerbelege/$id" params={{ id: data.dauerbeleg.id }}>
            {data.dauerbeleg.name ?? "Vorlage"}
          </Link>{" "}
          angelegt; die Datei ist der dort hinterlegte Vertrag.{!locked && " Bitte prüfen und buchen."}
        </p>
      )}
      {locked && !data.cancellation && (
        <div className="banner banner-ok" role="status">
          <Icon name="check" />
          <span>Gebucht {doc.lockedAt ? formatDateTime(doc.lockedAt) : ""}. Der Beleg ist festgeschrieben.</span>
        </div>
      )}

      <fieldset className="card" disabled={readOnly || running} style={{ margin: 0 }}>
        <legend className="visually-hidden">Belegdaten</legend>
        <div className="form-grid">
          <Field label="Lieferant">{(control) => <input {...control} value={supplierName} onChange={(e) => touch(typeSupplierName)(e.target.value)} />}</Field>
          <Field label="Aus den Kontakten">
            {(control) => (
              <ContactCombobox
                {...control}
                rolle="lieferant"
                contacts={data.suppliers}
                contactId={supplierContactId ?? ""}
                disabled={readOnly || running}
                onChoose={(id) => touch(pickSupplier)(data.suppliers.find((s) => s.id === id) ?? null)}
                onCreate={readOnly ? undefined : setNewSupplierName}
              />
            )}
          </Field>
          <NewContactDialog
            rolle="lieferant"
            name={newSupplierName}
            // Anschrift und E-Mail aus der E-Rechnung, Name und USt-IdNr. wie am Beleg; die IBAN nur als Vorschlag zum Übernehmen (#329)
            prefill={{
              ...data.supplierSuggestion?.contact,
              ...(supplierName ? { name: supplierName } : {}),
              ...(supplierUstId ? { ustId: supplierUstId } : {}),
            }}
            ibanSuggestion={data.supplierSuggestion?.iban ?? null}
            onSaved={(saved) => touch(pickSupplier)(savedAsChoice(saved))}
            onPickExisting={(id) => touch(pickSupplier)(data.suppliers.find((c) => c.id === id) ?? null)}
            onClose={() => setNewSupplierName(null)}
          />
          <Field label="Rechnungsnummer">
            {(control) => <input {...control} value={invoiceNumber} onChange={(e) => touch(setInvoiceNumber)(e.target.value)} />}
          </Field>
          <Field label="USt-IdNr. des Lieferanten">
            {(control) => <input {...control} value={supplierUstId} onChange={(e) => touch(setSupplierUstId)(e.target.value)} />}
          </Field>
          <Field label="Belegdatum">
            {(control) => <input {...control} type="date" value={documentDate} onChange={(e) => touch(setDocumentDate)(e.target.value)} />}
          </Field>
          <Field label="Fällig am">{(control) => <input {...control} type="date" value={dueDate} onChange={(e) => touch(setDueDate)(e.target.value)} />}</Field>
          {splitting ? (
            <p className="small" style={{ gridColumn: "1 / -1", margin: 0 }}>
              <strong>Kategorie:</strong> aufgeteilt auf {splitRows.length} Zeilen, siehe <a href="#aufteilung">Aufteilung auf Kategorien</a>.
            </p>
          ) : (
            <Field
              label="Kategorie"
              hint={
                data.categoryHint && (
                  <>
                    Bisher{" "}
                    {data.categoryHint.count === data.categoryHint.total
                      ? `${data.categoryHint.count}×`
                      : `${data.categoryHint.count} von ${data.categoryHint.total} Belegen`}{" "}
                    als {categories.find((c) => c.value === data.categoryHint!.category)?.label ?? data.categoryHint.category} gebucht, zuletzt am{" "}
                    {formatDate(data.categoryHint.last)}
                    {category !== data.categoryHint.category && (
                      <>
                        {" · "}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => {
                            const hint = data.categoryHint!.category;
                            touch(setCategory)(hint);
                            const preset = data.privateShares[hint];
                            setPrivateShare(preset ? String(preset) : "");
                          }}
                        >
                          übernehmen
                        </button>
                      </>
                    )}
                  </>
                )
              }
              style={{ gridColumn: "1 / -1" }}
            >
              {(control) => (
                <select
                  {...control}
                  value={category}
                  onChange={(e) => {
                    touch(setCategory)(e.target.value);
                    setOwnAccountId(passendesKonto(ownAccounts, e.target.value, ownAccountId));
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
              )}
            </Field>
          )}
          {!splitting && category !== "anlage" && (
            <EigenesKontoWahl
              accounts={ownAccounts}
              category={category}
              value={ownAccountId}
              onChange={touch(setOwnAccountId)}
              style={{ gridColumn: "1 / -1" }}
            />
          )}
          {!splitting && !readOnly && (
            <p className="small" style={{ gridColumn: "1 / -1", margin: 0 }}>
              <button type="button" className="link-button" onClick={startSplitting} disabled={splitBlocked !== null} aria-describedby="split-start-hint">
                Auf mehrere Kategorien aufteilen
              </button>
              <span id="split-start-hint" className="muted">
                {splitBlocked
                  ? ` · mit ${splitBlocked} noch nicht möglich`
                  : " · z. B. Handelsware, Software und Bürobedarf auf einer Rechnung; ein Beleg, eine Zahlung"}
              </span>
            </p>
          )}
          {category === "anlage" && !splitting && (
            <>
              <Field label="Bezeichnung der Anlage" style={{ gridColumn: "1 / -1" }}>
                {(control) => (
                  <input
                    {...control}
                    value={assetName}
                    onChange={(e) => touch(setAssetName)(e.target.value)}
                    placeholder="z. B. VW Passat, MacBook Pro"
                    maxLength={200}
                  />
                )}
              </Field>
              <Field label="Art">
                {(control) => (
                  <select
                    {...control}
                    value={assetKind}
                    onChange={(e) => {
                      const kind = e.target.value as AssetKind;
                      touch(setAssetKind)(kind);
                      setAssetMethod(ASSET_KINDS[kind].method);
                      const years = ASSET_KINDS[kind].usefulLifeYears;
                      // Ohne Vorschlag (sonstige Ausstattung, sonstige Transportmittel) bleibt keine Nutzungsdauer der vorigen Art
                      // stehen, etwa die sechs Jahre für Pkw, wie im Formular der Anlage (#312)
                      if (ASSET_KINDS[kind].method === "linear") setAssetYears(years ? String(years) : "");
                    }}
                  >
                    {Object.entries(ASSET_KINDS).map(([value, k]) => (
                      <option key={value} value={value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Abschreibung">
                {(control) => (
                  <select {...control} value={assetMethod} onChange={(e) => touch(setAssetMethod)(e.target.value as AssetMethod)}>
                    {Object.entries(ASSET_METHODS)
                      .filter(([value]) => value !== "elektro" || (assetKind === "kfz" && elektroAvailable(data.rechtsform)) || value === assetMethod)
                      .map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                  </select>
                )}
              </Field>
              {usesUsefulLife(assetMethod) && (
                <Field label="Nutzungsdauer in Jahren">
                  {(control) => <input {...control} inputMode="decimal" value={assetYears} onChange={(e) => touch(setAssetYears)(e.target.value)} />}
                </Field>
              )}
              <p className="small muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
                Beim Buchen entsteht die Anlage im <Link to="/anlagen">Anlagenverzeichnis</Link>; abgeschrieben wird ab dem Belegdatum. Degressiv mit dem
                Höchstsatz; Satz und Erinnerungswert änderst du bis zur ersten AfA an der Anlage.
              </p>
            </>
          )}
        </div>
      </fieldset>

      <fieldset className="card" disabled={readOnly || running} style={{ margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 16, padding: 0, marginBottom: 4 }}>Beträge je Steuersatz</legend>
        <Field
          label="Umsatzsteuer auf dem Beleg"
          hint={
            reverseCharge === "ig_erwerb" ? (
              <>
                Ein Unternehmer aus einem anderen EU-Land liefert dir Ware ohne Umsatzsteuer, mit seiner und deiner USt-IdNr. auf der Rechnung. Die Erwerbsteuer
                schuldest du; Haben rechnet sie aus dem Netto, meldet sie in Kz 89 (19 %) bzw. 93 (7 %) im Monat des Belegdatums, auch bei Ist-Versteuerung, und
                zieht sie zugleich als Vorsteuer ab (Kz 61). Bezahlt wird nur der Nettobetrag. Weist der Händler deutsche Umsatzsteuer aus, bleibt es ein
                gewöhnlicher Beleg.
              </>
            ) : reverseCharge ? (
              <>
                Die Rechnung weist keine deutsche Umsatzsteuer aus (Reverse Charge). Die Steuer schuldest du; Haben rechnet sie aus dem Netto, meldet sie in Kz{" "}
                {reverseCharge === "eu" ? "46/47" : "84/85"} und zieht sie zugleich als Vorsteuer ab (Kz 67). Bezahlt wird nur der Nettobetrag.
              </>
            ) : (
              looksLikeReverseCharge && (
                <>
                  Lieferant aus dem EU-Ausland ohne Umsatzsteuer auf der Rechnung? Bei einer Dienstleistung, etwa von Google, Microsoft oder AWS, ist es meist §
                  13b, bei Ware ein innergemeinschaftlicher Erwerb.
                </>
              )
            )
          }
        >
          {(control) => (
            <select {...control} value={reverseCharge ?? ""} onChange={(e) => chooseReverseCharge((e.target.value || null) as SelfAssessedTax | null)}>
              <option value="">Mit deutscher Umsatzsteuer (Vorsteuer)</option>
              <option value="eu">§ 13b: Leistung eines Unternehmers aus dem EU-Ausland</option>
              <option value="drittland">§ 13b: Leistung eines Unternehmers aus dem Drittland</option>
              <option value="ig_erwerb">Innergemeinschaftlicher Erwerb (§ 1a UStG): Ware aus dem EU-Ausland</option>
            </select>
          )}
        </Field>
        <div className="form-grid">
          <Field label="Währung" describedBy={foreign ? "currency-hint" : undefined}>
            {(control) => (
              <>
                <input
                  {...control}
                  value={currency}
                  onChange={(e) => touch(setCurrency)(e.target.value.toUpperCase().slice(0, 3))}
                  list="currency-codes"
                  maxLength={3}
                  aria-invalid={!CURRENCY_CODE.test(currencyCode)}
                />
                <datalist id="currency-codes">
                  {["EUR", "USD", "GBP", "CHF", "PLN", "SEK", "DKK", "JPY"].map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          {foreign && (
            <Field label={<>Kurs: 1 EUR = … {CURRENCY_CODE.test(currencyCode) ? currencyCode : ""}</>} describedBy="currency-hint">
              {(control) => (
                <input
                  {...control}
                  className="mono"
                  inputMode="decimal"
                  value={exchangeRate}
                  placeholder="z. B. 1,0812"
                  onChange={(e) => touch(setExchangeRate)(e.target.value)}
                  aria-invalid={exchangeRate.trim() !== "" && rate === null}
                />
              )}
            </Field>
          )}
          {foreign && data.tageskurs && (
            <Field label="Kursdatum">
              {(control) => <input {...control} type="date" value={exchangeRateDate} onChange={(e) => touch(setExchangeRateDate)(e.target.value)} />}
            </Field>
          )}
          {foreign && (
            <span id="currency-hint" className="small" style={{ gridColumn: "1 / -1" }}>
              {doc.exchangeRate && doc.currency === currencyCode && rate === parseExchangeRate(doc.exchangeRate) && (
                <>
                  <strong>{describeExchangeRate(doc.currency, doc.exchangeRate, doc.exchangeRateSource, doc.exchangeRateDate)}</strong>.{" "}
                </>
              )}
              Beträge unten in {currencyCode || "der Fremdwährung"}, wie auf dem Beleg. Haben rechnet sie mit dem Kurs in Euro um und bucht nur Euro. Lässt du
              den Kurs leer, nimmt Haben den Umsatzsteuer-Umrechnungskurs des BMF für den Monat des Belegdatums (§ 16 Abs. 6 UStG), sobald er veröffentlicht ist
              {data.tageskurs ? "; mit gestattetem Tageskurs trägst du Kurs und Kursdatum ein" : ""}. Bei § 13b und beim innergemeinschaftlichen Erwerb wird die
              Steuer aus dem umgerechneten Netto berechnet.
            </span>
          )}
        </div>
        {rows.map((row, index) => (
          <div className="amount-row" key={row.key}>
            <Field label="Satz">
              {(control) => (
                <select {...control} value={row.taxRate} onChange={(e) => updateRow(row.key, { taxRate: Number(e.target.value) as Rate })}>
                  <option value={1900}>19 %</option>
                  <option value={700}>7 %</option>
                  {!reverseCharge && <option value={0}>0 %</option>}
                </select>
              )}
            </Field>
            <Field label={foreign ? `Netto ${currencyCode}` : "Netto"}>
              {(control) => (
                <input
                  {...control}
                  className="mono"
                  inputMode="decimal"
                  value={row.net}
                  placeholder="0,00"
                  onChange={(e) => updateRow(row.key, { net: e.target.value })}
                  aria-invalid={parsed[index]!.net === null}
                />
              )}
            </Field>
            <Field
              label={
                <>
                  {reverseCharge === "ig_erwerb" ? "Erwerbsteuer" : reverseCharge ? "Steuer § 13b" : "Vorsteuer"}
                  {foreign ? ` ${currencyCode}` : ""}
                  {reverseCharge ? " (automatisch)" : ""}
                </>
              }
              describedBy={reverseCharge ? "self-assessed-tax-hint" : undefined}
            >
              {(control) => (
                <input
                  {...control}
                  className="mono"
                  inputMode="decimal"
                  value={row.tax}
                  placeholder="0,00"
                  readOnly={Boolean(reverseCharge)}
                  onChange={(e) => updateRow(row.key, { tax: e.target.value, taxTouched: true })}
                  aria-invalid={parsed[index]!.tax === null}
                />
              )}
            </Field>
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
        {reverseCharge && (
          <p id="self-assessed-tax-hint" className="small">
            Haben berechnet die Steuer automatisch aus Netto und Satz. Änderungen am Netto oder am Satz aktualisieren den schreibgeschützten Steuerbetrag.
          </p>
        )}
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
            <span className="amount" style={{ fontWeight: 600 }}>
              {gross === null ? "–" : foreign ? `${formatDecimal(gross)} ${currencyCode}` : formatEuro(gross)}
            </span>
            {foreign && (
              <div className="small" aria-live="polite">
                {euroRows ? (
                  <>
                    in Euro{" "}
                    <span className="amount" style={{ fontWeight: 600 }}>
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
        <p className="small muted" style={{ margin: 0 }}>
          Gutschriften mit Minus eingeben.
        </p>
        {/* Privatanteil nur im Einzelunternehmen; in GmbH und UG wäre er Arbeitslohn oder verdeckte Gewinnausschüttung */}
        {category !== "anlage" && !splitting && !isKapitalgesellschaft(data.rechtsform) && (
          <Field label="Privatanteil in %" hint="Z. B. beim Handyvertrag: nur der betriebliche Teil wird Ausgabe und Vorsteuer." style={{ maxWidth: 220 }}>
            {(control) => (
              <input
                {...control}
                inputMode="numeric"
                value={privateShare}
                placeholder="0"
                onChange={(e) => touch(setPrivateShare)(e.target.value.replace(/\D/g, "").slice(0, 3))}
                aria-invalid={!privateShareValid}
              />
            )}
          </Field>
        )}
      </fieldset>

      {splitting && (
        <div id="aufteilung">
          <DocumentSplits
            rows={splitRows}
            amounts={
              parsed.every((p) => p.net !== null && p.tax !== null) && !foreign ? parsed.map((p) => ({ taxRate: p.taxRate, net: p.net!, tax: p.tax! })) : null
            }
            categories={categories}
            ownAccounts={ownAccounts}
            disabled={readOnly || running}
            onChange={touch(setSplitRows)}
            taxLabel={reverseCharge === "ig_erwerb" ? "Erwerbsteuer" : reverseCharge ? "Steuer § 13b" : "Vorsteuer"}
            onDissolve={() => {
              // Zurück zu einer Kategorie: die der ersten Zeile
              touch(setCategory)(splitRows[0]?.category ?? "");
              setOwnAccountId(splitRows[0]?.ownAccountId ?? "");
              setSplitRows([]);
            }}
          />
        </div>
      )}

      <fieldset className="card" disabled={readOnly || running} style={{ margin: 0 }}>
        <legend style={{ fontWeight: 600, fontSize: 16, padding: 0, marginBottom: 4 }}>Bezahlung</legend>
        <label className="checkbox">
          <input type="radio" name="payment" checked={payment === "bank"} onChange={() => touch(setPayment)("bank")} />
          Über das Geschäftskonto (Zuordnung beim Bankabgleich)
        </label>
        <label className="checkbox">
          <input type="radio" name="payment" checked={payment === "privat"} onChange={() => touch(setPayment)("privat")} />
          {ownerLabels(data.rechtsform).documentPaid}
        </label>
        <label className="checkbox">
          <input type="radio" name="payment" checked={payment === "kasse"} onChange={() => touch(setPayment)("kasse")} />
          Bar aus der Kasse (Zeile im Kassenbuch)
        </label>
        {data.paymentHint && (
          <span className="small">
            Bisher{" "}
            {data.paymentHint.count === data.paymentHint.total
              ? `${data.paymentHint.count}×`
              : `${data.paymentHint.count} von ${data.paymentHint.total} Belegen`}{" "}
            {paymentHintText(data.paymentHint.payment, isKapitalgesellschaft(data.rechtsform))}, zuletzt am {formatDate(data.paymentHint.last)}
            {payment !== data.paymentHint.payment && (
              <>
                {" · "}
                <button type="button" className="link-button" onClick={() => touch(setPayment)(data.paymentHint!.payment)}>
                  übernehmen
                </button>
              </>
            )}
          </span>
        )}
        <Field label="Notiz">{(control) => <textarea {...control} value={note} onChange={(e) => touch(setNote)(e.target.value)} maxLength={2000} />}</Field>
      </fieldset>

      {!readOnly && issues.length > 0 && !dirty && (
        <div className="banner" role="status">
          <Icon name="alert" />
          <span>Vor dem Buchen: {issues.join(", ")}.</span>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title="Beleg buchen?"
        facts={[
          ...(supplierName.trim() ? [{ label: "Lieferant", value: supplierName.trim() }] : []),
          ...(documentDate ? [{ label: "Belegdatum", value: formatDate(documentDate) }] : []),
          ...(gross === null ? [] : [{ label: "Betrag", value: foreign ? `${formatDecimal(gross)} ${currencyCode}` : formatEuro(gross), strong: true }]),
        ]}
        confirmLabel="Buchen"
        onConfirm={bookNow}
        onClose={() => setConfirming(false)}
      >
        <p>Der Beleg wird gebucht und festgeschrieben; danach ist er nicht mehr änderbar.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmingDelete}
        title={supplierName.trim() ? `Beleg von ${supplierName.trim()} löschen?` : "Beleg löschen?"}
        confirmLabel="Beleg löschen"
        danger
        onConfirm={deleteNow}
        onClose={() => setConfirmingDelete(false)}
      >
        <p>Der Beleg und seine Datei werden gelöscht. Das lässt sich nicht rückgängig machen.</p>
      </ConfirmDialog>
      {!readOnly && (
        <div className="actions doc-actions">
          {/* In der stehenden Leiste: davor läge die Meldung beim Scrollen hinter ihr. Jede Aktion mit Meldung sitzt hier */}
          <NoticeBanner notice={notice} />
          <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)} disabled={busy || running || !valid} title="Strg+Enter">
            Bestätigen und buchen
          </button>
          <button type="submit" className="btn" disabled={busy || running || !valid || !dirty}>
            Speichern
          </button>
          {aiAvailable && doc.mimeType !== "application/xml" && doc.mimeType !== "image/heic" && (
            <button type="button" className="btn" onClick={onReextract} disabled={busy || running}>
              Mit KI neu auslesen
            </button>
          )}
          <button type="button" className="btn btn-danger" onClick={() => setConfirmingDelete(true)} disabled={busy || running}>
            Löschen
          </button>
          <label className="checkbox small" style={{ flexBasis: "100%" }}>
            <input type="checkbox" checked={continueAfterBooking} onChange={(e) => writeContinuePreference(e.target.checked)} />
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
