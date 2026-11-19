import { useRouter, getRouteApi } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useId, useState, type FormEvent } from "react";
import { FilePicker } from "../../components/FilePicker.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { certificateUploadNotice } from "../../lib/certificate-notice.ts";
import { formatDate } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { useSubmitCheck } from "../../lib/use-submit-check.ts";
import { removeCertificate, uploadCertificate } from "../../server/functions/certificate.ts";
import { checkElsterFormats, confirmElsterPrivacy, getEricStatus, installEricLibrary } from "../../server/functions/eric.ts";
import { Icon } from "../../components/Icon.tsx";
import { Field } from "../../components/Field.tsx";
import { Status } from "../../components/Status.tsx";

const route = getRouteApi("/_app/einstellungen");

export function CertificateForm() {
  const { certificate, mode } = route.useLoaderData();
  const router = useRouter();
  const upload = useServerFn(uploadCertificate);
  const remove = useServerFn(removeCertificate);
  const { busy, notice, setNotice, run } = useAction();
  const [removing, setRemoving] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void run(async () => {
      const done = certificateUploadNotice(await upload({ data }), data.get("pin") !== "");
      form.reset();
      await router.invalidate();
      setNotice(done);
    });
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="cert-heading">
      <h2 id="cert-heading">ELSTER-Zertifikat</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Die Zertifikatsdatei (.pfx) aus deinem ELSTER-Konto mit der Anmeldeart Zertifikatsdatei; ELSTER Secure geht nicht. Sie wird verschlüsselt abgelegt. Die
        PIN fragt Haben beim Senden ab; speichern kannst du sie nur für den automatischen Postfach-Abruf. ERiC:{" "}
        {mode === "eric" ? "eingerichtet" : "nicht eingerichtet, Senden simuliert"}.
      </p>
      {certificate && (
        <div className="history-row">
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 500 }}>{certificate.filename}</span>
            <span className="small muted">{certificate.validUntil ? `gültig bis ${formatDate(certificate.validUntil)}` : "Ablaufdatum nicht angegeben"}</span>
          </div>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setRemoving(true)}>
            Entfernen
          </button>
          <ConfirmDialog
            open={removing}
            title={`Zertifikat ${certificate.filename} entfernen?`}
            confirmLabel="Zertifikat entfernen"
            danger
            onConfirm={() =>
              void run(async () => {
                await remove();
                await router.invalidate();
              }, "Zertifikat entfernt.")
            }
            onClose={() => setRemoving(false)}
          >
            <p>Ohne Zertifikat sendet Haben nichts an ELSTER und ruft das Postfach nicht ab. Zum Wiederherstellen brauchst du die .pfx-Datei und ihre PIN.</p>
          </ConfirmDialog>
        </div>
      )}
      <Field label={certificate ? "Neue Zertifikatsdatei" : "Zertifikatsdatei"}>
        {(control) => <FilePicker {...control} name="file" accept=".pfx" required />}
      </Field>
      <Field label="Zertifikats-PIN (optional)" hint="Haben liest damit nur das Ablaufdatum aus der Datei und speichert sie nicht.">
        {(control) => <input {...control} name="pin" type="password" autoComplete="off" />}
      </Field>
      <Field
        label="Gültig bis (für die Erinnerung 30 Tage vorher)"
        hint="Nur nötig ohne PIN oder wenn Haben die Datei damit nicht lesen kann; sonst gilt das Datum aus der Datei."
      >
        {(control) => <input {...control} name="validUntil" type="date" />}
      </Field>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Hochladen
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}

export const ERIC_INFO_URL = "https://www.elster.de/elsterweb/entwickler/infoseite/eric";

/** ERiC von download.elster.de laden, mit Fortschritt; läuft im Hintergrund weiter */
export function EricCard() {
  const loaded = route.useLoaderData().eric;
  const router = useRouter();
  const install = useServerFn(installEricLibrary);
  const getStatus = useServerFn(getEricStatus);
  // Stand während des Downloads; danach gilt wieder der Loader
  const [polled, setPolled] = useState<typeof loaded | null>(null);
  const eric = polled ?? loaded;
  const [version, setVersion] = useState(eric.version ?? eric.defaultVersion);
  const [accepted, setAccepted] = useState(false);
  const { form, error, check } = useSubmitCheck({
    version: version.trim() === "" ? `Trag die Version ein, etwa ${eric.defaultVersion}.` : null,
    accepted: accepted ? null : "Stimm den Nutzungsbedingungen von ERiC zu, sonst lädt Haben es nicht.",
  });
  const zustimmungFehlerId = useId();
  const { busy, notice, run } = useAction();
  const running = eric.install?.status === "laeuft";

  // Während des Downloads alle zwei Sekunden nur den ERiC-Stand holen; am Ende einmal die ganze Seite
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      getStatus().then(
        (next) => {
          if (next.install?.status === "laeuft") return setPolled(next);
          setPolled(null);
          void router.invalidate();
        },
        // Netzfehler: der nächste Takt fragt erneut
        () => {},
      );
    }, 2000);
    return () => clearInterval(timer);
  }, [running, getStatus, router]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check()) return;
    void run(async () => {
      await install({ data: { version: version.trim(), acceptLicense: accepted as true } });
      await router.invalidate();
    });
  }

  const progress = eric.install?.status === "laeuft" ? eric.install.progress : null;
  const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

  return (
    <form ref={form} className="card" onSubmit={onSubmit} aria-labelledby="eric-heading" noValidate>
      <h2 id="eric-heading">ERiC</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Die Bibliothek der Finanzverwaltung für die Übermittlung an ELSTER. Haben darf sie nicht mitliefern, lädt sie aber hier direkt von download.elster.de
        auf deinen Server (rund 300 MB, nur Linux x86_64).
      </p>
      <div className="history-row">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 500 }}>
            {eric.mode === "eric" ? `Eingerichtet${eric.version ? `: Version ${eric.version}` : ""}` : "Nicht eingerichtet, Senden wird simuliert"}
          </span>
          {eric.home && (
            <span className="small muted mono">
              {eric.home}
              {eric.source === "env" ? " (ERIC_HOME)" : ""}
            </span>
          )}
        </div>
        {eric.mode === "eric" ? (
          <Status tone="ok" inline>
            ERiC
          </Status>
        ) : (
          <Status tone="warn" emphasis="notice" inline>
            Simuliert
          </Status>
        )}
      </div>
      {eric.source === "env" ? (
        <p className="small muted" style={{ margin: 0 }}>
          ERiC ist über ERIC_HOME eingebunden. Zum Aktualisieren das Paket dort austauschen oder ERIC_HOME entfernen und hier herunterladen.
        </p>
      ) : !eric.platformSupported ? (
        <p className="small muted" style={{ margin: 0 }}>
          Dieser Server ist kein Linux x86_64; dafür gibt es kein ERiC. Prüfen und Senden bleiben simuliert, außer ERIC_WORKER_COMMAND startet den Worker
          emuliert als x86_64 (siehe Installation).
        </p>
      ) : (
        <>
          <Field
            label="Version"
            hint={
              <>
                Die aktuelle Version steht auf der{" "}
                <a href={ERIC_INFO_URL} target="_blank" rel="noreferrer">
                  ERiC-Infoseite von ELSTER
                </a>
                . Neue Vordrucke (etwa für das nächste Steuerjahr) brauchen meist eine neue Version.
              </>
            }
            error={error("version")}
          >
            {(control) => (
              <input {...control} value={version} onChange={(e) => setVersion(e.target.value)} placeholder={eric.defaultVersion} disabled={running} />
            )}
          </Field>
          <div className="checkbox-hinted">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                disabled={running}
                aria-invalid={error("accepted") ? true : undefined}
                aria-describedby={error("accepted") ? zustimmungFehlerId : undefined}
              />
              Ich stimme den Nutzungsbedingungen von ERiC zu (siehe Infoseite).
            </label>
            {error("accepted") && (
              <span id={zustimmungFehlerId} className="field-error">
                {error("accepted")}
              </span>
            )}
          </div>
          {running && (
            <div className="banner banner-info" role="status">
              {progress?.phase === "entpacken"
                ? `Entpacke … ${megabytes(progress.bytes)}`
                : progress
                  ? `Lade ERiC ${eric.install!.version} … ${megabytes(progress.bytes)}${progress.total ? ` von ${megabytes(progress.total)}` : ""}`
                  : `Lade ERiC ${eric.install!.version} …`}
            </div>
          )}
          {eric.install?.status === "fertig" && (
            <div className="banner banner-ok" role="status">
              ERiC {eric.install.version} ist eingerichtet. Prüfen und Senden laufen jetzt über ERiC.
            </div>
          )}
          {eric.install?.status === "fehler" && (
            <div className="banner banner-danger" role="alert">
              Download fehlgeschlagen: {eric.install.message}
            </div>
          )}
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy || running}>
              {running ? "Läuft …" : eric.source === "download" ? "Neu herunterladen" : "Herunterladen und einrichten"}
            </button>
          </div>
        </>
      )}
      <NoticeBanner notice={notice} />
      <DatenschutzBestaetigung bestaetigt={eric.datenschutzBestaetigt} />
      <FormatCheck simuliert={eric.mode !== "eric"} />
    </form>
  );
}

/** ERiC-Lizenz § 5: Datenschutzhinweise der Finanzverwaltung einmal vor der ersten Nutzung bestätigen */
export function DatenschutzBestaetigung({ bestaetigt }: { bestaetigt: string | null }) {
  const router = useRouter();
  const confirm = useServerFn(confirmElsterPrivacy);
  const [gelesen, setGelesen] = useState(false);
  const { busy, notice, run } = useAction();
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="section-label">Datenschutzhinweise der Finanzverwaltung</div>
      <p className="small muted" style={{ margin: 0 }}>
        Bevor Haben über ERiC prüft oder sendet, nimmst du einmal die{" "}
        <a href="/elster-datenschutz.html" target="_blank" rel="noreferrer">
          Datenschutzhinweise der Finanzverwaltung
        </a>{" "}
        zur Kenntnis; so verlangt es der Lizenzvertrag zu ERiC.
      </p>
      {bestaetigt ? (
        <span className="small">Bestätigt am {formatDate(bestaetigt)}.</span>
      ) : (
        <>
          <label className="checkbox">
            <input type="checkbox" checked={gelesen} onChange={(e) => setGelesen(e.target.checked)} />
            Ich habe die Datenschutzhinweise der Finanzverwaltung zur Kenntnis genommen.
          </label>
          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={busy || !gelesen}
              onClick={() =>
                void run(async () => {
                  await confirm();
                  await router.invalidate();
                }, "Bestätigt.")
              }
            >
              Bestätigen
            </button>
          </div>
        </>
      )}
      <NoticeBanner notice={notice} />
    </div>
  );
}

/** ERiC prüft Belegabruf, Berechtigung und Postfach gegen seine Schemas, ohne zu senden */
export function FormatCheck({ simuliert }: { simuliert: boolean }) {
  const check = useServerFn(checkElsterFormats);
  const { busy, notice, run } = useAction();
  const [result, setResult] = useState<Awaited<ReturnType<typeof checkElsterFormats>> | null>(null);

  const failed = result?.results.filter((r) => !r.ok).length ?? 0;
  return (
    <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }} aria-label="Formate prüfen" role="group">
      <p className="small muted" style={{ margin: 0 }}>
        Belegabruf, Berechtigung und Postfach baut Haben nach freien Vorlagen, nicht nach der amtlichen Jahresdokumentation. Hier prüft ERiC diese Nachrichten
        gegen seine Schemas; gesendet wird nichts.
        {simuliert ? " Ohne ERiC ist die Prüfung nur simuliert." : ""}
      </p>
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => setResult(await check()))}>
          {busy ? "Prüft …" : "Formate mit ERiC prüfen"}
        </button>
      </div>
      <NoticeBanner notice={notice} />
      {result && (
        <>
          <div className={`banner ${failed === 0 ? "banner-ok" : "banner-danger"}`} role="status">
            {failed === 0
              ? `Alle ${result.results.length} Nachrichten sind gültig${result.mode === "simuliert" ? " (simuliert, ohne ERiC)" : ""}.`
              : `${failed} von ${result.results.length} Nachrichten bemängelt ERiC. Bitte die Meldungen als Issue melden.`}
          </div>
          <ul className="small stack" style={{ gap: 4, margin: 0, padding: 0, listStyle: "none" }}>
            {result.results.map((r) => (
              <li key={r.name}>
                <Icon name={r.ok ? "check" : "close"} size={14} />
                <span className="visually-hidden">{r.ok ? "gültig" : "bemängelt"}</span> {r.name} <span className="muted mono">{r.datenartVersion}</span>
                {!r.ok && (
                  <div style={{ overflowWrap: "anywhere" }}>
                    {r.code}: {r.message}
                    {r.meldungen.map((m) => (
                      <div key={m} className="muted">
                        {m}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
