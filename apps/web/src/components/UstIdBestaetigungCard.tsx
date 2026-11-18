import { EVATR_VERGLEICH, type EvatrVergleich, evatrGueltig, evatrMeldung, evatrWort, normalizeUstId } from "@haben/core";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { formatDateTime } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { bestaetigeUstIdFn } from "../server/functions/ustid-bestaetigung.ts";
import type { UstIdBestaetigung, UstIdBestaetigungsZustand } from "../server/modules/stammdaten/index.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { Status } from "./Status.tsx";

/**
 * Bestätigung der USt-IdNr. beim BZSt am Kontakt (#1385): letzte Antwort zur aktuellen Nummer mit Vergleich von Name und
 * Anschrift, Knopf und alle bisherigen Antworten, auch zu früheren Nummern. nachSpeichern fragt einmal nach dem Speichern
 * des Kontakts, wenn der Server es für fällig hält.
 */

type Props = {
  contactId: string;
  /** Aktuelle USt-IdNr. des Kontakts */
  ustId: string;
  bestaetigungen: UstIdBestaetigung[];
  zustand: UstIdBestaetigungsZustand;
  nachSpeichern: boolean;
  onNachSpeichernErledigt: () => void;
};

const ANGABEN = [
  ["Name", "ergFirmenname"],
  ["Straße", "ergStrasse"],
  ["PLZ", "ergPlz"],
  ["Ort", "ergOrt"],
] as const;

const VERGLEICH_TON = { A: "ok", B: "warn", C: "neutral", D: "neutral" } as const;

function Antwort({ b }: { b: UstIdBestaetigung }) {
  const gueltig = evatrGueltig(b.status);
  return (
    <Status tone={gueltig ? "ok" : "warn"} emphasis={gueltig ? undefined : "notice"} inline edge detail={`am ${formatDateTime(b.anfrageZeitpunkt)}`}>
      {evatrWort(b.status)}
    </Status>
  );
}

export function UstIdBestaetigungCard({ contactId, ustId, bestaetigungen, zustand, nachSpeichern, onNachSpeichernErledigt }: Props) {
  const router = useRouter();
  const bestaetige = useServerFn(bestaetigeUstIdFn);
  const { busy, notice, setNotice, run } = useAction();
  const nummer = normalizeUstId(ustId);
  const letzte = bestaetigungen.find((b) => b.angefragteUstid === nummer);
  const meldung = letzte && evatrMeldung(letzte);

  async function pruefen(nurWennFaellig: boolean) {
    let ergebnis: Awaited<ReturnType<typeof bestaetige>> | undefined;
    const ok = await run(async () => {
      ergebnis = await bestaetige({ data: { contactId, nurWennFaellig } });
      // Nur die Kontaktseite; wer inzwischen woanders ist, bekommt seine Seite nicht neu geladen
      await router.invalidate({ filter: (match) => match.routeId === "/_app/kontakte/$id" });
    });
    if (!ok || !ergebnis) return;
    if (ergebnis.hinweis) setNotice({ tone: "info", text: ergebnis.hinweis });
    else if (ergebnis.neu) setNotice({ tone: "ok", text: "Antwort des BZSt gespeichert." });
  }

  // Einmal je Speichern; der Server fragt nur, wenn Nummer, Name oder Anschrift neu sind
  const gestartet = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: nur der Wechsel von nachSpeichern startet eine Abfrage
  useEffect(() => {
    if (!nachSpeichern) {
      gestartet.current = false;
      return;
    }
    if (gestartet.current) return;
    gestartet.current = true;
    void pruefen(true).finally(onNachSpeichernErledigt);
  }, [nachSpeichern]);

  return (
    <section className="card" aria-labelledby="ustid-heading">
      <h2 id="ustid-heading">Bestätigung beim BZSt</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Das BZSt bestätigt, ob die USt-IdNr. gültig ist und Name und Anschrift stimmen. Jede Antwort bleibt als Nachweis gespeichert und lässt sich nicht
        ändern.
      </p>
      <NoticeBanner notice={notice} />
      {letzte ? (
        <div className="history-row stack" style={{ alignItems: "stretch", gap: 4 }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <strong className="mono">{letzte.angefragteUstid}</strong>
            <Antwort b={letzte} />
          </div>
          {meldung !== evatrWort(letzte.status) && <span className="small muted">{meldung}</span>}
          {letzte.art === "qualifiziert" && (
            <dl className="ustid-vergleich small">
              {ANGABEN.map(([label, feld]) => {
                const wert = letzte[feld] as EvatrVergleich | null;
                return (
                  <div key={feld}>
                    <dt>{label}</dt>
                    <dd>{wert ? <Status tone={VERGLEICH_TON[wert]}>{EVATR_VERGLEICH[wert]}</Status> : "–"}</dd>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
      ) : (
        zustand.art === "bereit" && (
          <p className="small muted" style={{ margin: 0 }}>
            Noch nicht bestätigt.
          </p>
        )
      )}
      {zustand.art === "aus" && (
        <p className="small muted" style={{ margin: 0 }}>
          Die Bestätigung ist auf dieser Installation abgeschaltet.
        </p>
      )}
      {zustand.art === "ohne-eigene" && (
        <p className="small muted" style={{ margin: 0 }}>
          Für die Bestätigung braucht es deine USt-IdNr. in den{" "}
          <Link to="/einstellungen" search={{ bereich: "firma" }}>
            Firmendaten
          </Link>
          .
        </p>
      )}
      {zustand.art === "bereit" && (
        <div className="actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void pruefen(false)}>
            {busy ? "Frage beim BZSt an …" : "Beim BZSt bestätigen"}
          </button>
        </div>
      )}
      {bestaetigungen.some((b) => b !== letzte) && (
        <details className="small">
          <summary>Alle Abfragen ({bestaetigungen.length})</summary>
          {bestaetigungen.map((b) => (
            <div key={b.id} className="history-row">
              <span>
                <span className="mono">{b.angefragteUstid}</span> · {b.art === "qualifiziert" ? "mit Name und Anschrift" : "einfach"}
              </span>
              <Antwort b={b} />
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
