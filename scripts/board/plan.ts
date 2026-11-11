/*
 * Plan der automatischen Board-Pflege (.github/workflows/board-pflege.yml), ohne Zugriff auf GitHub. Der Agent
 * schreibt nur einen Plan als JSON; ausgeführt wird er erst nach `/ok` des Maintainers, von plan-anwenden.ts ohne KI.
 * Die Tabelle im Issue „Board-Pflege“ entsteht aus demselben JSON, das später angewendet wird: Was der Maintainer
 * freigibt, ist genau das, was passiert.
 */

export const AUFWAND = ["S", "S–M", "M", "M–L", "L"] as const;
export const BEREICH = ["Bank und Kasse", "Belege", "Rechnungen", "Steuern", "Buchhaltung", "Lohn", "Umzug", "Oberfläche", "Plattform"] as const;
/** Spalten, in die der Plan Karten legen darf; „In Arbeit“ und weiter rechts setzt nur der Workflow „Board“ */
export const SPALTEN = ["Später", "Geplant"] as const;
const MARKE = "board-plan:";

export type Karte = {
  art: "karte";
  issue: number;
  status: (typeof SPALTEN)[number];
  /** Issue-Nummer der Karte darüber; null legt die Karte ganz nach oben */
  nach: number | null;
  aufwand: (typeof AUFWAND)[number];
  bereich: (typeof BEREICH)[number];
  hinweis: string;
  einstieg: boolean;
  kommentar: string | null;
  grund: string;
};
export type Kommentar = { art: "kommentar"; issue: number; text: string; grund: string };
export type Zuweisen = { art: "zuweisen"; issue: number; person: string; kommentar: string; grund: string };
/** Nur zur Anzeige: Entscheidungen, die der Maintainer selbst treffen muss; wird nie ausgeführt */
export type Frage = { art: "frage"; issue: number | null; text: string };
export type Schritt = Karte | Kommentar | Zuweisen | Frage;
export type Plan = { zusammenfassung: string; schritte: Schritt[] };

const istText = (wert: unknown, max: number): wert is string => typeof wert === "string" && wert.length <= max;
const istNummer = (wert: unknown): wert is number => Number.isInteger(wert) && (wert as number) > 0;
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** Prüft das JSON des Agenten; jeder Fehler nennt den Schritt */
export function pruefen(daten: unknown): { plan: Plan } | { fehler: string[] } {
  const fehler: string[] = [];
  const roh = daten as { zusammenfassung?: unknown; schritte?: unknown };
  if (!roh || typeof roh !== "object") return { fehler: ["Der Plan ist kein Objekt."] };
  if (!istText(roh.zusammenfassung, 2000)) fehler.push("„zusammenfassung“ fehlt oder ist zu lang.");
  if (!Array.isArray(roh.schritte)) return { fehler: [...fehler, "„schritte“ ist keine Liste."] };
  roh.schritte.forEach((schritt: Record<string, unknown>, i: number) => {
    const wo = `Schritt ${i + 1}`;
    const text = (feld: string, max: number) => istText(schritt[feld], max) || fehler.push(`${wo}: „${feld}“ fehlt oder ist zu lang.`);
    if (schritt.art === "frage") {
      if (schritt.issue !== null && !istNummer(schritt.issue)) fehler.push(`${wo}: „issue“ ist keine Nummer.`);
      text("text", 2000);
      return;
    }
    if (!istNummer(schritt.issue)) fehler.push(`${wo}: „issue“ ist keine Nummer.`);
    if (schritt.art === "kommentar") {
      text("text", 4000);
      text("grund", 500);
    } else if (schritt.art === "zuweisen") {
      if (typeof schritt.person !== "string" || !LOGIN.test(schritt.person)) fehler.push(`${wo}: „person“ ist kein GitHub-Login.`);
      text("kommentar", 4000);
      text("grund", 500);
    } else if (schritt.art === "karte") {
      if (!SPALTEN.includes(schritt.status as never)) fehler.push(`${wo}: „status“ muss ${SPALTEN.join(" oder ")} sein.`);
      if (schritt.nach !== null && !istNummer(schritt.nach)) fehler.push(`${wo}: „nach“ ist weder Nummer noch null.`);
      if (!AUFWAND.includes(schritt.aufwand as never)) fehler.push(`${wo}: „aufwand“ ist keiner von ${AUFWAND.join(", ")}.`);
      if (!BEREICH.includes(schritt.bereich as never)) fehler.push(`${wo}: „bereich“ ist keiner von ${BEREICH.join(", ")}.`);
      text("hinweis", 300);
      if (typeof schritt.einstieg !== "boolean") fehler.push(`${wo}: „einstieg“ ist kein Wahrheitswert.`);
      if (schritt.kommentar !== null) text("kommentar", 4000);
      text("grund", 500);
    } else {
      fehler.push(`${wo}: unbekannte Art „${String(schritt.art)}“.`);
    }
  });
  return fehler.length > 0 ? { fehler } : { plan: roh as Plan };
}

const zelle = (text: string) => text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
const zitat = (text: string) =>
  text
    .split(/\r?\n/)
    .map((zeile) => `> ${zeile}`)
    .join("\n");

/** Kommentar für das Issue „Board-Pflege“: Tabelle, Wortlaut der Kommentare, Fragen und der Plan als Anhang */
export function alsKommentar(plan: Plan, lauf: string): string {
  const nummeriert = plan.schritte.map((schritt, i) => ({ nr: i + 1, schritt }));
  const zeilen = nummeriert
    .filter(({ schritt }) => schritt.art !== "frage")
    .map(({ nr, schritt }) => {
      if (schritt.art === "karte") {
        const wo = `${schritt.status}, ${schritt.nach ? `nach #${schritt.nach}` : "ganz oben"}`;
        const felder = [schritt.aufwand, schritt.bereich, schritt.hinweis, schritt.einstieg ? "`einstieg`" : ""].filter(Boolean).join(" · ");
        return `| ${nr} | #${schritt.issue} | Karte: ${wo} | ${zelle(felder)} | ${zelle(schritt.grund)} |`;
      }
      if (schritt.art === "zuweisen") return `| ${nr} | #${schritt.issue} | zuweisen an @${schritt.person} | | ${zelle(schritt.grund)} |`;
      if (schritt.art === "kommentar") return `| ${nr} | #${schritt.issue} | Kommentar | | ${zelle(schritt.grund)} |`;
      return "";
    });
  const texte = nummeriert.flatMap(({ nr, schritt }) => {
    const text = schritt.art === "kommentar" ? schritt.text : schritt.art === "frage" ? null : schritt.kommentar;
    return text ? [`**${nr} · #${schritt.issue}**\n\n${zitat(text)}`] : [];
  });
  const fragen = nummeriert.flatMap(({ schritt }) => (schritt.art === "frage" ? [`- ${schritt.issue ? `#${schritt.issue}: ` : ""}${schritt.text}`] : []));
  const daten = Buffer.from(JSON.stringify(plan), "utf8").toString("base64");
  return [
    `## Vorschlag zur Board-Pflege`,
    "",
    plan.zusammenfassung,
    "",
    ...(zeilen.length > 0 ? ["| Nr. | Issue | Was | Felder | Grund |", "| --- | --- | --- | --- | --- |", ...zeilen] : ["Nichts umzusetzen."]),
    ...(texte.length > 0 ? ["", "<details><summary>Kommentare im Wortlaut</summary>", "", ...texte.flatMap((t) => [t, ""]), "</details>"] : []),
    ...(fragen.length > 0 ? ["", "### Fragen an dich", "", ...fragen] : []),
    "",
    "---",
    "`/ok` setzt alles um, `/ok ohne 2, 5` alles außer diesen Nummern. `/überarbeiten …` mit deinen Änderungen erstellt einen neuen Vorschlag.",
    `Lauf: ${lauf}`,
    "",
    `<!-- ${MARKE}${daten} -->`,
  ].join("\n");
}

/** Plan aus einem Kommentar von alsKommentar(); null, wenn keiner drin ist */
export function auslesen(text: string): Plan | null {
  const treffer = new RegExp(`<!-- ${MARKE}([A-Za-z0-9+/=]+) -->`).exec(text);
  if (!treffer) return null;
  const ergebnis = pruefen(JSON.parse(Buffer.from(treffer[1], "base64").toString("utf8")));
  return "plan" in ergebnis ? ergebnis.plan : null;
}

export type Freigabe = { art: "ok"; ohne: number[] } | { art: "überarbeiten"; wunsch: string } | null;

/** Antwort des Maintainers: `/ok`, `/ok ohne 2, 5` oder `/überarbeiten …` am Anfang des Kommentars */
export function freigabe(text: string): Freigabe {
  const kommentar = text.trim();
  const ok = /^\/ok\b(?:\s+ohne\s+([\d\s,und]+))?/i.exec(kommentar);
  if (ok) return { art: "ok", ohne: [...(ok[1] ?? "").matchAll(/\d+/g)].map((n) => Number(n[0])) };
  const neu = /^\/(?:überarbeiten|ueberarbeiten)\b\s*([\s\S]*)$/i.exec(kommentar);
  if (neu) return { art: "überarbeiten", wunsch: neu[1].trim() };
  return null;
}
