import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDate, formatDateTime } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Field } from "./Field.tsx";
import { KonfliktKlaeren } from "./ImportKonflikt.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { type getStripeSettings, removeStripeConnectionFn, saveStripeConnectionFn, syncStripeNow } from "../server/functions/stripe.ts";

type Data = Awaited<ReturnType<typeof getStripeSettings>>;

/** Auswahl für den automatischen Abruf; die Werte prüft der Server (STRIPE_RHYTHMEN in stripe/abruf-regeln.ts) */
const RHYTHMUS_LABELS: Record<Data["rhythmus"], string> = {
  stuendlich: "Stündlich",
  taeglich: "Täglich",
  woechentlich: "Wöchentlich",
};

/**
 * Balance Transactions von Stripe: API-Schlüssel hinterlegen und die Umsätze abrufen.
 *
 * Haben holt Zahlungen, Erstattungen, Streitfälle, Gebühren und Auszahlungen selbst und legt sie im Konto des
 * Zahlungsdienstleisters an, wie den CSV-Export „Balance history“; der Export bleibt der Weg für ältere Zeiträume.
 */
export function StripePaymentsCard({ data }: { data: Data }) {
  const router = useRouter();
  const save = useServerFn(saveStripeConnectionFn);
  const remove = useServerFn(removeStripeConnectionFn);
  const sync = useServerFn(syncStripeNow);
  const [fetchFrom, setFetchFrom] = useState(data.fetchFrom);
  const [rhythmus, setRhythmus] = useState(data.rhythmus);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [geklaert, setGeklaert] = useState(false);
  const { busy, notice, run } = useAction();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const apiKey = String(new FormData(form).get("apiKey") ?? "");
    void run(async () => {
      await save({ data: { apiKey, fetchFrom, rhythmus } });
      form.reset();
      await router.invalidate();
    }, "Zugang gespeichert.");
  }

  return (
    <section className="card" aria-labelledby="stripe-heading">
      <h2 id="stripe-heading">Stripe</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Haben holt die Umsätze des Stripe-Kontos (Zahlungen, Erstattungen, Streitfälle, Gebühren und Auszahlungen) und legt sie im Konto des
        Zahlungsdienstleisters an. Dafür braucht es im{" "}
        <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer">
          Stripe-Dashboard
        </a>{" "}
        einen eingeschränkten Schlüssel (<code>rk_live_…</code>) nur mit Lesezugriff auf „Guthaben“ und „Konto“. Der CSV-Export „Balance history“ bleibt der Weg
        für Zeiträume vor dem ersten Abruf.
      </p>

      <StripeStatus data={data} />

      {data.lastError && (
        <div className="banner banner-danger" role="status">
          {data.lastError}
        </div>
      )}
      {(data.konflikte.length > 0 || geklaert) && (
        <div className="actions">
          <KonfliktKlaeren konflikte={data.konflikte} disabled={busy} quelle="stripe" onGeklaert={() => setGeklaert(true)} />
        </div>
      )}

      <form onSubmit={onSubmit}>
        <Field
          label={data.configured ? "API-Schlüssel (leer lassen zum Behalten)" : "API-Schlüssel"}
          hint="Beginnt mit rk_live_ oder sk_live_; er liegt verschlüsselt in der Datenbank. Der öffentliche Schlüssel pk_ reicht nicht."
        >
          {(control) => <input {...control} name="apiKey" type="password" autoComplete="off" />}
        </Field>
        <Field label="Abruf ab" hint="Erster Tag, den Haben holt; davor gilt der CSV-Export">
          {(control) => <input {...control} name="fetchFrom" type="date" value={fetchFrom} onChange={(event) => setFetchFrom(event.target.value)} />}
        </Field>
        <Field label="Automatischer Abruf">
          {(control) => (
            <select {...control} name="rhythmus" value={rhythmus} onChange={(event) => setRhythmus(event.target.value as Data["rhythmus"])}>
              {Object.entries(RHYTHMUS_LABELS).map(([schluessel, label]) => (
                <option key={schluessel} value={schluessel}>
                  {label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Speichere …" : "Speichern"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !data.configured}
            onClick={() =>
              void run(async () => {
                setGeklaert(false);
                const result = await sync();
                await router.invalidate();
                if (result.error) throw new Error(result.error);
                return result;
              }, "Abruf durchgelaufen.")
            }
          >
            {busy ? "Laufe …" : "Jetzt abrufen"}
          </button>
          <button type="button" className="btn btn-danger" disabled={busy || !data.configured} onClick={() => setConfirmingRemove(true)}>
            Zugang entfernen
          </button>
        </div>
        <NoticeBanner notice={notice} />
        <ConfirmDialog
          open={confirmingRemove}
          title="Stripe-Zugang entfernen?"
          confirmLabel="Entfernen"
          danger
          onConfirm={() => {
            setConfirmingRemove(false);
            void run(async () => {
              await remove();
              await router.invalidate();
            }, "Zugang entfernt. Übernommene Umsätze bleiben im Konto stehen.");
          }}
          onClose={() => setConfirmingRemove(false)}
        >
          <p>
            Der Schlüssel wird gelöscht. Bereits übernommene Umsätze bleiben im Konto des Zahlungsdienstleisters stehen; ein neuer Abruf legt sie nicht noch
            einmal an.
          </p>
        </ConfirmDialog>
      </form>
    </section>
  );
}

/** Stand des Zugangs: eingerichtet, letzter und nächster Abruf */
function StripeStatus({ data }: { data: Data }) {
  return (
    <p className="small" style={{ margin: "0.5rem 0 0" }}>
      {data.configured ? (
        <strong>
          Verbunden mit {data.accountId} (Schlüssel …{data.keyHint}).
        </strong>
      ) : (
        <strong>Nicht eingerichtet.</strong>
      )}{" "}
      {data.lastSyncAt ? `Letzter Abruf: ${formatDateTime(data.lastSyncAt)}.` : data.configured ? "Noch kein Abruf." : ""}
      {data.lastSyncAt && data.naechsterAbrufAb ? ` Der nächste Abruf holt ab dem ${formatDate(data.naechsterAbrufAb)}.` : ""}
    </p>
  );
}
