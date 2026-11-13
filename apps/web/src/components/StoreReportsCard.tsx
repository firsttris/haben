import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDateTime } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Field } from "./Field.tsx";
import { FilePicker } from "./FilePicker.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import {
  createStoreDraftsFn,
  removeStoreConnectionFn,
  saveStoreConnectionFn,
  setStoreContactFn,
  syncStoreNow,
  type getStoreConnections,
} from "../server/functions/stores.ts";

type Settings = Awaited<ReturnType<typeof getStoreConnections>>;
type Connection = Settings["connections"][number];
type Contact = Settings["contacts"][number];
type Store = Connection["store"];

/** Größer ist weder eine Servicekonto-JSON noch eine .p8 */
const MAX_KEY_SIZE = 16 * 1024;

/** Vorgabe für den ersten Berichtsmonat: Januar des laufenden Jahres */
const defaultFrom = () => `${new Date().getFullYear()}-01`;

/** Zugänge zu den Finanzberichten von Google Play und App Store Connect */
export function StoreReportsCard({ connections, contacts }: { connections: Connection[]; contacts: Contact[] }) {
  return (
    <section className="card" aria-labelledby="stores-heading">
      <h2 id="stores-heading">Google Play und App Store</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Haben holt die monatlichen Finanzberichte der Stores selbst, legt sie unverändert ins Archiv und übernimmt je Monat den Auszahlungsanspruch in das
        Zahlungsdienstleister-Konto des Stores (unter Bank anlegen, Anbieter Google Play bzw. App Store).{" "}
        <a href="https://github.com/firsttris/haben/blob/main/docs/bank-zahlungsdienstleister.md#google-play-und-app-store" target="_blank" rel="noreferrer">
          Anleitung
        </a>
      </p>
      <StoreForm store="googleplay" connection={connections.find((c) => c.store === "googleplay") ?? null} contacts={contacts} />
      <StoreForm store="appstore" connection={connections.find((c) => c.store === "appstore") ?? null} contacts={contacts} />
    </section>
  );
}

function StoreForm({ store, connection, contacts }: { store: Store; connection: Connection | null; contacts: Contact[] }) {
  const router = useRouter();
  const save = useServerFn(saveStoreConnectionFn);
  const remove = useServerFn(removeStoreConnectionFn);
  const sync = useServerFn(syncStoreNow);
  const setContact = useServerFn(setStoreContactFn);
  const createDrafts = useServerFn(createStoreDraftsFn);
  const config = connection?.config;
  const [bucket, setBucket] = useState(config?.store === "googleplay" ? config.bucket : "");
  const [issuerId, setIssuerId] = useState(config?.store === "appstore" ? config.issuerId : "");
  const [keyId, setKeyId] = useState(config?.store === "appstore" ? config.keyId : "");
  const [vendorNumber, setVendorNumber] = useState(config?.store === "appstore" ? config.vendorNumber : "");
  const [fetchFrom, setFetchFrom] = useState(connection?.fetchFrom ?? defaultFrom());
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const action = useAction();
  const { busy, notice, run } = action;
  const label = store === "googleplay" ? "Google Play" : "App Store";
  const prefix = `store-${store}`;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("key");
    void run(async () => {
      let secret: string | undefined;
      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_KEY_SIZE) throw new Error("Die Datei ist zu groß für einen Schlüssel.");
        secret = await file.text();
      }
      if (store === "googleplay") await save({ data: { store, bucket, serviceAccountJson: secret, fetchFrom } });
      else await save({ data: { store, issuerId, keyId, vendorNumber, privateKey: secret, fetchFrom } });
      form.reset();
      await router.invalidate();
    }, `Zugang zu ${label} geprüft und verschlüsselt gespeichert.`);
  }

  /** Apple nennt die Datei „AuthKey_<Key ID>.p8“; damit ist die Key ID schon ausgefüllt */
  function onKeyChosen(event: FormEvent<HTMLFormElement>) {
    const input = event.target as HTMLInputElement;
    if (store !== "appstore" || input.name !== "key" || keyId) return;
    const match = /^AuthKey_([A-Z0-9]{10})\.p8$/i.exec(input.files?.[0]?.name ?? "");
    if (match) setKeyId(match[1]!.toUpperCase());
  }

  const { setNotice } = action;

  function onSync() {
    void run(async () => {
      const result = await sync({ data: { store } });
      await router.invalidate();
      if (result.error) throw new Error(result.error);
      const fetched = result.added.length === 0 ? "Keine neuen Berichte." : `${result.added.length} neue Berichte im Archiv.`;
      const imported = result.imported.accountName
        ? ` ${result.imported.added} neue Umsätze in ${result.imported.accountName}${result.imported.drafts ? `, ${result.imported.drafts} Rechnungsentwürfe` : ""}.`
        : "";
      const messages = result.imported.messages.join(" ");
      setNotice({ tone: result.imported.messages.length > 0 ? "info" : "ok", text: `${fetched}${imported}${messages ? ` ${messages}` : ""}` });
    });
  }

  function onContact(contactId: string) {
    void run(
      async () => {
        await setContact({ data: { store, contactId: contactId || null } });
        await router.invalidate();
      },
      contactId ? "Kontakt gespeichert. Neue Monate bekommen einen Rechnungsentwurf." : "Ohne Kontakt legt Haben keine Rechnungsentwürfe an.",
    );
  }

  function onDrafts() {
    void run(async () => {
      const result = await createDrafts({ data: { store } });
      const text = result.created === 0 ? "Keine neuen Rechnungsentwürfe." : `${result.created} Rechnungsentwürfe unter Rechnungen angelegt.`;
      setNotice({ tone: result.messages.length > 0 ? "info" : "ok", text: [text, ...result.messages].join(" ") });
    });
  }

  return (
    <form onSubmit={onSubmit} onChange={onKeyChosen} aria-labelledby={`${prefix}-heading`} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 id={`${prefix}-heading`}>{label}</h3>
      {store === "googleplay" ? (
        <p className="small muted" style={{ margin: 0 }}>
          Lege in der Google Cloud ein Servicekonto mit JSON-Schlüssel an und lade es in der Play Console unter „Nutzer und Berechtigungen“ mit „Finanzdaten
          ansehen“ für alle Apps ein. Die Cloud-Storage-URI steht unter „Berichte herunterladen › Finanzberichte“.
        </p>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          Lege in App Store Connect unter „Benutzer und Zugriff › Integrationen“ einen Team-Schlüssel mit der Rolle „Finanzen“ an. Die Vendor-Nummer steht unter
          „Zahlungen und Finanzberichte“.
        </p>
      )}
      {connection && (
        <div className="history-row">
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 500 }}>
              {connection.config.store === "googleplay" ? connection.config.clientEmail : `Key ID ${connection.config.keyId}`}
            </span>
            <span className="small muted">
              {connection.reports} Berichte im Archiv{connection.latestPeriod ? `, zuletzt ${connection.latestPeriod}` : ""}
              {connection.lastSyncAt ? ` · abgerufen am ${formatDateTime(connection.lastSyncAt)}` : " · noch nicht abgerufen"}
            </span>
          </div>
          <button type="button" className="btn" disabled={busy} onClick={onSync}>
            Jetzt abrufen
          </button>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setConfirmingRemove(true)}>
            Entfernen
          </button>
          <ConfirmDialog
            open={confirmingRemove}
            title={`Zugang zu ${label} entfernen?`}
            confirmLabel="Entfernen"
            danger
            onConfirm={() =>
              void run(async () => {
                await remove({ data: { store } });
                await router.invalidate();
              }, "Zugang entfernt.")
            }
            onClose={() => setConfirmingRemove(false)}
          >
            <p>Abgerufene Berichte bleiben im Archiv.</p>
          </ConfirmDialog>
        </div>
      )}
      {connection && (
        <div className="stack" style={{ gap: 8 }}>
          <Field label="Store-Gesellschaft für die Rechnungsentwürfe">
            {(control) => (
              <select {...control} value={connection.config.contactId ?? ""} onChange={(e) => onContact(e.target.value)} disabled={busy}>
                <option value="">Keine Rechnungsentwürfe</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.land}
                    {c.ustId ? `, ${c.ustId}` : ""})
                  </option>
                ))}
              </select>
            )}
          </Field>
          <p className="small muted" style={{ margin: 0 }}>
            Lege die Gesellschaft unter Kontakte an, mit Anschrift und USt-IdNr. aus deinem Vertrag mit {label} (
            {store === "googleplay" ? "in der Regel Google Commerce Ltd, Irland" : "für die meisten Länder Apple Distribution International Ltd, Irland"}).
            Haben legt je Monat einen Entwurf an, mit Reverse Charge bei einer Gesellschaft im EU-Ausland.
          </p>
          {connection.config.contactId && (
            <div>
              <button type="button" className="btn" disabled={busy} onClick={onDrafts}>
                Rechnungsentwürfe für alle Monate anlegen
              </button>
            </div>
          )}
        </div>
      )}
      {connection?.lastError && (
        <div className="banner banner-warn" role="status">
          {connection.lastError}
        </div>
      )}
      <Field
        label={connection ? "Neuer Schlüssel (leer lassen zum Behalten)" : store === "googleplay" ? "Schlüssel des Servicekontos (.json)" : "Schlüssel (.p8)"}
      >
        {(control) => <FilePicker {...control} name="key" accept={store === "googleplay" ? ".json" : ".p8"} required={!connection} />}
      </Field>
      {store === "googleplay" ? (
        <Field label="Cloud-Storage-URI">
          {(control) => (
            <input
              {...control}
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              required
              placeholder="gs://pubsite_prod_rev_…"
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </Field>
      ) : (
        <>
          <Field label="Issuer ID">
            {(control) => <input {...control} value={issuerId} onChange={(e) => setIssuerId(e.target.value)} required autoComplete="off" spellCheck={false} />}
          </Field>
          <Field label="Key ID">
            {(control) => <input {...control} value={keyId} onChange={(e) => setKeyId(e.target.value)} required autoComplete="off" spellCheck={false} />}
          </Field>
          <Field label="Vendor-Nummer">
            {(control) => (
              <input {...control} value={vendorNumber} onChange={(e) => setVendorNumber(e.target.value)} required inputMode="numeric" autoComplete="off" />
            )}
          </Field>
        </>
      )}
      <Field label="Berichte ab Monat">
        {(control) => <input {...control} type="month" value={fetchFrom} onChange={(e) => setFetchFrom(e.target.value)} required />}
      </Field>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Prüfe …" : "Prüfen und speichern"}
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}
