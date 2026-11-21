import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { defaultFetchFrom, fetchFromForConnect } from "../lib/bank-connect.ts";
import { errorMessage, formatDate, formatDateTime } from "../lib/format.ts";
import { useSubmitCheck } from "../lib/use-submit-check.ts";
import type { getBankOverview } from "../server/functions/bank.ts";
import { cancelFints, connectFints, continueFints, disconnectFints, syncFints } from "../server/functions/fints.ts";
import { today as todayInGermany } from "../server/today.ts";
import { FintsStatus } from "./BankStatus.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { Field } from "./Field.tsx";

/*
 * Kontoabruf über FinTS (#654) auf der Bankseite: Verbinden mit Bankleitzahl, FinTS-Adresse, Anmeldename und PIN,
 * dann die Schritte der Bank (TAN-Verfahren wählen, TAN eingeben oder in der App freigeben), die Verbindungen mit
 * „Jetzt abrufen“, „Zugang ändern“ und „Trennen“.
 */

type Fints = Awaited<ReturnType<typeof getBankOverview>>["fints"];
type Verbindung = Fints["connections"][number];
type Schritt = Awaited<ReturnType<typeof continueFints>>;
type Offen = Exclude<Schritt, { art: "fertig" }>;
type Meldung = { tone: "ok" | "danger" | "info"; text: string };

export const FINTS_ANLEITUNG = "https://github.com/Speicherstadt/haben/blob/main/docs/installation-anbindungen.md#kontoabruf-über-fints";

/** Name mit den letzten vier Ziffern der IBAN; neue Konten tragen sie schon im Namen („Testbank Girokonto …2051“) */
const kontoName = (a: { name: string; iban: string }) => (a.name.endsWith(a.iban.slice(-4)) ? a.name : `${a.name} …${a.iban.slice(-4)}`);

const meldungenAus = (s: Extract<Schritt, { art: "fertig" }>): Meldung[] => [
  { tone: s.ok ? "ok" : "danger", text: s.meldung },
  ...s.hinweise.map((text) => ({ tone: "info" as const, text })),
];

/** Was die Bank gerade will: ein TAN-Verfahren oder -Medium wählen, eine TAN eingeben oder in der App freigeben */
function SchrittForm({ schritt, onSchritt, onAbbrechen }: { schritt: Offen; onSchritt: (s: Schritt) => Promise<void>; onAbbrechen: () => void }) {
  const weiter = useServerFn(continueFints);
  const verwerfen = useServerFn(cancelFints);
  const medien = schritt.art === "verfahren" && schritt.verfahren.length === 1 ? schritt.verfahren[0]!.medien : [];
  const [wahl, setWahl] = useState(schritt.art === "verfahren" ? (medien[0] ?? String(schritt.verfahren[0]?.id ?? "")) : "");
  const [tan, setTan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    form,
    error: fehler,
    check,
  } = useSubmitCheck({
    tan: schritt.art === "tan" && !schritt.entkoppelt && !tan.trim() ? "Bitte die TAN eingeben." : null,
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !check()) return;
    setBusy(true);
    setError(null);
    try {
      const data =
        schritt.art === "tan"
          ? { vorgang: schritt.vorgang, tan: schritt.entkoppelt ? undefined : tan }
          : medien.length > 0
            ? { vorgang: schritt.vorgang, verfahren: schritt.verfahren[0]!.id, medium: wahl }
            : { vorgang: schritt.vorgang, verfahren: Number(wahl) };
      await onSchritt(await weiter({ data }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function abbrechen() {
    void verwerfen({ data: schritt.vorgang }).catch(() => undefined);
    onAbbrechen();
  }

  return (
    <form ref={form} onSubmit={onSubmit} className="stack" style={{ gap: 12, maxWidth: 560 }} aria-label="Freigabe bei der Bank" noValidate>
      {schritt.art === "verfahren" ? (
        <Field
          label={medien.length > 0 ? "TAN-Medium" : "TAN-Verfahren"}
          hint="Wie du Aufträge bei deiner Bank freigibst; die Bank nennt nur, was für deinen Zugang geht."
        >
          {(control) => (
            <select {...control} value={wahl} onChange={(e) => setWahl(e.target.value)}>
              {medien.length > 0
                ? medien.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))
                : schritt.verfahren.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
            </select>
          )}
        </Field>
      ) : (
        <>
          <p style={{ margin: 0, whiteSpace: "pre-line" }}>{schritt.text}</p>
          {schritt.bild && <img src={schritt.bild} alt="Grafik der Bank für die photoTAN" style={{ maxWidth: 240 }} />}
          {schritt.hinweis && (
            <div className="banner banner-info" role="status">
              {schritt.hinweis}
            </div>
          )}
          {!schritt.entkoppelt && (
            <Field label="TAN" error={fehler("tan")}>
              {(control) => (
                <input {...control} value={tan} onChange={(e) => setTan(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required autoFocus />
              )}
            </Field>
          )}
        </>
      )}
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={abbrechen} disabled={busy}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Warte auf die Bank …" : schritt.art === "verfahren" ? "Weiter" : schritt.entkoppelt ? "Freigegeben, weiter" : "TAN senden"}
        </button>
      </div>
    </form>
  );
}

/** Zugang zum Online-Banking; mit vorlage für „Zugang ändern“ schon ausgefüllt, nur die PIN fehlt */
function VerbindenForm({ vorlage, onSchritt, onAbbrechen }: { vorlage: Verbindung | null; onSchritt: (s: Schritt) => Promise<void>; onAbbrechen: () => void }) {
  const connect = useServerFn(connectFints);
  const today = todayInGermany();
  const [blz, setBlz] = useState(vorlage?.bankCode ?? "");
  const [url, setUrl] = useState(vorlage?.url ?? "");
  const [benutzer, setBenutzer] = useState(vorlage?.login ?? "");
  const [kundenId, setKundenId] = useState(vorlage?.customerId ?? "");
  const [pin, setPin] = useState("");
  const [fetchFrom, setFetchFrom] = useState(defaultFetchFrom(today));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    form,
    error: fehler,
    check,
  } = useSubmitCheck({
    blz: /^\d{8}$/.test(blz.replace(/\s/g, "")) ? null : "Die Bankleitzahl hat acht Ziffern.",
    url: /^https:\/\/\S+$/i.test(url.trim()) || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(url.trim()) ? null : "Die FinTS-Adresse beginnt mit https://.",
    benutzer: benutzer.trim() ? null : "Der Anmeldename fehlt.",
    pin: pin ? null : "Die PIN fehlt.",
    fetchFrom: fetchFrom > today ? `Wähle einen Tag bis ${formatDate(today)} oder lass das Feld leer.` : null,
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !check()) return;
    setBusy(true);
    setError(null);
    try {
      const data = {
        blz: blz.replace(/\s/g, ""),
        url: url.trim(),
        benutzer,
        kundenId: kundenId.trim() || undefined,
        pin,
        fetchFrom: fetchFromForConnect(fetchFrom, today),
      };
      await onSchritt(await connect({ data }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={form} onSubmit={onSubmit} className="stack" style={{ gap: 12, maxWidth: 560 }} aria-label="Über FinTS verbinden" noValidate>
      <Field label="Bankleitzahl" error={fehler("blz")} hint="Acht Ziffern; in deiner IBAN die Stellen 5 bis 12.">
        {(control) => <input {...control} value={blz} onChange={(e) => setBlz(e.target.value)} inputMode="numeric" required autoFocus />}
      </Field>
      <Field
        label="FinTS-Adresse der Bank"
        error={fehler("url")}
        hint={
          <>
            Steht bei deiner Bank unter HBCI oder FinTS, etwa für Banking-Programme.{" "}
            <a href={FINTS_ANLEITUNG} target="_blank" rel="noreferrer">
              Anleitung
            </a>
          </>
        }
      >
        {(control) => <input {...control} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" required spellCheck={false} />}
      </Field>
      <Field label="Anmeldename" error={fehler("benutzer")} hint="Wie im Online-Banking, auch Benutzerkennung, Legitimations-ID oder Zugangsnummer.">
        {(control) => <input {...control} value={benutzer} onChange={(e) => setBenutzer(e.target.value)} autoComplete="off" required spellCheck={false} />}
      </Field>
      <Field label="Kunden-ID (optional)" hint="Nur, wenn deine Bank sie getrennt vom Anmeldenamen nennt.">
        {(control) => <input {...control} value={kundenId} onChange={(e) => setKundenId(e.target.value)} autoComplete="off" spellCheck={false} />}
      </Field>
      <Field label="PIN" error={fehler("pin")} hint="Haben speichert die PIN verschlüsselt, damit der tägliche Abruf ohne dich läuft.">
        {(control) => <input {...control} type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" required />}
      </Field>
      <Field
        label="Umsätze abrufen ab"
        error={fehler("fetchFrom")}
        hint="Gilt für Konten, die noch nie abgerufen wurden. Mit der Vorgabe holt Haben ab Jahresbeginn oder schließt an Umsätze an, die schon da sind."
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

/** FinTS im Bereich „Automatischer Abruf“: Formular zum Verbinden (verbinden) und die Verbindungen */
export function FintsAbruf({ fints, verbinden, setVerbinden }: { fints: Fints; verbinden: boolean; setVerbinden: (v: boolean) => void }) {
  const router = useRouter();
  const sync = useServerFn(syncFints);
  const disconnect = useServerFn(disconnectFints);
  const [offen, setOffen] = useState<{ fuer: string; schritt: Offen } | null>(null);
  const [vorlage, setVorlage] = useState<Verbindung | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [meldungen, setMeldungen] = useState<Meldung[]>([]);
  const [trennt, setTrennt] = useState<Verbindung | null>(null);

  async function ergebnis(fuer: string, s: Schritt) {
    if (s.art !== "fertig") {
      setOffen({ fuer, schritt: s });
      return;
    }
    // Erst neu laden, dann Formular schließen und melden: Verbinden ersetzt die Verbindung samt ID, und „Trennen“ an der
    // alten Zeile fände sie nicht mehr. Ohne sync endete invalidate schon mit den alten Daten und lüde im Hintergrund nach
    await router.invalidate({ sync: true });
    setOffen(null);
    if (fuer === "neu") {
      setVerbinden(false);
      setVorlage(null);
    }
    setMeldungen(meldungenAus(s));
  }

  async function run(id: string, work: () => Promise<void>) {
    setBusy(id);
    setMeldungen([]);
    try {
      await work();
    } catch (e) {
      setMeldungen([{ tone: "danger", text: errorMessage(e) }]);
    } finally {
      setBusy(null);
    }
  }

  const schliessen = () => {
    setVerbinden(false);
    setVorlage(null);
    setOffen(null);
  };

  return (
    <>
      {verbinden &&
        (offen?.fuer === "neu" ? (
          <SchrittForm key={offen.schritt.vorgang} schritt={offen.schritt} onSchritt={(s) => ergebnis("neu", s)} onAbbrechen={schliessen} />
        ) : (
          // Nicht die ID der Verbindung allein: Die trägt schon ihre Zeile unten, und mit demselben Schlüssel blieb das
          // Formular nach „Zugang ändern“ im DOM stehen
          <VerbindenForm key={vorlage ? `zugang-${vorlage.id}` : "neu"} vorlage={vorlage} onSchritt={(s) => ergebnis("neu", s)} onAbbrechen={schliessen} />
        ))}

      <ConfirmDialog
        open={trennt !== null}
        title={`FinTS-Verbindung zu ${trennt?.bankName} trennen?`}
        confirmLabel="Trennen"
        danger
        onConfirm={() => {
          if (!trennt) return;
          const { id } = trennt;
          void run(`x-${id}`, async () => {
            await disconnect({ data: id });
            await router.invalidate();
          });
        }}
        onClose={() => setTrennt(null)}
      >
        <p>Haben löscht die gespeicherte PIN. Die abgerufenen Umsätze bleiben erhalten.</p>
      </ConfirmDialog>

      {fints.connections.map((c) => (
        <div key={c.id} className="history-row" style={{ alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0, flex: "1 1 260px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 600 }}>{c.bankName}</span>
              <FintsStatus status={c.status} />
              <span className="small muted">FinTS</span>
            </div>
            <span className="small muted">{c.accounts.map(kontoName).join(" · ") || "Keine Konten"}</span>
            <span className="small muted">{c.lastSyncAt ? `Zuletzt abgerufen ${formatDateTime(c.lastSyncAt)}` : "Noch nicht abgerufen"}</span>
            {c.lastError && <span className="field-error">{c.lastError}</span>}
          </div>
          <div className="actions">
            <button type="button" className="btn btn-danger" disabled={busy !== null} onClick={() => setTrennt(c)}>
              Trennen
            </button>
            {c.status === "fehler" && fints.configured && (
              <button
                type="button"
                className="btn"
                disabled={busy !== null}
                onClick={() => {
                  setOffen(null);
                  setVorlage(c);
                  setVerbinden(true);
                }}
              >
                Zugang ändern
              </button>
            )}
            {fints.configured && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy !== null || offen !== null}
                onClick={() => void run(c.id, async () => ergebnis(c.id, await sync({ data: c.id })))}
              >
                {busy === c.id ? "Rufe ab …" : "Jetzt abrufen"}
              </button>
            )}
          </div>
          {offen?.fuer === c.id && (
            <div style={{ flexBasis: "100%" }}>
              <SchrittForm key={offen.schritt.vorgang} schritt={offen.schritt} onSchritt={(s) => ergebnis(c.id, s)} onAbbrechen={() => setOffen(null)} />
            </div>
          )}
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
