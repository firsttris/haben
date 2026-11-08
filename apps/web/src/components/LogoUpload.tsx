import { useServerFn } from "@tanstack/react-start";
import type { ChangeEvent } from "react";
import { useAction } from "../lib/use-action.ts";
import { useLoadedState } from "../lib/use-loaded-state.ts";
import { deleteLogo, getLogo, uploadLogo } from "../server/functions/logo.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";

/** Datei als Base64 ohne data:-Präfix */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error("Die Datei ließ sich nicht lesen."));
    reader.readAsDataURL(file);
  });
}

/** Logo hochladen oder entfernen, in den Einstellungen und im Panel der Vorschau; wird sofort gespeichert */
export function LogoUpload({ sha256, onChanged }: { sha256: string | null; onChanged?: (sha256: string | null) => unknown }) {
  const upload = useServerFn(uploadLogo);
  const remove = useServerFn(deleteLogo);
  const load = useServerFn(getLogo);
  const [current, setCurrent] = useLoadedState(sha256);
  const { busy, notice, run } = useAction();

  // Ohne router.invalidate: Im Belegeditor bleibt das Formular so unberührt
  const change = (work: () => Promise<unknown>, text: string) =>
    run(async () => {
      await work();
      const info = await load();
      await onChanged?.(info?.sha256 ?? null);
      setCurrent(info?.sha256 ?? null);
    }, text);

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void change(async () => {
      if (file.size > 1024 * 1024) throw new Error("Das Logo darf höchstens 1 MB groß sein.");
      await upload({ data: { base64: await readBase64(file) } });
    }, "Logo gespeichert. Es gilt für alles, was ab jetzt erzeugt wird.");
  }

  return (
    <div className="logo-upload">
      {current ? <img src={`/api/logo?v=${current.slice(0, 12)}`} alt="Aktuelles Logo" /> : <p className="small">Noch kein Logo.</p>}
      <div className="actions">
        <label className="btn" style={{ cursor: busy ? "default" : "pointer" }}>
          {current ? "Anderes Logo wählen" : "Logo hochladen"}
          <input type="file" accept="image/png,image/jpeg" onChange={onFile} disabled={busy} className="visually-hidden" aria-label="Logodatei" />
        </label>
        {current && (
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void change(() => remove(), "Logo entfernt.")}>
            Entfernen
          </button>
        )}
      </div>
      <NoticeBanner notice={notice} />
    </div>
  );
}
