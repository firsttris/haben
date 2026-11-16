import { formatPruefwert } from "../pruefwert.ts";
import { abschnitt, type VerfahrensdokuAbschnitt } from "./modell.ts";

/**
 * Textbausteine für das, was dieses Paket selbst leistet: Audit-Log als Hash-Kette, Siegel, Sperren und Prüfung in
 * Postgres (sql/vorlage.ts), Prüfwert (pruefwert.ts) und Dateispeicher (dateispeicher.ts). Sie stehen nur für Zusagen,
 * die der Code des Pakets einhält; was eine App darüber hinaus tut, beschreibt sie selbst.
 *
 * Quelle: GoBD, BMF-Schreiben vom 28.11.2019, Rz. 58 f. und 107 bis 112 (Unveränderbarkeit, Protokollierung), Rz. 60
 * (Nachweis der Kontrollen), Rz. 100 und 103 (Zugriffskontrollen, Schutz gegen unberechtigte Veränderung), Rz. 110
 * (Dateisystem allein genügt nicht).
 */

export const KERN_TEXTE = {
  unveraenderbarkeit:
    "Die Unveränderbarkeit liegt in der Datenbank (PostgreSQL), nicht nur in der Anwendung: Trigger lehnen das Ändern und Löschen gesperrter Zeilen ab, ebenso das Leeren der Tabellen mit TRUNCATE. Das gilt für jeden Weg in die Datenbank, auch für einen Fehler im Programm oder SQL von Hand, solange niemand mit Rechten an der Datenbank die Trigger abschaltet (GoBD Rz. 108 und 110).",
  auditLog:
    "Jede Änderung an einer protokollierten Tabelle schreibt ein Trigger in das Änderungsprotokoll (Audit-Log): Tabelle, Zeile, Art der Änderung, alter und neuer Inhalt, Zeitpunkt und den Akteur, den die Anwendung für die Transaktion setzt. Spalten, die die Anwendung dabei ausnimmt (etwa verschlüsselte Geheimnisse), lässt er aus. Das Protokoll lässt sich nur ergänzen; Ändern, Löschen und Leeren lehnt die Datenbank ab (Rz. 59 und 111).",
  hashKette:
    "Jeder Eintrag im Protokoll trägt eine fortlaufende Nummer und den SHA-256 aus dem Hash seines Vorgängers und seinem eigenen Inhalt (Hash-Kette). Nummer und Hash des letzten Eintrags hält der Kopf der Kette, den nur das Protokoll selbst fortschreibt.",
  siegel:
    "Wird eine Zeile einer versiegelten Tabelle festgeschrieben, bei manchen Tabellen schon beim Einfügen, legt ein Trigger ein Siegel an: den SHA-256 über ihren Inhalt. Ab dann lehnt die Datenbank jede Änderung und das Löschen der Zeile ab. Siegel lassen sich nur ergänzen und stehen selbst im Protokoll (Rz. 58 und 107 bis 110).",
  korrektur: "Eine Korrektur ist deshalb ein neuer Datensatz; der ursprüngliche Inhalt und die Tatsache der Korrektur bleiben erkennbar (Rz. 111).",
  pruefung:
    "Die Prüfung rechnet die Kette Eintrag für Eintrag nach, vergleicht den Kopf mit dem letzten Eintrag und jedes Siegel mit dem heutigen Inhalt seiner Zeile; sie meldet Lücken in der Nummerierung, falsche Verweise auf den Vorgänger und abweichende Inhalte. Die Kette verhindert keine Änderung durch jemanden, der die Datenbank selbst verändern kann; sie macht sie sichtbar (Rz. 60).",
  pruefwert:
    "Der Prüfwert ist Nummer und Hash des letzten Eintrags im Protokoll. Außerhalb des Servers aufbewahrt zeigt er später, ob das Protokoll bis zu diesem Eintrag nachträglich verändert wurde.",
  dateien:
    "Dateien liegen unter ihrem SHA-256, werden vollständig oder gar nicht geschrieben und beim Lesen gegen den Hash geprüft; eine Prüfung aller Dateien meldet fehlende und veränderte. Weil das Dateisystem allein keine Unveränderbarkeit gewährleistet (Rz. 110), steht der Hash im Datensatz in der Datenbank; eine geänderte Datei fällt beim Lesen und bei der Prüfung auf.",
} as const;

/** Wirksame Rechte der Datenbankanmeldung, mit der die Anwendung arbeitet, wie die App sie aus der Datenbank liest */
export interface DatenbankZugriff {
  anmeldung: string;
  /**
   * Die App hat ihre wirksamen Rechte geprüft und keine gefunden, mit denen sie Sperren, Protokoll oder Trigger umgehen
   * könnte: kein Eigentum an Tabellen, keine Superuser- oder Rollenrechte, kein Anlegen von Objekten oder Triggern, kein
   * Setzen von session_replication_role. datenbankRollenText sagt genau das zu; true nur, wenn die Prüfung das abdeckt.
   */
  eingeschraenkt: boolean;
  /** Was die Prüfung der Rechte gefunden hat, je ein Satz */
  probleme: string[];
}

export function datenbankRollenText(zugriff: DatenbankZugriff): string {
  if (zugriff.eingeschraenkt)
    return `Die Anwendung meldet sich bei der Datenbank als „${zugriff.anmeldung}“ an. Die Prüfung ihrer wirksamen Rechte fand keine, mit denen sie Sperren und Protokoll umgehen könnte: kein Eigentum an Tabellen, keine Superuser- oder Rollenrechte, kein Anlegen von Triggern oder anderen Objekten und kein Umschalten des Replikationsmodus. Tabellen und Trigger gehören einer anderen Rolle, mit der nur die Migrationen laufen (Rz. 100 und 103).`;
  return `Die Anwendung meldet sich bei der Datenbank als „${zugriff.anmeldung}“ an, mit mehr Rechten als nötig: ${zugriff.probleme.join(" ")} Die Sperren gelten für jede Änderung, die die Anwendung macht; mit diesen Rechten ließen sie sich aber abschalten. Getrennte Datenbankrollen für Anwendung und Migrationen sind noch einzurichten (Rz. 100 und 103).`;
}

export interface KernStand {
  /** Was die App versiegelt, in Worten, etwa „festgeschriebene Rechnungen“ */
  versiegelt: string[];
  /** Kopf der Kette bei Erstellung des Dokuments */
  pruefwert?: { seq: number; hash: string } | null;
  /** Zahl der Befunde der letzten Prüfung von Kette, Kopf und Siegeln; null, wenn keine gelaufen ist */
  befunde?: number | null;
  /** Die App speichert Dateien mit dem Dateispeicher des Pakets */
  dateien?: boolean;
  zugriff?: DatenbankZugriff | null;
}

/** Abschnitt zur Unveränderbarkeit aus den Textbausteinen und dem Stand der Instanz */
export function kernAbschnitt(titel: string, stand: KernStand): VerfahrensdokuAbschnitt {
  const pruefwert = stand.pruefwert ? `${KERN_TEXTE.pruefwert} Bei Erstellung dieses Dokuments: ${formatPruefwert(stand.pruefwert)}.` : KERN_TEXTE.pruefwert;
  const befunde =
    stand.befunde === undefined || stand.befunde === null
      ? ""
      : stand.befunde === 0
        ? "Die letzte Prüfung von Kette, Kopf und Siegeln fand keine Befunde."
        : `Die letzte Prüfung von Kette, Kopf und Siegeln fand ${stand.befunde === 1 ? "einen Befund" : `${stand.befunde} Befunde`}.`;
  return abschnitt(titel, {
    absaetze: [
      KERN_TEXTE.unveraenderbarkeit,
      KERN_TEXTE.auditLog,
      KERN_TEXTE.hashKette,
      `${KERN_TEXTE.siegel} ${KERN_TEXTE.korrektur}`,
      stand.zugriff ? datenbankRollenText(stand.zugriff) : "",
      stand.dateien ? KERN_TEXTE.dateien : "",
      KERN_TEXTE.pruefung,
      befunde,
      pruefwert,
    ],
    liste: stand.versiegelt.map((was) => `Versiegelt: ${was}`),
  });
}
