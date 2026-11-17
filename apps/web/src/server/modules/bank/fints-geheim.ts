import type { FintsBankdaten } from "@haben/import";
import { decrypt, encrypt } from "../../crypto.ts";

/*
 * Was von einem FinTS-Zugang verschlüsselt in fints_connections.ciphertext steht (#654): die PIN und die Bankdaten (BPD,
 * UPD, Kundensystem-ID). Die Bankdaten ändern sich kaum, gehen aber mit jeder Antwort der Bank zurück in die Zeile; als
 * eigene Spalte stünden sie bei jedem Abruf alt und neu im Audit-Log, mit allen Konten samt Inhabern und Limits.
 * ciphertext lässt haben_audit aus.
 */

export interface FintsGeheimnis {
  pin: string;
  bankdaten: FintsBankdaten;
}

export function fintsGeheimnisVerschluesseln(geheimnis: FintsGeheimnis): Buffer {
  return encrypt(Buffer.from(JSON.stringify(geheimnis), "utf8"));
}

export function fintsGeheimnisLesen(ciphertext: Buffer): FintsGeheimnis {
  return JSON.parse(decrypt(ciphertext).toString("utf8")) as FintsGeheimnis;
}
