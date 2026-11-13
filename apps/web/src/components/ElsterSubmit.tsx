import { Link } from "@tanstack/react-router";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { formatDate } from "../lib/format.ts";
import { submitKind, type ElsterKind } from "../lib/elster.ts";
import type { Notice } from "../lib/use-action.ts";
import { Icon } from "./Icon.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { ConfirmDialog, type ConfirmFact } from "./ConfirmDialog.tsx";
import { Field } from "./Field.tsx";

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
            <Link to="/einstellungen" search={{ bereich: "elster" }}>
              In den Einstellungen hochladen
            </Link>
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
  const hintId = useId();
  const box = (
    <label className="checkbox">
      <input
        type="checkbox"
        checked={testOnly || !canSendLive}
        onChange={(e) => onChange(e.target.checked)}
        disabled={!canSendLive}
        aria-describedby={canSendLive ? undefined : hintId}
      />
      Nur Testübermittlung
    </label>
  );
  // Der Grund, warum nur testweise geht, steht außerhalb des Labels und gehört per aria-describedby zum Kästchen (DESIGN.md)
  return canSendLive ? (
    box
  ) : (
    <div className="checkbox-hinted">
      {box}
      <span id={hintId} className="field-hint">
        {lockedHint ??
          (setup.mode === "simuliert"
            ? "Echtübermittlung erst mit eingerichtetem ERiC (Einstellungen) und eigener Hersteller-ID."
            : "ERiC nimmt Prüfungen und Übermittlungen, auch zum Test, nur mit eigener Hersteller-ID an (ELSTER_HERSTELLER_ID).")}
      </span>
    </div>
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
  confirmTitle,
  confirmText,
  confirmLabel = "Verbindlich senden",
  confirmDanger = false,
  confirmFacts,
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
  /** Frage im Bestätigungsdialog vor der Echtübermittlung, mit dem Objekt */
  confirmTitle: string;
  /** Die Folgen, bei ELSTER samt dem Hinweis auf die verbindliche Übermittlung */
  confirmText: string;
  confirmLabel?: string;
  confirmDanger?: boolean;
  /** Was gesendet wird: Steuerart oder Meldung, Zeitraum, Zahllast, soweit es sie gibt */
  confirmFacts?: readonly ConfirmFact[];
  footer: ReactNode;
  onSubmit: (kind: ElsterKind, pin?: string) => Promise<unknown>;
}) {
  const headingId = useId();
  const [pin, setPin] = useState("");
  const [testOnly, setTestOnly] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const live = submitKind(testOnly, setup.herstellerIdConfigured && !lockedHint) === "send";

  async function transmit() {
    await onSubmit(live ? "send" : "test", pin);
    setPin("");
  }

  function send(event: FormEvent) {
    event.preventDefault();
    if (live) setConfirming(true);
    else void transmit();
  }

  return (
    <form className={className} onSubmit={send} aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <CertificateStatus certificate={setup.certificate} />
      <Field label="Zertifikats-PIN">
        {(control) => <input {...control} type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" required />}
      </Field>
      <TestOnlyToggle setup={setup} testOnly={testOnly} lockedHint={lockedHint} onChange={setTestOnly} />
      <ConfirmDialog
        open={confirming}
        title={confirmTitle}
        confirmLabel={confirmLabel}
        danger={confirmDanger}
        facts={confirmFacts}
        onConfirm={() => void transmit()}
        onClose={() => setConfirming(false)}
      >
        <p>{confirmText}</p>
      </ConfirmDialog>
      <NoticeBanner notice={notice} />
      <div className="actions">
        <button type="button" className="btn" disabled={busy || !ready} onClick={() => void onSubmit("validate")}>
          Nur prüfen
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !ready || !setup.certificate || pin.length === 0} style={{ flexGrow: 1 }}>
          {busy ? "Läuft …" : live ? "Prüfen und senden" : "Prüfen und testweise senden"}
        </button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {footer}
      </p>
    </form>
  );
}
