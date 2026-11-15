import { installedEricVersion } from "@haben/elster";
import pkg from "../../../../../../package.json" with { type: "json" };
import { formatSize } from "../../../lib/format.ts";
import { env } from "../../env.ts";
import { type BackupOverview, backupOverview } from "../archiv/index.ts";
import { ericHome } from "../elster/index.ts";
import { datenbankBytes, verzeichnisBytes } from "./speicher.ts";

/**
 * Stand einer Instanz für Betreiber: Version, ERiC, letzte Sicherung und Speicher. `haben status --json` gibt ihn aus; das
 * Werkzeug für mehrere Instanzen (deploy/instanzen) liest ihn über `docker compose exec -T app`, statt Pfade und
 * Tabellen der App selbst zu kennen.
 */
export interface BetriebsStatus {
  /** Format dieser Ausgabe; steigt, wenn ein Feld entfällt oder seine Bedeutung ändert. Neue Felder zählen nicht */
  schema: 1;
  /** Version aus der package.json im Wurzelverzeichnis */
  version: string;
  /** Commit, aus dem das Image gebaut ist (Build-Argument HABEN_COMMIT); null ohne Angabe beim Bauen */
  commit: string | null;
  eric: {
    /** env: von Hand eingebunden (ERIC_HOME), download: von Haben heruntergeladen, null: kein ERiC */
    source: "env" | "download" | null;
    /** Von Haben installierte Version; null ohne ERiC oder bei einem von Hand entpackten Paket */
    version: string | null;
  };
  backup: {
    state: BackupOverview["state"];
    overdue: boolean;
    /** Zeitpunkt des letzten erfolgreichen Backups (ISO 8601) */
    lastBackup: string | null;
    /** Der letzte fehlgeschlagene Lauf je Art, wenn er der jüngste seiner Art ist */
    failed: { kind: string; at: string }[];
  };
  /** Belegter Platz in Bytes, etwa um Platte und Tarife zu planen (#951) */
  speicher: {
    /** pg_database_size der Datenbank der App */
    datenbankBytes: number;
    /** Summe der Dateien unter DOCUMENTS_DIR: Belege, Vorlagen und ihre Pakete */
    belegeBytes: number;
  };
  /** Kurzfassung für Menschen; das Werkzeug zeigt sie in seiner Tabelle, ohne die Regeln dahinter zu kennen */
  summary: { eric: string; backup: string; speicher: string };
}

export interface BetriebsStatusOptions {
  now?: Date;
  /** ERIC_HOME oder das heruntergeladene ERiC; null ohne ERiC */
  ericHome?: string | null;
  /** ERiC über ERIC_HOME eingebunden statt heruntergeladen */
  ericFromEnv?: boolean;
  /** Commit des Builds; ohne Angabe aus HABEN_COMMIT */
  commit?: string | null;
  /** Verzeichnis der Belege; ohne Angabe DOCUMENTS_DIR */
  belegeVerzeichnis?: string;
}

export async function betriebsStatus(options: BetriebsStatusOptions = {}): Promise<BetriebsStatus> {
  const home = options.ericHome !== undefined ? options.ericHome : (ericHome() ?? null);
  const fromEnv = options.ericFromEnv ?? Boolean(env().ERIC_HOME?.trim());
  const commit = options.commit !== undefined ? options.commit : env().HABEN_COMMIT?.trim() || null;
  const overview = await backupOverview(options.now);
  const eric: BetriebsStatus["eric"] = {
    source: home ? (fromEnv ? "env" : "download") : null,
    version: home ? await installedEricVersion(home) : null,
  };
  const backup: BetriebsStatus["backup"] = {
    state: overview.state,
    overdue: overview.overdue,
    lastBackup: overview.lastBackup?.at.toISOString() ?? null,
    failed: overview.failed.map(({ kind, run }) => ({ kind, at: run.at.toISOString() })),
  };
  const [datenbank, belege] = await Promise.all([datenbankBytes(), verzeichnisBytes(options.belegeVerzeichnis ?? env().DOCUMENTS_DIR)]);
  const speicher: BetriebsStatus["speicher"] = { datenbankBytes: datenbank, belegeBytes: belege };
  return {
    schema: 1,
    version: pkg.version,
    commit,
    eric,
    backup,
    speicher,
    summary: { eric: ericKurz(eric), backup: sicherungKurz(backup), speicher: speicherKurz(speicher) },
  };
}

/** Speicher kurz, in KB, MB oder GB wie die Dateigrößen in der App */
function speicherKurz(speicher: BetriebsStatus["speicher"]): string {
  return `Datenbank ${formatSize(speicher.datenbankBytes)}, Belege ${formatSize(speicher.belegeBytes)}`;
}

const BERLIN = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** Zeitpunkt als „2026-11-10 03:15“ in deutscher Zeit, wie das Backup ihn plant (BACKUP_TIME) */
function berlinerZeit(iso: string): string {
  return BERLIN.format(new Date(iso));
}

/** ERiC kurz: Version, „von Hand“ (ERIC_HOME ohne Versionsdatei) oder „fehlt“ */
function ericKurz(eric: BetriebsStatus["eric"]): string {
  if (eric.version) return eric.version;
  return eric.source ? "von Hand" : "fehlt";
}

/**
 * Letzte Sicherung kurz: Zeitpunkt oder „keine“, dazu ein Fehlschlag oder ein veralteter Stand. Ein fehlgeschlagener
 * Test-Restore nach gelungenem Backup heißt auch so, sonst läse man ihn als fehlgeschlagenes Backup.
 */
function sicherungKurz(backup: BetriebsStatus["backup"]): string {
  const zeit = backup.lastBackup ? berlinerZeit(backup.lastBackup) : "keine";
  if (backup.state === "fehler") return `${zeit} (${backup.failed.some((f) => f.kind === "backup") ? "letztes Backup" : "Test-Restore"} fehlgeschlagen)`;
  if (backup.state === "veraltet") return `${zeit} (veraltet)`;
  return zeit;
}

/** Für Menschen: je Zeile ein Wert */
export function statusAlsText(status: BetriebsStatus): string {
  const version = status.commit ? `${status.version} (${status.commit.slice(0, 7)})` : status.version;
  return [
    `Version:          ${version}`,
    `ERiC:             ${status.summary.eric}`,
    `Letzte Sicherung: ${status.summary.backup}`,
    `Speicher:         ${status.summary.speicher}`,
  ].join("\n");
}
