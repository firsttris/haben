import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState, type FormEvent } from "react";
import { formatDateTime } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { useSubmitCheck } from "../../lib/use-submit-check.ts";
import { NoticeBanner } from "../NoticeBanner.tsx";
import { saveFastbillLogin } from "../../server/functions/fastbill.ts";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { Icon } from "../Icon.tsx";
import { ArchiveUpload } from "./ArchiveUpload.tsx";
import { OpenItems } from "./OpenItems.tsx";
import { WebBackup } from "./WebBackup.tsx";
import { BuchhaltungsButlerImport } from "./BuchhaltungsButlerImport.tsx";
import { SevdeskAssets } from "./SevdeskAssets.tsx";
import { WisoImport } from "./WisoImport.tsx";
import { SevdeskExportImport } from "./SevdeskExportImport.tsx";
import { FastbillReceipts } from "./FastbillReceipts.tsx";
import { fastbillUsageText, FastbillArticles, FastbillLoginFields } from "./FastbillTeile.tsx";
import { Field } from "../Field.tsx";

import { ALL_SOURCES, type ConnectedSource, type FastbillPlan, type MigrationData, SOURCES, type Source } from "./migration-quellen.ts";
import { ImportCard } from "./MigrationImportCard.tsx";
import { YearCheck } from "./MigrationJahre.tsx";

/** Die zuletzt genutzte Quelle, sonst Lexware Office */
function startSource(data: MigrationData): Source {
  if (data.connection || data.lastImport) return "lexoffice";
  if (data.sevdeskConnection || data.sevdeskImport || data.sevdeskExportImport) return "sevdesk";
  if (data.fastbillConnection || data.fastbillImport) return "fastbill";
  if (data.accountableImport) return "accountable";
  if (data.bbImport) return "buchhaltungsbutler";
  if (data.wisoImport) return "wiso";
  return "lexoffice";
}

function lastImportOf(data: MigrationData, source: Source) {
  const imports = {
    buchhaltungsbutler: data.bbImport,
    wiso: data.wisoImport,
    sevdesk: data.sevdeskImport,
    fastbill: data.fastbillImport,
    accountable: data.accountableImport,
    lexoffice: data.lastImport,
  } satisfies Record<Source, unknown>;
  return imports[source];
}

/** Verbindung zur API der gewählten Quelle */
function SourceConnection({ data, source }: { data: MigrationData; source: ConnectedSource }) {
  return (
    <>
      {source === "sevdesk" ? (
        <Connection key="sevdesk" source="sevdesk" connected={data.sevdeskConnection ? { name: "sevDesk", since: data.sevdeskConnection.createdAt } : null} />
      ) : source === "fastbill" ? (
        <Connection
          key="fastbill"
          source="fastbill"
          plans={data.fastbillPlans}
          connected={
            data.fastbillConnection
              ? {
                  name: data.fastbillConnection.email,
                  since: data.fastbillConnection.createdAt,
                  detail: `Tarif ${data.fastbillPlans.find((p) => p.callsPerHour === data.fastbillConnection?.callsPerHour)?.label ?? ""}, ${data.fastbillConnection.callsPerHour} Anfragen pro Stunde.${fastbillUsageText(data.fastbillUsage, data.fastbillConnection.callsPerHour)}`,
                }
              : null
          }
        />
      ) : (
        <Connection
          key="lexoffice"
          source="lexoffice"
          connected={data.connection ? { name: data.connection.organizationName || "Lexware Office", since: data.connection.createdAt } : null}
        />
      )}
    </>
  );
}

export function Migration({ data }: { data: MigrationData }) {
  const ready = data.years.length > 0 && data.years.every((y) => y.ready) && data.orderArchive.withoutPdf === 0;
  const [source, setSource] = useState<Source>(() => startSource(data));
  const config = ALL_SOURCES[source];
  // Das Anlagenverzeichnis liefert nur die API von sevDesk
  const assets = source === "sevdesk" && Boolean(data.sevdeskConnection);
  const lastImport = lastImportOf(data, source);
  return (
    <div className="stack">
      {data.externalImports.length > 0 && (
        <p className="banner banner-info" role="status">
          Geprüfte JSON-Pakete übernommen: {data.externalImports.map((entry) => `${entry.source} (${entry.count} Vorgänge)`).join(", ")}. Originale stehen unter
          Belege und Auftragsdokumente. Offene Posten werden unten am Stichtag geprüft.
        </p>
      )}
      {data.orderArchive.count > 0 && (
        <p className="banner banner-info" role="status">
          {data.orderArchive.count} Auftragsdokumente archiviert; {data.orderArchive.withoutPdf} ohne PDF.{" "}
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
        {(Object.keys(ALL_SOURCES) as Source[]).map((s) => (
          <button key={s} type="button" className={`chip${source === s ? " active" : ""}`} aria-pressed={source === s} onClick={() => setSource(s)}>
            Umzug aus {ALL_SOURCES[s].product}
          </button>
        ))}
      </div>
      {source === "buchhaltungsbutler" ? (
        <BuchhaltungsButlerImport key="buchhaltungsbutler" initial={data.bbImport} />
      ) : source === "wiso" ? (
        <WisoImport key="wiso" initial={data.wisoImport} />
      ) : source === "accountable" ? (
        <ImportCard key={`accountable-${lastImport?.id ?? "neu"}`} source="accountable" connected initial={lastImport} />
      ) : (
        <>
          <SourceConnection data={data} source={source} />
          {source === "lexoffice" && !data.connection && <WebBackup />}
          <ImportCard
            key={`${source}-${lastImport?.id ?? "neu"}`}
            source={source}
            connected={Boolean(source === "sevdesk" ? data.sevdeskConnection : source === "fastbill" ? data.fastbillConnection : data.connection)}
            initial={lastImport}
          />
          {source === "sevdesk" && <SevdeskExportImport key={`sevdesk-export-${data.sevdeskExportImport?.id ?? "neu"}`} initial={data.sevdeskExportImport} />}
          {source === "fastbill" && <FastbillReceipts receipts={data.fastbillReceipts} running={data.fastbillImport?.status === "laeuft"} />}
          {source === "fastbill" && data.fastbillConnection && <FastbillArticles />}
        </>
      )}
      <OpenItems
        items={data.openItems}
        cutoff={data.cutoff}
        cutoffError={data.cutoffError}
        imported={Boolean(
          data.lastImport ||
            data.sevdeskImport ||
            data.sevdeskExportImport ||
            data.fastbillImport ||
            data.accountableImport ||
            data.bbImport ||
            data.wisoImport ||
            data.externalImports.length,
        )}
      />
      {assets && <SevdeskAssets bookingDate={data.cutoff.bookingDate} />}
      <section className="card stack" aria-labelledby="upload-heading">
        <div className="step-head">
          <span className="step-num">{assets ? 5 : 4}</span>
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
            <span className="step-num">{assets ? 6 : 5}</span>
            <h2 id="check-heading" style={{ margin: 0 }}>
              Abgleich je Jahr
            </h2>
          </div>
          {data.years.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              Noch nichts übernommen. Der Abgleich erscheint, sobald die ersten Daten aus Schritt 2 oder {assets ? 5 : 4} da sind.
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

function Connection({
  source,
  connected,
  plans = [],
}: {
  source: ConnectedSource;
  connected: { name: string; since: Date; detail?: string } | null;
  /** Nur FastBill: Tarife mit Stundengrenze; dort braucht die Anmeldung auch die Login-E-Mail */
  plans?: readonly FastbillPlan[];
}) {
  const router = useRouter();
  const config = SOURCES[source];
  const save = useServerFn(config.save);
  const saveFastbill = useServerFn(saveFastbillLogin);
  const remove = useServerFn(config.remove);
  const [key, setKey] = useState("");
  const [email, setEmail] = useState("");
  const [callsPerHour, setCallsPerHour] = useState<number>(plans[0]?.callsPerHour ?? 50);
  const fastbill = source === "fastbill";
  const [removing, setRemoving] = useState(false);
  const { busy, notice, run } = useAction();
  const error = notice?.text ?? null;
  const keyId = useId();
  const {
    form,
    error: fehler,
    check,
  } = useSubmitCheck({
    key: key.trim() === "" ? `Trag den ${config.keyLabel} ein.` : null,
    email: fastbill && email.trim() === "" ? "Trag die E-Mail ein, mit der du dich bei FastBill anmeldest." : null,
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!check()) return;
    void run(async () => {
      if (fastbill) await saveFastbill({ data: { email, apiKey: key, callsPerHour } });
      else await save({ data: { apiKey: key } });
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
              {config.keyLabel} hinterlegt am {formatDateTime(connected.since)}, verschlüsselt gespeichert.{connected.detail ? ` ${connected.detail}` : ""}
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
        <form ref={form} className="stack" onSubmit={onSubmit} noValidate>
          <p className="small muted" style={{ margin: 0 }}>
            {config.keyHelp}
          </p>
          {fastbill && (
            <FastbillLoginFields
              email={email}
              onEmail={setEmail}
              emailError={fehler("email")}
              callsPerHour={callsPerHour}
              onCallsPerHour={setCallsPerHour}
              plans={plans}
            />
          )}
          <Field label={config.keyLabel} describedBy={error ? `${keyId}-error` : undefined} error={fehler("key")}>
            {(control) => (
              <input
                {...control}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(event) => setKey(event.target.value)}
                aria-invalid={error || fehler("key") ? true : undefined}
              />
            )}
          </Field>
          {error && (
            <div id={`${keyId}-error`} className="banner banner-danger" role="alert">
              {error}
            </div>
          )}
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Prüfe …" : "Prüfen und speichern"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
