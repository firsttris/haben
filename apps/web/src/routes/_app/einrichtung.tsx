import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useRef, useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { BereichFragen, StartFrage, UnternehmenFragen } from "../../components/EinrichtungFragen.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { type Antworten, antwortenAus, erneutDurchgehen, mitBereich, rueckfrageAenderungen, steuerangabenNach } from "../../lib/einrichtung.ts";
import { useAction } from "../../lib/use-action.ts";
import { getEinrichtung, saveEinrichtung } from "../../server/functions/einrichtung.ts";

export const Route = createFileRoute("/_app/einrichtung")({
  // Nur der Inhaber richtet ein; die Steuerberatung leitet _app schon um, das hier hält es auch ohne fest
  beforeLoad: ({ context }) => {
    if (context.user.role !== "inhaber") throw redirect({ to: "/" });
  },
  loader: () => getEinrichtung(),
  head: () => ({ meta: [{ title: "Einrichtung · Haben" }] }),
  component: EinrichtungPage,
});

const SCHRITTE = ["Dein Unternehmen", "Start in Haben", "Bereiche"] as const;

function EinrichtungPage() {
  const { stand, locks } = Route.useLoaderData();
  // Schon einmal eingerichtet oder Firmendaten gespeichert: aus den Einstellungen gekommen, zurück dorthin
  const erneut = erneutDurchgehen(stand);
  const ziel = erneut ? ({ to: "/einstellungen", search: { bereich: "bereiche" } } as const) : ({ to: "/" } as const);
  const router = useRouter();
  const save = useServerFn(saveEinrichtung);
  const { busy, notice, setNotice, run } = useAction();
  // Nach dem Speichern mit Entwürfen, die nicht mehr zum Voranmeldungszeitraum passen: Hinweis lesen, dann „Weiter“
  const [gespeichert, setGespeichert] = useState(false);
  const [schritt, setSchritt] = useState(0);
  const [antworten, setAntworten] = useState<Antworten>(() => antwortenAus(stand));
  // Steuerberatung und Umzug stehen nirgends gespeichert; sie öffnen nur weitere Angaben
  const [steuerberatung, setSteuerberatung] = useState<boolean | null>(erneut && stand.kontenrahmen === "SKR04" ? true : null);
  const [wechsel, setWechsel] = useState<boolean | null>(null);
  const [rueckfrage, setRueckfrage] = useState(false);
  const titel = useRef<HTMLHeadingElement>(null);

  // Nach „Weiter“ und „Zurück“ steht der Fokus am Titel des Schritts, damit Screenreader den neuen Schritt vorlesen; der
  // Titel bleibt dasselbe Element, nur sein Text wechselt
  function wechseln(naechster: number) {
    setSchritt(naechster);
    titel.current?.focus();
  }

  const setzen = <K extends keyof Antworten>(key: K, wert: Antworten[K]) => setAntworten((a) => ({ ...a, [key]: wert }));
  const nachher = steuerangabenNach(stand, antworten);
  const geaendert = rueckfrageAenderungen(stand, antworten);
  const letzter = schritt === SCHRITTE.length - 1;

  function speichern() {
    void run(async () => {
      const { orphanedDrafts } = await save({ data: antworten });
      await router.invalidate();
      if (orphanedDrafts.length === 0) return router.navigate(ziel);
      setGespeichert(true);
      setNotice({
        tone: "info",
        text: `Gespeichert. Entwürfe der Voranmeldung, die nicht mehr zum Zeitraum passen und sich nicht senden lassen: ${orphanedDrafts.join(", ")}.`,
      });
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!letzter) return wechseln(schritt + 1);
    if (geaendert.length > 0) return setRueckfrage(true);
    speichern();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{erneut ? "Einstellungen" : "Willkommen"}</div>
          <h1>{erneut ? "Fragen zur Einrichtung" : "Haben einrichten"}</h1>
        </div>
      </div>
      <form className="card form-card form-narrow einrichtung" onSubmit={onSubmit} aria-labelledby="einrichtung-schritt" noValidate>
        <div className="form-card-head">
          <div className="small muted">
            Schritt {schritt + 1} von {SCHRITTE.length}
          </div>
          <h2 id="einrichtung-schritt" ref={titel} tabIndex={-1}>
            {SCHRITTE[schritt]}
          </h2>
          {schritt === 0 && (
            <p className="small muted">
              Jede Frage lässt sich überspringen; bei „Weiß ich nicht“ bleibt die bisherige Angabe, die Übersicht fragt später nach.
            </p>
          )}
        </div>
        <section className="form-section einrichtung-fragen" aria-labelledby="einrichtung-schritt">
          {schritt === 0 && (
            <UnternehmenFragen
              antworten={antworten}
              setzen={setzen}
              stand={stand}
              locks={locks}
              steuerberatung={steuerberatung}
              setSteuerberatung={setSteuerberatung}
            />
          )}
          {schritt === 1 && <StartFrage wechsel={wechsel} setWechsel={setWechsel} einzelunternehmen={nachher.rechtsform === "einzelunternehmen"} />}
          {schritt === 2 && <BereichFragen bereiche={antworten.bereiche} setzen={(id, wert) => setzen("bereiche", mitBereich(antworten.bereiche, id, wert))} />}
        </section>
        <NoticeBanner notice={notice} />
        {gespeichert ? (
          <div className="actions form-footer">
            <Link to="/umsatzsteuer" className="btn">
              Zur Umsatzsteuer
            </Link>
            <Link {...ziel} className="btn btn-primary">
              Weiter
            </Link>
          </div>
        ) : (
          <div className="actions form-footer">
            {erneut ? (
              <Link to="/einstellungen" search={{ bereich: "bereiche" }} className="btn">
                Abbrechen
              </Link>
            ) : (
              <Link to="/" className="btn">
                Später
              </Link>
            )}
            {schritt > 0 && (
              <button type="button" className="btn" onClick={() => wechseln(schritt - 1)} disabled={busy}>
                Zurück
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {letzter ? "Fertig" : "Weiter"}
            </button>
          </div>
        )}
      </form>
      <ConfirmDialog
        open={rueckfrage}
        title="Angaben zur Firma ändern?"
        confirmLabel="Ändern"
        facts={geaendert.map((a) => ({ label: a.feld, value: `${a.nach} (bisher ${a.von})` }))}
        onConfirm={speichern}
        onClose={() => setRueckfrage(false)}
      >
        <p>
          Diese Angaben entscheiden über Voranmeldung, EÜR oder Bilanz und Gewerbesteuer. Haben prüft sie wie in den Firmendaten; nach Buchungen im Jahr lässt
          sich manches erst zum Jahreswechsel ändern.
        </p>
      </ConfirmDialog>
    </>
  );
}
