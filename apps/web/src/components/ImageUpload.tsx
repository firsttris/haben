import type { ChangeEvent } from "react";
import { useAction } from "../lib/use-action.ts";
import { useLoadedState } from "../lib/use-loaded-state.ts";
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

export interface ImageUploadTexts {
  /** Nomen für „Noch kein …“, Alternativtext und Beschriftung, z. B. „Logo“ */
  name: string;
  empty: string;
  alt: string;
  fileLabel: string;
  upload: string;
  replace: string;
  saved: string;
  removed: string;
  tooBig: string;
}

/** Bild hochladen oder entfernen; wird sofort gespeichert. Der Loader bleibt außen, damit das Feld auch im Belegeditor passt */
export function ImageUpload({
  sha256,
  url,
  maxBytes,
  texts,
  upload,
  remove,
  load,
  onChanged,
}: {
  sha256: string | null;
  url: string;
  maxBytes: number;
  texts: ImageUploadTexts;
  upload: (input: { data: { base64: string } }) => Promise<unknown>;
  remove: () => Promise<unknown>;
  load: () => Promise<{ sha256: string } | null>;
  onChanged?: (sha256: string | null) => unknown;
}) {
  const [current, setCurrent] = useLoadedState(sha256);
  const { busy, notice, run } = useAction();

  // Erst melden, dann zeigen: So ist der Loader frisch, sobald das Bild dasteht
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
      if (file.size > maxBytes) throw new Error(texts.tooBig);
      await upload({ data: { base64: await readBase64(file) } });
    }, texts.saved);
  }

  return (
    <div className="logo-upload">
      {current ? <img src={`${url}?v=${current.slice(0, 12)}`} alt={texts.alt} /> : <p className="small">{texts.empty}</p>}
      <div className="actions">
        <label className="btn" style={{ cursor: busy ? "default" : "pointer" }}>
          {current ? texts.replace : texts.upload}
          <input type="file" accept="image/png,image/jpeg" onChange={onFile} disabled={busy} className="visually-hidden" aria-label={texts.fileLabel} />
        </label>
        {current && (
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void change(remove, texts.removed)}>
            Entfernen
          </button>
        )}
      </div>
      <NoticeBanner notice={notice} />
    </div>
  );
}
