import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useAction } from "../lib/use-action.ts";
import { saveArchiveSearch } from "../server/functions/search.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";

/** Einstellung für das Durchsuchen des Umzugsarchivs in der Schnellsuche (#617) */
export function ArchiveSearchCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const save = useServerFn(saveArchiveSearch);
  const { busy, notice, run } = useAction();
  const [checked, setChecked] = useState(enabled);

  async function onToggle(next: boolean) {
    setChecked(next);
    const ok = await run(
      async () => {
        await save({ data: { enabled: next } });
        await router.invalidate();
      },
      next ? "Archivsuche eingeschaltet." : "Archivsuche ausgeschaltet.",
    );
    // Ohne Speichern bleibt der Haken, wie er war
    if (!ok) setChecked(!next);
  }

  return (
    <section className="card">
      <h2>Schnellsuche</h2>
      <p className="muted small">Legt fest, ob die Schnellsuche auch Belege und Aufträge aus dem Umzugsarchiv findet.</p>
      <label className="checkbox">
        <input type="checkbox" checked={checked} disabled={busy} onChange={(e) => void onToggle(e.target.checked)} />
        Archiv durchsuchen
      </label>
      <NoticeBanner notice={notice} />
    </section>
  );
}
