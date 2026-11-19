import { formatEuro } from "@haben/core";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod/mini";
import { TransactionStatus } from "../../components/BankStatus.tsx";
import { UmsatzBetrag, useGebuehrZeilen } from "../../components/BankGebuehr.tsx";
import { formatDate, daysUntil } from "../../lib/format.ts";
import { getBankOverview } from "../../server/functions/bank.ts";
import { getExternalBankSources } from "../../server/functions/bank-quellen.ts";
import { ExcludedAccounts } from "../../components/BankKontoAusschliessen.tsx";
import { isDialogOpen } from "../../components/ConfirmDialog.tsx";
import { BestaetigenLeiste, useBestaetigen, useLeertasteMarkiert, ZeilenMarkierung } from "../../components/BankBestaetigen.tsx";
import { BankSortierKopf } from "../../components/BankSortierKopf.tsx";
import type { Data } from "./-bank-daten.ts";
import { AllocationPanel } from "./-bank-zuordnung.tsx";
import { BankSync } from "./-bank-verbindung.tsx";
import { AccountSettings, ImportControls, SearchBox } from "./-bank-konto.tsx";
import { ExterneQuelle } from "../../components/ExterneQuelle.tsx";

const searchSchema = z.object({
  /** Ein Konto oder „alle“ (#617) */
  konto: z.optional(z.union([z.uuid(), z.literal("alle")])),
  filter: z.optional(z.enum(["offen", "zugeordnet", "alle", "vorschlag"])),
  suche: z.optional(z.string()),
  umsatz: z.optional(z.uuid()),
  /** Sortierung der Umsatzliste: Spalte und Richtung (#681) */
  sort: z.optional(z.enum(["datum", "gegenpartei", "betrag", "status"])),
  dir: z.optional(z.enum(["auf", "ab"])),
  /** Ergebnis der Rückleitung von der Bank */
  abruf: z.optional(z.enum(["ok", "fehler"])),
  meldung: z.optional(z.string().check(z.maxLength(500))),
});

export const Route = createFileRoute("/_app/bank")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    konto: search.konto,
    filter: search.filter,
    suche: search.suche,
    umsatz: search.umsatz,
    sort: search.sort,
    dir: search.dir,
  }),
  loader: async ({ deps }) => {
    const [overview, quellen] = await Promise.all([
      getBankOverview({
        data: {
          konto: deps.konto,
          filter: deps.filter ?? "offen",
          suche: deps.suche ?? "",
          umsatz: deps.umsatz,
          sort: deps.sort ?? "datum",
          dir: deps.dir ?? "ab",
        },
      }),
      // Externe Quellen für den REST-Import (#306, Schritt 4)
      getExternalBankSources(),
    ]);
    return { ...overview, ...quellen };
  },
  head: () => ({ meta: [{ title: "Bank · Haben" }] }),
  component: BankPage,
});

const FORMAT_LABEL = (format: string) =>
  format === "enablebanking" || format === "fints"
    ? "Abruf"
    : format.startsWith("importvertrag")
      ? "REST-Import"
      : format.startsWith("camt")
        ? "CAMT.053"
        : format === "paypal-csv"
          ? "PayPal"
          : format === "paypal-api"
            ? "PayPal (Abruf)"
            : format === "stripe-csv"
              ? "Stripe"
              : format === "shopify-payments-csv"
                ? "Shopify"
                : format === "ebay-csv"
                  ? "eBay"
                  : format === "etsy-csv"
                    ? "Etsy"
                    : format === "etsy-ledger"
                      ? "Etsy (Abruf)"
                      : format === "googleplay-earnings"
                        ? "Google Play"
                        : format === "appstore-finance"
                          ? "App Store"
                          : format === "store-payout"
                            ? "Auszahlung"
                            : "CSV";

/** J/K springen zum nächsten bzw. vorigen Umsatz */
function useUmsatzTasten(transactions: Data["transactions"], index: number) {
  const navigate = useNavigate({ from: "/bank" });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (isDialogOpen() || target.closest("input, select, textarea, [contenteditable]") || event.metaKey || event.ctrlKey || event.altKey) return;
      const step = event.key === "j" ? 1 : event.key === "k" ? -1 : 0;
      if (!step) return;
      const next = transactions[index + step];
      if (next) {
        event.preventDefault();
        void navigate({ search: (prev) => ({ ...prev, umsatz: next.id }), replace: true });
        document.getElementById(`tx-${next.id}`)?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [transactions, index, navigate]);
}

function BankPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  // Spaltenkopf sortiert: erster Klick absteigend, derselbe Kopf nochmal dreht die Richtung (#681)
  const sortierung = search.sort ?? "datum";
  const richtung = search.dir ?? "ab";
  const filter = search.filter ?? "offen";
  const selectedId = data.detail?.transaction.id;
  const { zeilen, sichtbar, index } = useGebuehrZeilen(data.transactions, data.accounts, selectedId);
  const selectedAccount = data.accounts.find((a) => a.id === data.accountId);
  // „Alle Konten“ zeigt die Umsätze aller Konten, etwa für „Alle anzeigen“ der Schnellsuche (#617)
  const konto = data.allAccounts ? ("alle" as const) : (data.accountId ?? undefined);
  const openCount = data.allAccounts ? data.accounts.reduce((sum, a) => sum + a.openCount, 0) : (selectedAccount?.openCount ?? 0);
  const accountName = new Map(data.accounts.map((a) => [a.id, a.name]));

  const bestaetigen = useBestaetigen(sichtbar);
  useLeertasteMarkiert(bestaetigen);
  useUmsatzTasten(sichtbar, index);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Umsätze zuordnen</div>
          <h1>Bank</h1>
        </div>
        <ImportControls data={data} />
      </div>

      <BankSync sync={data.sync} fints={data.fints} result={search.abruf ? { ok: search.abruf === "ok", message: search.meldung ?? "" } : null} />

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
            {data.accounts.length > 1 && (
              <Link to="/bank" search={{ konto: "alle", filter }} aria-current={data.allAccounts ? "page" : undefined} className="account-tab">
                <span style={{ fontSize: 14, fontWeight: 600 }}>Alle Konten</span>
                <span className="small muted">{data.accounts.length} Konten</span>
              </Link>
            )}
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
            <AccountSettings
              key={selectedAccount.id}
              account={selectedAccount}
              purposes={data.purposes}
              ledger={data.ledgers[selectedAccount.id]}
              excludeBlockedBy={data.excludeBlockedBy}
            />
          )}
          {selectedAccount && <ExterneQuelle key={`quelle-${selectedAccount.id}`} account={selectedAccount} daten={data} />}

          <div className="grid-main">
            <section className="card" style={{ padding: "8px 0 12px" }} aria-label="Umsätze">
              <div className="tx-toolbar">
                <div role="group" aria-label="Filter" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(["alle", "offen", "zugeordnet", "vorschlag"] as const).map((f) => (
                    <Link
                      key={f}
                      to="/bank"
                      search={{ konto, filter: f, suche: search.suche, sort: search.sort, dir: search.dir }}
                      className={`chip${filter === f ? " active" : ""}`}
                      aria-current={filter === f ? "page" : undefined}
                    >
                      {f === "alle" ? "Alle" : f === "offen" ? `Offen · ${openCount}` : f === "zugeordnet" ? "Zugeordnet" : "Vorschlag"}
                    </Link>
                  ))}
                </div>
                {/* key: beim Kontowechsel leer neu aufsetzen, sonst trägt die Suche ins neue Konto */}
                <SearchBox key={konto ?? ""} initial={search.suche ?? ""} />
              </div>
              <BestaetigenLeiste b={bestaetigen} />
              <BankSortierKopf sort={sortierung} dir={richtung} />
              {data.transactions.length === 0 && (
                <p className="muted" style={{ margin: 0, padding: "16px 20px" }}>
                  {filter === "offen" ? "Alles zugeordnet." : filter === "vorschlag" ? "Keine Umsätze mit Vorschlag." : "Keine Umsätze."}
                </p>
              )}
              {zeilen.map(({ umsatz: tx, gebuehr }) => (
                <div key={tx.id} className="tx-wrap">
                  {bestaetigen.markierbar.length > 0 && <ZeilenMarkierung id={tx.id} b={bestaetigen} label={tx.counterpartyName || "Umsatz"} />}
                  <Link
                    id={`tx-${tx.id}`}
                    to="/bank"
                    search={{ ...search, umsatz: tx.id }}
                    replace
                    className={`table-row tx-cols tx-row${tx.id === selectedId ? " selected" : ""}`}
                    aria-current={tx.id === selectedId ? "true" : undefined}
                  >
                    <div className="muted small">{formatDate(tx.bookingDate)}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <span className="ellipsis" style={{ fontWeight: 500 }}>
                        {tx.counterpartyName || "–"}
                      </span>
                      <span className="small muted ellipsis">
                        {data.allAccounts ? [accountName.get(tx.bankAccountId), tx.purpose].filter(Boolean).join(" · ") : tx.purpose}
                      </span>
                      {tx.bestaetigung && (
                        <span className="small" style={{ color: "var(--accent-ink)" }}>
                          Vorschlag: {tx.bestaetigung.text}
                        </span>
                      )}
                    </div>
                    <UmsatzBetrag betrag={tx.amount} gebuehr={gebuehr?.amount ?? null} />
                    <div>
                      <TransactionStatus tx={tx} />
                    </div>
                  </Link>
                </div>
              ))}
            </section>
            {data.detail ? (
              <AllocationPanel
                key={`${data.detail.transaction.id}-${data.detail.transaction.open}`}
                detail={data.detail}
                directKinds={data.directKinds}
                steuerOptionen={{ steuerarten: data.steuerarten, steuerPosten: data.steuerPosten }}
                darlehenOptionen={{ loans: data.loans, loanParts: data.loanParts }}
                kategorieOptionen={{ kategorien: data.kategorien, kleinunternehmer: data.kleinunternehmer }}
                nextOpenId={nextOpenAfter(sichtbar, data.detail.transaction.id)}
                gebuehr={zeilen.find((z) => z.umsatz.id === selectedId)?.gebuehr ?? null}
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

      <ExcludedAccounts accounts={data.excludedAccounts} />
    </>
  );
}

/** Nächster offener Umsatz nach dem gewählten, am Ende der Liste wieder von vorn */
function nextOpenAfter(transactions: Data["transactions"], id: string): string | undefined {
  const index = transactions.findIndex((t) => t.id === id);
  const after = [...transactions.slice(index + 1), ...transactions.slice(0, Math.max(index, 0))];
  return after.find((t) => t.open !== 0 && t.id !== id)?.id;
}
