import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { FormEvent } from "react";
import { useAction } from "../lib/use-action.ts";
import { saveNextNumber } from "../server/functions/invoices.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { Field } from "./Field.tsx";

export interface Numbering {
  kind: "rechnung" | "angebot";
  year: number;
  running: boolean;
  last: number;
  next: string;
}

const TITLE = { rechnung: "Rechnungsnummern", angebot: "Angebotsnummern" } as const;

/** Nächste laufende Nummer eines Kreises setzen, etwa beim Umzug aus Lexoffice oder sevDesk; zurück geht nicht */
export function NumberingCard({ numbering }: { numbering: Numbering }) {
  const router = useRouter();
  const save = useServerFn(saveNextNumber);
  const { busy, notice, run } = useAction();
  const title = `${TITLE[numbering.kind]} ${numbering.running ? "(Zähler läuft weiter)" : numbering.year}`;
  const id = `numbering-${numbering.kind}`;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = Number(new FormData(event.currentTarget).get("next"));
    void run(async () => {
      await save({ data: { kind: numbering.kind, next } });
      await router.invalidate();
    }, "Nummernkreis gespeichert.");
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>{title}</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Nächste Nummer: <span className="mono">{numbering.next}</span>. Nummern werden erst beim Festschreiben vergeben und laufen lückenlos. Um nach Lexoffice
        oder sevDesk weiterzuzählen, die nächste laufende Nummer eintragen; zurücksetzen geht nicht.
      </p>
      <Field label="Nächste laufende Nummer">
        {(control) => <input {...control} name="next" type="number" min={numbering.last + 1} defaultValue={numbering.last + 1} required />}
      </Field>
      <div className="actions">
        <button type="submit" className="btn" disabled={busy}>
          Übernehmen
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}
