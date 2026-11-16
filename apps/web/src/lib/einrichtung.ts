import { RECHTSFORMEN, type Rechtsform, type VatFrequency } from "@haben/core";
import { BEREICHE, type BereichId } from "./bereiche.ts";

/*
 * Fragen zur Einrichtung (#266): Antworten und Firmendaten ineinander umrechnen. Die Antworten schreiben nur vorhandene
 * Felder der Firmendaten und den Voranmeldungszeitraum; null heißt „weiß ich nicht“ und lässt den Wert, wie er ist.
 */

export const SELBSTAENDIG = {
  freiberufler: "Freiberuflich",
  gewerbe: "Mit Gewerbe",
  gmbh: "GmbH",
  ug: "UG (haftungsbeschränkt)",
} as const;

export type Selbstaendig = keyof typeof SELBSTAENDIG;
export type Einkunftsart = "gewerbe" | "selbstaendig";
export type OffeneFrage = "rechtsform" | "kleinunternehmer";

export interface Antworten {
  selbstaendig: Selbstaendig | null;
  kleinunternehmer: boolean | null;
  versteuerung: "ist" | "soll" | null;
  voranmeldung: "monatlich" | "vierteljaehrlich" | null;
  ohneVorsteuerabzug: boolean | null;
  /** Nur mit Steuerberatung gefragt */
  kontenrahmen: "SKR03" | "SKR04" | null;
  /** true = nutze ich, false = ausblenden; fehlt = weiß ich noch nicht (bleibt sichtbar) */
  bereiche: Partial<Record<BereichId, boolean>>;
}

/** Was die Antworten in den Firmendaten und beim Voranmeldungszeitraum festlegen */
export interface Steuerangaben {
  rechtsform: Rechtsform;
  einkunftsart: Einkunftsart | null;
  kleinunternehmer: boolean;
  versteuerung: "ist" | "soll";
  ohneVorsteuerabzug: boolean;
  kontenrahmen: "SKR03" | "SKR04";
  /** Im laufenden Monat */
  voranmeldung: VatFrequency;
}

export interface Stand extends Steuerangaben {
  /** Fragen schon einmal durchgegangen */
  eingerichtet: boolean;
  /** Firmendaten bewusst gespeichert: Dann sind Kleinunternehmer und Versteuerung entschieden, keine Vorgabe mehr */
  firmendatenGespeichert: boolean;
  einrichtungOffen: readonly OffeneFrage[];
  ausgeblendet: readonly string[];
  hatMitarbeiter: boolean;
}

function selbstaendigAus(rechtsform: Rechtsform, einkunftsart: Einkunftsart | null): Selbstaendig | null {
  if (rechtsform !== "einzelunternehmen") return rechtsform;
  if (einkunftsart === "selbstaendig") return "freiberufler";
  return einkunftsart;
}

/** Antworten zum Vorausfüllen: beim ersten Mal nur, was schon feststeht, danach die gespeicherten Angaben */
export function antwortenAus(stand: Stand): Antworten {
  const entschieden = stand.eingerichtet || stand.firmendatenGespeichert;
  const offen = (frage: OffeneFrage) => !entschieden || stand.einrichtungOffen.includes(frage);
  const bereiche: Partial<Record<BereichId, boolean>> = {};
  for (const { id } of BEREICHE) {
    if (stand.ausgeblendet.includes(id)) bereiche[id] = false;
    else if (stand.eingerichtet || (id === "personal" && stand.hatMitarbeiter)) bereiche[id] = true;
  }
  return {
    selbstaendig: offen("rechtsform") ? null : selbstaendigAus(stand.rechtsform, stand.einkunftsart),
    kleinunternehmer: offen("kleinunternehmer") ? null : stand.kleinunternehmer,
    versteuerung: entschieden ? stand.versteuerung : null,
    voranmeldung: stand.eingerichtet && stand.voranmeldung !== "keine" ? stand.voranmeldung : null,
    ohneVorsteuerabzug: entschieden ? stand.ohneVorsteuerabzug : null,
    kontenrahmen: entschieden ? stand.kontenrahmen : null,
    bereiche,
  };
}

/** Die Angaben nach den Antworten; ein Kleinunternehmer gibt keine Voranmeldung ab, Versteuerung und Zeitraum bleiben */
export function steuerangabenNach(aktuell: Steuerangaben, antworten: Antworten): Steuerangaben {
  const art = antworten.selbstaendig;
  const kleinunternehmer = antworten.kleinunternehmer ?? aktuell.kleinunternehmer;
  return {
    rechtsform: art === null ? aktuell.rechtsform : art === "gmbh" || art === "ug" ? art : "einzelunternehmen",
    einkunftsart: art === "freiberufler" ? "selbstaendig" : art === "gewerbe" ? "gewerbe" : aktuell.einkunftsart,
    kleinunternehmer,
    versteuerung: kleinunternehmer ? aktuell.versteuerung : (antworten.versteuerung ?? aktuell.versteuerung),
    ohneVorsteuerabzug: antworten.ohneVorsteuerabzug ?? aktuell.ohneVorsteuerabzug,
    kontenrahmen: antworten.kontenrahmen ?? aktuell.kontenrahmen,
    voranmeldung: kleinunternehmer ? aktuell.voranmeldung : (antworten.voranmeldung ?? aktuell.voranmeldung),
  };
}

const JA_NEIN = (wert: boolean) => (wert ? "ja" : "nein");
const FELDER: { [K in keyof Steuerangaben]: { feld: string; text: (wert: Steuerangaben[K]) => string } } = {
  rechtsform: { feld: "Rechtsform", text: (wert) => RECHTSFORMEN[wert] },
  einkunftsart: {
    feld: "Einkunftsart",
    text: (wert) => (wert === "selbstaendig" ? "Selbständige Arbeit" : wert === "gewerbe" ? "Gewerbebetrieb" : "keine Angabe"),
  },
  kleinunternehmer: { feld: "Kleinunternehmer", text: JA_NEIN },
  versteuerung: { feld: "Versteuerung", text: (wert) => (wert === "ist" ? "Ist" : "Soll") },
  voranmeldung: {
    feld: "Voranmeldung",
    text: (wert) => (wert === "vierteljaehrlich" ? "vierteljährlich" : wert === "keine" ? "keine" : "monatlich"),
  },
  ohneVorsteuerabzug: { feld: "Ohne Vorsteuerabzug", text: JA_NEIN },
  kontenrahmen: { feld: "Kontenrahmen", text: (wert) => wert },
};

/** Geänderte Angaben mit altem und neuem Wert, für die Rückfrage vor dem Speichern */
export function aenderungen(vorher: Steuerangaben, nachher: Steuerangaben): { feld: string; von: string; nach: string }[] {
  return (Object.keys(FELDER) as (keyof Steuerangaben)[])
    .filter((key) => vorher[key] !== nachher[key])
    .map((key) => {
      const { feld, text } = FELDER[key] as { feld: string; text: (wert: unknown) => string };
      return { feld, von: text(vorher[key]), nach: text(nachher[key]) };
    });
}

/** Woran die Startseite erinnert: was mit „weiß ich nicht“ offen bleibt */
export function offeneFragen(antworten: Antworten): OffeneFrage[] {
  return [antworten.selbstaendig === null && ("rechtsform" as const), antworten.kleinunternehmer === null && ("kleinunternehmer" as const)].filter(
    (frage): frage is OffeneFrage => frage !== false,
  );
}

/**
 * Fragen noch nie durchgegangen und die Firma noch leer. Instanzen von vor #266 haben Firmendaten und keine Zeile in
 * `einrichtung`: Die Übersicht fragt sie nicht, sie sehen alle Bereiche wie bisher.
 */
export function fragenFehlen({
  eingerichtet,
  firmendatenGespeichert,
  firmenname,
}: {
  eingerichtet: boolean;
  firmendatenGespeichert: boolean;
  firmenname: string;
}) {
  return !eingerichtet && !firmendatenGespeichert && firmenname.trim() === "";
}

/** Woran die Übersicht erinnert, solange die Fragen fehlen oder etwas offen ist; null für die Steuerberatung */
export function einrichtungsAufgaben(einrichtung: { fehlt: boolean; offen: readonly OffeneFrage[] } | null) {
  const { fehlt, offen } = einrichtung ?? { fehlt: false, offen: [] };
  const aufgaben: {
    title: string;
    detail: string;
    action: string;
    tone: "info" | "warn";
    to: "/einrichtung" | "/einstellungen";
    bereich?: "firma";
  }[] = [];
  if (fehlt) {
    aufgaben.push({
      title: "Haben einrichten",
      detail: "Ein paar Fragen zu Rechtsform, Umsatzsteuer und den Bereichen, die du brauchst",
      action: "Beantworten",
      tone: "info",
      to: "/einrichtung",
    });
  }
  if (offen.includes("rechtsform")) {
    aufgaben.push({
      title: "Rechtsform festlegen",
      detail: "Freiberuflich, Gewerbe, GmbH oder UG: entscheidet über EÜR oder Bilanz und Gewerbesteuer",
      action: "Festlegen",
      tone: "warn",
      to: "/einstellungen",
      bereich: "firma",
    });
  }
  if (offen.includes("kleinunternehmer")) {
    aufgaben.push({
      title: "Kleinunternehmer klären",
      detail: "Bis dahin rechnet Haben mit Umsatzsteuer und Voranmeldung",
      action: "Klären",
      tone: "warn",
      to: "/einstellungen",
      bereich: "firma",
    });
  }
  return aufgaben;
}
