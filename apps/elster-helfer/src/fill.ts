/*
 * Haben für Mein ELSTER: trägt Werte aus Haben in die offene Formularseite ein. Reine Logik ohne Chrome-APIs, damit
 * sie sich in einem Browser ohne Erweiterung testen lässt (apps/web/e2e/elster-helfer.spec.ts).
 *
 * Mein ELSTER benennt seine Eingabefelder nach den amtlichen Feldkennungen, die auch im ERiC-XML stehen:
 *   EÜR 2025: fields[eruEUERBEinUSt_StPflichtSumE6000401]
 *   USt 2025: fields[eruUSt2AUmsaetzeTabelleUms_allgE3003303]
 * Jedes Feld trägt außerdem seinen ERiC-Pfad: data-eru-name="/EUER/BEin/USt_StPflicht/Sum/E6000401".
 *
 * Summenfelder der EÜR sind in Mein ELSTER gesperrt; Mein ELSTER rechnet sie aus Einzelposten (…/Einz/…, Bezeichnung
 * und Betrag), die man mit „Eintrag übernehmen“ hinzufügt. Für eine gesperrte Summe füllt die Erweiterung deshalb die
 * freie Einzelposten-Zeile daneben und markiert den Knopf; übernehmen klickt der Nutzer.
 * Mehrfachzeilen, die Haben selbst mehrfach liefert (Anlagegüter, Kinder), trägt der Nutzer von Hand ein; die
 * Erweiterung zeigt ihre Werte zum Abschreiben.
 *
 * Die Voranmeldung benennt ihre Felder nach der Kennzahl: data-eru-name="/Anmeldungssteuern/Steuerfall/
 * Umsatzsteuervoranmeldung/Kz81". Gesperrte Felder, die Mein ELSTER selbst rechnet (Steuer zu Kz 81, Kz 83), vergleicht
 * die Erweiterung nur mit Haben.
 *
 * Die Einkommensteuer führt Anlagen je Person (Anlage S, N, Vorsorgeaufwand); Werte einer Person trägt die
 * Erweiterung nur auf deren Anlage ein. Vorbefüllte Werte (etwa aus dem Vorjahr) überschreibt sie nur, wenn der Nutzer
 * es in der Leiste ausdrücklich anstößt.
 *
 * Die Erweiterung klickt nie: Seiten wechseln, prüfen und absenden macht der Nutzer.
 */
import type { ElsterFeld, MeinElsterWerte } from "@haben/elster/felder";

export type { ElsterFeld, MeinElsterWerte };

export const FORMAT = "haben-mein-elster";

/** Person einer Anlage je Person, wie Haben sie in `personen` liefert */
export type Person = "A" | "B";

/** Ein Eingabefeld von Mein ELSTER, wie die Erweiterung es liest und setzt */
type Feld = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export interface Eintrag {
  kennung: string;
  wert: string;
  label: string;
}

/** Was `ausfuellen` auf einer Seite getan und gefunden hat */
export interface Ergebnis {
  eingetragen: (Eintrag & { vorher?: string })[];
  uebernehmen: (Eintrag & { knopf: boolean })[];
  gleich: Eintrag[];
  abweichend: (Eintrag & { vorhanden: string })[];
  berechnet: Eintrag[];
  vonHand: (Eintrag & { zeile: number | null })[];
  andererPerson: (Eintrag & { person: Person | null })[];
  nichtMoeglich: Eintrag[];
  /** Kennungen, deren Feld auf dieser Seite stand */
  kennungen: string[];
  person: Person | null;
}

const KENNUNG = /^(E\d{7}|Kz\d{2}|Zeitraum)$/;

/**
 * Kennung eines Felds: der letzte Teil seines ERiC-Pfads (data-eru-name, z. B. „…/Umsatzsteuervoranmeldung/Kz81“),
 * sonst das Ende des Namens. Hat ein Feld einen Pfad, zählt nur dieser: „…/EOL_SteuerZuKz81“ ist die von
 * Mein ELSTER gerechnete Steuer zu Kz 81, nicht Kz 81 selbst.
 */
export function kennungOf(el: Element): string | null {
  const pfad = el.getAttribute?.("data-eru-name");
  if (pfad) {
    const letzter = pfad.split("/").pop() ?? "";
    return KENNUNG.test(letzter) ? letzter : null;
  }
  const match = /(E\d{7}|Kz\d{2}|Zeitraum)\]$/.exec((el as Feld).name || "");
  return match?.[1] ?? null;
}

/** Vergleichbarer Wert: ohne Leerzeichen und ohne Tausenderpunkte („2.900“ = „2900“, „1.234,56“ = „1234,56“) */
export function normal(wert: unknown): string {
  return String(wert)
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "");
}

function istMehrfachzeile(name: string): boolean {
  return /^mzbs\[/.test(name) || name.includes(".newItem.");
}

/** Formular und Jahr aus dem Pfad: /eportal/interpreter/eingabe/euer-2025/…, Voranmeldung: ustvaeru-2026 */
export function formularAusPfad(pathname: string | null | undefined): { formular: string; jahr: number } | null {
  const match = /\/eportal\/interpreter\/eingabe\/([a-z0-9]+)-(\d{4})(?:\/|$)/.exec(pathname || "");
  return match?.[1] && match[2] ? { formular: match[1], jahr: Number(match[2]) } : null;
}

/** Prüft die eingefügten Werte aus Haben; Fehlermeldung oder null. Danach sind es Werte im Format von Haben. */
export function pruefeWerte(werte: unknown): string | null {
  const w = werte as Partial<MeinElsterWerte> | null | undefined;
  if (!w || w.format !== FORMAT) return "Das sind keine Werte aus Haben („Werte für Mein ELSTER kopieren“).";
  if (w.version !== 1) return `Version ${w.version} kennt diese Erweiterung nicht. Bitte die Erweiterung aktualisieren.`;
  if (!Array.isArray(w.felder) || !/^[a-z0-9]+$/.test(String(w.formular)) || !Number.isInteger(w.jahr)) return "Die Werte sind unvollständig.";
  return null;
}

function beschriftung(doc: Document, el: Feld): string {
  const label = el.id ? doc.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
  return (label?.textContent || el.getAttribute("aria-label") || el.name).trim().replace(/\s+/g, " ");
}

function feuern(el: Element, ...typen: string[]): void {
  for (const typ of typen) el.dispatchEvent(new Event(typ, { bubbles: true }));
}

function radios(doc: Document, name: string): HTMLInputElement[] {
  return [...doc.getElementsByName(name)].filter((r): r is HTMLInputElement => r instanceof HTMLInputElement);
}

/** Aktueller Wert eines Felds, vergleichbar mit dem Wert aus Haben */
function vorhanden(doc: Document, el: Feld): string {
  if (el.type === "radio") return radios(doc, el.name).find((r) => r.checked)?.value ?? "";
  if (el instanceof HTMLInputElement && el.type === "checkbox") return el.checked ? "1" : "";
  return el.value.trim();
}

/** Ob ein Wert aus Haben ein Häkchen bedeutet */
function angekreuzt(wert: string): boolean {
  return wert === "1" || wert === "true" || wert === "X";
}

/** Steht im Feld schon der Wert aus Haben? Ein Häkchen zählt nach seiner Bedeutung, nicht nach dem Text */
function stimmt(el: Feld, jetzt: string, wert: string): boolean {
  if (el instanceof HTMLInputElement && el.type === "checkbox") return el.checked === angekreuzt(wert);
  return normal(jetzt) === normal(wert);
}

/** Setzt den Wert; false, wenn das Feld ihn nicht annehmen kann (z. B. Auswahl ohne passende Option) */
function setzen(doc: Document, el: Feld, wert: string): boolean {
  if (el.type === "radio") {
    const option = radios(doc, el.name).find((r) => r.value === wert);
    if (!option) return false;
    option.checked = true;
    feuern(option, "click", "change");
    return true;
  }
  if (el instanceof HTMLInputElement && el.type === "checkbox") {
    el.checked = angekreuzt(wert);
    feuern(el, "click", "change");
    return true;
  }
  if (el instanceof HTMLSelectElement) {
    const option = [...el.options].find((o) => o.value === wert);
    if (!option) return false;
    el.value = option.value;
    feuern(el, "change");
    return true;
  }
  el.focus();
  el.value = wert;
  feuern(el, "input", "change", "blur");
  return true;
}

const MARKE = "2px solid #1f6f5c";
const BEZEICHNUNG = "Laut Haben";

/**
 * Die freie Einzelposten-Zeile zu einer gesperrten Summe: …/Sum/E6000401 → Felder …/Einz/… (Bezeichnung, Betrag) und
 * der Knopf „Eintrag übernehmen“ ihrer Gruppe. null, wenn es keine passende freie Zeile gibt.
 */
function einzelposten(doc: Document, summe: Feld): { bezeichnung: HTMLInputElement; betrag: HTMLInputElement; knopf: HTMLButtonElement | null } | null {
  const pfad = summe.getAttribute("data-eru-name") || "";
  const match = /^(.*)\/Sum\/E\d{7}$/.exec(pfad);
  if (!match) return null;
  const felder = [...doc.querySelectorAll<HTMLInputElement>("input[data-eru-name]")].filter(
    (i) => !i.disabled && i.type !== "hidden" && (i.getAttribute("data-eru-name") ?? "").startsWith(`${match[1]}/Einz/`) && istMehrfachzeile(i.name),
  );
  const [erstes, zweites] = felder;
  if (felder.length !== 2 || !erstes || !zweites) return null;
  const betrag = felder.find((f) => /betrag/i.test(beschriftung(doc, f))) ?? zweites;
  const bezeichnung = betrag === erstes ? zweites : erstes;
  // Frei ist die Zeile, wenn sie leer ist oder ein früherer Lauf sie vorbereitet hat und noch niemand übernommen hat
  const leer = felder.every((f) => f.value.trim() === "");
  if (!leer && bezeichnung.value.trim() !== BEZEICHNUNG) return null;
  return { bezeichnung, betrag, knopf: gruppenKnopf(betrag) };
}

/** Der Knopf „Eintrag übernehmen“ im kleinsten Abschnitt um das Feld, der genau einen solchen Knopf hat */
function gruppenKnopf(el: Element): HTMLButtonElement | null {
  for (let box = el.parentElement; box; box = box.parentElement) {
    const knoepfe = [...box.querySelectorAll("button")].filter((b) => /Eintrag übernehmen/.test(b.getAttribute("aria-label") || b.textContent || ""));
    if (knoepfe.length === 1) return knoepfe[0] ?? null;
    if (knoepfe.length > 1) return null;
  }
  return null;
}

/**
 * Wessen Anlage gerade offen ist: Mein ELSTER schreibt Anlagen je Person mit Namen in die Überschrift
 * („Anlage S (Erika Muster)“). "A", "B" oder null, wenn die Seite keine der Personen nennt.
 */
export function personAufSeite(doc: Document, personen: MeinElsterWerte["personen"] | undefined): Person | null {
  if (!personen) return null;
  // biome-ignore lint/performance/useDomNodeTextContent: gemeint ist der sichtbare Text
  const kopf = (((doc.querySelector("main") || doc.body) as HTMLElement).innerText || "").slice(0, 600);
  for (const key of ["A", "B"] as const) {
    const name = personen[key];
    if (name && kopf.includes(`(${name})`)) return key;
  }
  return null;
}

function gruppiert(felder: ElsterFeld[]): { einfach: Map<string, ElsterFeld[]>; mehrfach: Map<string, ElsterFeld[]> } {
  const einfach = new Map<string, ElsterFeld[]>();
  const mehrfach = new Map<string, ElsterFeld[]>();
  for (const feld of felder) {
    const ziel = feld.zeile === null || feld.zeile === undefined ? einfach : mehrfach;
    ziel.set(feld.kennung, [...(ziel.get(feld.kennung) ?? []), feld]);
  }
  return { einfach, mehrfach };
}

/**
 * Trägt alle Werte ein, deren Feld auf dieser Seite steht. Ein Feld, in dem schon etwas anderes steht, bleibt
 * unverändert und wird gemeldet. Liefert, was eingetragen, schon gleich, abweichend oder von Hand einzutragen ist.
 */
export function ausfuellen(doc: Document, werte: MeinElsterWerte, optionen: { ueberschreiben?: boolean } = {}): Ergebnis {
  const ueberschreiben = Boolean(optionen.ueberschreiben);
  const seitenPerson = personAufSeite(doc, werte.personen);
  const { einfach, mehrfach } = gruppiert(werte.felder);
  const ergebnis: Ergebnis = {
    eingetragen: [],
    uebernehmen: [],
    gleich: [],
    abweichend: [],
    berechnet: [],
    vonHand: [],
    andererPerson: [],
    nichtMoeglich: [],
    kennungen: [],
    person: seitenPerson,
  };
  const gesehen = new Set<string>();
  for (const el of doc.querySelectorAll<Feld>("input[name], select[name], textarea[name]")) {
    if (el.type === "hidden") continue;
    const kennung = kennungOf(el);
    if (!kennung || (el.type === "radio" && gesehen.has(el.name))) continue;
    gesehen.add(el.name);
    const label = beschriftung(doc, el);
    if (istMehrfachzeile(el.name)) {
      for (const feld of [...(mehrfach.get(kennung) ?? []), ...(einfach.get(kennung) ?? [])]) {
        ergebnis.vonHand.push({ kennung, wert: feld.wert, zeile: feld.zeile ?? null, label });
      }
      if (mehrfach.has(kennung) || einfach.has(kennung)) ergebnis.kennungen.push(kennung);
      continue;
    }
    const kandidaten = einfach.get(kennung) ?? [];
    // Felder einer Person nur auf deren Anlage; erkennt die Seite die Person nicht, bleibt das Feld unberührt
    const feld = kandidaten.find((f) => !f.person || f.person === seitenPerson);
    if (!feld) {
      for (const f of kandidaten) ergebnis.andererPerson.push({ kennung, wert: f.wert, person: f.person, label });
      continue;
    }
    ergebnis.kennungen.push(kennung);
    const jetzt = vorhanden(doc, el);
    if (stimmt(el, jetzt, feld.wert)) ergebnis.gleich.push({ kennung, wert: feld.wert, label });
    else if (jetzt !== "" && !(ueberschreiben && !el.disabled)) ergebnis.abweichend.push({ kennung, wert: feld.wert, vorhanden: jetzt, label });
    else if (el.disabled) {
      // Gesperrte Summe der EÜR: die Einzelposten-Zeile daneben füllen, übernehmen klickt der Nutzer.
      // Andere gesperrte Felder rechnet Mein ELSTER selbst (Kz 83 der Voranmeldung); sie werden nur verglichen.
      const zeile = einzelposten(doc, el);
      if (zeile && setzen(doc, zeile.bezeichnung, BEZEICHNUNG) && setzen(doc, zeile.betrag, feld.wert)) {
        for (const markiert of [zeile.bezeichnung, zeile.betrag, zeile.knopf]) if (markiert) markiert.style.outline = MARKE;
        ergebnis.uebernehmen.push({ kennung, wert: feld.wert, label, knopf: Boolean(zeile.knopf) });
      } else if (!/\/Sum\/E\d{7}$/.test(el.getAttribute("data-eru-name") || "")) ergebnis.berechnet.push({ kennung, wert: feld.wert, label });
      else ergebnis.nichtMoeglich.push({ kennung, wert: feld.wert, label });
    } else if (setzen(doc, el, feld.wert)) {
      ergebnis.eingetragen.push({ kennung, wert: feld.wert, label, ...(jetzt !== "" ? { vorher: jetzt } : {}) });
      el.style.outline = MARKE;
    } else ergebnis.nichtMoeglich.push({ kennung, wert: feld.wert, label });
  }
  return ergebnis;
}
