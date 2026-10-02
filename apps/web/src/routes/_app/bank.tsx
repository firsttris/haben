import { formatDecimal, formatEuro, parseEuro } from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { Icon } from "../../components/Icon.tsx";
import { errorMessage, formatDate, daysUntil } from "../../lib/format.ts";
import {
  addBankAccount,
  allocateTransaction,
  getBankOverview,
  importStatements,
  reverseTransactionAllocation,
} from "../../server/functions/bank.ts";

const searchSchema = z.object({
  konto: z.uuid().optional(),
  filter: z.enum(["offen", "zugeordnet", "alle"]).optional(),
  suche: z.string().optional(),
  umsatz: z.uuid().optional(),
});

export const Route = createFileRoute("/_app/bank")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) =>
    getBankOverview({ data: { konto: deps.konto, filter: deps.filter ?? "offen", suche: deps.suche ?? "", umsatz: deps.umsatz } }),
  head: () => ({ meta: [{ title: "Bank · Haben" }] }),
  component: BankPage,
});

type Data = Awaited<ReturnType<typeof getBankOverview>>;
type Detail = NonNullable<Data["detail"]>;

const HINT = {
  vorschlag: { text: "Vorschlag", tone: "pill-info" },
  belegFehlt: { text: "Beleg fehlt", tone: "pill-warn" },
  offen: { text: "Offen", tone: "" },
  teilweise: { text: "Teilweise", tone: "pill-info" },
  zugeordnet: { text: "Zugeordnet", tone: "pill-ok" },
} as const;

const KIND_LABEL = {
  invoice: "Rechnung",
  document: "Beleg",
  privat: "Privat",
  geldtransit: "Geldtransit",
  ustVorauszahlung: "Umsatzsteuer",
  gebuehren: "Bankgebühren",
} as const;

function BankPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/bank" });
  const filter = search.filter ?? "offen";
  const selectedId = data.detail?.transaction.id;
  const index = data.transactions.findIndex((t) => t.id === selectedId);
  const openCount = data.accounts.find((a) => a.id === data.accountId)?.openCount ?? 0;

  // J/K springen zum nächsten bzw. vorigen Umsatz
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.closest("input, select, textarea, [contenteditable]") || event.metaKey || event.ctrlKey || event.altKey) return;
      const step = event.key === "j" ? 1 : event.key === "k" ? -1 : 0;
      if (!step) return;
      const next = data.transactions[index + step];
      if (next) {
        event.preventDefault();
        void navigate({ search: (prev) => ({ ...prev, umsatz: next.id }), replace: true });
        document.getElementById(`tx-${next.id}`)?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [data.transactions, index, navigate]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Umsätze zuordnen</div>
          <h1>Bank</h1>
        </div>
        <ImportControls data={data} />
      </div>

      {data.accounts.length === 0 ? (
        <section className="card">
          <h2>Noch kein Konto</h2>
          <p className="muted" style={{ margin: 0 }}>
            Exportiere bei deiner Bank die Umsätze als CSV oder CAMT.053 und importiere die Datei. DKB-Dateien und CAMT
            nennen die IBAN, das Konto wird dann automatisch angelegt; für N26 lege das Konto vorher an.
          </p>
        </section>
      ) : (
        <>
          <div className="account-tabs" role="tablist" aria-label="Konten">
            {data.accounts.map((account) => {
              const age = account.lastImport ? -daysUntil(account.lastImport.createdAt) : null;
              return (
                <Link
                  key={account.id}
                  to="/bank"
                  search={{ konto: account.id, filter }}
                  role="tab"
                  aria-selected={account.id === data.accountId}
                  className="account-tab"
                >
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{account.name}</span>
                  <span className="small" style={{ color: age !== null && age > 7 ? "var(--warn-ink)" : "var(--muted)" }}>
                    {account.lastImport
                      ? `${account.lastImport.format.startsWith("camt") ? "CAMT.053" : "CSV"} · zuletzt ${formatDate(account.lastImport.createdAt)}`
                      : "noch kein Import"}
                    {account.lastImport?.closingBalance != null ? ` · ${formatEuro(account.lastImport.closingBalance)}` : ""}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="grid-main">
            <section className="card" style={{ padding: "8px 0 12px" }} aria-label="Umsätze">
              <div className="tx-toolbar">
                <div role="group" aria-label="Filter" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(["alle", "offen", "zugeordnet"] as const).map((f) => (
                    <Link
                      key={f}
                      to="/bank"
                      search={{ konto: data.accountId ?? undefined, filter: f, suche: search.suche }}
                      className={`chip${filter === f ? " active" : ""}`}
                      aria-pressed={filter === f}
                    >
                      {f === "alle" ? "Alle" : f === "offen" ? `Offen · ${openCount}` : "Zugeordnet"}
                    </Link>
                  ))}
                </div>
                <SearchBox initial={search.suche ?? ""} />
              </div>
              <div className="table-row head tx-cols" style={{ padding: "0 20px" }}>
                <div>Datum</div>
                <div>Gegenpartei · Verwendungszweck</div>
                <div className="num">Betrag</div>
                <div>Status</div>
              </div>
              {data.transactions.length === 0 && (
                <p className="muted" style={{ margin: 0, padding: "16px 20px" }}>
                  {filter === "offen" ? "Alles zugeordnet." : "Keine Umsätze."}
                </p>
              )}
              {data.transactions.map((tx) => (
                <Link
                  key={tx.id}
                  id={`tx-${tx.id}`}
                  to="/bank"
                  search={{ ...search, umsatz: tx.id }}
                  replace
                  className={`table-row tx-cols tx-row${tx.id === selectedId ? " selected" : ""}`}
                  aria-current={tx.id === selectedId ? "true" : undefined}
                >
                  <div className="muted small">{formatDate(tx.bookingDate).slice(0, 6)}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span className="ellipsis" style={{ fontWeight: 500 }}>{tx.counterpartyName || "–"}</span>
                    <span className="small muted ellipsis">{tx.purpose}</span>
                  </div>
                  <div className="num" style={{ color: tx.amount > 0 ? "var(--accent-ink)" : undefined }}>
                    {tx.amount > 0 ? "+" : "−"}
                    {formatEuro(Math.abs(tx.amount))}
                  </div>
                  <div>
                    <span className={`pill ${HINT[tx.hint].tone}`}>{HINT[tx.hint].text}</span>
                  </div>
                </Link>
              ))}
            </section>
            {data.detail ? (
              <AllocationPanel key={`${data.detail.transaction.id}-${data.detail.transaction.open}`} detail={data.detail} directKinds={data.directKinds} />
            ) : (
              <aside className="card" aria-label="Zuordnung">
                <p className="muted" style={{ margin: 0 }}>Umsatz links auswählen.</p>
              </aside>
            )}
          </div>
        </>
      )}
    </>
  );
}

function SearchBox({ initial }: { initial: string }) {
  const navigate = useNavigate({ from: "/bank" });
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (value === initial) return;
    const timer = setTimeout(() => void navigate({ search: (prev) => ({ ...prev, suche: value || undefined, umsatz: undefined }), replace: true }), 300);
    return () => clearTimeout(timer);
  }, [value, initial, navigate]);
  return (
    <label className="search-box">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <span className="visually-hidden">Umsätze durchsuchen</span>
      <input type="search" placeholder="Suchen" value={value} onChange={(e) => setValue(e.target.value)} />
    </label>
  );
}

function ImportControls({ data }: { data: Data }) {
  const router = useRouter();
  const importFiles = useServerFn(importStatements);
  const addAccount = useServerFn(addBankAccount);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [targetAccount, setTargetAccount] = useState("");
  const [messages, setMessages] = useState<{ tone: "ok" | "danger" | "info"; text: string }[]>([]);

  async function onFiles(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setMessages([]);
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      if (targetAccount) form.append("accountId", targetAccount);
      const results = await importFiles({ data: form });
      setMessages(
        results.flatMap((r) =>
          "error" in r && r.error
            ? [{ tone: "danger" as const, text: r.error }]
            : "added" in r
              ? [
                  { tone: "ok" as const, text: `${r.filename}: ${r.added} neue Umsätze für ${r.accountName}${r.skipped ? `, ${r.skipped} schon vorhanden` : ""}.` },
                  ...(r.gap ? [{ tone: "danger" as const, text: r.gap }] : []),
                  ...r.warnings.map((w) => ({ tone: "info" as const, text: `${r.filename}: ${w}` })),
                ]
              : [],
        ),
      );
      await router.invalidate();
    } catch (error) {
      setMessages([{ tone: "danger", text: errorMessage(error) }]);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function onAddAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const { id } = await addAccount({ data: { name: String(form.get("name")), iban: String(form.get("iban")) } });
      setShowAccount(false);
      setTargetAccount(id);
      await router.invalidate();
      setMessages([{ tone: "ok", text: "Konto angelegt. Jetzt die Umsätze importieren." }]);
    } catch (error) {
      setMessages([{ tone: "danger", text: errorMessage(error) }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 8, alignItems: "flex-end" }}>
      <div className="actions">
        {data.accounts.length > 0 && (
          <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <span>Konto</span>
            <select value={targetAccount} onChange={(e) => setTargetAccount(e.target.value)} style={{ minHeight: 44 }}>
              <option value="">aus der Datei</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="btn" onClick={() => setShowAccount((v) => !v)} disabled={busy}>
          Konto hinzufügen
        </button>
        <button type="button" className="btn btn-primary" onClick={() => fileInput.current?.click()} disabled={busy}>
          {busy ? "Importiere …" : "CSV / CAMT importieren"}
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".csv,.xml,.txt,text/csv,application/xml,text/xml"
          className="visually-hidden"
          tabIndex={-1}
          aria-label="Kontoauszugsdateien"
          onChange={(e) => void onFiles([...(e.target.files ?? [])])}
        />
      </div>
      {showAccount && (
        <form className="card" onSubmit={onAddAccount} style={{ minWidth: 320 }}>
          <label className="field">
            Name
            <input name="name" required placeholder="N26 Business" />
          </label>
          <label className="field">
            IBAN
            <input name="iban" required />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Konto anlegen
          </button>
        </form>
      )}
      {messages.length > 0 && (
        <ul className="upload-messages" role="status" style={{ maxWidth: 560 }}>
          {messages.map((m, i) => (
            <li key={i} className={`banner banner-${m.tone}`}>
              {m.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AllocationPanel({ detail, directKinds }: { detail: Detail; directKinds: Data["directKinds"] }) {
  const router = useRouter();
  const allocateFn = useServerFn(allocateTransaction);
  const reverseFn = useServerFn(reverseTransactionAllocation);
  const { transaction: tx, suggestions, candidates, allocations } = detail;
  const best = suggestions[0];
  const [mode, setMode] = useState<"best" | "other" | "direct">(best ? "best" : candidates.length ? "other" : "direct");
  const [candidate, setCandidate] = useState(best ? `${best.item.type}:${best.item.id}` : "");
  const [directKind, setDirectKind] = useState(tx.amount < 0 ? "privat" : "privat");
  const [amount, setAmount] = useState(formatDecimal(Math.abs(best?.amount ?? tx.open)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const primaryButton = useRef<HTMLButtonElement>(null);

  const parsedAmount = parseEuro(amount);
  const signedAmount = parsedAmount === null ? null : Math.sign(tx.amount) * Math.abs(parsedAmount);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await work();
      await router.invalidate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function submitAllocation() {
    if (signedAmount === null || signedAmount === 0) return;
    if (mode === "direct") {
      return run(() => allocateFn({ data: { kind: directKind as "privat", transactionId: tx.id, amount: signedAmount } }));
    }
    const choice = mode === "best" && best ? `${best.item.type}:${best.item.id}` : candidate;
    const [type, id] = choice.split(":");
    if (!id) return;
    return run(() =>
      allocateFn({
        data:
          type === "invoice"
            ? { kind: "invoice", transactionId: tx.id, invoiceId: id, amount: signedAmount }
            : { kind: "document", transactionId: tx.id, documentId: id, amount: signedAmount },
      }),
    );
  }

  // Enter ordnet zu, solange der Fokus nicht in einem Eingabefeld liegt
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Enter" || tx.open === 0) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, select, textarea, button, a")) return;
      event.preventDefault();
      primaryButton.current?.click();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const selectedCandidate = candidates.find((c) => `${c.type}:${c.id}` === candidate);

  return (
    <aside className="card" aria-label="Zuordnung" style={{ gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="small muted">Ausgewählter Umsatz · {formatDate(tx.bookingDate)}</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>{tx.counterpartyName || "–"}</div>
        <div className="mono" style={{ fontSize: 22, color: tx.amount > 0 ? "var(--accent-ink)" : undefined }}>
          {tx.amount > 0 ? "+" : "−"}
          {formatEuro(Math.abs(tx.amount))}
        </div>
        <div className="small muted" style={{ overflowWrap: "anywhere" }}>
          {tx.purpose}
          {tx.counterpartyIban ? ` · ${tx.counterpartyIban.replace(/(.{4})/g, "$1 ").trim()}` : ""}
        </div>
        {tx.open !== 0 && tx.open !== tx.amount && <div className="small">Noch offen: {formatEuro(Math.abs(tx.open))}</div>}
      </div>

      {allocations.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="section-label">Zugeordnet</div>
          {allocations.map((a) => (
            <div key={a.id} className="history-row">
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ textDecoration: a.reversed ? "line-through" : undefined }}>
                  {KIND_LABEL[a.kind]}
                  {a.invoiceNumber ? ` ${a.invoiceNumber}` : ""}
                  {a.documentSupplier ? ` ${a.documentSupplier}${a.documentNumber ? ` (${a.documentNumber})` : ""}` : ""}
                </span>
                <span className="small muted">{a.reversed ? "aufgehoben" : formatEuro(Math.abs(a.amount))}</span>
              </div>
              {!a.reversed && (
                <button type="button" className="btn" style={{ minHeight: 36 }} onClick={() => run(() => reverseFn({ data: a.id }))} disabled={busy}>
                  Aufheben
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {tx.open !== 0 && (
        <>
          {mode === "best" && best && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="section-label">Bester Treffer</div>
              <div className="match-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontWeight: 600 }}>
                      {best.item.type === "invoice" ? `Rechnung ${best.item.number}` : `Beleg ${best.item.partyName}`}
                    </span>
                    <span className="small muted">
                      vom {formatDate(best.item.date)}
                      {best.item.dueDate ? ` · fällig ${formatDate(best.item.dueDate)}` : ""}
                      {best.item.type === "document" && best.item.number ? ` · ${best.item.number}` : ""}
                    </span>
                  </div>
                  <span className="mono">{formatEuro(Math.abs(best.item.open))}</span>
                </div>
                <ul className="reasons">
                  {best.reasons.map((reason) => (
                    <li key={reason}>
                      <Icon name="check" size={16} />
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                {best.item.type === "invoice"
                  ? "Bucht Bank an Forderungen; bei Ist-Versteuerung wird die Umsatzsteuer mit diesem Zahlungseingang fällig."
                  : "Bucht Verbindlichkeiten an Bank."}
              </p>
            </div>
          )}

          {mode === "other" && (
            <label className="field">
              Rechnung oder Beleg
              <select value={candidate} onChange={(e) => {
                setCandidate(e.target.value);
                const c = candidates.find((x) => `${x.type}:${x.id}` === e.target.value);
                if (c) setAmount(formatDecimal(Math.min(Math.abs(c.open), Math.abs(tx.open))));
              }}>
                <option value="">Bitte wählen</option>
                {candidates.map((c) => (
                  <option key={`${c.type}:${c.id}`} value={`${c.type}:${c.id}`}>
                    {c.type === "invoice" ? `Rechnung ${c.number}` : `Beleg ${c.partyName} ${c.number}`} · {c.partyName} · offen{" "}
                    {formatEuro(Math.abs(c.open))}
                  </option>
                ))}
              </select>
              {candidates.length === 0 && <span className="small">Keine offenen Rechnungen oder gebuchten Belege in dieser Richtung.</span>}
            </label>
          )}

          {mode === "direct" && (
            <label className="field">
              Buchen als
              <select value={directKind} onChange={(e) => setDirectKind(e.target.value)}>
                {directKinds.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              {tx.amount < 0 && (
                <span className="small">
                  Für Ausgaben mit Rechnung den Beleg erst unter <Link to="/belege">Belege</Link> hochladen und buchen.
                </span>
              )}
            </label>
          )}

          <label className="field">
            Betrag
            <input
              className="mono"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={parsedAmount === null}
              style={{ textAlign: "right" }}
            />
          </label>

          {error && (
            <div className="banner banner-danger" role="alert">
              {error}
            </div>
          )}

          <div className="actions">
            <button
              ref={primaryButton}
              type="button"
              className="btn btn-primary"
              style={{ flexGrow: 1 }}
              disabled={busy || signedAmount === null || (mode === "other" && !selectedCandidate)}
              onClick={() => void submitAllocation()}
            >
              {mode === "direct" ? "Buchen" : "Zuordnen"}
            </button>
            {mode !== "other" && (
              <button type="button" className="btn" onClick={() => setMode("other")} disabled={busy}>
                Andere Rechnung
              </button>
            )}
            {mode === "other" && best && (
              <button type="button" className="btn" onClick={() => setMode("best")} disabled={busy}>
                Vorschlag
              </button>
            )}
          </div>
          {mode !== "direct" && (
            <button type="button" className="btn btn-dashed" onClick={() => setMode("direct")} disabled={busy}>
              Ohne Rechnung buchen
            </button>
          )}
          <div className="small muted">Tastatur: Enter ordnet zu, J und K springen zum nächsten Umsatz.</div>
        </>
      )}
    </aside>
  );
}
