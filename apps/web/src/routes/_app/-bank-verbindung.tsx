import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ConnectionStatus } from "../../components/BankStatus.tsx";
import { FintsAbruf } from "../../components/FintsAbruf.tsx";
import { defaultFetchFrom, fetchFromForConnect } from "../../lib/bank-connect.ts";
import { errorMessage, formatDate, formatDateTime } from "../../lib/format.ts";
import { useSubmitCheck } from "../../lib/use-submit-check.ts";
import { connectBank, disconnectBank, getEnableBanks, syncBankConnection } from "../../server/functions/bank.ts";
import { today as todayInGermany } from "../../server/today.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { KonfliktKlaeren, stichtagText } from "../../components/ImportKonflikt.tsx";
import { Field } from "../../components/Field.tsx";
import type { Data } from "./-bank-daten.ts";

export type Sync = Data["sync"];

/** Automatischer Abruf über Enable Banking und FinTS (#654): verbundene Banken, Abruf, Erneuern und Trennen */
export function BankSync({ sync, fints, result }: { sync: Sync; fints: Data["fints"]; result: { ok: boolean; message: string } | null }) {
  const router = useRouter();
  const navigate = useNavigate({ from: "/bank" });
  const syncFn = useServerFn(syncBankConnection);
  const disconnectFn = useServerFn(disconnectBank);
  const connectFn = useServerFn(connectBank);
  const [connecting, setConnecting] = useState(false);
  const [fintsConnecting, setFintsConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState<Sync["connections"][number] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ tone: "ok" | "danger" | "info"; text: string }[]>([]);

  if (!sync.configured && sync.connections.length === 0 && !fints.configured && fints.connections.length === 0) {
    return (
      <p className="small muted" style={{ margin: "0 0 16px" }}>
        Automatischer Abruf: mit einer Enable-Banking-Anwendung oder über FinTS holt Haben die Umsätze täglich selbst. Einrichten unter{" "}
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
        <div className="actions">
          {sync.configured && (
            <button type="button" className="btn" onClick={() => setConnecting((v) => !v)} disabled={busy !== null}>
              Bank verbinden
            </button>
          )}
          {fints.configured && (
            <button type="button" className="btn" onClick={() => setFintsConnecting((v) => !v)} disabled={busy !== null}>
              Über FinTS verbinden
            </button>
          )}
        </div>
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

      {sync.connections.length === 0 && fints.connections.length === 0 && !connecting && !fintsConnecting && (
        <p className="small muted" style={{ margin: 0 }}>
          Noch keine Bank verbunden. Nach der Freigabe bei deiner Bank holt Haben die Umsätze einmal täglich; der Import per CSV oder CAMT bleibt daneben
          möglich.
        </p>
      )}

      {sync.connections.map((c) => {
        const canSync = c.status === "aktiv";
        return (
          <div key={c.id} className="history-row" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: "1 1 260px" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600 }}>{c.aspspName}</span>
                <ConnectionStatus connection={c} />
              </div>
              <span className="small muted">
                {c.accounts.map((a) => `${a.name} …${a.iban.slice(-4)}${stichtagText(sync.stichtage, a.bankAccountId)}`).join(" · ") || "Keine Konten"}
              </span>
              <span className="small muted">
                {c.lastSyncAt ? `Zuletzt abgerufen ${formatDateTime(c.lastSyncAt)}` : "Noch nicht abgerufen"}
                {c.validUntil ? ` · Zustimmung bis ${formatDate(c.validUntil)}` : ""}
              </span>
              {c.lastError && <span className="field-error">{c.lastError}</span>}
            </div>
            <div className="actions">
              <button type="button" className="btn" disabled={busy !== null} onClick={() => setDisconnecting(c)}>
                Trennen
              </button>
              {sync.configured && (c.status !== "aktiv" || c.renewSoon) && (
                <button type="button" className="btn" disabled={busy !== null} onClick={() => void renew(c.aspspName, c.psuType)}>
                  Zustimmung erneuern
                </button>
              )}
              <KonfliktKlaeren konflikte={sync.konflikte.filter((k) => c.accounts.some((a) => a.bankAccountId === k.bankAccountId))} disabled={busy !== null} />
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
            </div>
          </div>
        );
      })}

      <FintsAbruf fints={fints} verbinden={fintsConnecting} setVerbinden={setFintsConnecting} />

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

/** Höchstens so viele Banken stehen in der Auswahl; mehr findet die Suche */
export const MAX_BANK_OPTIONS = 300;

/** Die Banken, deren Name den Suchbegriff enthält, in der Reihenfolge der Liste */
export function matchingBanks<T extends { name: string }>(banks: T[], query: string): T[] {
  const term = query.trim().toLowerCase();
  return banks.filter((b) => !term || b.name.toLowerCase().includes(term)).slice(0, MAX_BANK_OPTIONS);
}

export function ConnectForm({
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

  const visible = matchingBanks(banks ?? [], query);
  // Gewählt ist, was die Liste markiert zeigt: Passt der Zustand zu keiner Zeile, markiert React von sich aus die
  // erste. Ohne diesen Rückfall sah die einzige Bank nach der Suche gewählt aus, der Knopf blieb aber grau, und ein
  // Klick auf sie änderte nichts, weil der Browser sie schon für gewählt hielt (#555)
  const bank = visible.find((b) => b.name === selected) ?? visible[0];
  const {
    form,
    error: fehler,
    check,
  } = useSubmitCheck({
    bank: bank
      ? null
      : banks === null
        ? "Die Liste der Banken lädt noch."
        : query.trim()
          ? `Keine Bank passt zu „${query.trim()}“. Ändere die Suche.`
          : "Keine Bank verfügbar.",
    // Leer heißt Vorgabe (fetchFromForConnect); max prüft der Browser mit noValidate nicht mehr
    fetchFrom: fetchFrom > today ? `Wähle einen Tag bis ${formatDate(today)} oder lass das Feld leer.` : null,
  });

  // Fällt die gewählte Bank aus den Treffern, rückt der erste Treffer nach und bleibt, wenn die Suche wieder weiter wird
  function onQueryChange(value: string) {
    setQuery(value);
    const next = matchingBanks(banks ?? [], value);
    const keep = next.find((b) => b.name === bank?.name) ?? next[0];
    if (keep) setSelected(keep.name);
  }

  // Enter im Suchfeld schickt das Formular nicht ab; gewählt ist schon der erste Treffer
  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !check() || !bank) return;
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
    <form ref={form} onSubmit={onSubmit} className="stack" style={{ gap: 12, maxWidth: 560 }} noValidate>
      <Field label="Bank suchen">
        {(control) => (
          <input
            {...control}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="z. B. DKB, Sparkasse, N26"
            autoFocus
          />
        )}
      </Field>
      <Field label="Bank" error={fehler("bank")}>
        {(control) => (
          <select {...control} size={8} value={bank?.name ?? ""} onChange={(e) => setSelected(e.target.value)} required aria-busy={banks === null}>
            {banks === null && !error && <option disabled>Lade Banken …</option>}
            {visible.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </Field>
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
      <Field
        label="Umsätze abrufen ab"
        error={fehler("fetchFrom")}
        hint={
          <>
            Gilt für Konten, die noch nie abgerufen wurden. Mit der Vorgabe holt Haben ab Jahresbeginn oder schließt an Umsätze an, die schon da sind (etwa aus
            einer Datei). Beginnt die Buchhaltung in Haben später im Jahr, etwa nach einem Umzug, trage diesen Tag ein.
          </>
        }
      >
        {(control) => <input {...control} type="date" value={fetchFrom} max={today} onChange={(e) => setFetchFrom(e.target.value)} />}
      </Field>
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
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Weiterleiten …" : "Weiter zur Bank"}
        </button>
      </div>
    </form>
  );
}
