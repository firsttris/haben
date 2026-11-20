import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDateTime } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Field } from "./Field.tsx";
import { FilePicker } from "./FilePicker.tsx";
import { MonthPicker } from "./MonthPicker.tsx";
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
        <a
          href="https://github.com/Speicherstadt/haben/blob/main/docs/bank-zahlungsdienstleister.md#google-play-und-app-store"
          target="_blank"
          rel="noreferrer"
        >
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
  const [zugang, setZugang] = useState<Zugang>({
    bucket: config?.store === "googleplay" ? config.bucket : "",
    issuerId: config?.store === "appstore" ? config.issuerId : "",
    keyId: config?.store === "appstore" ? config.keyId : "",
    vendorNumber: config?.store === "appstore" ? config.vendorNumber : "",
  });
  const { bucket, issuerId, keyId, vendorNumber } = zugang;
  const [fetchFrom, setFetchFrom] = useState(connection?.fetchFrom ?? defaultFrom());
  const { busy, notice, run, setNotice } = useAction();
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
    if (match) setZugang((z) => ({ ...z, keyId: match[1]!.toUpperCase() }));
  }

  function onSync() {
    void run(async () => {
      const result = await sync({ data: { store } });
      await router.invalidate();
      if (result.error) throw new Error(result.error);
      setNotice(syncMeldung(result));
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
      setNotice(draftsMeldung(result));
    });
  }

  return (
    <form onSubmit={onSubmit} onChange={onKeyChosen} aria-labelledby={`${prefix}-heading`} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 id={`${prefix}-heading`}>{label}</h3>
      <StoreAnleitung store={store} />
      {connection && (
        <>
          <StoreVerbindung
            connection={connection}
            label={label}
            busy={busy}
            onSync={onSync}
            onRemove={() =>
              void run(async () => {
                await remove({ data: { store } });
                await router.invalidate();
              }, "Zugang entfernt.")
            }
          />
          <StoreKontakt
            store={store}
            label={label}
            contactId={connection.config.contactId ?? null}
            contacts={contacts}
            busy={busy}
            onContact={onContact}
            onDrafts={onDrafts}
          />
        </>
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
      <StoreZugang store={store} values={zugang} onChange={(patch) => setZugang((z) => ({ ...z, ...patch }))} />
      <Field label="Berichte ab Monat">{(control) => <MonthPicker {...control} value={fetchFrom} onChange={setFetchFrom} />}</Field>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Prüfe …" : "Prüfen und speichern"}
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}

/** Meldung nach dem Abruf: neue Berichte, übernommene Umsätze und Entwürfe, dazu Hinweise des Abrufs */
function syncMeldung(result: { added: unknown[]; imported: { accountName?: string | null; added: number; drafts?: number; messages: string[] } }) {
  const fetched = result.added.length === 0 ? "Keine neuen Berichte." : `${result.added.length} neue Berichte im Archiv.`;
  const imported = result.imported.accountName
    ? ` ${result.imported.added} neue Umsätze in ${result.imported.accountName}${result.imported.drafts ? `, ${result.imported.drafts} Rechnungsentwürfe` : ""}.`
    : "";
  const messages = result.imported.messages.join(" ");
  return { tone: result.imported.messages.length > 0 ? ("info" as const) : ("ok" as const), text: `${fetched}${imported}${messages ? ` ${messages}` : ""}` };
}

/** Store-Gesellschaft, an die Haben je Monat einen Rechnungsentwurf richtet */
function StoreKontakt({
  store,
  label,
  contactId,
  contacts,
  busy,
  onContact,
  onDrafts,
}: {
  store: Store;
  label: string;
  contactId: string | null;
  contacts: Contact[];
  busy: boolean;
  onContact: (contactId: string) => void;
  onDrafts: () => void;
}) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Field label="Store-Gesellschaft für die Rechnungsentwürfe">
        {(control) => (
          <select {...control} value={contactId ?? ""} onChange={(e) => onContact(e.target.value)} disabled={busy}>
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
        {store === "googleplay" ? "in der Regel Google Commerce Ltd, Irland" : "für die meisten Länder Apple Distribution International Ltd, Irland"}). Haben
        legt je Monat einen Entwurf an, mit Reverse Charge bei einer Gesellschaft im EU-Ausland.
      </p>
      {contactId && (
        <div>
          <button type="button" className="btn" disabled={busy} onClick={onDrafts}>
            Rechnungsentwürfe für alle Monate anlegen
          </button>
        </div>
      )}
    </div>
  );
}

/** Verbundener Zugang: Konto, Stand der Berichte, Abrufen und Entfernen */
function StoreVerbindung({
  connection,
  label,
  busy,
  onSync,
  onRemove,
}: {
  connection: Connection;
  label: string;
  busy: boolean;
  onSync: () => void;
  onRemove: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
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
      <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setConfirming(true)}>
        Entfernen
      </button>
      <ConfirmDialog
        open={confirming}
        title={`Zugang zu ${label} entfernen?`}
        confirmLabel="Entfernen"
        danger
        onConfirm={onRemove}
        onClose={() => setConfirming(false)}
      >
        <p>Abgerufene Berichte bleiben im Archiv.</p>
      </ConfirmDialog>
    </div>
  );
}

type Zugang = { bucket: string; issuerId: string; keyId: string; vendorNumber: string };

/** Angaben zum Zugang: bei Google Play der Bucket, beim App Store Issuer ID, Key ID und Vendor-Nummer */
function StoreZugang({ store, values, onChange }: { store: Store; values: Zugang; onChange: (patch: Partial<Zugang>) => void }) {
  return store === "googleplay" ? (
    <Field label="Cloud-Storage-URI">
      {(control) => (
        <input
          {...control}
          value={values.bucket}
          onChange={(e) => onChange({ bucket: e.target.value })}
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
        {(control) => (
          <input {...control} value={values.issuerId} onChange={(e) => onChange({ issuerId: e.target.value })} required autoComplete="off" spellCheck={false} />
        )}
      </Field>
      <Field label="Key ID">
        {(control) => (
          <input {...control} value={values.keyId} onChange={(e) => onChange({ keyId: e.target.value })} required autoComplete="off" spellCheck={false} />
        )}
      </Field>
      <Field label="Vendor-Nummer">
        {(control) => (
          <input
            {...control}
            value={values.vendorNumber}
            onChange={(e) => onChange({ vendorNumber: e.target.value })}
            required
            inputMode="numeric"
            autoComplete="off"
          />
        )}
      </Field>
    </>
  );
}

function StoreAnleitung({ store }: { store: Store }) {
  return store === "googleplay" ? (
    <p className="small muted" style={{ margin: 0 }}>
      Lege in der Google Cloud ein Servicekonto mit JSON-Schlüssel an und lade es in der Play Console unter „Nutzer und Berechtigungen“ mit „Finanzdaten
      ansehen“ für alle Apps ein. Die Cloud-Storage-URI steht unter „Berichte herunterladen › Finanzberichte“.
    </p>
  ) : (
    <p className="small muted" style={{ margin: 0 }}>
      Lege in App Store Connect unter „Benutzer und Zugriff › Integrationen“ einen Team-Schlüssel mit der Rolle „Finanzen“ an. Die Vendor-Nummer steht unter
      „Zahlungen und Finanzberichte“.
    </p>
  );
}

function draftsMeldung(result: { created: number; messages: string[] }) {
  const text = result.created === 0 ? "Keine neuen Rechnungsentwürfe." : `${result.created} Rechnungsentwürfe unter Rechnungen angelegt.`;
  return { tone: result.messages.length > 0 ? ("info" as const) : ("ok" as const), text: [text, ...result.messages].join(" ") };
}
