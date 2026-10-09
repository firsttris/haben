import { MONTHS, formatEuro } from "@haben/core";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useId, useState, type FormEvent } from "react";
import { formatDateTime } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { NoticeBanner } from "../NoticeBanner.tsx";
import {
  cancelLexofficeImport,
  getImportStatus,
  removeLexofficeKey,
  saveLexofficeKey,
  startLexofficeImport,
  type getMigration,
} from "../../server/functions/archive.ts";
import { Icon } from "../Icon.tsx";
import { ArchiveUpload } from "./ArchiveUpload.tsx";
import { OpenItems } from "./OpenItems.tsx";

type MigrationData = Awaited<ReturnType<typeof getMigration>>;
type ImportRow = NonNullable<MigrationData["lastImport"]>;

export function Migration({ data }: { data: MigrationData }) {
  const ready = data.years.length > 0 && data.years.every((y) => y.ready);
  return (
    <div className="stack">
      <div className="banner banner-info" role="note">
        Haben übernimmt alle Jahre aus Lexware Office, damit du nach der Kündigung jede Frage des Finanzamts aus Haben beantworten kannst.
        Kündige erst, wenn der Abgleich unten für jedes Jahr aufgeht. Alles, was hier landet, ist danach unveränderlich.
      </div>
      <Connection connection={data.connection} />
      <ImportCard key={data.lastImport?.id ?? "neu"} connected={Boolean(data.connection)} initial={data.lastImport} />
      <OpenItems items={data.openItems} imported={Boolean(data.lastImport)} />
      <section className="card stack" aria-labelledby="upload-heading">
        <div className="step-head">
          <span className="step-num">4</span>
          <h2 id="upload-heading" style={{ margin: 0 }}>Exporte ablegen</h2>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Die API liefert keine Buchungen und keine Bankumsätze. Lade deshalb je Geschäftsjahr den DATEV-Export (Buchungsstapel, CSV) und den
          IDEA-Export aus Lexware Office hoch, dazu die ELSTER-Übertragungsprotokolle und die Kontoauszüge der Bank als PDF. Die Dateien
          bleiben unverändert und mit Prüfsumme im Archiv; den Buchungsstapel liest Haben zusätzlich zeilenweise ein.
        </p>
        <ArchiveUpload kinds={data.kinds} />
      </section>
      <section className="stack" aria-labelledby="check-heading">
        <div className="step-head">
          <span className="step-num">5</span>
          <h2 id="check-heading" style={{ margin: 0 }}>Abgleich je Jahr</h2>
        </div>
        {data.years.length === 0 ? (
          <div className="card muted">Noch nichts übernommen.</div>
        ) : (
          <>
            <div className={ready ? "banner banner-ok" : "banner banner-info"} role="status">
              {ready
                ? "Alle Prüfungen sind erfüllt. Vergleiche noch die Summen und die Umsatzsteuer je Monat mit Lexware Office, dann kannst du kündigen."
                : "Noch nicht alles beisammen. Offene Punkte stehen bei den Jahren unten."}
            </div>
            {data.years.map((year) => (
              <YearCheck key={year.year} year={year} versteuerung={data.versteuerung} />
            ))}
          </>
        )}
      </section>
    </div>
  );
}

function Connection({ connection }: { connection: MigrationData["connection"] }) {
  const router = useRouter();
  const save = useServerFn(saveLexofficeKey);
  const remove = useServerFn(removeLexofficeKey);
  const [key, setKey] = useState("");
  const { busy, notice, run } = useAction();
  const error = notice?.text ?? null;
  const keyId = useId();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await save({ data: { apiKey: key } });
      setKey("");
      await router.invalidate();
    });
  }

  const onRemove = () =>
    run(async () => {
      await remove();
      await router.invalidate();
    });

  return (
    <section className={`card stack${connection ? " step-done" : ""}`} aria-labelledby="connection-heading">
      <div className="step-head">
        <span className="step-num">{connection ? <Icon name="check" /> : "1"}</span>
        <h2 id="connection-heading" style={{ margin: 0 }}>Verbindung zu Lexware Office</h2>
      </div>
      {connection ? (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            Verbunden mit <strong>{connection.organizationName || "Lexware Office"}</strong>
            <div className="small muted">Schlüssel hinterlegt am {formatDateTime(connection.createdAt)}, verschlüsselt gespeichert.</div>
          </div>
          <button type="button" className="btn btn-danger" onClick={onRemove} disabled={busy}>
            Schlüssel entfernen
          </button>
          <NoticeBanner notice={notice} />
        </div>
      ) : (
        <form className="stack" onSubmit={onSubmit}>
          <p className="small muted" style={{ margin: 0 }}>
            Die Public API gibt es im Tarif XL. Den Schlüssel erzeugst du in Lexware Office unter Erweiterungen → Public API
            (app.lexware.de/addons/public-api). Haben liest nur, es ändert nichts in Lexware Office.
          </p>
          <label className="field" htmlFor={keyId}>
            API-Schlüssel
            <input
              id={keyId}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${keyId}-error` : undefined}
            />
          </label>
          {error && (
            <div id={`${keyId}-error`} className="banner banner-danger" role="alert">
              {error}
            </div>
          )}
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy || key.trim().length === 0}>
              {busy ? "Prüfe …" : "Prüfen und speichern"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

const PHASES = { kontakte: "Kontakte", liste: "Belegliste", belege: "Belege und Dateien", fertig: "Fertig" } as const;

function ImportCard({ connected, initial }: { connected: boolean; initial: ImportRow | null }) {
  const router = useRouter();
  const start = useServerFn(startLexofficeImport);
  const cancel = useServerFn(cancelLexofficeImport);
  const poll = useServerFn(getImportStatus);
  const [run, setRun] = useState<ImportRow | null>(initial);
  const action = useAction();
  const running = run?.status === "laeuft";

  useEffect(() => {
    if (!running) return;
    let stopped = false;
    const timer = setInterval(async () => {
      const next = await poll().catch(() => null);
      if (stopped || !next) return;
      setRun(next);
      if (next.status !== "laeuft") void router.invalidate();
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [running, poll, router]);

  const onStart = () =>
    action.run(async () => {
      await start();
      setRun(await poll());
    });

  const progress = run?.progress;
  const done = run?.status === "fertig" && (progress?.failed.length ?? 0) === 0;
  return (
    <section className={`card stack${done ? " step-done" : ""}`} aria-labelledby="import-heading">
      <div className="step-head">
        <span className="step-num">{done ? <Icon name="check" /> : "2"}</span>
        <h2 id="import-heading" style={{ margin: 0 }}>Kontakte, Rechnungen und Belege abrufen</h2>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Holt alle Kontakte, Ausgangsrechnungen, Gutschriften und Belege mit ihren Original-PDFs. Die API erlaubt etwa zwei Anfragen pro
        Sekunde; bei einigen hundert Belegen dauert das eine Weile, du kannst die Seite währenddessen verlassen. Ein neuer Abruf überspringt
        alles, was schon da ist.
      </p>
      {progress && run && (
        <div className="stack" style={{ gap: 12 }} aria-live="polite">
          <div className="small">
            {run.status === "laeuft" ? `Läuft: ${PHASES[progress.phase]}` : null}
            {run.status === "fertig" ? `Fertig am ${formatDateTime(run.finishedAt ?? run.updatedAt)}` : null}
            {run.status === "fehler" ? "Abgebrochen mit Fehler" : null}
            {run.status === "abgebrochen" ? "Abgebrochen" : null}
          </div>
          <div className="progress-facts">
            <div>
              <span className="small muted">Kontakte neu</span>
              <strong>{progress.contacts}</strong>
            </div>
            <div>
              <span className="small muted">verknüpft</span>
              <strong>{progress.contactsLinked}</strong>
            </div>
            <div>
              <span className="small muted">Belege gefunden</span>
              <strong>{progress.listed}</strong>
            </div>
            <div>
              <span className="small muted">übernommen</span>
              <strong>
                {progress.imported + progress.skipped}
                {progress.listed ? ` / ${progress.listed}` : ""}
              </strong>
            </div>
            <div>
              <span className="small muted">Dateien</span>
              <strong>{progress.files}</strong>
            </div>
          </div>
          {run.error && (
            <div className="banner banner-danger" role="alert">
              {run.error}
            </div>
          )}
          {progress.failed.length > 0 && (
            <details>
              <summary className="small">{progress.failed.length} Belege nicht übernommen – ein neuer Abruf versucht sie erneut</summary>
              <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {progress.failed.slice(0, 50).map((f) => (
                  <li key={f.lexofficeId}>
                    {f.number || f.lexofficeId}: {f.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <NoticeBanner notice={action.notice} />
      <div className="actions">
        {running ? (
          <button type="button" className="btn" disabled={action.busy} onClick={() => run && void action.run(() => cancel({ data: { id: run.id } }))}>
            Abbrechen
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onStart} disabled={!connected || action.busy}>
            {run ? "Erneut abrufen" : "Alles abrufen"}
          </button>
        )}
      </div>
    </section>
  );
}

function YearCheck({ year, versteuerung }: { year: MigrationData["years"][number]; versteuerung: "ist" | "soll" }) {
  return (
    <section className="card stack" aria-labelledby={`year-${year.year}`}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h3 id={`year-${year.year}`} style={{ margin: 0 }}>
          Geschäftsjahr {year.year}
        </h3>
        <span className={year.ready ? "pill pill-ok" : "pill pill-warn"}>{year.ready ? "vollständig" : "unvollständig"}</span>
      </div>
      <div className="grid-main">
        <ul className="checks">
          {year.checks.map((check) => (
            <li key={check.label}>
              <span className={check.ok ? "ok" : "open"} aria-hidden="true">
                <Icon name={check.ok ? "check" : "alert"} />
              </span>
              <span>
                {check.label}
                <span className="visually-hidden">{check.ok ? " – erfüllt" : " – offen"}</span>
              </span>
              <span className="small muted">{check.detail}</span>
            </li>
          ))}
        </ul>
        <dl className="facts">
          <dt>Einnahmen netto</dt>
          <dd className="mono">{formatEuro(year.einnahmen.net)}</dd>
          <dt>Umsatzsteuer</dt>
          <dd className="mono">{formatEuro(year.einnahmen.tax)}</dd>
          <dt>Ausgaben netto</dt>
          <dd className="mono">{formatEuro(year.ausgaben.net)}</dd>
          <dt>Vorsteuer</dt>
          <dd className="mono">{formatEuro(year.ausgaben.tax)}</dd>
          <dt>Letzte Rechnungsnummer</dt>
          <dd className="mono">{year.lastInvoiceNumber ?? "–"}</dd>
        </dl>
      </div>
      <div className="small muted">
        Summen nach Belegdatum. Vergleiche sie mit den Auswertungen in Lexware Office.{" "}
        {year.bookings && year.bookings.unmatched > 0 && (
          <Link to="/archiv" activeProps={{}} search={{ ansicht: "buchungen", jahr: year.year, ohneBeleg: true }}>
            Buchungen ohne passenden Beleg ansehen
          </Link>
        )}{" "}
        {year.withoutFile > 0 && (
          <Link to="/archiv" activeProps={{}} search={{ ansicht: "belege", jahr: year.year, ohneDatei: true }}>
            Belege ohne Datei ansehen
          </Link>
        )}
      </div>
      {year.vat.length > 0 && (
        <details>
          <summary>Umsatzsteuer je Monat zum Vergleich mit den übermittelten Voranmeldungen</summary>
          <div className="table-scroll">
            <table className="data-table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Monat</th>
                  <th className="num">Kz 81</th>
                  <th className="num">Kz 86</th>
                  <th className="num">Kz 66</th>
                  <th className="num">Andere Sätze</th>
                </tr>
              </thead>
              <tbody>
                {year.vat.map((m) => (
                  <tr key={m.month}>
                    <td>{MONTHS[Number(m.month.slice(5)) - 1]}</td>
                    <td className="num mono">{formatEuro(m.kz81)}</td>
                    <td className="num mono">{formatEuro(m.kz86)}</td>
                    <td className="num mono">{formatEuro(m.kz66)}</td>
                    <td className="num mono">{formatEuro(m.otherBase)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Aus den übernommenen Belegen berechnet:{" "}
            {versteuerung === "ist" ? "Einnahmen nach Zahlungsdatum (Ist-Versteuerung)" : "Einnahmen nach Rechnungsdatum (Soll-Versteuerung)"},
            Vorsteuer nach Belegdatum. Kleine Abweichungen entstehen, wenn in Lexware Office nachträglich korrigiert wurde.
          </p>
        </details>
      )}
      {year.year === new Date().getFullYear() && year.lastInvoiceNumber && (
        <p className="small" style={{ margin: 0 }}>
          Deine Rechnungsnummern sollen lückenlos weiterlaufen: Stelle die nächste Nummer in den{" "}
          <Link to="/einstellungen">Einstellungen</Link> auf die Nummer nach {year.lastInvoiceNumber}.
        </p>
      )}
    </section>
  );
}
