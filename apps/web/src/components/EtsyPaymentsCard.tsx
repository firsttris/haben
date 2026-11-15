import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDateTime } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { connectEtsyFn, disconnectEtsyFn, type getEtsySettings, removeEtsyConnectionFn, saveEtsyConnectionFn, syncEtsyNow } from "../server/functions/etsy.ts";

type Data = Awaited<ReturnType<typeof getEtsySettings>>;

/**
 * Zahlungsverlauf von Etsy Payments: App-Schlüssel hinterlegen, den Shop freigeben und den Verlauf abrufen.
 *
 * Zwei Schritte, weil Etsy den Verlauf nur dem Shop-Inhaber gibt: erst App-Schlüssel und Geheimnis der eigenen
 * Etsy-App speichern, dann freigeben (OAuth mit PKCE). Erst danach holt Haben Verkäufe, Erstattungen, Gebühren,
 * Werbung, Steuer und Auszahlungen selbst.
 */
export function EtsyPaymentsCard({ data }: { data: Data }) {
  const router = useRouter();
  const save = useServerFn(saveEtsyConnectionFn);
  const connect = useServerFn(connectEtsyFn);
  const disconnect = useServerFn(disconnectEtsyFn);
  const remove = useServerFn(removeEtsyConnectionFn);
  const sync = useServerFn(syncEtsyNow);
  const [keystring, setKeystring] = useState(data.keystring);
  const [fetchFrom, setFetchFrom] = useState(data.fetchFrom);
  const [sammelzeilen, setSammelzeilen] = useState(data.sammelzeilen);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const { busy, notice, run } = useAction();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const sharedSecret = String(new FormData(form).get("sharedSecret") ?? "");
    void run(async () => {
      await save({ data: { keystring, fetchFrom, sammelzeilen, sharedSecret } });
      form.reset();
      await router.invalidate();
    }, "Zugang gespeichert. Jetzt verbinden, damit Etsy die Freigabe zeigt.");
  }

  return (
    <section className="card" aria-labelledby="etsy-heading">
      <h2 id="etsy-heading">Etsy Payments</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Haben holt den Zahlungsverlauf des Shops über die Etsy-API (Verkäufe, Erstattungen, Gebühren, Werbung, Steuer und Auszahlungen) und legt ihn im Konto
        des Zahlungsdienstleisters an. Dafür braucht es eine eigene App im{" "}
        <a href="https://www.etsy.com/developers/your-apps" target="_blank" rel="noreferrer">
          Etsy-Entwicklerbereich
        </a>
        ; als Redirect-URI gehört <code>{data.callbackUrl}</code> hinein. Die monatliche CSV von Hand entfällt damit.
      </p>

      <p className="small" style={{ margin: "0.5rem 0 0" }}>
        {data.connected ? (
          <strong>
            Verbunden mit {data.shopName || "dem Shop"} ({data.shopId}).
          </strong>
        ) : data.configured ? (
          <strong>Nicht verbunden. Schlüssel gespeichert, die Freigabe bei Etsy fehlt noch.</strong>
        ) : (
          <strong>Nicht eingerichtet.</strong>
        )}{" "}
        {data.lastSyncAt ? `Letzter Abruf: ${formatDateTime(data.lastSyncAt)}.` : "Noch kein Abruf."}
      </p>

      {data.lastError && (
        <div className="banner banner-danger" role="status">
          {data.lastError}
        </div>
      )}

      <form onSubmit={onSubmit}>
        <Field label="App-Schlüssel (keystring)" hint="Steht in der Etsy-App unter „Keystring“">
          {(control) => <input {...control} name="keystring" value={keystring} onChange={(event) => setKeystring(event.target.value)} autoComplete="off" />}
        </Field>
        <Field
          label={data.configured ? "Gemeinsames Geheimnis (leer lassen zum Behalten)" : "Gemeinsames Geheimnis"}
          hint="Der shared secret der Etsy-App; er liegt verschlüsselt in der Datenbank"
        >
          {(control) => <input {...control} name="sharedSecret" type="password" autoComplete="off" />}
        </Field>
        <Field label="Abruf ab Monat" hint="Erster Monat, den Haben holt (JJJJ-MM)">
          {(control) => <input {...control} name="fetchFrom" value={fetchFrom} onChange={(event) => setFetchFrom(event.target.value)} />}
        </Field>
        <Field label="Gebühren bündeln" hint="Gebühren, Werbung und Steuer je Monat zu einer Zeile, wie die Gebührenrechnung sie zeigt">
          {(control) => (
            <input {...control} name="sammelzeilen" type="checkbox" checked={sammelzeilen} onChange={(event) => setSammelzeilen(event.target.checked)} />
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
                const { url } = await connect();
                window.location.href = url;
              })
            }
          >
            Verbinden
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !data.connected}
            onClick={() =>
              void run(async () => {
                const result = await sync();
                await router.invalidate();
                if (result.error) throw new Error(result.error);
                return result;
              }, "Abruf durchgelaufen.")
            }
          >
            {busy ? "Laufe …" : "Jetzt abrufen"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !data.connected}
            onClick={() =>
              void run(async () => {
                await disconnect();
                await router.invalidate();
              }, "Verbindung getrennt. Der Schlüssel bleibt gespeichert.")
            }
          >
            Trennen
          </button>
          <button type="button" className="btn btn-danger" disabled={busy || !data.configured} onClick={() => setConfirmingRemove(true)}>
            Zugang entfernen
          </button>
        </div>
        <NoticeBanner notice={notice} />
        <ConfirmDialog
          open={confirmingRemove}
          title="Etsy-Zugang entfernen?"
          confirmLabel="Entfernen"
          danger
          onConfirm={() => {
            setConfirmingRemove(false);
            void run(async () => {
              await remove();
              setKeystring("");
              await router.invalidate();
            }, "Zugang entfernt. Übernommene Umsätze bleiben im Konto stehen.");
          }}
          onClose={() => setConfirmingRemove(false)}
        >
          <p>
            Schlüssel, Geheimnis und Token werden gelöscht. Bereits übernommene Umsätze bleiben im Konto des Zahlungsdienstleisters stehen; ein neuer Abruf legt
            sie nicht noch einmal an.
          </p>
        </ConfirmDialog>
      </form>
    </section>
  );
}
