import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDate, formatDateTime } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Field } from "./Field.tsx";
import { KonfliktKlaeren } from "./ImportKonflikt.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { type getPayPalSettings, removePayPalConnectionFn, savePayPalConnectionFn, syncPayPalNow } from "../server/functions/paypal.ts";

type Data = Awaited<ReturnType<typeof getPayPalSettings>>;

/** Auswahl für den automatischen Abruf; die Werte prüft der Server (PAYPAL_RHYTHMEN in paypal/abruf-regeln.ts) */
const RHYTHMUS_LABELS: Record<Data["rhythmus"], string> = {
  stuendlich: "Stündlich",
  taeglich: "Täglich",
  woechentlich: "Wöchentlich",
};

/**
 * Transaction Search von PayPal: Zugangsdaten der PayPal-App hinterlegen und die Umsätze abrufen.
 *
 * Haben holt Zahlungen, Gebühren, Erstattungen, Rückbuchungen und Abbuchungen selbst und legt sie im Konto des
 * Zahlungsdienstleisters an, wie den Aktivitätenexport (CSV); der Export bleibt der Weg für ältere Zeiträume.
 */
export function PayPalPaymentsCard({ data }: { data: Data }) {
  const router = useRouter();
  const save = useServerFn(savePayPalConnectionFn);
  const remove = useServerFn(removePayPalConnectionFn);
  const sync = useServerFn(syncPayPalNow);
  const [fetchFrom, setFetchFrom] = useState(data.fetchFrom);
  const [rhythmus, setRhythmus] = useState(data.rhythmus);
  const [sandbox, setSandbox] = useState(data.sandbox);
  const [zeitzone, setZeitzone] = useState(data.zeitzone);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [geklaert, setGeklaert] = useState(false);
  const { busy, notice, run } = useAction();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const clientId = String(formData.get("clientId") ?? "");
    const clientSecret = String(formData.get("clientSecret") ?? "");
    void run(async () => {
      await save({ data: { clientId, clientSecret, sandbox, zeitzone, fetchFrom, rhythmus } });
      form.reset();
      await router.invalidate();
    }, "Zugang gespeichert.");
  }

  return (
    <section className="card" aria-labelledby="paypal-heading">
      <h2 id="paypal-heading">PayPal</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Haben holt die Umsätze des PayPal-Kontos (Zahlungen mit Gebühr, Erstattungen, Rückbuchungen und Abbuchungen auf die Bank) und legt sie im Konto des
        Zahlungsdienstleisters an. Dafür braucht es im{" "}
        <a href="https://developer.paypal.com/dashboard/applications/live" target="_blank" rel="noreferrer">
          PayPal Developer Dashboard
        </a>{" "}
        eine App mit dem Recht „Transaction Search“; Client-ID und Secret trägst du hier ein. Der Aktivitätenexport (CSV) bleibt der Weg für Zeiträume vor dem
        ersten Abruf.
      </p>

      <PayPalStatus data={data} />
      {data.sandbox && (
        <div className="banner banner-warn" role="note">
          Die Zugangsdaten gehören zur Sandbox von PayPal: Haben holt Testdaten, keine echten Umsätze.
        </div>
      )}

      {data.lastError && (
        <div className="banner banner-danger" role="status">
          {data.lastError}
        </div>
      )}
      {(data.konflikte.length > 0 || geklaert) && (
        <div className="actions">
          <KonfliktKlaeren konflikte={data.konflikte} disabled={busy} quelle="paypal" onGeklaert={() => setGeklaert(true)} />
        </div>
      )}

      <form className="stack" onSubmit={onSubmit}>
        <Field
          label={data.configured ? "Client-ID (leer lassen zum Behalten)" : "Client-ID"}
          hint="Aus der PayPal-App; sie liegt zusammen mit dem Secret verschlüsselt in der Datenbank."
        >
          {(control) => <input {...control} name="clientId" type="text" autoComplete="off" />}
        </Field>
        <Field label={data.configured ? "Secret (leer lassen zum Behalten)" : "Secret"}>
          {(control) => <input {...control} name="clientSecret" type="password" autoComplete="off" />}
        </Field>
        <Field label="Umgebung" hint="Live und Sandbox haben eigene Zugangsdaten; beim Wechsel trägst du beide neu ein">
          {(control) => (
            <select {...control} name="umgebung" value={sandbox ? "sandbox" : "live"} onChange={(event) => setSandbox(event.target.value === "sandbox")}>
              <option value="live">Live</option>
              <option value="sandbox">Sandbox (Testdaten)</option>
            </select>
          )}
        </Field>
        <Field
          label="Zeitzone des PayPal-Kontos"
          hint="Wie im Aktivitätenexport (Spalte „Zeitzone“): Nach ihr bildet Haben den Buchungstag, etwa Europe/Berlin"
        >
          {(control) => <input {...control} name="zeitzone" type="text" value={zeitzone} onChange={(event) => setZeitzone(event.target.value)} />}
        </Field>
        <Field label="Abruf ab" hint="Erster Tag, den Haben holt (höchstens drei Jahre zurück); davor gilt der CSV-Export">
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
        <div className="actions">
          <button type="button" className="btn btn-danger" disabled={busy || !data.configured} onClick={() => setConfirmingRemove(true)}>
            Zugang entfernen
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
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Speichere …" : "Speichern"}
          </button>
        </div>
        <NoticeBanner notice={notice} />
        <ConfirmDialog
          open={confirmingRemove}
          title="PayPal-Zugang entfernen?"
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
            Client-ID und Secret werden gelöscht. Bereits übernommene Umsätze bleiben im Konto des Zahlungsdienstleisters stehen; ein neuer Abruf legt sie nicht
            noch einmal an.
          </p>
        </ConfirmDialog>
      </form>
    </section>
  );
}

/** Stand des Zugangs: eingerichtet, letzter und nächster Abruf */
function PayPalStatus({ data }: { data: Data }) {
  return (
    <p className="small" style={{ margin: "0.5rem 0 0" }}>
      {data.configured ? (
        <strong>
          Verbunden mit {data.accountId} (Client-ID …{data.keyHint}).
        </strong>
      ) : (
        <strong>Nicht eingerichtet.</strong>
      )}{" "}
      {data.lastSyncAt ? `Letzter Abruf: ${formatDateTime(data.lastSyncAt)}.` : data.configured ? "Noch kein Abruf." : ""}
      {data.lastSyncAt && data.naechsterAbrufAb ? ` Der nächste Abruf holt ab dem ${formatDate(data.naechsterAbrufAb)}.` : ""}
    </p>
  );
}
