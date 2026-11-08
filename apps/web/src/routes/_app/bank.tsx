import { formatDecimal, formatEuro, isKapitalgesellschaft, parseEuro, type DirectBooking } from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { z } from "zod/mini";
import { DauerbelegVorschlaege } from "../../components/DauerbelegVorschlaege.tsx";
import { Icon } from "../../components/Icon.tsx";
import { shortDate } from "../../components/Ledger.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { SteuerFelder, steuerangabe, steuerWahlFuer, type SteuerOptionen, type SteuerWahl } from "../../components/SteuerFelder.tsx";
import { DarlehenFelder, darlehenWahlFuer, type DarlehenOptionen, type DarlehenWahl } from "../../components/DarlehenFelder.tsx";
import { defaultFetchFrom, fetchFromForConnect } from "../../lib/bank-connect.ts";
import { errorMessage, formatDate, formatDateTime, daysUntil } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import {
  addBankAccount,
  addProviderAccount,
  allocateTransaction,
  allocateTransactionWithRest,
  allocateProviderFees,
  connectBank,
  disconnectBank,
  getBankOverview,
  getEnableBanks,
  importStatements,
  transferBetweenAccounts,
  updateBankAccount,
  reverseTransactionAllocation,
  splitTransaction,
  syncBankConnection,
} from "../../server/functions/bank.ts";
import { bookAndAllocateDauerbelegFn } from "../../server/functions/dauerbelege.ts";
import { today as todayInGermany } from "../../server/today.ts";
import { ConfirmDialog, isDialogOpen } from "../../components/ConfirmDialog.tsx";

const searchSchema = z.object({
  konto: z.optional(z.uuid()),
  filter: z.optional(z.enum(["offen", "zugeordnet", "alle"])),
  suche: z.optional(z.string()),
  umsatz: z.optional(z.uuid()),
  /** Ergebnis der Rückleitung von der Bank */
  abruf: z.optional(z.enum(["ok", "fehler"])),
  meldung: z.optional(z.string().check(z.maxLength(500))),
});

export const Route = createFileRoute("/_app/bank")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ konto: search.konto, filter: search.filter, suche: search.suche, umsatz: search.umsatz }),
  loader: ({ deps }) => getBankOverview({ data: { konto: deps.konto, filter: deps.filter ?? "offen", suche: deps.suche ?? "", umsatz: deps.umsatz } }),
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
  sondervorauszahlung: "Sondervorauszahlung",
  gebuehren: "Bankgebühren",
  mahnerloes: "Mahngebühren und Zinsen",
  kursdifferenz: "Kursdifferenz",
  kapest: "Kapitalertragsteuer",
  lohn: "Lohn/Gehalt",
  lohnsteuer: "Lohnsteuer",
  sozialversicherung: "SV-Beiträge",
  steuer: "Steuer",
  zinsertrag: "Zinserträge",
  darlehen: "Darlehen",
} as const;

/**
 * Hinweis zu „Direkt buchen“ (früher „Ohne Rechnung buchen“, #312): Unterlagen sind nicht nur Rechnungen, sondern auch
 * Steuerbescheide, Kreditverträge oder Abrechnungen; den Zahlungsnachweis bildet der Bankumsatz selbst.
 */
const DIRECT_HINT = "Bankumsatz einer Buchungsart zuordnen, ohne einen separaten Beleg anzulegen.";

/** „Direkt buchen“: Buchungsarten ohne Beleg und die Steuerzahlung mit Steuerart, Bezugsjahr und Teil */
type DirectChoice = DirectBooking | "steuer" | "darlehen";
const STEUER_OPTION = { value: "steuer", label: "Steuerzahlung oder Erstattung (Finanzamt, Gemeinde)" } as const;
const DARLEHEN_OPTION = { value: "darlehen", label: "Darlehen: Auszahlung, Tilgung, Zinsen oder Gebühren" } as const;

/** Offener Posten in Auswahl und Treffer: Rechnung, Beleg oder Zahllast bzw. Erstattung einer Voranmeldung */
function itemLabel(item: { type: "invoice" | "document" | "ustva"; number: string; partyName: string }): string {
  if (item.type === "invoice") return `Rechnung ${item.number}`;
  if (item.type === "ustva") return `Voranmeldung ${item.number}`;
  return `Beleg ${item.partyName} ${item.number}`;
}

/** Ziel einer Zuordnung aus „Typ:ID“ der Auswahl */
function itemTarget(type: string | undefined, id: string, amount: number) {
  if (type === "invoice") return { kind: "invoice" as const, invoiceId: id, amount };
  if (type === "ustva") return { kind: "ustva" as const, vatReturnId: id, amount };
  return { kind: "document" as const, documentId: id, amount };
}

const FORMAT_LABEL = (format: string) =>
  format === "enablebanking"
    ? "Abruf"
    : format.startsWith("camt")
      ? "CAMT.053"
      : format === "paypal-csv"
        ? "PayPal"
        : format === "stripe-csv"
          ? "Stripe"
          : format === "shopify-payments-csv"
            ? "Shopify"
            : format === "ebay-csv"
              ? "eBay"
              : "CSV";

function BankPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/bank" });
  const filter = search.filter ?? "offen";
  const selectedId = data.detail?.transaction.id;
  const index = data.transactions.findIndex((t) => t.id === selectedId);
  const selectedAccount = data.accounts.find((a) => a.id === data.accountId);
  const openCount = selectedAccount?.openCount ?? 0;

  // J/K springen zum nächsten bzw. vorigen Umsatz
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (isDialogOpen() || target.closest("input, select, textarea, [contenteditable]") || event.metaKey || event.ctrlKey || event.altKey) return;
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

      <BankSync sync={data.sync} result={search.abruf ? { ok: search.abruf === "ok", message: search.meldung ?? "" } : null} />

      {data.accounts.length === 0 ? (
        <section className="card">
          <h2>Noch kein Konto</h2>
          <p className="muted" style={{ margin: 0 }}>
            Verbinde dein Konto für den automatischen Abruf oder exportiere bei deiner Bank die Umsätze als CSV oder CAMT.053 und importiere die Datei.
            DKB-Dateien und CAMT nennen die IBAN, das Konto wird dann automatisch angelegt; für N26 lege das Konto vorher an.
          </p>
        </section>
      ) : (
        <>
          <nav className="account-tabs" aria-label="Konten">
            {data.accounts.map((account) => {
              const age = account.lastImport ? -daysUntil(account.lastImport.createdAt) : null;
              return (
                <Link
                  key={account.id}
                  to="/bank"
                  search={{ konto: account.id, filter }}
                  aria-current={account.id === data.accountId ? "page" : undefined}
                  className="account-tab"
                >
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{account.name}</span>
                  <span className="small" style={{ color: age !== null && age > 7 ? "var(--warn-ink)" : "var(--muted)" }}>
                    {account.lastImport
                      ? `${FORMAT_LABEL(account.lastImport.format)} · zuletzt ${formatDate(account.lastImport.createdAt)}`
                      : "noch kein Import"}
                    {account.lastImport?.closingBalance != null ? ` · ${formatEuro(account.lastImport.closingBalance)}` : ""}
                    {account.providerBalance !== null ? ` · Guthaben ${formatEuro(account.providerBalance)}` : ""}
                  </span>
                </Link>
              );
            })}
          </nav>
          {/* key: beim Kontowechsel mit dem Namen des neuen Kontos aufsetzen */}
          {selectedAccount && (
            <AccountSettings key={selectedAccount.id} account={selectedAccount} purposes={data.purposes} ledger={data.ledgers[selectedAccount.id]} />
          )}

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
                      aria-current={filter === f ? "page" : undefined}
                    >
                      {f === "alle" ? "Alle" : f === "offen" ? `Offen · ${openCount}` : "Zugeordnet"}
                    </Link>
                  ))}
                </div>
                {/* key: beim Kontowechsel leer neu aufsetzen, sonst trägt die Suche ins neue Konto */}
                <SearchBox key={data.accountId ?? ""} initial={search.suche ?? ""} />
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
                  <div className="muted small">{shortDate(tx.bookingDate)}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span className="ellipsis" style={{ fontWeight: 500 }}>
                      {tx.counterpartyName || "–"}
                    </span>
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
              <AllocationPanel
                key={`${data.detail.transaction.id}-${data.detail.transaction.open}`}
                detail={data.detail}
                directKinds={data.directKinds}
                steuerOptionen={{ steuerarten: data.steuerarten, steuerPosten: data.steuerPosten }}
                darlehenOptionen={{ loans: data.loans, loanParts: data.loanParts }}
                nextOpenId={nextOpenAfter(data.transactions, data.detail.transaction.id)}
              />
            ) : (
              <aside className="card" aria-label="Zuordnung">
                <p className="muted" style={{ margin: 0 }}>
                  Umsatz links auswählen.
                </p>
              </aside>
            )}
          </div>
        </>
      )}
    </>
  );
}

const PURPOSE_SHORT = {
  geschaeft: "Geschäftskonto",
  steuer: "Steuerkonto",
  ruecklage: "Rücklagen",
  privat: "Privatkonto",
  zahlungsdienstleister: "Zahlungsdienstleister",
} as const;

/** Name und Zweck des gewählten Kontos, etwa „Geschäftskonto“ und „Steuerkonto“ bei derselben Bank */
function AccountSettings({ account, purposes, ledger }: { account: Data["accounts"][number]; purposes: Data["purposes"]; ledger: string | undefined }) {
  const router = useRouter();
  const navigate = useNavigate({ from: "/bank" });
  const updateFn = useServerFn(updateBankAccount);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const [purpose, setPurpose] = useState(account.purpose);
  const { busy, notice, run } = useAction();

  if (!editing) {
    return (
      <div className="small muted" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "8px 0 16px" }}>
        <span>
          {account.name} · {PURPOSE_SHORT[account.purpose]} ·{" "}
          {account.iban ? account.iban.replace(/(.{4})/g, "$1 ").trim() : `Verrechnungskonto ${ledger ?? ""}`}
        </span>
        <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
          Name und Zweck
        </button>
      </div>
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await updateFn({ data: { id: account.id, name, purpose: purpose === "zahlungsdienstleister" ? undefined : purpose } });
      // Konto fest in die Adresse: ohne „konto“ zeigt die Seite das alphabetisch erste, nach dem Umbenennen ein anderes
      await navigate({ search: (prev) => ({ ...prev, konto: account.id }), replace: true });
      await router.invalidate();
      setEditing(false);
    });
  }

  return (
    <form onSubmit={onSubmit} className="stack" style={{ gap: 8, margin: "8px 0 16px", maxWidth: 480 }} aria-label="Name und Zweck des Kontos">
      <label className="field">
        Name des Kontos
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoFocus />
      </label>
      {account.purpose !== "zahlungsdienstleister" && (
        <label className="field">
          Zweck
          <select value={purpose} onChange={(e) => setPurpose(e.target.value as typeof purpose)}>
            {purposes.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="small muted">
        Der Name ist nur Anzeige; Umsätze und Import über die IBAN bleiben, wie sie sind. Der Zweck steuert Vorschläge im Bankabgleich (Geldtransit zwischen
        eigenen Konten, Umsatzsteuer auf dem Steuerkonto, Privat beim Privatkonto), die IBAN für „Bankverbindung ändern“ beim Finanzamt und die Deckung der
        Zahllast in der Übersicht. Gebucht wird weiter auf das eine Bankkonto.
      </span>
      <NoticeBanner notice={notice} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          Speichern
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setName(account.name);
            setPurpose(account.purpose);
            setEditing(false);
          }}
          disabled={busy}
        >
          Abbrechen
        </button>
      </div>
    </form>
  );
}

type Sync = Data["sync"];

const CONNECTION_STATUS = {
  aktiv: { text: "Aktiv", tone: "pill-ok" },
  abgelaufen: { text: "Abgelaufen", tone: "pill-warn" },
  fehler: { text: "Fehler", tone: "pill-danger" },
  widerrufen: { text: "Getrennt", tone: "" },
  wartet: { text: "Wartet auf Bank", tone: "pill-info" },
} as const;

/** Automatischer Abruf über Enable Banking: verbundene Banken, Abruf, Erneuern und Trennen */
function BankSync({ sync, result }: { sync: Sync; result: { ok: boolean; message: string } | null }) {
  const router = useRouter();
  const navigate = useNavigate({ from: "/bank" });
  const syncFn = useServerFn(syncBankConnection);
  const disconnectFn = useServerFn(disconnectBank);
  const connectFn = useServerFn(connectBank);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState<Sync["connections"][number] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ tone: "ok" | "danger" | "info"; text: string }[]>([]);

  if (!sync.configured && sync.connections.length === 0) {
    return (
      <p className="small muted" style={{ margin: "0 0 16px" }}>
        Automatischer Abruf: mit einer Enable-Banking-Anwendung holt Haben die Umsätze täglich selbst. Einrichten unter{" "}
        <Link to="/einstellungen" search={{ bereich: "bank" }}>
          Einstellungen › Bank
        </Link>
        .
      </p>
    );
  }

  async function run(id: string, work: () => Promise<void>) {
    setBusy(id);
    setMessages([]);
    try {
      await work();
      await router.invalidate();
    } catch (error) {
      setMessages([{ tone: "danger", text: errorMessage(error) }]);
    } finally {
      setBusy(null);
    }
  }

  async function renew(aspspName: string, psuType: "personal" | "business") {
    await run("renew", async () => {
      const { url } = await connectFn({ data: { aspspName, psuType } });
      window.location.assign(url);
    });
  }

  return (
    <section className="card" aria-label="Automatischer Abruf" style={{ marginBottom: 16, gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Automatischer Abruf</h2>
        {sync.configured && (
          <button type="button" className="btn" onClick={() => setConnecting((v) => !v)} disabled={busy !== null}>
            Bank verbinden
          </button>
        )}
      </div>

      {result && (
        <div className={`banner banner-${result.ok ? "ok" : "danger"}`} role="status" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <span>{result.message || (result.ok ? "Bank verbunden." : "Die Verbindung ist fehlgeschlagen.")}</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void navigate({ search: (prev) => ({ ...prev, abruf: undefined, meldung: undefined }), replace: true })}
          >
            Schließen
          </button>
        </div>
      )}

      {connecting && <ConnectForm onCancel={() => setConnecting(false)} callbackUrl={sync.callbackUrl} connect={connectFn} />}

      <ConfirmDialog
        open={disconnecting !== null}
        title={`Verbindung zu ${disconnecting?.aspspName} trennen?`}
        confirmLabel="Trennen"
        danger
        onConfirm={() => {
          if (!disconnecting) return;
          const { id } = disconnecting;
          void run(`x-${id}`, async () => {
            await disconnectFn({ data: id });
          });
        }}
        onClose={() => setDisconnecting(null)}
      >
        <p>Die abgerufenen Umsätze bleiben erhalten.</p>
      </ConfirmDialog>

      {sync.connections.length === 0 && !connecting && (
        <p className="small muted" style={{ margin: 0 }}>
          Noch keine Bank verbunden. Nach der Freigabe bei deiner Bank holt Haben die Umsätze einmal täglich; der Import per CSV oder CAMT bleibt daneben
          möglich.
        </p>
      )}

      {sync.connections.map((c) => {
        const status = CONNECTION_STATUS[c.status];
        const canSync = c.status === "aktiv";
        return (
          <div key={c.id} className="history-row" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: "1 1 260px" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600 }}>{c.aspspName}</span>
                <span className={`pill ${status.tone}`}>{status.text}</span>
                {c.renewSoon && <span className="pill pill-warn">Läuft bald ab</span>}
              </div>
              <span className="small muted">{c.accounts.map((a) => `${a.name} …${a.iban.slice(-4)}`).join(" · ") || "Keine Konten"}</span>
              <span className="small muted">
                {c.lastSyncAt ? `Zuletzt abgerufen ${formatDateTime(c.lastSyncAt)}` : "Noch nicht abgerufen"}
                {c.validUntil ? ` · Zustimmung bis ${formatDate(c.validUntil)}` : ""}
              </span>
              {c.lastError && <span className="field-error">{c.lastError}</span>}
            </div>
            <div className="actions">
              {canSync && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(c.id, async () => {
                      const r = await syncFn({ data: c.id });
                      setMessages([
                        r.error ? { tone: "danger", text: r.error } : { tone: "ok", text: `${c.aspspName}: ${r.added} neue Umsätze.` },
                        ...r.gaps.map((g) => ({ tone: "danger" as const, text: g })),
                      ]);
                    })
                  }
                >
                  {busy === c.id ? "Rufe ab …" : "Jetzt abrufen"}
                </button>
              )}
              {sync.configured && (c.status !== "aktiv" || c.renewSoon) && (
                <button type="button" className="btn" disabled={busy !== null} onClick={() => void renew(c.aspspName, c.psuType)}>
                  Zustimmung erneuern
                </button>
              )}
              <button type="button" className="btn" disabled={busy !== null} onClick={() => setDisconnecting(c)}>
                Trennen
              </button>
            </div>
          </div>
        );
      })}

      {messages.length > 0 && (
        <ul className="upload-messages" role="status">
          {messages.map((m, i) => (
            <li key={i} className={`banner banner-${m.tone}`}>
              {m.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ConnectForm({
  onCancel,
  callbackUrl,
  connect,
}: {
  onCancel: () => void;
  callbackUrl: string;
  connect: (args: { data: { aspspName: string; psuType: "personal" | "business"; fetchFrom?: string | null } }) => Promise<{ url: string }>;
}) {
  const loadBanks = useServerFn(getEnableBanks);
  const [banks, setBanks] = useState<Awaited<ReturnType<typeof getEnableBanks>> | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [psuType, setPsuType] = useState<"business" | "personal">("business");
  const today = todayInGermany();
  const [fetchFrom, setFetchFrom] = useState(defaultFetchFrom(today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadBanks()
      .then(setBanks)
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [loadBanks]);

  // Safari legt die Seite beim Zurückgehen aus dem Cache wieder auf, samt „Weiterleiten …“
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const term = query.trim().toLowerCase();
  const visible = (banks ?? []).filter((b) => !term || b.name.toLowerCase().includes(term));
  const bank = banks?.find((b) => b.name === selected);

  // Enter im Suchfeld wählt den ersten Treffer, statt das Formular abzuschicken
  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    const first = visible[0];
    if (first && !visible.some((b) => b.name === selected)) setSelected(first.name);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!bank || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { url } = await connect({ data: { aspspName: bank.name, psuType, fetchFrom: fetchFromForConnect(fetchFrom, today) } });
      window.location.assign(url);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="stack" style={{ gap: 12, maxWidth: 560 }}>
      <label className="field">
        Bank suchen
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="z. B. DKB, Sparkasse, N26"
          autoFocus
        />
      </label>
      <label className="field">
        Bank
        <select size={8} value={selected} onChange={(e) => setSelected(e.target.value)} required aria-busy={banks === null}>
          {banks === null && !error && <option disabled>Lade Banken …</option>}
          {visible.slice(0, 300).map((b) => (
            <option key={b.name} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      {bank && bank.psuTypes.length > 1 && (
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>Kontoart</legend>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="radio" name="psuType" checked={psuType === "business"} onChange={() => setPsuType("business")} />
            Geschäftskonto
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="radio" name="psuType" checked={psuType === "personal"} onChange={() => setPsuType("personal")} />
            Privatkonto (auch Einzelunternehmer mit Privatzugang)
          </label>
        </fieldset>
      )}
      <label className="field">
        Umsätze abrufen ab
        <input type="date" value={fetchFrom} max={today} onChange={(e) => setFetchFrom(e.target.value)} aria-describedby="fetch-from-hint" />
        <span id="fetch-from-hint" className="small muted">
          Gilt für Konten, die noch nie abgerufen wurden. Mit der Vorgabe holt Haben ab Jahresbeginn oder schließt an Umsätze an, die schon da sind (etwa aus
          einer Datei). Beginnt die Buchhaltung in Haben später im Jahr, etwa nach einem Umzug, trage diesen Tag ein.
        </span>
      </label>
      {bank && (
        <p className="small muted" style={{ margin: 0 }}>
          Du wirst zu {bank.name} weitergeleitet und gibst dort den Lesezugriff für {bank.maxConsentDays} Tage frei. Danach geht es zurück zu Haben (
          {callbackUrl}).
        </p>
      )}
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={!bank || busy}>
          {busy ? "Weiterleiten …" : "Weiter zur Bank"}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Abbrechen
        </button>
      </div>
    </form>
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
  const addProvider = useServerFn(addProviderAccount);
  const [accountType, setAccountType] = useState<"bank" | "provider">("bank");
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
                  {
                    tone: "ok" as const,
                    text: `${r.filename}: ${r.added} neue Umsätze für ${r.accountName}${r.skipped ? `, ${r.skipped} schon vorhanden` : ""}.`,
                  },
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
      const { id } =
        accountType === "provider"
          ? await addProvider({ data: { name: String(form.get("name")), provider: String(form.get("provider")) as "paypal" } })
          : await addAccount({ data: { name: String(form.get("name")), iban: String(form.get("iban")) } });
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
            Art
            <select value={accountType} onChange={(e) => setAccountType(e.target.value as "bank" | "provider")}>
              <option value="bank">Bankkonto (mit IBAN)</option>
              <option value="provider">Zahlungsdienstleister (PayPal, Stripe, Shopify …)</option>
            </select>
          </label>
          {accountType === "provider" && (
            <label className="field">
              Dienstleister
              <select name="provider" defaultValue="paypal">
                {data.providers.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            Name
            <input name="name" required placeholder={accountType === "provider" ? "PayPal Geschäftskonto" : "N26 Business"} />
          </label>
          {accountType === "bank" ? (
            <label className="field">
              IBAN
              <input name="iban" required />
            </label>
          ) : (
            <span className="small muted">
              Bekommt ein eigenes Verrechnungskonto (SKR03 1361 …, SKR04 1461 …). Importiere den CSV-Export des Dienstleisters und wähle dabei dieses Konto
              unter „Konto“.
            </span>
          )}
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

/** Nächster offener Umsatz nach dem gewählten, am Ende der Liste wieder von vorn */
function nextOpenAfter(transactions: Data["transactions"], id: string): string | undefined {
  const index = transactions.findIndex((t) => t.id === id);
  const after = [...transactions.slice(index + 1), ...transactions.slice(0, Math.max(index, 0))];
  return after.find((t) => t.open !== 0 && t.id !== id)?.id;
}

function AllocationPanel({
  detail,
  directKinds,
  steuerOptionen,
  darlehenOptionen,
  nextOpenId,
}: {
  detail: Detail;
  directKinds: Data["directKinds"];
  steuerOptionen: SteuerOptionen;
  darlehenOptionen: DarlehenOptionen;
  nextOpenId: string | undefined;
}) {
  const router = useRouter();
  const navigate = useNavigate({ from: "/bank" });
  const allocateFn = useServerFn(allocateTransaction);
  const splitFn = useServerFn(splitTransaction);
  const restFn = useServerFn(allocateTransactionWithRest);
  const feesFn = useServerFn(allocateProviderFees);
  const reverseFn = useServerFn(reverseTransactionAllocation);
  const transferFn = useServerFn(transferBetweenAccounts);
  const dauerbelegFn = useServerFn(bookAndAllocateDauerbelegFn);
  const { transaction: tx, suggestions, candidates, splitCandidates, allocations, direct, dauerbelege } = detail;
  // Eine GmbH oder UG hat kein Privat; dieselbe Zuordnung geht dort auf das Gesellschafter-Verrechnungskonto
  const gesellschaft = isKapitalgesellschaft(Route.useRouteContext().rechtsform);
  const best = suggestions[0];
  // Ein Treffer mit Rechnung geht vor; sonst der Vorschlag aus dem Zweck der Konten (Geldtransit, Umsatzsteuer, Privat)
  const [mode, setMode] = useState<"best" | "other" | "direct" | "split">(best ? "best" : direct ? "direct" : candidates.length ? "other" : "direct");
  const [candidate, setCandidate] = useState(best ? `${best.item.type}:${best.item.id}` : "");
  const [directKind, setDirectKind] = useState<DirectChoice>(direct?.kind ?? "privat");
  const [steuer, setSteuer] = useState<SteuerWahl>(() => steuerWahlFuer(steuerOptionen, tx.bookingDate));
  const [darlehen, setDarlehen] = useState<DarlehenWahl>(() => darlehenWahlFuer(darlehenOptionen, tx.amount));
  const [amount, setAmount] = useState(formatDecimal(Math.abs(best?.amount ?? tx.open)));
  const action = useAction();
  const { busy, notice } = action;
  const primaryButton = useRef<HTMLButtonElement>(null);

  const parsedAmount = parseEuro(amount);
  const signedAmount = parsedAmount === null ? null : Math.sign(tx.amount) * Math.abs(parsedAmount);

  const run = (work: () => Promise<unknown>) =>
    action.run(async () => {
      await work();
      await router.invalidate();
    });

  // Ist der Umsatz danach ganz zugeordnet, weiter zum nächsten offenen, wie bei den Belegen
  const runAndAdvance = (work: () => Promise<unknown>, completes: boolean) =>
    action.run(async () => {
      await work();
      if (completes && nextOpenId) await navigate({ search: (prev) => ({ ...prev, umsatz: nextOpenId }), replace: true });
      else await router.invalidate();
    });

  // Zahlung in der Skontofrist um genau das Skonto gekürzt: zuordnen und den Rest gleich als gewährtes Skonto ausbuchen
  const skontoRest = mode === "best" && best?.skonto && best.item.type === "invoice" && signedAmount === tx.open ? best.skonto : 0;

  function submitAllocation() {
    if (signedAmount === null || signedAmount === 0) return;
    const completes = signedAmount === tx.open;
    if (skontoRest !== 0 && best) {
      return runAndAdvance(() => restFn({ data: { transactionId: tx.id, target: { kind: "invoice", invoiceId: best.item.id }, rest: "skonto" } }), true);
    }
    if (mode === "direct") {
      if (directKind === "darlehen") {
        if (!darlehen.loanId) return;
        return runAndAdvance(() => allocateFn({ data: { kind: "darlehen", transactionId: tx.id, amount: signedAmount, darlehen } }), completes);
      }
      if (directKind !== "steuer") {
        return runAndAdvance(() => allocateFn({ data: { kind: directKind, transactionId: tx.id, amount: signedAmount } }), completes);
      }
      const angabe = steuerangabe(steuer);
      if (!angabe) return;
      return runAndAdvance(() => allocateFn({ data: { kind: "steuer", transactionId: tx.id, amount: signedAmount, steuer: angabe } }), completes);
    }
    const choice = mode === "best" && best ? `${best.item.type}:${best.item.id}` : candidate;
    const [type, id] = choice.split(":");
    if (!id) return;
    return runAndAdvance(() => allocateFn({ data: { ...itemTarget(type, id, signedAmount), transactionId: tx.id } }), completes);
  }

  // Enter ordnet zu, solange der Fokus nicht in einem Eingabefeld liegt
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Enter" || tx.open === 0 || isDialogOpen()) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, select, textarea, button, a")) return;
      event.preventDefault();
      primaryButton.current?.click();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tx.open]);

  const selectedCandidate = candidates.find((c) => `${c.type}:${c.id}` === candidate);
  // Posten, der gerade zugeordnet würde; ist er höher als der Umsatz, bietet sich „Rest als Gebühr“ an
  const target = mode === "best" && best ? best.item : mode === "other" ? selectedCandidate : undefined;
  // Nur bei Zahlungseingängen: der Dienstleister behält eine Gebühr ein. Zahlst du selbst weniger, ist das Skonto, keine Gebühr.
  const feeRest = target && target.type !== "ustva" && tx.amount > 0 && target.open > tx.open ? tx.open - target.open : 0;
  // Beim Wechsel zu „Aufteilen“ festgehalten: dort ist der Modus „split“ und target wäre leer
  const [splitInitial, setSplitInitial] = useState<typeof target>(undefined);

  // Zahlung unter dem offenen Betrag: Rest ausbuchen (Skonto, Forderungsausfall) statt als Teilzahlung stehen lassen
  const rest = target && Math.sign(target.open) === Math.sign(tx.open) && Math.abs(target.open) > Math.abs(tx.open) ? target.open - tx.open : 0;
  const restKinds: ("skonto" | "forderungsausfall" | "skontoErhalten")[] =
    rest === 0
      ? []
      : target?.type === "invoice" && tx.amount > 0
        ? ["skonto", "forderungsausfall"]
        : target?.type === "document" && tx.amount < 0
          ? ["skontoErhalten"]
          : [];
  const REST_LABEL = { skonto: "als Skonto", forderungsausfall: "als Forderungsausfall", skontoErhalten: "als erhaltenes Skonto" } as const;
  // Rechnung oder Beleg in Fremdwährung: Abweichung der Zahlung vom umgerechneten Betrag als Kursdifferenz (Zahlung − offen)
  const exchangeDifference =
    target?.currency && target.currency !== "EUR" && Math.sign(target.open) === Math.sign(tx.open) && target.open !== tx.open ? tx.open - target.open : 0;

  function bookRest(kind: (typeof restKinds)[number] | "kursdifferenz") {
    if (!target) return;
    const t = target.type === "invoice" ? { kind: "invoice" as const, invoiceId: target.id } : { kind: "document" as const, documentId: target.id };
    return run(() => restFn({ data: { transactionId: tx.id, target: t, rest: kind } }));
  }

  function bookRestAsFee() {
    if (!target || feeRest === 0) return;
    const first = itemTarget(target.type, target.id, target.open);
    return run(() => splitFn({ data: { transactionId: tx.id, parts: [first, { kind: "gebuehren", amount: feeRest }] } }));
  }

  // Teile einer Aufteilung werden nur zusammen aufgehoben: Knopf nur am ersten Teil
  const firstOfSplit = new Set<string>();
  const seenSplits = new Set<string>();
  for (const a of allocations) {
    if (a.splitId && !seenSplits.has(a.splitId)) {
      seenSplits.add(a.splitId);
      firstOfSplit.add(a.id);
    }
  }

  return (
    <aside className="card" aria-label="Zuordnung" style={{ gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="small muted">Ausgewählter Umsatz · {formatDate(tx.bookingDate)}</div>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{tx.counterpartyName || "–"}</h2>
        <div className="mono" style={{ fontSize: 24, color: tx.amount > 0 ? "var(--accent-ink)" : undefined }}>
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
        <div className="stack" style={{ gap: 8 }}>
          <div className="section-label">Zugeordnet</div>
          {allocations.map((a) => (
            <div key={a.id} className="history-row">
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ textDecoration: a.reversed ? "line-through" : undefined }}>
                  {a.kind === "privat" && gesellschaft ? "Gesellschafter" : KIND_LABEL[a.kind]}
                  {a.invoiceNumber ? ` ${a.invoiceNumber}` : ""}
                  {a.documentSupplier ? ` ${a.documentSupplier}${a.documentNumber ? ` (${a.documentNumber})` : ""}` : ""}
                  {a.vatReturnLabel ? ` ${a.vatReturnLabel}` : ""}
                  {a.steuerLabel ? `: ${a.steuerLabel}` : ""}
                  {a.darlehenLabel ? `: ${a.darlehenLabel}` : ""}
                </span>
                <span className="small muted">
                  {a.reversed ? "aufgehoben" : a.splitId ? `${a.amount < 0 ? "−" : "+"}${formatEuro(Math.abs(a.amount))}` : formatEuro(Math.abs(a.amount))}
                  {a.splitId ? " · Teil einer Aufteilung" : ""}
                </span>
              </div>
              {!a.reversed && (!a.splitId || firstOfSplit.has(a.id)) && (
                <button type="button" className="btn btn-sm btn-danger" onClick={() => run(() => reverseFn({ data: a.id }))} disabled={busy}>
                  {a.splitId ? "Aufteilung aufheben" : "Aufheben"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <NoticeBanner notice={notice} />

      {tx.open !== 0 && mode === "split" && (
        <SplitForm
          key={tx.id}
          tx={tx}
          initial={splitInitial}
          splitCandidates={splitCandidates}
          directKinds={directKinds}
          steuerOptionen={steuerOptionen}
          darlehenOptionen={darlehenOptionen}
          busy={busy}
          onCancel={() => setMode(best ? "best" : candidates.length ? "other" : "direct")}
          onSubmit={(parts) => run(() => splitFn({ data: { transactionId: tx.id, parts } }))}
        />
      )}

      {tx.open !== 0 && mode !== "split" && (
        <DauerbelegVorschlaege
          suggestions={dauerbelege}
          busy={busy}
          onBook={(documentId) =>
            runAndAdvance(
              () => dauerbelegFn({ data: { documentId, transactionId: tx.id } }),
              dauerbelege.find((d) => d.item.id === documentId)?.amount === tx.open,
            )
          }
        />
      )}

      {tx.open !== 0 && mode !== "split" && (
        <>
          {mode === "best" && best && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="section-label">Bester Treffer</div>
              <div className="match-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontWeight: 600 }}>{best.item.type === "document" ? `Beleg ${best.item.partyName}` : itemLabel(best.item)}</span>
                    <span className="small muted">
                      {best.item.type === "ustva"
                        ? `${best.item.open < 0 ? "fällig" : "Erstattung ab"} ${formatDate(best.item.date)}`
                        : `vom ${formatDate(best.item.date)}`}
                      {best.item.dueDate && best.item.type !== "ustva" ? ` · fällig ${formatDate(best.item.dueDate)}` : ""}
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
                  : best.item.type === "ustva"
                    ? "Bucht wie „Umsatzsteuer an das Finanzamt“ (Umsatzsteuer-Vorauszahlungen), mit Bezug auf die Voranmeldung."
                    : "Bucht Verbindlichkeiten an Bank."}
              </p>
            </div>
          )}

          {mode === "other" && (
            <label className="field">
              Rechnung, Beleg oder Voranmeldung
              <select
                value={candidate}
                onChange={(e) => {
                  setCandidate(e.target.value);
                  const c = candidates.find((x) => `${x.type}:${x.id}` === e.target.value);
                  if (c) setAmount(formatDecimal(Math.min(Math.abs(c.open), Math.abs(tx.open))));
                }}
              >
                <option value="">Bitte wählen</option>
                {candidates.map((c) => (
                  <option key={`${c.type}:${c.id}`} value={`${c.type}:${c.id}`}>
                    {itemLabel(c)} · {c.partyName} · offen {formatEuro(Math.abs(c.open))}
                  </option>
                ))}
              </select>
              {candidates.length === 0 && <span className="small">Keine offenen Rechnungen, gebuchten Belege oder Voranmeldungen in dieser Richtung.</span>}
            </label>
          )}

          {mode === "direct" && direct && (
            <div className="stack" style={{ gap: 10 }}>
              <div className="section-label">Vorschlag ohne Rechnung</div>
              <div className="match-card">
                <span style={{ fontWeight: 600 }}>{directKinds.find((k) => k.value === direct.kind)?.label}</span>
                <ul className="reasons">
                  {direct.reasons.map((reason) => (
                    <li key={reason}>
                      <Icon name="check" size={16} />
                      {reason}
                    </li>
                  ))}
                </ul>
              </div>
              {direct.counterpart && (
                <>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        transferFn({ data: { transactionId: tx.id, counterpartId: direct.counterpart!.id, payoutIds: direct.counterpart!.payoutIds } }),
                      )
                    }
                  >
                    Beide Seiten als Geldtransit buchen
                  </button>
                  <span className="small muted">
                    Gegenbuchung vom {formatDate(direct.counterpart.bookingDate)} über {formatEuro(Math.abs(direct.counterpart.amount))} auf dem anderen Konto
                    {direct.counterpart.payoutIds?.length ? ` (Auszahlung aus ${direct.counterpart.payoutIds.length + 1} Teilen)` : ""}; alles wird in einem
                    Schritt zugeordnet.
                  </span>
                </>
              )}
            </div>
          )}

          {mode === "direct" && (
            <label className="field">
              Buchen als
              <select value={directKind} onChange={(e) => setDirectKind(e.target.value as DirectChoice)}>
                {[...directKinds, STEUER_OPTION, DARLEHEN_OPTION].map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <span className="small muted">{DIRECT_HINT}</span>
              {tx.amount < 0 && (
                <span className="small">
                  Für Ausgaben mit Rechnung den Beleg erst unter <Link to="/belege">Belege</Link> hochladen und buchen.
                </span>
              )}
            </label>
          )}

          {mode === "direct" && directKind === "steuer" && <SteuerFelder options={steuerOptionen} value={steuer} onChange={setSteuer} />}
          {mode === "direct" && directKind === "darlehen" && <DarlehenFelder options={darlehenOptionen} value={darlehen} onChange={setDarlehen} />}

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

          <div className="actions">
            <button
              ref={primaryButton}
              type="button"
              className="btn btn-primary"
              style={{ flexGrow: 1 }}
              disabled={
                busy ||
                signedAmount === null ||
                (mode === "other" && !selectedCandidate) ||
                (mode === "direct" && directKind === "steuer" && !steuerangabe(steuer)) ||
                (mode === "direct" && directKind === "darlehen" && !darlehen.loanId)
              }
              onClick={() => void submitAllocation()}
            >
              {mode === "direct" ? "Buchen" : skontoRest !== 0 ? `Zuordnen, Rest ${formatEuro(Math.abs(skontoRest))} als Skonto` : "Zuordnen"}
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
          {feeRest !== 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <button type="button" className="btn" onClick={() => void bookRestAsFee()} disabled={busy}>
                Voll zuordnen, Rest {formatEuro(Math.abs(feeRest))} als Gebühr
              </button>
              <span className="small muted">
                Für Auszahlungen von PayPal, Stripe oder Shopify: Die Rechnung gilt als voll bezahlt, die einbehaltene Gebühr wird Aufwand (Nebenkosten des
                Geldverkehrs).
              </span>
            </div>
          )}
          {mode === "other" && selectedCandidate?.type === "document" && tx.amount < 0 && tx.purpose.startsWith("Gebühr") && (
            <div className="stack" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => void run(() => feesFn({ data: { transactionId: tx.id, documentId: selectedCandidate.id } }))}
              >
                Alle offenen Gebühren aus {formatDate(tx.bookingDate).slice(3)} diesem Beleg zuordnen
              </button>
              <span className="small muted">Für die monatliche Sammelrechnung des Dienstleisters: Vorsteuer bzw. § 13b laufen einmal über den Beleg.</span>
            </div>
          )}
          {exchangeDifference !== 0 && target && (
            <div className="stack" style={{ gap: 8 }}>
              <button type="button" className="btn" onClick={() => void bookRest("kursdifferenz")} disabled={busy}>
                Ausgleichen, {formatEuro(Math.abs(exchangeDifference))} als Kursdifferenz
              </button>
              <span className="small muted">
                {target.type === "invoice" ? "Rechnung" : "Beleg"} in {target.currency}: Die Zahlung weicht vom umgerechneten Betrag ab. Die Abweichung wird{" "}
                {exchangeDifference > 0 ? "Ertrag" : "Aufwand"} aus Kursdifferenzen, die Umsatzsteuer bleibt beim Kurs{" "}
                {target.type === "invoice" ? "der Rechnung" : "des Belegs"}.
              </span>
            </div>
          )}
          {restKinds.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <div className="actions">
                {restKinds.map((k) => (
                  <button key={k} type="button" className="btn" onClick={() => void bookRest(k)} disabled={busy}>
                    Rest {formatEuro(Math.abs(rest))} {REST_LABEL[k]}
                  </button>
                ))}
              </div>
              <span className="small muted">
                {restKinds.includes("skontoErhalten")
                  ? "Du hast Skonto abgezogen: Der Beleg ist erledigt, die Vorsteuer wird anteilig gemindert."
                  : "Der Kunde hat weniger gezahlt: Skonto oder Forderungsausfall mindern Erlöse und Umsatzsteuer anteilig (§ 17 UStG); die Rechnung ist erledigt."}
              </span>
            </div>
          )}
          {mode !== "direct" && (
            <button type="button" className="btn" onClick={() => setMode("direct")} disabled={busy} title={DIRECT_HINT}>
              Direkt buchen
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => {
              setSplitInitial(target);
              setMode("split");
            }}
            disabled={busy}
          >
            Aufteilen
          </button>
          <div className="small muted pointer-fine">Tastatur: Enter ordnet zu, J und K springen zum nächsten Umsatz.</div>
        </>
      )}
    </aside>
  );
}

type SplitTarget = Detail["splitCandidates"][number];
type SplitPart =
  | { kind: "invoice"; invoiceId: string; amount: number }
  | { kind: "document"; documentId: string; amount: number }
  | { kind: "ustva"; vatReturnId: string; amount: number }
  | { kind: "steuer"; amount: number; steuer: NonNullable<ReturnType<typeof steuerangabe>> }
  | { kind: "darlehen"; amount: number; darlehen: DarlehenWahl }
  | { kind: DirectBooking; amount: number };

interface SplitRow {
  key: number;
  /** "invoice:<id>", "document:<id>", eine Buchungsart ohne Beleg oder "steuer" */
  target: string;
  amount: string;
  /** Nur bei "steuer": Steuerart, Bezugsjahr und Teil */
  steuer: SteuerWahl;
  /** Nur bei "darlehen": Darlehen und Teil der Rate */
  darlehen: DarlehenWahl;
}

let nextSplitKey = 1;

const signed = (cents: number) => `${cents < 0 ? "-" : ""}${formatDecimal(Math.abs(cents))}`;

/** Splitbuchung: den offenen Teil eines Umsatzes auf mehrere Ziele verteilen, Vorzeichen wie auf dem Konto */
function SplitForm({
  tx,
  initial,
  splitCandidates,
  directKinds,
  steuerOptionen,
  darlehenOptionen,
  busy,
  onCancel,
  onSubmit,
}: {
  tx: Detail["transaction"];
  initial: SplitTarget | undefined;
  splitCandidates: SplitTarget[];
  directKinds: Data["directKinds"];
  steuerOptionen: SteuerOptionen;
  darlehenOptionen: DarlehenOptionen;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (parts: SplitPart[]) => void;
}) {
  const steuerStart = steuerWahlFuer(steuerOptionen, tx.bookingDate);
  const darlehenStart = darlehenWahlFuer(darlehenOptionen, tx.amount);
  const [rows, setRows] = useState<SplitRow[]>(() =>
    initial
      ? [
          { key: nextSplitKey++, target: `${initial.type}:${initial.id}`, amount: signed(initial.open), steuer: steuerStart, darlehen: darlehenStart },
          { key: nextSplitKey++, target: "gebuehren", amount: signed(tx.open - initial.open), steuer: steuerStart, darlehen: darlehenStart },
        ]
      : [
          { key: nextSplitKey++, target: "", amount: signed(tx.open), steuer: steuerStart, darlehen: darlehenStart },
          { key: nextSplitKey++, target: "gebuehren", amount: "", steuer: steuerStart, darlehen: darlehenStart },
        ],
  );

  const parsed = rows.map((r) => parseEuro(r.amount));
  const sum = parsed.reduce<number>((s, p) => s + (p ?? 0), 0);
  const rest = tx.open - sum;
  const complete =
    rows.every(
      (r, i) =>
        r.target &&
        parsed[i] !== null &&
        parsed[i] !== 0 &&
        (r.target !== "steuer" || steuerangabe(r.steuer) !== null) &&
        (r.target !== "darlehen" || r.darlehen.loanId !== ""),
    ) && rest === 0;

  function update(key: number, patch: Partial<SplitRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function toPart(row: SplitRow, amount: number): SplitPart {
    const [type, id] = row.target.split(":");
    if (id) return itemTarget(type, id, amount);
    const angabe = steuerangabe(row.steuer);
    if (row.target === "steuer" && angabe) return { kind: "steuer", amount, steuer: angabe };
    if (row.target === "darlehen") return { kind: "darlehen", amount, darlehen: row.darlehen };
    return { kind: row.target as DirectBooking, amount };
  }

  return (
    <form
      className="stack"
      style={{ gap: 10 }}
      aria-label="Umsatz aufteilen"
      onSubmit={(event) => {
        event.preventDefault();
        if (!complete) return;
        onSubmit(rows.map((r, i) => toPart(r, parsed[i]!)));
      }}
    >
      <div className="section-label">Aufteilen</div>
      <p className="small muted" style={{ margin: 0 }}>
        Beträge mit Vorzeichen wie auf dem Konto: Zahlungseingänge positiv, Gebühren und Ausgänge negativ. Zusammen ergeben die Teile den offenen Betrag von{" "}
        {signed(tx.open)} €; jeder Teil wird einzeln gebucht.
      </p>
      {rows.map((row, index) => (
        <div key={row.key} className="split-row">
          <label className="field">
            Teil {index + 1}
            <select
              value={row.target}
              onChange={(e) => {
                const value = e.target.value;
                const item = splitCandidates.find((c) => `${c.type}:${c.id}` === value);
                update(row.key, item ? { target: value, amount: signed(item.open) } : { target: value });
              }}
            >
              <option value="">Bitte wählen</option>
              <optgroup label="Rechnungen, Belege und Voranmeldungen">
                {splitCandidates.map((c) => (
                  <option key={`${c.type}:${c.id}`} value={`${c.type}:${c.id}`}>
                    {itemLabel(c)} · {c.partyName} · offen {signed(c.open)} €
                  </option>
                ))}
              </optgroup>
              <optgroup label="Direkt buchen">
                {[...directKinds, STEUER_OPTION, DARLEHEN_OPTION].map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label className="field">
            Betrag
            <input
              className="mono"
              inputMode="decimal"
              value={row.amount}
              placeholder="-0,00"
              onChange={(e) => update(row.key, { amount: e.target.value })}
              aria-invalid={parsed[index] === null}
              style={{ textAlign: "right" }}
            />
          </label>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Teil ${index + 1} entfernen`}
            disabled={rows.length <= 2}
            onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          {row.target === "steuer" && (
            <div style={{ gridColumn: "1 / -1" }}>
              <SteuerFelder options={steuerOptionen} value={row.steuer} onChange={(steuer) => update(row.key, { steuer })} />
            </div>
          )}
          {row.target === "darlehen" && (
            <div style={{ gridColumn: "1 / -1" }}>
              <DarlehenFelder options={darlehenOptionen} value={row.darlehen} onChange={(darlehen) => update(row.key, { darlehen })} />
            </div>
          )}
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-dashed"
          disabled={rows.length >= 20}
          onClick={() =>
            setRows((prev) => [
              ...prev,
              { key: nextSplitKey++, target: "", amount: rest !== 0 ? signed(rest) : "", steuer: steuerStart, darlehen: darlehenStart },
            ])
          }
        >
          + Teil
        </button>
        <span className="small" aria-live="polite">
          {rest === 0 ? "Teile ergeben den Umsatz." : `Noch zu verteilen: ${signed(rest)} €`}
        </span>
      </div>
      <div className="actions">
        <button type="submit" className="btn btn-primary" style={{ flexGrow: 1 }} disabled={busy || !complete}>
          Aufteilen und buchen
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
