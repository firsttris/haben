import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useAction } from "../lib/use-action.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { stichjahrVorziehenFn, type getStichjahr } from "../server/functions/stichjahr.ts";

type Stand = Awaited<ReturnType<typeof getStichjahr>>;

/**
 * Stichjahr, ab dem Voranmeldung und EÜR aus dem Journal rechnen (#542, docs/adr/journal-als-quelle.md), mit Vorziehen auf
 * das laufende Jahr (Einstellungen › Firma)
 */
export function StichjahrCard({ stand }: { stand: Stand }) {
  const vorziehen = useServerFn(stichjahrVorziehenFn);
  const router = useRouter();
  const { busy, notice, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const spaeter = stand.stichjahr > stand.jahr;

  function onConfirm() {
    setConfirming(false);
    void run(async () => {
      await vorziehen();
      await router.invalidate();
    }, `Voranmeldung und EÜR rechnen jetzt ab ${stand.jahr} aus dem Journal.`);
  }

  return (
    <section className="card stack" aria-labelledby="stichjahr-heading">
      <h2 id="stichjahr-heading">Voranmeldung und EÜR aus dem Journal</h2>
      <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
        Ab dem Stichjahr rechnet Haben Voranmeldung und EÜR wie DATEV aus Konto und Steuerschlüssel der Buchungen im Journal; Rechnungen, Belege und Zahlungen
        sind die Gegenprobe im Abgleich. Davor rechnet Haben aus Rechnungen, Belegen und Zahlungen. Gesendete Voranmeldungen ändern sich nie.
      </p>
      <p style={{ margin: 0 }}>
        <strong>Stichjahr {stand.stichjahr}</strong>
        {spaeter ? ` · ${stand.jahr} rechnet noch aus den Nebenbüchern` : " · aus dem Journal"}
      </p>
      {spaeter && (
        <>
          <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
            Vorziehen auf {stand.jahr} geht, solange für {stand.jahr} keine Voranmeldung gesendet ist und Voranmeldungen und EÜR des Jahres aus dem Journal
            genauso herauskommen wie bisher; dann ändert der Umstieg keine Zahl. Zurück geht es nicht.
          </p>
          {stand.gruende.length > 0 && (
            <ul className="small" aria-label="Noch nicht vorziehbar" style={{ margin: 0 }}>
              {stand.gruende.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          )}
          <div className="actions">
            <button type="button" className="btn" disabled={busy || !stand.vorziehbar} onClick={() => setConfirming(true)}>
              Ab {stand.jahr} aus dem Journal
            </button>
          </div>
        </>
      )}
      <NoticeBanner notice={notice} />
      <ConfirmDialog
        open={confirming}
        title={`Stichjahr auf ${stand.jahr} vorziehen?`}
        facts={[
          { label: "Bisher", value: String(stand.stichjahr) },
          { label: "Neu", value: String(stand.jahr), strong: true },
        ]}
        confirmLabel="Vorziehen"
        onConfirm={onConfirm}
        onClose={() => setConfirming(false)}
      >
        <p>Voranmeldung und EÜR für {stand.jahr} rechnen dann aus dem Journal. Sie kommen dort genauso heraus wie bisher. Zurück geht es nicht.</p>
      </ConfirmDialog>
    </section>
  );
}
