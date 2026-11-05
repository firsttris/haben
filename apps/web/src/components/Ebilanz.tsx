import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ELSTER_KIND_LABEL, elsterNotice } from "../lib/elster.ts";
import { formatDateTime } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { submitEbilanzFn } from "../server/functions/abschluss.ts";
import { ElsterSubmit, type ElsterSetup } from "./ElsterSubmit.tsx";

interface EbilanzEntry {
  id: string;
  kind: "validate" | "test" | "send";
  ok: boolean;
  code: number;
  message: string;
  transferTicket: string | null;
  hasPdf: boolean;
  createdAt: Date;
}

export interface EbilanzData {
  /** HGB-Taxonomie des Wirtschaftsjahres, 6.9 oder 6.10 */
  taxonomie: string;
  issues: { tone: "fehler" | "hinweis"; text: string }[];
  history: EbilanzEntry[];
  sent: EbilanzEntry | null;
}

/** E-Bilanz (§ 5b EStG) auf der Abschluss-Seite: offene Punkte, Prüfen und Senden über ERiC, Verlauf */
export function Ebilanz({ year, ebilanz, setup, closed }: { year: number; ebilanz: EbilanzData; setup: ElsterSetup; closed: boolean }) {
  const router = useRouter();
  const submit = useServerFn(submitEbilanzFn);
  const { busy, notice, setNotice, run } = useAction();
  const blocking = ebilanz.issues.some((i) => i.tone === "fehler");
  const lockedHint = ebilanz.sent
    ? "Schon übermittelt. Eine berichtigte E-Bilanz geht über die Steuerberatung oder das ELSTER-Portal."
    : closed
      ? undefined
      : `Echt senden lässt sich die E-Bilanz erst, wenn ${year} abgeschlossen ist.`;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 24, alignItems: "start" }}>
      <section className="card" aria-labelledby="ebilanz-heading">
        <h2 id="ebilanz-heading" style={{ marginTop: 0 }}>
          E-Bilanz {year}
        </h2>
        <p className="small muted" style={{ marginTop: 0, maxWidth: 760 }}>
          Bilanz und GuV als Steuerbilanz in der HGB-Taxonomie {ebilanz.taxonomie} an das Finanzamt (§ 5b EStG), mit Anlagenspiegel, Betriebsvermögensvergleich
          und dem Kontennachweis: jedes Konto mit Saldo auf seiner Position. Die Positionen kommen aus den Konten; was Haben nicht zuordnen kann, steht unten.
          Eine Überleitung von der Handels- zur Steuerbilanz rechnet Haben nicht: Gesendet wird, was gebucht ist.
        </p>
        {ebilanz.issues.length > 0 && (
          <ul className="stack" style={{ gap: 4 }} aria-label="Offene Punkte der E-Bilanz">
            {ebilanz.issues.map((i) => (
              <li key={i.text}>{i.text}</li>
            ))}
          </ul>
        )}
        {ebilanz.history.length > 0 && (
          <div aria-label="Verlauf der E-Bilanz" role="group">
            {ebilanz.history.map((entry) => (
              <div key={entry.id} className="history-row">
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontWeight: 500 }}>
                    {ELSTER_KIND_LABEL[entry.kind]}{" "}
                    <span className={`pill ${entry.ok ? "pill-ok" : "pill-danger"}`}>{entry.ok ? "OK" : `Fehler ${entry.code}`}</span>
                  </span>
                  <span className="small muted" style={{ overflowWrap: "anywhere" }}>
                    {formatDateTime(entry.createdAt)}
                    {entry.transferTicket ? ` · Ticket ${entry.transferTicket}` : ""}
                    {!entry.ok ? ` · ${entry.message}` : ""}
                  </span>
                </div>
                {entry.hasPdf && (
                  <a href={`/api/protokoll/${entry.id}`} target="_blank" rel="noreferrer" className="small">
                    Protokoll
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      <ElsterSubmit
        setup={setup}
        title="E-Bilanz übermitteln"
        ready={!blocking}
        busy={busy}
        notice={notice}
        lockedHint={lockedHint}
        confirmText={`Die E-Bilanz ${year} geht verbindlich an das Finanzamt. Noch einmal klicken zum Senden.`}
        footer="„Nur prüfen“ lässt ERiC die E-Bilanz gegen die Taxonomie und die Plausibilitätsregeln prüfen, ohne zu senden. Die PIN wird nicht gespeichert."
        onSubmit={(kind, pin) =>
          run(async () => {
            const result = await submit({ data: { year, kind, pin } });
            setNotice(elsterNotice(kind, result, "Übermittelt."));
            await router.invalidate();
          })
        }
      />
    </div>
  );
}
