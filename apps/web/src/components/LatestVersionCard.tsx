import { useEffect, useState } from "react";
import { isNewerVersion, releaseNotesUrl } from "../lib/release-notes.ts";
import { getLatestVersion } from "../server/functions/integrity.ts";

const DOCS = "https://haben.app/";

/** Anleitungen zum Aktualisieren je Installationsart, jeweils aus dem Abschnitt „Updates“ der Seite */
const UPDATE_GUIDES = [
  { label: "Docker Compose und Podman Quadlets", hint: "Backup, dann Images ziehen und neu starten", href: "installation-backup.html#updates" },
  {
    label: "Mehrere Instanzen mit dem Werkzeug",
    hint: "Der Befehl update sichert und aktualisiert alle der Reihe nach",
    href: "installation.html#mit-dem-werkzeug",
  },
  { label: "Coolify", hint: "Dienst neu deployen", href: "coolify.html#updates" },
  { label: "Synology", hint: "Images im Container Manager aktualisieren", href: "synology.html#updates" },
  { label: "TrueNAS SCALE", hint: "Unter Apps mit Update die Images holen", href: "truenas.html#updates" },
  { label: "Unraid", hint: "Unter Docker die drei Container aktualisieren", href: "unraid.html#updates" },
  { label: "Plesk", hint: "Backup, docker compose pull und up -d", href: "plesk.html#updates" },
  { label: "Kubernetes", hint: "image.tag anheben und helm upgrade", href: "kubernetes.html#updates" },
] as const;

/**
 * Zeigt in Einstellungen › Export die installierte und die neueste stabile Version. Die neueste lädt die Karte erst
 * nach dem Rendern vom Server; ohne Antwort (abgeschaltet, kein Internet) bleibt nur die installierte Version stehen.
 */
export function LatestVersionCard() {
  const [latest, setLatest] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    getLatestVersion()
      .then((version) => current && setLatest(version))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  const installed = __HABEN_VERSION__;
  const newer = latest !== null && isNewerVersion(latest, installed);
  return (
    <section className="card" aria-labelledby="latest-version-heading">
      <h2 id="latest-version-heading">Version</h2>
      <p style={{ margin: 0 }}>
        Installiert: <span className="mono">v{installed}</span> (
        <a href={releaseNotesUrl(installed)} target="_blank" rel="noreferrer">
          Versionshinweise
        </a>
        )
      </p>
      {latest && (
        <p style={{ margin: 0 }} role="status">
          Neueste stabile Version: <span className="mono">v{latest}</span> (
          <a href={releaseNotesUrl(latest)} target="_blank" rel="noreferrer">
            Versionshinweise
          </a>
          ){newer ? " – ein Update ist verfügbar." : ""}
        </p>
      )}
      <details>
        <summary style={{ cursor: "pointer", fontWeight: 500 }}>So aktualisierst du</summary>
        <ul className="small" style={{ margin: "10px 0 0", paddingLeft: 20 }}>
          {UPDATE_GUIDES.map((guide) => (
            <li key={guide.href}>
              <a href={DOCS + guide.href} target="_blank" rel="noreferrer">
                {guide.label}
              </a>
              <span className="muted">: {guide.hint}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
