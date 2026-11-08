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
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { Icon } from "../Icon.tsx";
import { ScrollBox } from "../ScrollTable.tsx";
import { ArchiveUpload } from "./ArchiveUpload.tsx";
import { OpenItems } from "./OpenItems.tsx";
import { WebBackup } from "./WebBackup.tsx";

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
    cancel: cancelLexofficeImport,
  },
  sevdesk: {
    product: "sevDesk",
    keyLabel: "API-Token",
    keyHelp: "Den API-Token findest du in sevDesk unter Einstellungen → Benutzer, beim jeweiligen Benutzer. Haben liest nur, es ändert nichts in sevDesk.",
    removeLabel: "Token entfernen",
    importHelp:
      "Holt alle Kontakte, Rechnungen, Gutschriften und Belege mit ihren PDFs bzw. Belegdateien. Angebote, Auftragsbestätigungen und Lieferscheine werden zusätzlich als Archivkopien übernommen. Auftrags-PDFs werden nur bei frisch bestätigter Buchhaltungsversion 1.0 automatisch abgerufen; bei Version 2.0 oder unbekannter Version können sie manuell ergänzt werden. Du kannst die Seite währenddessen verlassen.",
    exportsHelp:
      "Die API liefert keine Buchungen und keine Bankumsätze. Lade deshalb je Geschäftsjahr den DATEV-Export (Buchungsstapel, CSV) aus sevDesk hoch, dazu den Datenexport für die Betriebsprüfung (GoBD, als „IDEA-Export“ ablegen), die ELSTER-Übertragungsprotokolle und die Kontoauszüge der Bank als PDF.",
    save: saveSevdeskToken,
    remove: removeSevdeskToken,
    cancel: cancelSevdeskImport,
  },
} as const;

export function Migration({ data }: { data: MigrationData }) {
  const ready = data.years.length > 0 && data.years.every((y) => y.ready) && data.orderArchive.withoutPdf === 0;
  const [source, setSource] = useState<Source>(
    (data.sevdeskConnection || data.sevdeskImport) && !(data.connection || data.lastImport) ? "sevdesk" : "lexoffice",
  );
  const config = SOURCES[source];
  const lastImport = source === "sevdesk" ? data.sevdeskImport : data.lastImport;
  return (
    <div className="stack">
      {data.orderArchive.count > 0 && (
        <p className="banner banner-info" role="status">
          {data.orderArchive.count} Auftragsdokumente aus sevdesk archiviert; {data.orderArchive.withoutPdf} ohne PDF.{" "}
          <Link to="/archiv" search={{ ansicht: "auftraege" }}>
            Auftragsdokumente ansehen
          </Link>
        </p>
      )}
      <div className="banner banner-info" role="note">
        Haben übernimmt alle Jahre aus {config.product}, damit du nach der Kündigung jede Frage des Finanzamts aus Haben beantworten kannst. Kündige erst, wenn
        der Abgleich unten für jedes Jahr aufgeht. Alles, was hier landet, ist danach unveränderlich.
      </div>
      <div className="chip-row" role="group" aria-label="Bisherige Buchhaltung">
        {(Object.keys(SOURCES) as Source[]).map((s) => (
          <button key={s} type="button" className={`chip${source === s ? " active" : ""}`} aria-pressed={source === s} onClick={() => setSource(s)}>
            Umzug aus {SOURCES[s].product}
          </button>
        ))}
      </div>
      {source === "sevdesk" ? (
        <Connection key="sevdesk" source="sevdesk" connected={data.sevdeskConnection ? { name: "sevDesk", since: data.sevdeskConnection.createdAt } : null} />
      ) : (
        <Connection
          key="lexoffice"
          source="lexoffice"
          connected={data.connection ? { name: data.connection.organizationName || "Lexware Office", since: data.connection.createdAt } : null}
        />
      )}
      {source === "lexoffice" && !data.connection && <WebBackup />}
      <ImportCard
        key={`${source}-${lastImport?.id ?? "neu"}`}
        source={source}
        connected={Boolean(source === "sevdesk" ? data.sevdeskConnection : data.connection)}
        initial={lastImport}
      />
      <OpenItems items={data.openItems} cutoff={data.cutoff} cutoffError={data.cutoffError} imported={Boolean(data.lastImport || data.sevdeskImport)} />
      <section className="card stack" aria-labelledby="upload-heading">
        <div className="step-head">
          <span className="step-num">4</span>
          <h2 id="upload-heading" style={{ margin: 0 }}>
            Exporte ablegen
          </h2>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {config.exportsHelp} Die Dateien bleiben unverändert und mit Prüfsumme im Archiv; den Buchungsstapel liest Haben zusätzlich zeilenweise ein.
        </p>
        <ArchiveUpload kinds={data.kinds} />
      </section>
      <section className="stack" aria-labelledby="check-heading">
        <div className="card stack">
          <div className="step-head">
            <span className="step-num">5</span>
            <h2 id="check-heading" style={{ margin: 0 }}>
              Abgleich je Jahr
            </h2>
          </div>
          {data.years.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              Noch nichts übernommen. Der Abgleich erscheint, sobald die ersten Daten aus Schritt 2 oder 4 da sind.
            </p>
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
  const [removing, setRemoving] = useState(false);
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
        <h2 id="connection-heading" style={{ margin: 0 }}>
          Verbindung zu {config.product}
        </h2>
      </div>
      {connected ? (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            Verbunden mit <strong>{connected.name}</strong>
            <div className="small muted">
              {config.keyLabel} hinterlegt am {formatDateTime(connected.since)}, verschlüsselt gespeichert.
            </div>
          </div>
          <button type="button" className="btn btn-danger" onClick={() => setRemoving(true)} disabled={busy}>
            {config.removeLabel}
          </button>
          <ConfirmDialog
            open={removing}
            title={`${config.keyLabel} entfernen?`}
            confirmLabel={config.removeLabel}
            danger
            onConfirm={() => void onRemove()}
            onClose={() => setRemoving(false)}
          >
            <p>Für neue Abrufe brauchst du dann wieder einen Zugang aus {config.product}. Schon übernommene Daten bleiben erhalten.</p>
          </ConfirmDialog>
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
  const startLexoffice = useServerFn(startLexofficeImport);
  const startSevdesk = useServerFn(startSevdeskImport);
  const cancel = useServerFn(config.cancel);
  const poll = useServerFn(getImportStatus);
  const [run, setRun] = useState<ImportRow | null>(initial);
  const action = useAction();
  const running = run?.status === "laeuft";
  const [cancelling, setCancelling] = useState(false);

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
      if (source === "sevdesk") await startSevdesk();
      else await startLexoffice();
      setRun(await poll({ data: { source } }));
    });

  const progress = run?.progress;
  const done = run?.status === "fertig" && (progress?.failed.length ?? 0) === 0;
  return (
    <section className={`card stack${done ? " step-done" : ""}`} aria-labelledby="import-heading">
      <div className="step-head">
        <span className="step-num">{done ? <Icon name="check" /> : "2"}</span>
        <h2 id="import-heading" style={{ margin: 0 }}>
          Kontakte, Rechnungen und Belege abrufen
        </h2>
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
              <span className="small muted">{source === "sevdesk" ? "Dokumente gefunden" : "Belege gefunden"}</span>
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
          {source === "sevdesk" && (
            <div className="banner">
              <p style={{ margin: 0 }}>
                <strong>Kontaktrollen prüfen:</strong> Neue Partner, Interessenten und Kontakte ohne eindeutige sevDesk-Kategorie werden zunächst als Kunden
                angelegt. Bestehende Kontakte erhalten nur zusätzliche eindeutige Rollen; ein früher fälschlich als Kunde importierter Lieferant bleibt deshalb
                auch Kunde. Entferne diese Rolle bei Bedarf unter Kontakte. Vorhandene Nummern bleiben unverändert.
              </p>
            </div>
          )}
          {run.error && (
            <div className="banner banner-danger" role="alert">
              {run.error}
            </div>
          )}
          {progress.failed.length > 0 && (
            <details>
              <summary className="small">{progress.failed.length} offene Punkte beim Abruf</summary>
              <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 20 }}>
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
      {/* Endet der Lauf, während die Frage offen steht, gibt es nichts mehr abzubrechen */}
      <ConfirmDialog
        open={cancelling && running}
        title="Abruf abbrechen?"
        confirmLabel="Abruf abbrechen"
        danger
        onConfirm={() => run && void action.run(() => cancel({ data: { id: run.id } }))}
        onClose={() => setCancelling(false)}
      >
        <p>Du kannst den Abruf jederzeit neu starten. Schon Übernommenes bleibt und wird übersprungen; Kontakte und Belegliste liest Haben dabei noch einmal.</p>
      </ConfirmDialog>
      <div className="actions">
        {running ? (
          <button type="button" className="btn" disabled={action.busy} onClick={() => setCancelling(true)}>
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

type VatMonth = MigrationData["years"][number]["vat"][number];

const SPECIAL_COLUMNS = [
  { key: "kz21", label: "Kz 21", title: "Sonstige Leistungen ins EU-Ausland (Reverse Charge)" },
  { key: "kz41", label: "Kz 41", title: "Innergemeinschaftliche Lieferungen" },
  { key: "kz43", label: "Kz 43", title: "Steuerfreie Ausfuhrlieferungen" },
  { key: "kz45", label: "Kz 45", title: "Nicht steuerbare Leistungen ins Drittland" },
  { key: "kz60", label: "Kz 60", title: "Umsätze, für die der Empfänger die Steuer nach § 13b UStG schuldet" },
  { key: "kz87", label: "Kz 87", title: "Umsätze zu 0 % nach § 12 Abs. 3 UStG (Photovoltaik)" },
  { key: "steuerfrei", label: "Steuerfrei", title: "In der bisherigen Buchhaltung als steuerfrei markiert: Kz 48 oder Kleinunternehmer" },
  { key: "oss", label: "OSS", title: "Fernverkäufe und elektronische Dienstleistungen über das OSS-Verfahren" },
] as const;

/** Spalten für Sonderfälle nur, wenn im Jahr etwas drinsteht */
function specialColumns(months: VatMonth[]) {
  return SPECIAL_COLUMNS.filter((c) => months.some((m) => m[c.key] !== 0));
}

/**
 * Archiviert, aber weder Einnahme noch Ausgabe: im Einzelunternehmen Privates und Geldtransit, bei GmbH und UG
 * Gesellschafter, Kapital, Darlehen und Steuern vom Einkommen. Sichtbar, damit der Vergleich mit der alten Buchhaltung
 * aufgeht und nichts still fehlt.
 */
function NeutralSums({ year, rows }: { year: number; rows: MigrationData["years"][number]["neutral"] }) {
  return (
    <ScrollBox label={`Weder Einnahme noch Ausgabe ${year}`}>
      <table className="data-table" aria-label={`Weder Einnahme noch Ausgabe ${year}`}>
        <caption className="small muted" style={{ textAlign: "left", captionSide: "top", paddingBottom: 4 }}>
          Weder Einnahme noch Ausgabe, deshalb nicht in den Summen oben und nicht in der Umsatzsteuer
        </caption>
        <thead>
          <tr>
            <th>Art</th>
            <th className="num">Anzahl</th>
            <th className="num">Zufluss</th>
            <th className="num">Abfluss</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.kind}>
              <td>{row.label}</td>
              <td className="num mono">{row.count}</td>
              <td className="num mono">{formatEuro(row.zufluss)}</td>
              <td className="num mono">{formatEuro(row.abfluss)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollBox>
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
        {year.sumsFrom === "datev"
          ? `Keine Belege per API: Summen aus dem DATEV-Buchungsstapel, nach Erlös-, Aufwands- und Steuerkonten des Kontenrahmens geschätzt. Vergleiche sie mit den Auswertungen in ${product}.`
          : `Summen nach Belegdatum. Vergleiche sie mit den Auswertungen in ${product}.`}{" "}
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
      {year.neutral.length > 0 && <NeutralSums year={year.year} rows={year.neutral} />}
      {year.vatIssue && (
        <p className="banner banner-info" role="status">
          {year.vatIssue}
        </p>
      )}
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
                  {specialColumns(year.vat).map((c) => (
                    <th key={c.key} className="num" title={c.title}>
                      {c.label}
                    </th>
                  ))}
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
                    {specialColumns(year.vat).map((c) => (
                      <td key={c.key} className="num mono">
                        {formatEuro(m[c.key])}
                      </td>
                    ))}
                    <td className="num mono">{formatEuro(m.otherBase)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">
            Aus den übernommenen Belegen berechnet:{" "}
            {versteuerung === "ist" ? "Einnahmen nach Zahlungsdatum (Ist-Versteuerung)" : "Einnahmen nach Rechnungsdatum (Soll-Versteuerung)"}, Vorsteuer nach
            Belegdatum. Kz 21, 41 und 60 zählen immer nach Belegdatum. „Steuerfrei“ gehört in Kz 48, wenn die Umsätze nach § 4 Nr. 8–28 UStG steuerfrei sind,
            und fehlt bei Kleinunternehmern ganz; „OSS“ meldest du nicht in der Voranmeldung. Kleine Abweichungen entstehen, wenn in {product} nachträglich
            korrigiert wurde.
          </p>
        </details>
      )}
      {year.year === new Date().getFullYear() && year.lastInvoiceNumber && (
        <p className="small" style={{ margin: 0 }}>
          Deine Rechnungsnummern sollen lückenlos weiterlaufen: Stelle die nächste Nummer in den{" "}
          <Link to="/einstellungen" search={{ bereich: "rechnungen" }}>
            Einstellungen
          </Link>{" "}
          auf die Nummer nach {year.lastInvoiceNumber}.
        </p>
      )}
    </section>
  );
}
