import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useRef, useState } from "react";
import { formatDate, formatSize } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { vermerkenFn, zuruecknehmenFn } from "../../server/functions/sv-meldungen.ts";
import { NoticeBanner } from "../NoticeBanner.tsx";
import { Field } from "../Field.tsx";
import { FilePicker } from "../FilePicker.tsx";

export interface VermerkStandDaten {
  vermerke: { id: string; datum: string; notiz: string; protokollDateiname: string | null; protokollGroesse: number | null; geaendert: boolean }[];
  zurueckgenommen: { id: string; datum: string; grund: string; abgegebenAm: string }[];
  abgegeben: boolean;
  geaendert: boolean;
}

/**
 * Vermerk „im Portal abgegeben“ zu einem Beitragsnachweis oder einer Meldung: Tag, optional das Protokoll des Portals
 * und eine Notiz. Ein Vermerk lässt sich nur zurücknehmen, nicht löschen.
 */
export function Vermerk({ gegenstand, titel, stand, heute }: { gegenstand: string; titel: string; stand: VermerkStandDaten; heute: string }) {
  const router = useRouter();
  const vermerken = useServerFn(vermerkenFn);
  const { busy, notice, run } = useAction();
  const [datum, setDatum] = useState(heute);
  const [notiz, setNotiz] = useState("");
  const datei = useRef<HTMLInputElement>(null);
  // Ein neuer key leert das Feld samt angezeigtem Dateinamen
  const [vermerkt, setVermerkt] = useState(0);

  function absenden(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const form = new FormData();
      form.append("gegenstand", gegenstand);
      form.append("datum", datum);
      form.append("notiz", notiz);
      const file = datei.current?.files?.[0];
      if (file) form.append("protokoll", file);
      await vermerken({ data: form });
      setNotiz("");
      setVermerkt((n) => n + 1);
      await router.invalidate();
    }, "Vermerkt: im Portal abgegeben.");
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      {stand.vermerke.map((v) => (
        <VermerkZeile key={v.id} v={v} titel={titel} />
      ))}
      {stand.zurueckgenommen.map((z) => (
        <p key={z.id} className="small muted" style={{ margin: 0 }}>
          Vermerk vom {formatDate(z.abgegebenAm)} am {formatDate(z.datum)} zurückgenommen: {z.grund}
        </p>
      ))}
      {stand.geaendert && (
        <div className="banner banner-danger" role="note">
          Die Liste hat sich seit dem Vermerk geändert, etwa durch ein Storno. Im Portal korrigieren und danach neu vermerken.
        </div>
      )}
      <form className="actions" style={{ alignItems: "end", flexWrap: "wrap" }} onSubmit={absenden} aria-label={`Abgabe vermerken: ${titel}`}>
        <Field label="Abgegeben am">
          {(control) => <input {...control} type="date" value={datum} max={heute} onChange={(e) => setDatum(e.target.value)} required />}
        </Field>
        <Field label="Protokoll (PDF oder Bild, optional)">
          {(control) => <FilePicker key={vermerkt} {...control} inputRef={datei} accept="application/pdf,image/png,image/jpeg" />}
        </Field>
        <Field label="Notiz (optional)">
          {(control) => <input {...control} type="text" value={notiz} maxLength={500} onChange={(e) => setNotiz(e.target.value)} />}
        </Field>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {stand.abgegeben ? "Erneut abgegeben" : "Im Portal abgegeben"}
        </button>
      </form>
      <NoticeBanner notice={notice} />
    </div>
  );
}

function VermerkZeile({ v, titel }: { v: VermerkStandDaten["vermerke"][number]; titel: string }) {
  const router = useRouter();
  const zuruecknehmen = useServerFn(zuruecknehmenFn);
  const { busy, notice, run } = useAction();
  const [grund, setGrund] = useState("");

  function absenden(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await zuruecknehmen({ data: { id: v.id, grund } });
      await router.invalidate();
    });
  }

  return (
    <div className="stack" style={{ gap: 4 }}>
      <p style={{ margin: 0 }}>
        <span className="pill pill-ok">im Portal abgegeben</span> am {formatDate(v.datum)}
        {v.notiz && <span className="muted"> · {v.notiz}</span>}
        {v.protokollDateiname && (
          <>
            {" · "}
            <a href={`/api/sv-protokoll/${v.id}`} target="_blank" rel="noreferrer">
              Protokoll {v.protokollDateiname}
            </a>
            {v.protokollGroesse !== null && <span className="small muted"> ({formatSize(v.protokollGroesse)})</span>}
          </>
        )}
      </p>
      <details>
        <summary className="small">Vermerk zurücknehmen</summary>
        <form className="actions" style={{ alignItems: "end" }} onSubmit={absenden} aria-label={`Vermerk zurücknehmen: ${titel}`}>
          <Field label="Grund">
            {(control) => <input {...control} type="text" value={grund} maxLength={500} onChange={(e) => setGrund(e.target.value)} required />}
          </Field>
          <button type="submit" className="btn" disabled={busy}>
            Zurücknehmen
          </button>
        </form>
        <NoticeBanner notice={notice} />
      </details>
    </div>
  );
}
