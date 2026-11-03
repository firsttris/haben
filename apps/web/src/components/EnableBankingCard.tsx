import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDateTime } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { FilePicker } from "./FilePicker.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { removeEnableBanking, saveEnableBanking, type getEnableBankingSettings } from "../server/functions/bank.ts";

type Data = Awaited<ReturnType<typeof getEnableBankingSettings>>;

/** Größer ist keine .pem von Enable Banking */
const MAX_KEY_SIZE = 16 * 1024;

/** Application ID und privater Schlüssel für den automatischen Kontoabruf über Enable Banking */
export function EnableBankingCard({ data }: { data: Data }) {
  const router = useRouter();
  const save = useServerFn(saveEnableBanking);
  const remove = useServerFn(removeEnableBanking);
  const stored = data.source === "einstellungen";
  const [applicationId, setApplicationId] = useState(stored ? (data.applicationId ?? "") : "");
  const { busy, notice, run } = useAction();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("key");
    void run(async () => {
      let privateKey: string | undefined;
      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_KEY_SIZE) throw new Error("Die Datei ist zu groß für einen Schlüssel von Enable Banking.");
        privateKey = await file.text();
      }
      await save({ data: { applicationId, privateKey } });
      form.reset();
      await router.invalidate();
    }, "Zugang geprüft und verschlüsselt gespeichert. Unter Bank kannst du jetzt deine Bank verbinden.");
  }

  /** Enable Banking nennt die Datei „<Application ID>.pem“; damit ist die ID schon ausgefüllt */
  function onKeyChosen(event: FormEvent<HTMLFormElement>) {
    const input = event.target as HTMLInputElement;
    if (input.name !== "key" || applicationId) return;
    const match = /^([A-Za-z0-9-]+)\.pem$/i.exec(input.files?.[0]?.name ?? "");
    if (match) setApplicationId(match[1]!);
  }

  return (
    <form className="card" onSubmit={onSubmit} onChange={onKeyChosen} aria-labelledby="enablebanking-heading">
      <h2 id="enablebanking-heading">Automatischer Kontoabruf</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Mit einer Anwendung bei{" "}
        <a href="https://enablebanking.com" target="_blank" rel="noreferrer">
          Enable Banking
        </a>{" "}
        holt Haben die Umsätze täglich selbst. Lege dort im Kontrollzentrum unter „API applications“ eine Anwendung an, trage als Redirect URL{" "}
        <code>{data.callbackUrl}</code> ein und lass den Schlüssel im Browser erzeugen. Die heruntergeladene .pem-Datei lädst du hier hoch; sie liegt
        verschlüsselt in der Datenbank.{" "}
        <a href="https://github.com/firsttris/haben/blob/main/docs/installation.md#kontoabruf-enable-banking" target="_blank" rel="noreferrer">
          Anleitung
        </a>
      </p>
      {data.source === "umgebung" && (
        <div className="banner banner-info" role="status">
          Eingerichtet über die Umgebung (ENABLE_BANKING_APP_ID, Application ID {data.applicationId}). Was du hier speicherst, gilt stattdessen.
        </div>
      )}
      {stored && (
        <div className="history-row">
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 500 }}>Application ID {data.applicationId}</span>
            {data.updatedAt && <span className="small muted">gespeichert am {formatDateTime(data.updatedAt)}</span>}
          </div>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => {
              if (!window.confirm("Zugang zu Enable Banking entfernen? Bestehende Verbindungen werden dann nicht mehr abgerufen.")) return;
              void run(async () => {
                await remove();
                setApplicationId("");
                await router.invalidate();
              }, "Zugang entfernt.");
            }}
          >
            Entfernen
          </button>
        </div>
      )}
      <label className="field">
        {stored ? "Neuer Schlüssel (.pem, leer lassen zum Behalten)" : "Privater Schlüssel (.pem)"}
        <FilePicker name="key" accept=".pem" required={!stored} />
      </label>
      <label className="field">
        Application ID
        <input value={applicationId} onChange={(e) => setApplicationId(e.target.value)} required autoComplete="off" spellCheck={false} />
      </label>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Prüfe …" : "Prüfen und speichern"}
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}
