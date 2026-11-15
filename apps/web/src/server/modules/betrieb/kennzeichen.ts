import { readNavMarkLogo } from "../stammdaten/index.ts";

/*
 * `haben kennzeichen` (#1036): das Logo, das die Firma als Zeichen in der Navigation gewählt hat, als Bytes nach
 * stdout. Das Instanzen-Werkzeug holt es so über `docker compose exec -T app` ins Firmenportal; eine Route ohne
 * Anmeldung gibt es dafür nicht, das Logo kommt nur an, wer auf dem Server Docker bedienen darf.
 */

/** Was von process.stdout gebraucht wird */
export interface Ausgabe {
  isTTY?: boolean;
  write(daten: Uint8Array, fertig: (fehler?: Error | null) => void): boolean;
}

/**
 * Exit-Code: 0 Logo ausgegeben, 2 stdout ist ein Terminal (dort wären Binärdaten nur Zeichensalat), 3 kein Logo als
 * Zeichen gewählt oder keins hochgeladen. Fehler der Datenbank wirft es, die Meldung dazu macht der Befehl.
 */
export async function kennzeichenAusgeben(aus: Ausgabe, meldung: (text: string) => void): Promise<0 | 2 | 3> {
  if (aus.isTTY) {
    meldung("Das Logo sind Binärdaten; leite die Ausgabe in eine Datei um: haben kennzeichen > logo.png");
    return 2;
  }
  const logo = await readNavMarkLogo();
  if (!logo) {
    meldung("Kein Logo als Zeichen gewählt (Einstellungen › Firma › Zeichen in der Navigation).");
    return 3;
  }
  // Erst nach dem Schreiben zurück: Danach schließt der Befehl die Datenbank und endet
  await new Promise<void>((ok, fehler) => aus.write(logo.data, (e) => (e ? fehler(e) : ok())));
  return 0;
}
