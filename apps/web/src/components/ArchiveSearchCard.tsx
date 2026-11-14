import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { useAction } from "../lib/use-action.ts";
import { saveArchiveSearch } from "../server/functions/search.ts";

/** Einstellung für das Durchsuchen des Umzugsarchivs in der Schnellsuche (#617) */
export function ArchiveSearchCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const save = useServerFn(saveArchiveSearch);
  const { busy, notice, run } = useAction();
  const [checked, setChecked] = useState(enabled);

  async function onToggle(next: boolean) {
    setChecked(next);
    await run(async () => {
      await save({ data: { enabled: next } });
      await router.invalidate();
      return { ok: next ? "Archivsuche eingeschaltet." : "Archivsuche ausgeschaltet." };
    });
  }

  return (
    <section className="card">
      <h2>Schnellsuche</h2>
      <p className="muted small">Legt fest, ob die Schnellsuche auch Belege und Aufträge aus dem Umzugsarchiv findet.</p>
      <label className="check">
        <input type="checkbox" checked={checked} disabled={busy} onChange={(e) => void onToggle(e.target.checked)} />
        <span>Archiv durchsuchen</span>
      </label>
      {notice && <p className="small muted">{notice.text}</p>}
    </section>
  );
}
