import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useAction } from "../lib/use-action.ts";
import { getMeinElsterWerte } from "../server/functions/annual.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";

const DOCS = "https://firsttris.github.io/haben/elster-mit-erweiterung.html";

/**
 * Ohne eigene Hersteller-ID: die Werte der Erklärung in die Zwischenablage, für die Erweiterung, die sie in
 * Mein ELSTER einträgt. Abgeschickt wird dort, von Hand.
 */
export function MeinElsterWerte({ form, year, label, blocked }: { form: "ust" | "euer" | "est"; year: number; label: string; blocked: boolean }) {
  const load = useServerFn(getMeinElsterWerte);
  const { busy, notice, run } = useAction();
  const [copied, setCopied] = useState<number | null>(null);

  const copy = () =>
    run(async () => {
      const werte = await load({ data: { form, year } });
      await navigator.clipboard.writeText(JSON.stringify(werte));
      setCopied(werte.felder.length);
    });

  return (
    <section className="card stack" aria-label={`${label} in Mein ELSTER`} style={{ gap: 8 }}>
      <h3 style={{ margin: 0 }}>In Mein ELSTER eintragen</h3>
      <p className="small muted" style={{ margin: 0 }}>
        Ohne eigene Hersteller-ID: Werte kopieren und in der Erweiterung „Haben für Mein ELSTER“ einfügen. Sie trägt jede Seite des
        Formulars {label} {year} aus, prüfen und absenden machst du in Mein ELSTER.{" "}
        <a href={DOCS} target="_blank" rel="noreferrer">
          Anleitung
        </a>
      </p>
      <div className="actions">
        <button type="button" className="btn" onClick={() => void copy()} disabled={busy || blocked}>
          {copied === null ? "Werte für Mein ELSTER kopieren" : `${copied} Werte kopiert`}
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </section>
  );
}
