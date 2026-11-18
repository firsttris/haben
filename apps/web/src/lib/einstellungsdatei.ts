/** Name der Daten im ZIP der Einstellungsdatei (#488); der Server schreibt und liest sie, die Seite liest die Rückfrage daraus */
export const EINSTELLUNGEN_JSON = "einstellungen.json";

/**
 * Die Daten im ZIP: oben oder in genau einem Ordner. Den Ordner gibt es, wenn jemand das entpackte ZIP wieder packt;
 * Safari entpackt ein geladenes ZIP von sich aus, der Finder packt den Ordner mit
 */
export function istEinstellungenJson(name: string): boolean {
  const teile = name.split("/");
  return teile.at(-1) === EINSTELLUNGEN_JSON && teile.length <= 2 && teile[0] !== "__MACOSX";
}
