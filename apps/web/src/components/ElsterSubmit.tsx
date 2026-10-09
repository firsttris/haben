import { Link } from "@tanstack/react-router";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { formatDate } from "../lib/format.ts";
import { submitKind, type ElsterKind } from "../lib/elster.ts";
import type { Notice } from "../lib/use-action.ts";
import { Icon } from "./Icon.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

/** Was eine Seite über ERiC und das Zertifikat aus dem Loader mitbringt */
export interface ElsterSetup {
  certificate: { filename: string; validUntil?: string | null } | null;
  herstellerIdConfigured: boolean;
  mode: string;
}

export function CertificateStatus({ certificate }: { certificate: ElsterSetup["certificate"] }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px", background: "var(--ground)", borderRadius: 10 }}>
      <Icon name={certificate ? "check" : "alert"} />
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontWeight: 500 }}>{certificate ? "Zertifikat hinterlegt" : "Kein Zertifikat hinterlegt"}</span>
        <span className="small muted">
          {certificate ? (
            <>
              {certificate.filename}
              {certificate.validUntil ? ` · gültig bis ${formatDate(certificate.validUntil)}` : ""}
            </>
          ) : (
            <Link to="/einstellungen">In den Einstellungen hochladen</Link>
          )}
        </span>
      </div>
    </div>
  );
}

/** Test-Schalter; echt geht nur mit ERiC und Hersteller-ID und solange `lockedHint` nichts anderes sagt */
export function TestOnlyToggle({
  setup,
  testOnly,
  lockedHint,
  onChange,
}: {
  setup: ElsterSetup;
  testOnly: boolean;
  lockedHint?: string;
  onChange: (testOnly: boolean) => void;
}) {
  const canSendLive = setup.herstellerIdConfigured && !lockedHint;
  return (
    <>
      <label className="checkbox">
        <input type="checkbox" checked={testOnly || !canSendLive} onChange={(e) => onChange(e.target.checked)} disabled={!canSendLive} />
        Nur Testübermittlung
      </label>
      {!canSendLive && (
        <p className="small muted" style={{ margin: 0 }}>
          {lockedHint ??
            (setup.mode === "simuliert"
              ? "Echtübermittlung erst mit eingerichtetem ERiC (Einstellungen) und eigener Hersteller-ID."
              : "Echtübermittlung erst mit eigener Hersteller-ID (ELSTER_HERSTELLER_ID).")}
        </p>
      )}
    </>
  );
}

/**
 * Prüfen, testweise oder echt senden über ELSTER: PIN, Test-Schalter und Zweiklick vor der Echtsendung.
 * `busy` und die Meldung führt die Seite, damit sie auch das Speichern davor abdecken.
 */
export function ElsterSubmit({
  setup,
  title,
  className = "card",
  ready,
  busy,
  notice = null,
  lockedHint,
  confirmText,
  footer,
  onSubmit,
}: {
  setup: ElsterSetup;
  title: string;
  className?: string;
  ready: boolean;
  busy: boolean;
  notice?: Notice;
  lockedHint?: string;
  confirmText: string;
  footer: ReactNode;
  onSubmit: (kind: ElsterKind, pin?: string) => Promise<unknown>;
}) {
  const headingId = useId();
  const [pin, setPin] = useState("");
  const [testOnly, setTestOnly] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const live = submitKind(testOnly, setup.herstellerIdConfigured && !lockedHint) === "send";

  async function send(event: FormEvent) {
    event.preventDefault();
    if (live && !confirming) {
      setConfirming(true);
      return;
    }
    await onSubmit(live ? "send" : "test", pin);
    setPin("");
    setConfirming(false);
  }

  return (
    <form className={className} onSubmit={send} aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <CertificateStatus certificate={setup.certificate} />
      <label className="field">
        Zertifikats-PIN
        <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" required />
      </label>
      <TestOnlyToggle
        setup={setup}
        testOnly={testOnly}
        lockedHint={lockedHint}
        onChange={(value) => {
          setTestOnly(value);
          setConfirming(false);
        }}
      />
      {confirming && (
        <div className="banner" role="alert">
          {confirmText}
        </div>
      )}
      <NoticeBanner notice={notice} />
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !ready || !setup.certificate || pin.length === 0} style={{ flexGrow: 1 }}>
          {busy ? "Läuft …" : confirming ? "Jetzt verbindlich senden" : live ? "Prüfen und senden" : "Prüfen und testweise senden"}
        </button>
        <button type="button" className="btn" disabled={busy || !ready} onClick={() => void onSubmit("validate")}>
          Nur prüfen
        </button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {footer}
      </p>
    </form>
  );
}
