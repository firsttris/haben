import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { ChangeEvent } from "react";
import { formatDateTime } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import { deleteLogo, uploadLogo, type getLogo } from "../server/functions/logo.ts";

type Info = Awaited<ReturnType<typeof getLogo>>;

/** Datei als Base64 ohne data:-Präfix */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(new Error("Die Datei ließ sich nicht lesen."));
    reader.readAsDataURL(file);
  });
}

/** Logo für den Briefkopf von Rechnungen, Angeboten und Mahnungen */
export function LogoCard({ info }: { info: Info }) {
  const router = useRouter();
  const upload = useServerFn(uploadLogo);
  const remove = useServerFn(deleteLogo);
  const action = useAction();
  const { busy, notice } = action;

  const run = (work: () => Promise<string>) =>
    action.run(async () => {
      const text = await work();
      await router.invalidate();
      action.setNotice({ tone: "ok", text });
    });

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void run(async () => {
      if (file.size > 1024 * 1024) throw new Error("Das Logo darf höchstens 1 MB groß sein.");
      await upload({ data: { base64: await readBase64(file) } });
      return "Logo gespeichert. Es steht auf allen Rechnungen, Angeboten und Mahnungen, die ab jetzt festgeschrieben werden.";
    });
  }

  return (
    <section className="card" aria-labelledby="logo-heading">
      <h2 id="logo-heading">Logo</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Erscheint oben rechts im Briefkopf, höchstens 18 mm hoch und 60 mm breit. PNG (gern mit transparentem Hintergrund) oder JPEG, bis 1 MB.
        Schon festgeschriebene Belege behalten ihr PDF.
      </p>
      {info ? (
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <img
            src={`/api/logo?v=${info.sha256.slice(0, 12)}`}
            alt="Aktuelles Logo"
            style={{ maxHeight: 64, maxWidth: 220, objectFit: "contain", background: "#fff", padding: 6, border: "1px solid var(--line)", borderRadius: 6 }}
          />
          <span className="small muted">
            {info.format.toUpperCase()} · seit {formatDateTime(info.createdAt)}
          </span>
        </div>
      ) : (
        <p className="small" style={{ margin: 0 }}>
          Noch kein Logo.
        </p>
      )}
      <div className="actions" style={{ flexWrap: "wrap" }}>
        <label className="btn" style={{ cursor: busy ? "default" : "pointer" }}>
          {info ? "Anderes Logo wählen" : "Logo hochladen"}
          <input type="file" accept="image/png,image/jpeg" onChange={onFile} disabled={busy} className="visually-hidden" aria-label="Logodatei" />
        </label>
        {info && (
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void run(async () => (await remove(), "Logo entfernt."))}>
            Entfernen
          </button>
        )}
      </div>
      <NoticeBanner notice={notice} />
    </section>
  );
}
