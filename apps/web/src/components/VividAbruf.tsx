import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { defaultFetchFrom, fetchFromForConnect } from "../lib/bank-connect.ts";
import { errorMessage, formatDate, formatDateTime } from "../lib/format.ts";
import { useSubmitCheck } from "../lib/use-submit-check.ts";
import type { getBankOverview } from "../server/functions/bank.ts";
import { connectVivid, disconnectVivid, syncVivid } from "../server/functions/vivid.ts";
import { today as todayInGermany } from "../server/today.ts";
import { VividStatus } from "./BankStatus.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Field } from "./Field.tsx";

/*
 * Kontoabruf über die Vivid Business API (#1393) auf der Bankseite: Verbinden mit einem API-Schlüssel, die Verbindungen
 * mit „Jetzt abrufen“ und „Trennen“. Ein abgelehnter Schlüssel (abgelaufen, gelöscht) wird mit „Vivid verbinden“ ersetzt.
 */

type Vivid = Awaited<ReturnType<typeof getBankOverview>>["vivid"];
type Verbindung = Vivid["connections"][number];
type Ergebnis = Awaited<ReturnType<typeof syncVivid>>;
type Meldung = { tone: "ok" | "danger" | "info"; text: string };

export const VIVID_ANLEITUNG = "https://github.com/firsttris/haben/blob/main/docs/installation-anbindungen.md#kontoabruf-über-vivid";

const kontoName = (a: { name: string; iban: string }) => (a.name.endsWith(a.iban.slice(-4)) ? a.name : `${a.name} …${a.iban.slice(-4)}`);

const meldungenAus = (e: Ergebnis): Meldung[] => [
  { tone: e.ok ? "ok" : "danger", text: e.meldung },
  ...e.hinweise.map((text) => ({ tone: "info" as const, text })),
];

function VerbindenForm({ onErgebnis, onAbbrechen }: { onErgebnis: (e: Ergebnis) => Promise<void>; onAbbrechen: () => void }) {
  const connect = useServerFn(connectVivid);
  const today = todayInGermany();
  const [apiKey, setApiKey] = useState("");
  const [fetchFrom, setFetchFrom] = useState(defaultFetchFrom(today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    form,
    error: fehler,
    check,
  } = useSubmitCheck({
    apiKey: apiKey.trim() ? null : "Der API-Schlüssel fehlt.",
    fetchFrom: fetchFrom > today ? `Wähle einen Tag bis ${formatDate(today)} oder lass das Feld leer.` : null,
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !check()) return;
    setBusy(true);
    setError(null);
    try {
      await onErgebnis(await connect({ data: { apiKey: apiKey.trim(), fetchFrom: fetchFromForConnect(fetchFrom, today) } }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={onSubmit} className="stack" style={{ gap: 12, maxWidth: 560 }} aria-label="Vivid verbinden" noValidate>
      <Field
        label="API-Schlüssel"
        error={fehler("apiKey")}
        hint={
          <>
            In Vivid Business unter API › Add API token, mit den Rechten accounts:read und transactions:read. Haben speichert ihn verschlüsselt.{" "}
            <a href={VIVID_ANLEITUNG} target="_blank" rel="noreferrer">
              Anleitung
            </a>
          </>
        }
      >
        {(control) => (
          <input
            {...control}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="vivid_sk_v1_…"
            autoComplete="off"
            spellCheck={false}
            required
            autoFocus
          />
        )}
      </Field>
      <Field
        label="Umsätze abrufen ab"
        error={fehler("fetchFrom")}
        hint="Gilt für Konten, die noch nie abgerufen wurden. Vivid gibt nur die letzten 90 Tage heraus; ältere Umsätze importierst du per Datei."
      >
        {(control) => <input {...control} type="date" value={fetchFrom} max={today} onChange={(e) => setFetchFrom(e.target.value)} />}
      </Field>
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={onAbbrechen} disabled={busy}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Verbinde …" : "Verbinden"}
        </button>
      </div>
    </form>
  );
}

/** Vivid im Bereich „Automatischer Abruf“: Formular zum Verbinden (verbinden) und die Verbindungen */
export function VividAbruf({ vivid, verbinden, setVerbinden }: { vivid: Vivid; verbinden: boolean; setVerbinden: (v: boolean) => void }) {
  const router = useRouter();
  const sync = useServerFn(syncVivid);
  const disconnect = useServerFn(disconnectVivid);
  const [busy, setBusy] = useState<string | null>(null);
  const [meldungen, setMeldungen] = useState<Meldung[]>([]);
  const [trennt, setTrennt] = useState<Verbindung | null>(null);

  async function run(id: string, work: () => Promise<void>) {
    setBusy(id);
    setMeldungen([]);
    try {
      await work();
      await router.invalidate();
    } catch (e) {
      setMeldungen([{ tone: "danger", text: errorMessage(e) }]);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {verbinden && (
        <VerbindenForm
          onAbbrechen={() => setVerbinden(false)}
          onErgebnis={async (e) => {
            setVerbinden(false);
            setMeldungen(meldungenAus(e));
            await router.invalidate();
          }}
        />
      )}

      <ConfirmDialog
        open={trennt !== null}
        title="Vivid-Verbindung trennen?"
        confirmLabel="Trennen"
        danger
        onConfirm={() => {
          if (!trennt) return;
          const { id } = trennt;
          void run(`x-${id}`, () => disconnect({ data: id }).then(() => undefined));
        }}
        onClose={() => setTrennt(null)}
      >
        <p>Haben löscht den gespeicherten API-Schlüssel; in Vivid gilt er weiter, bis du ihn dort löschst. Die abgerufenen Umsätze bleiben erhalten.</p>
      </ConfirmDialog>

      {vivid.connections.map((c) => (
        <div key={c.id} className="history-row" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: "1 1 260px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600 }}>Vivid Business</span>
              <VividStatus status={c.status} />
              <span className="small muted">API</span>
            </div>
            <span className="small muted">{c.accounts.map(kontoName).join(" · ") || "Keine Konten"}</span>
            <span className="small muted">{c.lastSyncAt ? `Zuletzt abgerufen ${formatDateTime(c.lastSyncAt)}` : "Noch nicht abgerufen"}</span>
            {c.lastError && <span className="field-error">{c.lastError}</span>}
          </div>
          <div className="actions">
            <button type="button" className="btn btn-danger" disabled={busy !== null} onClick={() => setTrennt(c)}>
              Trennen
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy !== null}
              onClick={() => void run(c.id, async () => setMeldungen(meldungenAus(await sync({ data: c.id }))))}
            >
              {busy === c.id ? "Rufe ab …" : "Jetzt abrufen"}
            </button>
          </div>
        </div>
      ))}

      {meldungen.length > 0 && (
        <ul className="upload-messages" role="status">
          {meldungen.map((m, i) => (
            <li key={i} className={`banner banner-${m.tone}`}>
              {m.text}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
