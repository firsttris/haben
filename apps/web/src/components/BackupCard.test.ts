import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BackupCard } from "./BackupCard.tsx";

type Status = Parameters<typeof BackupCard>[0]["status"];

const at = new Date("2026-11-17T03:00:00Z");
const ok: Status = {
  state: "ok",
  overdue: false,
  lastBackup: { at, ok: true, snapshot: "4f2a9c1e", bytes: 48234496, message: "" },
  lastCheck: null,
  failed: [],
  target: null,
};

const render = (status: Status) => renderToStaticMarkup(createElement(BackupCard, { status }));

describe("BackupCard: Speicherort (#1331)", () => {
  it("lokales Verzeichnis mit Hinweis auf ein zweites System", () => {
    const html = render({ ...ok, target: { repository: "/backups", local: true } });
    expect(html).toContain("Speicherort");
    expect(html).toContain('Lokal · <span class="mono">/backups</span>');
    expect(html).toContain('href="https://haben.app/installation-backup.html#repository-auf-einem-zweiten-system"');
  });

  it("entferntes Repository ohne Hinweis", () => {
    const html = render({ ...ok, target: { repository: "sftp:backup.example:/srv/restic/haben", local: false } });
    expect(html).toContain('Extern · <span class="mono">sftp:backup.example:/srv/restic/haben</span>');
    expect(html).not.toContain("Zweites System einrichten");
  });

  // Bis zum ersten Lauf nach dem Update mit der Spalte target ist auch ein aktuelles Backup-Image noch ohne Ziel
  it("ohne eingetragenes Ziel: unbekannt bis zum nächsten Backup", () => {
    expect(render(ok)).toContain("Unbekannt: Das nächste Backup mit aktuellem Backup-Image trägt ihn ein");
  });

  it("ohne jeden Lauf keine Zeile Speicherort", () => {
    expect(render({ ...ok, state: "keins", lastBackup: null })).not.toContain("Speicherort");
  });
});
