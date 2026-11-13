import { ohneCode } from "./regel.ts";

/*
 * Regeln zum Übernehmen und Freigeben von Karten, ohne Zugriff auf GitHub. Der Ablauf steht in
 * docs/mitwirken.md unter „Etwas übernehmen“: `/übernehmen` im Issue weist es zu, `/freigeben` gibt es zurück,
 * nach 14 Tagen ohne Lebenszeichen kommt eine Erinnerung, nach sieben weiteren die Freigabe.
 */

export const TAGE_BIS_ERINNERUNG = 14;
export const TAGE_BIS_FREIGABE = 7;
/** Unsichtbare Marke im Kommentar der Erinnerung, damit der nächste Lauf sie wiederfindet */
export const MARKE_ERINNERUNG = "<!-- board:erinnerung -->";

const BOARD = "[Board](https://github.com/users/firsttris/projects/2)";
const ANLEITUNG = "[Etwas übernehmen](https://haben.app/mitwirken.html#etwas-übernehmen)";
const TAG = 24 * 60 * 60 * 1000;

export type Befehl = "übernehmen" | "freigeben";

/** Befehl in einem Kommentar: eine eigene Zeile, die mit `/übernehmen` (auch `/uebernehmen`) oder `/freigeben` beginnt */
export function befehl(text: string): Befehl | null {
  for (const zeile of ohneCode(text).split("\n")) {
    const wort = zeile.trim().split(/\s+/)[0]?.toLowerCase();
    if (wort === "/übernehmen" || wort === "/uebernehmen") return "übernehmen";
    if (wort === "/freigeben") return "freigeben";
  }
  return null;
}

export type Lage = {
  person: string;
  offen: boolean;
  /** Spalte der Karte im Board, null ohne Karte */
  status: string | null;
  zugewiesen: string[];
};

export type Entscheidung = { art: "zuweisen" } | { art: "freigeben"; zurueckNachGeplant: boolean } | { art: "ablehnen"; text: string };

const erwaehnen = (namen: string[]) => namen.map((name) => `@${name}`).join(", ");

export function entscheiden(was: Befehl, lage: Lage): Entscheidung {
  const { person, zugewiesen } = lage;
  const ablehnen = (text: string): Entscheidung => ({ art: "ablehnen", text: `@${person} ${text}` });
  if (!lage.offen) return ablehnen("das Issue ist geschlossen.");
  if (was === "freigeben") {
    if (!zugewiesen.includes(person)) return ablehnen("das Issue ist dir nicht zugewiesen, es gibt nichts freizugeben.");
    const bleibt = zugewiesen.filter((name) => name !== person);
    return { art: "freigeben", zurueckNachGeplant: bleibt.length === 0 && lage.status === "In Arbeit" };
  }
  if (zugewiesen.includes(person)) return ablehnen("das Issue ist dir schon zugewiesen.");
  if (zugewiesen.length > 0) return ablehnen(`das Issue ist schon vergeben an ${erwaehnen(zugewiesen)}. Frag gern dort nach, ob ihr es teilen könnt.`);
  if (lage.status === null) {
    return ablehnen(`das Issue ist noch nicht im ${BOARD} eingeordnet. Ein Maintainer schaut es sich an und meldet sich hier.`);
  }
  // „In Arbeit“ ohne Zuweisung: die Karte hat ein Pull Request mit `Refs` oder `Umgesetzt` vorgezogen, vergeben ist sie nicht
  if (lage.status !== "Geplant" && lage.status !== "Später" && lage.status !== "In Arbeit") {
    return ablehnen(`die Karte steht in „${lage.status}“ und ist damit schon umgesetzt.`);
  }
  return { art: "zuweisen" };
}

export function textZugewiesen(person: string, status: string): string {
  const spaeter = status === "Später" ? " Die Karte stand unter „Später“; klär den Umfang am besten kurz hier, bevor du viel baust." : "";
  return [
    `@${person} gehört dir! Das Issue ist dir zugewiesen, die Karte steht jetzt im ${BOARD} unter „In Arbeit“.${spaeter}`,
    "",
    `Ein kurzer Plan hier im Issue oder ein früher Entwurf als Pull Request hilft, wenn du unsicher bist, ob der Weg passt. Kommt 14 Tage nichts, fragen wir nach; aufhören geht jederzeit mit \`/freigeben\` (${ANLEITUNG}).`,
  ].join("\n");
}

export function textFreigegeben(person: string, zurueck: boolean): string {
  const karte = zurueck ? " Die Karte steht wieder unter „Geplant“, und jemand anderes kann sie mit `/übernehmen` nehmen." : "";
  return `@${person} danke, die Zuweisung ist aufgehoben.${karte}`;
}

export function textErinnerung(personen: string[]): string {
  return [
    MARKE_ERINNERUNG,
    `${erwaehnen(personen)} hier gab es seit ${TAGE_BIS_ERINNERUNG} Tagen weder einen Pull Request noch einen Kommentar. Bist du noch dran? Ein kurzes Lebenszeichen reicht.`,
    "",
    `Kommt in ${TAGE_BIS_FREIGABE} Tagen nichts, geben wir die Karte frei, damit jemand anderes sie nehmen kann. Aufhören geht jederzeit mit \`/freigeben\`.`,
  ].join("\n");
}

export function textAutomatischFreigegeben(personen: string[]): string {
  return `${erwaehnen(personen)} nach der Erinnerung kam ${TAGE_BIS_FREIGABE} Tage nichts, deshalb ist die Zuweisung aufgehoben und die Karte wieder unter „Geplant“. Willst du weitermachen, nimm sie einfach wieder mit \`/übernehmen\`.`;
}

export type Verlauf = {
  /** Letzte Zuweisung an eine der zugewiesenen Personen */
  zugewiesenAm: Date;
  /** Kommentare der zugewiesenen Personen */
  kommentareAm: Date[];
  /** Letzte Erinnerung (Kommentar mit MARKE_ERINNERUNG), null ohne */
  erinnertAm: Date | null;
  /** Ein offener Pull Request verweist mit `Refs` oder `Umgesetzt` auf das Issue */
  offenerPr: boolean;
};

/**
 * Was der tägliche Lauf mit einer Zuweisung tut. Lebenszeichen sind die Zuweisung selbst und Kommentare der
 * zugewiesenen Personen; ein offener Pull Request ist Arbeit, darum kümmert sich das Review.
 */
export function faellig(verlauf: Verlauf, jetzt: Date): "erinnern" | "freigeben" | null {
  if (verlauf.offenerPr) return null;
  const zuletzt = Math.max(verlauf.zugewiesenAm.getTime(), ...verlauf.kommentareAm.map((datum) => datum.getTime()));
  const erinnert = verlauf.erinnertAm?.getTime() ?? null;
  if (erinnert !== null && erinnert > zuletzt) {
    return jetzt.getTime() - erinnert >= TAGE_BIS_FREIGABE * TAG ? "freigeben" : null;
  }
  return jetzt.getTime() - zuletzt >= TAGE_BIS_ERINNERUNG * TAG ? "erinnern" : null;
}
