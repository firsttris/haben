import { MONTHS, formatEuro } from "@haben/core";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useId, useState, type FormEvent } from "react";
import { formatDateTime } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { NoticeBanner } from "../NoticeBanner.tsx";
import {
  cancelLexofficeImport,
  cancelSevdeskImport,
  getImportStatus,
  removeLexofficeKey,
  removeSevdeskToken,
  saveLexofficeKey,
  saveSevdeskToken,
  startLexofficeImport,
  startSevdeskImport,
  type getMigration,
} from "../../server/functions/archive.ts";
import { Icon } from "../Icon.tsx";
import { ArchiveUpload } from "./ArchiveUpload.tsx";
import { OpenItems } from "./OpenItems.tsx";

type MigrationData = Awaited<ReturnType<typeof getMigration>>;
type ImportRow = NonNullable<MigrationData["lastImport"]>;
type Source = "lexoffice" | "sevdesk";

/** Was sich je Quelle unterscheidet: Name, Schlüssel und die Server-Funktionen für Verbindung und Abruf */
const SOURCES = {
  lexoffice: {
    product: "Lexware Office",
    keyLabel: "API-Schlüssel",
    keyHelp:
      "Die Public API gibt es im Tarif XL. Den Schlüssel erzeugst du in Lexware Office unter Erweiterungen → Public API (app.lexware.de/addons/public-api). Haben liest nur, es ändert nichts in Lexware Office.",
    removeLabel: "Schlüssel entfernen",
    importHelp:
      "Holt alle Kontakte, Ausgangsrechnungen, Gutschriften und Belege mit ihren Original-PDFs. Die API erlaubt etwa zwei Anfragen pro Sekunde; bei einigen hundert Belegen dauert das eine Weile, du kannst die Seite währenddessen verlassen. Ein neuer Abruf überspringt alles, was schon da ist.",
    exportsHelp:
      "Die API liefert keine Buchungen und keine Bankumsätze. Lade deshalb je Geschäftsjahr den DATEV-Export (Buchungsstapel, CSV) und den IDEA-Export aus Lexware Office hoch, dazu die ELSTER-Übertragungsprotokolle und die Kontoauszüge der Bank als PDF.",
    save: saveLexofficeKey,
    remove: removeLexofficeKey,
    start: startLexofficeImport,
    cancel: cancelLexofficeImport,
  },
  sevdesk: {
    product: "sevDesk",
    keyLabel: "API-Token",
    keyHelp:
      "Den API-Token findest du in sevDesk unter Einstellungen → Benutzer, beim jeweiligen Benutzer. Haben liest nur, es ändert nichts in sevDesk.",
    removeLabel: "Token entfernen",
    importHelp:
      "Holt alle Kontakte, Rechnungen, Gutschriften und Belege mit ihren PDFs bzw. Belegdateien. Je Beleg sind mehrere Anfragen nötig; bei einigen hundert Belegen dauert das eine Weile, du kannst die Seite währenddessen verlassen. Ein neuer Abruf überspringt alles, was schon da ist.",
    exportsHelp:
      "Die API liefert keine Buchungen und keine Bankumsätze. Lade deshalb je Geschäftsjahr den DATEV-Export (Buchungsstapel, CSV) aus sevDesk hoch, dazu den Datenexport für die Betriebsprüfung (GoBD, als „IDEA-Export“ ablegen), die ELSTER-Übertragungsprotokolle und die Kontoauszüge der Bank als PDF.",
    save: saveSevdeskToken,
    remove: removeSevdeskToken,
    start: startSevdeskImport,
    cancel: cancelSevdeskImport,
  },
} as const;

export function Migration({ data }: { data: MigrationData }) {
  const ready = data.years.length > 0 && data.years.every((y) => y.ready);
  const [source, setSource] = useState<Source>(
    (data.sevdeskConnection || data.sevdeskImport) && !(data.connection || data.lastImport) ? "sevdesk" : "lexoffice",
  );
  const config = SOURCES[source];
  const lastImport = source === "sevdesk" ? data.sevdeskImport : data.lastImport;
  return (
    <div className="stack">
      <div className="banner banner-info" role="note">
        Haben übernimmt alle Jahre aus {config.product}, damit du nach der Kündigung jede Frage des Finanzamts aus Haben beantworten kannst.
        Kündige erst, wenn der Abgleich unten für jedes Jahr aufgeht. Alles, was hier landet, ist danach unveränderlich.
      </div>
      <div className="chip-row" role="group" aria-label="Bisherige Buchhaltung">
        {(Object.keys(SOURCES) as Source[]).map((s) => (
          <button key={s} type="button" className={`chip${source === s ? " active" : ""}`} aria-pressed={source === s} onClick={() => setSource(s)}>
            Umzug aus {SOURCES[s].product}
          </button>
        ))}
      </div>
      {source === "sevdesk" ? (
        <Connection
          key="sevdesk"
          source="sevdesk"
          connected={data.sevdeskConnection ? { name: "sevDesk", since: data.sevdeskConnection.createdAt } : null}
        />
      ) : (
        <Connection
          key="lexoffice"
          source="lexoffice"
          connected={data.connection ? { name: data.connection.organizationName || "Lexware Office", since: data.connection.createdAt } : null}
        />
      )}
      <ImportCard
        key={`${source}-${lastImport?.id ?? "neu"}`}
        source={source}
        connected={Boolean(source === "sevdesk" ? data.sevdeskConnection : data.connection)}
        initial={lastImport}
      />
      <OpenItems items={data.openItems} imported={Boolean(data.lastImport || data.sevdeskImport)} />
      <section className="card stack" aria-labelledby="upload-heading">
        <div className="step-head">
          <span className="step-num">4</span>
          <h2 id="upload-heading" style={{ margin: 0 }}>Exporte ablegen</h2>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {config.exportsHelp} Die Dateien bleiben unverändert und mit Prüfsumme im Archiv; den Buchungsstapel liest Haben zusätzlich
          zeilenweise ein.
        </p>
        <ArchiveUpload kinds={data.kinds} />
      </section>
      <section className="stack" aria-labelledby="check-heading">
        <div className="card stack">
          <div className="step-head">
            <span className="step-num">5</span>
            <h2 id="check-heading" style={{ margin: 0 }}>Abgleich je Jahr</h2>
          </div>
          {data.years.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>Noch nichts übernommen. Der Abgleich erscheint, sobald die ersten Daten aus Schritt 2 oder 4 da sind.</p>
          ) : (
            <div className={ready ? "banner banner-ok" : "banner banner-info"} role="status">
              {ready
                ? `Alle Prüfungen sind erfüllt. Vergleiche noch die Summen und die Umsatzsteuer je Monat mit ${config.product}, dann kannst du kündigen.`
                : "Noch nicht alles beisammen. Offene Punkte stehen bei den Jahren unten."}
            </div>
          )}
        </div>
        {data.years.map((year) => (
          <YearCheck key={year.year} year={year} versteuerung={data.versteuerung} product={config.product} />
        ))}
      </section>
    </div>
  );
}

function Connection({ source, connected }: { source: Source; connected: { name: string; since: Date } | null }) {
  const router = useRouter();
  const config = SOURCES[source];
  const save = useServerFn(config.save);
  const remove = useServerFn(config.remove);
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
    <section className={`card stack${connected ? " step-done" : ""}`} aria-labelledby="connection-heading">
      <div className="step-head">
        <span className="step-num">{connected ? <Icon name="check" /> : "1"}</span>
        <h2 id="connection-heading" style={{ margin: 0 }}>Verbindung zu {config.product}</h2>
      </div>
      {connected ? (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            Verbunden mit <strong>{connected.name}</strong>
            <div className="small muted">
              {config.keyLabel} hinterlegt am {formatDateTime(connected.since)}, verschlüsselt gespeichert.
            </div>
          </div>
          <button type="button" className="btn btn-danger" onClick={onRemove} disabled={busy}>
            {config.removeLabel}
          </button>
          <NoticeBanner notice={notice} />
        </div>
      ) : (
        <form className="stack" onSubmit={onSubmit}>
          <p className="small muted" style={{ margin: 0 }}>
            {config.keyHelp}
          </p>
          <label className="field" htmlFor={keyId}>
            {config.keyLabel}
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

function ImportCard({ source, connected, initial }: { source: Source; connected: boolean; initial: ImportRow | null }) {
  const router = useRouter();
  const config = SOURCES[source];
  const start = useServerFn(config.start);
  const cancel = useServerFn(config.cancel);
  const poll = useServerFn(getImportStatus);
  const [run, setRun] = useState<ImportRow | null>(initial);
  const action = useAction();
  const running = run?.status === "laeuft";

  useEffect(() => {
    if (!running) return;
    let stopped = false;
    const timer = setInterval(async () => {
      const next = await poll({ data: { source } }).catch(() => null);
      if (stopped || !next) return;
      setRun(next);
      if (next.status !== "laeuft") void router.invalidate();
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [running, poll, router, source]);

  const onStart = () =>
    action.run(async () => {
      await start();
      setRun(await poll({ data: { source } }));
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
        {config.importHelp}
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

function YearCheck({ year, versteuerung, product }: { year: MigrationData["years"][number]; versteuerung: "ist" | "soll"; product: string }) {
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
        Summen nach Belegdatum. Vergleiche sie mit den Auswertungen in {product}.{" "}
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
            Vorsteuer nach Belegdatum. Kleine Abweichungen entstehen, wenn in {product} nachträglich korrigiert wurde.
          </p>
        </details>
      )}
      {year.year === new Date().getFullYear() && year.lastInvoiceNumber && (
        <p className="small" style={{ margin: 0 }}>
          Deine Rechnungsnummern sollen lückenlos weiterlaufen: Stelle die nächste Nummer in den{" "}
          <Link to="/einstellungen" search={{ bereich: "rechnungen" }}>Einstellungen</Link> auf die Nummer nach {year.lastInvoiceNumber}.
        </p>
      )}
    </section>
  );
}
