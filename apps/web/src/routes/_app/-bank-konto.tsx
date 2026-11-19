import { useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { errorMessage } from "../../lib/format.ts";
import { PURPOSE_SHORT } from "../../lib/kontozweck.ts";
import { useAction } from "../../lib/use-action.ts";
import { useSubmitCheck } from "../../lib/use-submit-check.ts";
import { addBankAccount, addProviderAccount, importStatements, updateBankAccount } from "../../server/functions/bank.ts";
import { ExcludeAccountButton } from "../../components/BankKontoAusschliessen.tsx";
import { Field } from "../../components/Field.tsx";
import { UploadButton } from "../../components/UploadButton.tsx";
import { ImportMeldungen, importMessages, type ImportMessage } from "../../components/BankImportMeldungen.tsx";
import type { Data } from "./-bank-daten.ts";

/** Name und Zweck des gewählten Kontos, etwa „Geschäftskonto“ und „Steuerkonto“ bei derselben Bank */
export function AccountSettings({
  account,
  purposes,
  ledger,
  excludeBlockedBy,
}: {
  account: Data["accounts"][number];
  purposes: Data["purposes"];
  ledger: string | undefined;
  excludeBlockedBy: string | null;
}) {
  const router = useRouter();
  const navigate = useNavigate({ from: "/bank" });
  const updateFn = useServerFn(updateBankAccount);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const [purpose, setPurpose] = useState(account.purpose);
  const { busy, notice, run } = useAction();
  const { form, error, check } = useSubmitCheck({ name: name.trim() === "" ? "Trag einen Namen ein." : null });

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
        <ExcludeAccountButton account={account} blockedBy={excludeBlockedBy} />
      </div>
    );
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check()) return;
    void run(async () => {
      await updateFn({ data: { id: account.id, name, purpose: purpose === "zahlungsdienstleister" ? undefined : purpose } });
      // Konto fest in die Adresse: ohne „konto“ zeigt die Seite das alphabetisch erste, nach dem Umbenennen ein anderes
      await navigate({ search: (prev) => ({ ...prev, konto: account.id }), replace: true });
      await router.invalidate();
      setEditing(false);
    });
  }

  return (
    <form
      ref={form}
      onSubmit={onSubmit}
      className="stack"
      style={{ gap: 8, margin: "8px 0 16px", maxWidth: 480 }}
      aria-label="Name und Zweck des Kontos"
      noValidate
    >
      <Field label="Name des Kontos" error={error("name")}>
        {(control) => <input {...control} value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} autoFocus />}
      </Field>
      {account.purpose !== "zahlungsdienstleister" && (
        <Field label="Zweck">
          {(control) => (
            <select {...control} value={purpose} onChange={(e) => setPurpose(e.target.value as typeof purpose)}>
              {purposes.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <span className="small muted">
        Der Name ist nur Anzeige; Umsätze und Import über die IBAN bleiben, wie sie sind. Der Zweck steuert Vorschläge im Bankabgleich (Geldtransit zwischen
        eigenen Konten, Umsatzsteuer auf dem Steuerkonto, Privat beim Privatkonto), die IBAN für „Bankverbindung ändern“ beim Finanzamt und die Deckung der
        Zahllast in der Übersicht. Gebucht wird weiter auf das eine Bankkonto.
      </span>
      <NoticeBanner notice={notice} />
      <div className="actions">
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
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Speichern
        </button>
      </div>
    </form>
  );
}

export function SearchBox({ initial }: { initial: string }) {
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

/** Meldungen zu den hochgeladenen Kontoauszügen, je Datei */
function importErgebnisse(results: Awaited<ReturnType<typeof importStatements>>, files: File[]): ImportMessage[] {
  return results.flatMap((r, i) =>
    "error" in r && r.error
      ? [{ tone: "danger" as const, text: r.error, datei: r.zuordnen ? { file: files[i]!, aktion: "Spalten zuordnen" as const } : undefined }]
      : "added" in r
        ? importMessages(r, files[i])
        : [],
  );
}

export function ImportControls({ data }: { data: Data }) {
  const router = useRouter();
  const importFiles = useServerFn(importStatements);
  const addAccount = useServerFn(addBankAccount);
  const addProvider = useServerFn(addProviderAccount);
  const [accountType, setAccountType] = useState<"bank" | "provider">("bank");
  const [busy, setBusy] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [targetAccount, setTargetAccount] = useState("");
  const [messages, setMessages] = useState<ImportMessage[]>([]);

  async function onFiles(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setMessages([]);
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      if (targetAccount) form.append("accountId", targetAccount);
      const results = await importFiles({ data: form });
      setMessages(importErgebnisse(results, files));
      await router.invalidate();
    } catch (error) {
      setMessages([{ tone: "danger", text: errorMessage(error) }]);
    } finally {
      setBusy(false);
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
          <Field label="Konto" className="field-inline">
            {(control) => (
              <select {...control} value={targetAccount} onChange={(e) => setTargetAccount(e.target.value)} style={{ minHeight: 44 }}>
                <option value="">aus der Datei</option>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <button type="button" className="btn" onClick={() => setShowAccount((v) => !v)} disabled={busy}>
          Konto hinzufügen
        </button>
        <UploadButton
          className="btn btn-primary"
          multiple
          accept=".csv,.xml,.txt,text/csv,application/xml,text/xml"
          disabled={busy}
          inputLabel="Kontoauszugsdateien"
          onFiles={onFiles}
        >
          {busy ? "Importiere …" : "CSV / CAMT importieren"}
        </UploadButton>
      </div>
      {showAccount && (
        <form className="card" onSubmit={onAddAccount} style={{ minWidth: 320 }}>
          <Field label="Art">
            {(control) => (
              <select {...control} value={accountType} onChange={(e) => setAccountType(e.target.value as "bank" | "provider")}>
                <option value="bank">Bankkonto (mit IBAN)</option>
                <option value="provider">Zahlungsdienstleister (PayPal, Stripe, Shopify …)</option>
              </select>
            )}
          </Field>
          {accountType === "provider" && (
            <Field label="Dienstleister">
              {(control) => (
                <select {...control} name="provider" defaultValue="paypal">
                  {data.providers.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          <Field label="Name">
            {(control) => <input {...control} name="name" required placeholder={accountType === "provider" ? "PayPal Geschäftskonto" : "N26 Business"} />}
          </Field>
          {accountType === "bank" ? (
            <Field label="IBAN">{(control) => <input {...control} name="iban" required />}</Field>
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
      <ImportMeldungen
        messages={messages}
        accounts={data.accounts.filter((a) => a.purpose !== "zahlungsdienstleister")}
        accountId={targetAccount}
        onImported={(result, file) => {
          setTargetAccount(result.accountId);
          setMessages(importMessages(result, file));
          void router.invalidate();
        }}
      />
    </div>
  );
}
