/**
 * Datenmodell der Verfahrensdokumentation (GoBD, BMF-Schreiben vom 28.11.2019, Rz. 151 bis 155): ein Dokument aus
 * Abschnitten mit Absätzen, Listen und Lücken. Es ist reines JSON, damit eine Druckansicht es ohne weitere Umwandlung
 * darstellen und `alsMarkdown` es als Text ausgeben kann.
 *
 * Lücken statt Platzhalter: Fehlt eine Angabe, steht sie als Lücke im Abschnitt, und das Dokument gilt als
 * unvollständig. So entsteht kein Muster, das ausgefüllt aussieht, es aber nicht ist.
 */

export interface VerfahrensdokuAbschnitt {
  titel: string;
  absaetze: string[];
  liste?: string[];
  /** Angaben, die der Betrieb noch machen muss, als kurze Beschreibung des Fehlenden */
  luecken?: string[];
}

/**
 * Stand einer Fassung (Rz. 154: Änderungen versioniert und nachvollziehbar, eingesetzte Programmversionen): Tag der
 * Erzeugung und das Programm mit Version, aus dem sie stammt.
 */
export interface VerfahrensdokuStand {
  /** JJJJ-MM-TT */
  datum: string;
  programm: string;
  version: string;
}

export interface Verfahrensdoku {
  titel: string;
  stand: VerfahrensdokuStand;
  abschnitte: VerfahrensdokuAbschnitt[];
  /** Zahl aller Lücken; 0 heißt vollständig */
  luecken: number;
  vollstaendig: boolean;
}

/** Ein Abschnitt ohne leere Absätze, Listeneinträge und Lücken; so können Generatoren mit `bedingung ? text : ""` arbeiten */
export function abschnitt(titel: string, teile: { absaetze?: string[]; liste?: string[]; luecken?: string[] }): VerfahrensdokuAbschnitt {
  const voll = (texte?: string[]) => (texte ?? []).map((t) => t.trim()).filter(Boolean);
  const liste = voll(teile.liste);
  const luecken = voll(teile.luecken);
  return { titel, absaetze: voll(teile.absaetze), ...(liste.length ? { liste } : {}), ...(luecken.length ? { luecken } : {}) };
}

/** Setzt das Dokument zusammen und zählt die Lücken */
export function verfahrensdoku(teile: { titel: string; stand: VerfahrensdokuStand; abschnitte: VerfahrensdokuAbschnitt[] }): Verfahrensdoku {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(teile.stand.datum)) throw new Error(`Stand ohne Datum JJJJ-MM-TT: ${teile.stand.datum}`);
  const luecken = teile.abschnitte.reduce((summe, a) => summe + (a.luecken?.length ?? 0), 0);
  return { titel: teile.titel, stand: teile.stand, abschnitte: teile.abschnitte, luecken, vollstaendig: luecken === 0 };
}

/** Kalendertag in Deutschland (JJJJ-MM-TT), unabhängig von der Zeitzone des Servers */
export function tagInDeutschland(zeitpunkt: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(zeitpunkt);
}
