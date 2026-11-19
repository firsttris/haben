import { formatEuro } from "@haben/core";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState } from "react";
import { ElsterSubmit } from "../../components/ElsterSubmit.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { ELSTER_KIND_LABEL, elsterNotice, zahllastFakt } from "../../lib/elster.ts";
import { formatDate, formatDateTime } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { type getAusschuettungen, reverseAusschuettungFn, submitKapEStFn } from "../../server/functions/ausschuettung.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { OutcomeStatus } from "../../components/Status.tsx";
import { Status } from "../../components/Status.tsx";
import { EmpfaengerTabelle, faelligkeit } from "./-ausschuettungen-neu.tsx";

export type Data = Awaited<ReturnType<typeof getAusschuettungen>>;

export type Ausschuettung = Data["ausschuettungen"][number];

/** Je Gesellschafter die Steuerbescheinigung nach § 45a Abs. 2 EStG zum Herunterladen, oder was dafür fehlt */
export function Steuerbescheinigungen({ a }: { a: Ausschuettung }) {
  const headingId = useId();
  return (
    <section className="stack" style={{ gap: 8, marginTop: 16 }} aria-labelledby={headingId}>
      <h3 id={headingId} style={{ margin: 0 }}>
        Steuerbescheinigungen
      </h3>
      <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
        Nach § 45a Abs. 2 EStG (amtliches Muster II), ab dem Zahlungstag. Gib jedem Gesellschafter seine Bescheinigung für die Einkommensteuererklärung und
        bewahre eine Kopie bei den Unterlagen der Ausschüttung auf. Anschrift, Identifikationsnummer und Religionsgemeinschaft kommen aus den{" "}
        <Link to="/jahreserklaerung">Angaben zu den Erklärungen</Link>.
      </p>
      <ul className="stack" style={{ gap: 8, margin: 0, paddingLeft: 20 }}>
        {a.bescheinigungen.map((b) => (
          <li key={b.nr}>
            {b.fehlend.length === 0 ? (
              <a href={`/api/steuerbescheinigung/${a.id}/${b.nr}`} download>
                Steuerbescheinigung {b.name} (PDF)
              </a>
            ) : (
              <span>
                Steuerbescheinigung {b.name}: <span className="muted">{b.fehlend.join(" ")}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AusschuettungCard({ data, a }: { data: Data; a: Ausschuettung }) {
  const router = useRouter();
  const submit = useServerFn(submitKapEStFn);
  const reverse = useServerFn(reverseAusschuettungFn);
  const { busy, notice, setNotice, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const titel = `Beschluss vom ${formatDate(a.beschlussDate)}`;
  const faellig = faelligkeit(a.zufluss);
  return (
    <section className="card" aria-label={titel}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>
          {titel}: {formatEuro(a.brutto)}
        </h2>
        {a.storniert ? (
          <Status tone="danger" inline edge>
            Storniert
          </Status>
        ) : a.angemeldet ? (
          <Status tone="ok" inline edge>
            Angemeldet
          </Status>
        ) : (
          <Status inline edge detail={`bis ${formatDate(faellig)}`}>
            Anmelden
          </Status>
        )}
      </div>
      <p className="small muted">Zufluss am {formatDate(a.zufluss)}</p>
      <EmpfaengerTabelle empfaenger={a.empfaenger} />
      {!a.storniert && <Steuerbescheinigungen a={a} />}
      {!a.storniert && (
        <div className="grid-main" style={{ marginTop: 16 }}>
          <ElsterSubmit
            setup={data}
            title={`Kapitalertragsteuer-Anmeldung ${formatDate(a.zufluss)}`}
            ready
            busy={busy}
            notice={notice}
            lockedHint={a.angemeldet ? "Schon übermittelt. Eine Berichtigung geht über das ELSTER-Portal." : undefined}
            confirmTitle={`Kapitalertragsteuer-Anmeldung vom ${formatDate(a.zufluss)} verbindlich senden?`}
            confirmFacts={[
              { label: "Steuerart", value: "Kapitalertragsteuer-Anmeldung" },
              { label: "Zufluss", value: formatDate(a.zufluss) },
              zahllastFakt(a.empfaenger.reduce((summe, e) => summe + e.kapest + e.soli + e.kist, 0)),
            ]}
            confirmText="Die Kapitalertragsteuer-Anmeldung geht verbindlich an das Finanzamt."
            footer="Die einbehaltenen Steuern überweist du bis zum 10. des Folgemonats; im Bankabgleich ordnest du die Zahlung „Kapitalertragsteuer an das Finanzamt“ zu."
            onSubmit={(kind, pin) =>
              run(async () => {
                const result = await submit({ data: { id: a.id, kind, pin } });
                setNotice(elsterNotice(kind, result, "Übermittelt."));
                await router.invalidate();
              })
            }
          />
          <div className="stack" style={{ gap: 8 }}>
            {a.history.map((h) => (
              <div key={h.id} className="history-row">
                <span className="small">
                  {ELSTER_KIND_LABEL[h.kind]} <OutcomeStatus ok={h.ok}>{h.ok ? "OK" : `Fehler ${h.code}`}</OutcomeStatus> {formatDateTime(h.createdAt)}
                  {h.transferTicket ? ` · Ticket ${h.transferTicket}` : ""}
                </span>
                {h.ok && h.kind !== "validate" && (
                  <a href={`/api/protokoll/${h.id}`} target="_blank" rel="noreferrer" className="small">
                    Protokoll
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {!a.storniert && !a.angemeldet && (
        <div className="actions" style={{ marginTop: 16 }}>
          <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => setConfirming(true)}>
            {titel} stornieren
          </button>
          <ConfirmDialog
            open={confirming}
            title={`${titel} stornieren?`}
            facts={[
              { label: "Zufluss", value: formatDate(a.zufluss) },
              { label: "Brutto", value: formatEuro(a.brutto), strong: true },
            ]}
            confirmLabel="Stornieren"
            danger
            onConfirm={() =>
              void run(async () => {
                await reverse({ data: { id: a.id } });
                await router.invalidate();
              }, "Ausschüttung storniert.")
            }
            onClose={() => setConfirming(false)}
          >
            <p>Haben bucht die Ausschüttung gegen; sie bleibt als storniert stehen.</p>
          </ConfirmDialog>
        </div>
      )}
      {a.storniert && <NoticeBanner notice={notice} />}
    </section>
  );
}
