import { addDays } from "../holidays.ts";
import type { Cents } from "../money.ts";
import { einzugsstelle, schluesselHinweise } from "./beitragsnachweis.ts";
import { abmeldungFrist, anmeldungFrist, jahresmeldungFrist } from "./termine.ts";
import { type Abschnitt, datumText, type Feld, monatsschluessel, type SvAbrechnung, type SvPerson } from "./typen.ts";

/*
 * DEÜV-Meldungen je Person zum Abtippen im SV-Meldeportal, Bereich „SV-Meldungen (Allgemein, Knappschaft, See)“
 * (Benutzerhandbuch SV-Meldeportal, Stand 01.12.2025, Kap. 4.1): Anmeldung mit Meldegrund 10, Abmeldung 30,
 * Jahresmeldung 50 und Sofortmeldung 20. Inhalt nach § 28a Abs. 3 und 4 SGB IV
 * (https://www.gesetze-im-internet.de/sgb_4/__28a.html) und § 5 DEÜV (https://www.gesetze-im-internet.de/de_v/__5.html).
 * Was Haben nicht kennt (Staatsangehörigkeit, Statuskennzeichen, Geburtsort), steht als leeres Feld mit Hinweis da;
 * Haben rät nichts. Den Gesellschafter-Geschäftsführer ohne SV-Pflicht meldet Haben nicht: Er ist nicht beschäftigt im
 * Sinne von § 7 Abs. 1 SGB IV.
 */

export type MeldungArt = "anmeldung" | "sofortmeldung" | "abmeldung" | "jahresmeldung";

const GRUND: Record<MeldungArt, string> = { anmeldung: "10", sofortmeldung: "20", abmeldung: "30", jahresmeldung: "50" };

const FORMULAR: Record<MeldungArt, string> = {
  anmeldung: "SV-Meldungen › Anmeldung › 10 Beginn der Beschäftigung",
  sofortmeldung: "SV-Meldungen › Sofortmeldung › 20 Sofortmeldung",
  abmeldung: "SV-Meldungen › Abmeldung › 30 Ende der Beschäftigung",
  jahresmeldung: "SV-Meldungen › Jahresmeldung › 50 Jahresmeldung",
};

export interface DeuevMeldung {
  /** Schlüssel des Vermerks „im Portal abgegeben“ */
  gegenstand: string;
  art: MeldungArt;
  grund: string;
  titel: string;
  formular: string;
  /** Tag des Anlasses (Beginn, Ende, 31.12.), JJJJ-MM-TT */
  anlass: string;
  /** Letzter Tag der Meldung; null bei der Sofortmeldung, deren Pflicht Haben nicht kennt */
  frist: string | null;
  abschnitte: Abschnitt[];
  hinweise: string[];
  /** Alle Pflichtangaben aus Haben vorhanden */
  vollstaendig: boolean;
}

export interface MeldungenEingabe {
  employeeId: string;
  /** Aktuelle Stammdaten: Meldungen gelten nach den Verhältnissen ihres Zeitpunkts (§ 5 Abs. 1 DEÜV) */
  person: SvPerson;
  /** Festgeschriebene, nicht stornierte Abrechnungen dieser Person */
  abrechnungen: SvAbrechnung[];
  /** Zahltage aller Lohnläufe: die Abrechnung, mit der eine Meldung spätestens fällig ist */
  zahltage: string[];
  steuernummer: string;
}

export const meldungGegenstand = (art: MeldungArt, employeeId: string, anlass: string): string => `${art}:${employeeId}:${anlass}`;

const feld = (name: string, wert: string, extra: Omit<Feld, "name" | "wert"> = {}): Feld => ({ name, wert, ...extra });
const pflicht = (name: string, wert: string, hinweis = "fehlt in den Stammdaten"): Feld => (wert ? feld(name, wert) : feld(name, "", { fehlt: true, hinweis }));

/** Volle Euro: Cent über 49 aufrunden, unter 50 abrunden (§ 5 Abs. 4 DEÜV) */
export const vollerEuro = (cents: Cents): string => String(Math.floor((cents + 50) / 100));

function personAbschnitt(p: SvPerson): Abschnitt {
  return {
    titel: "Versicherte Person",
    felder: [
      pflicht("Versicherungsnummer", p.svNummer),
      pflicht("Familienname", p.nachname),
      pflicht("Vorname", p.vorname),
      pflicht("Geburtsdatum", p.geburtsdatum ? datumText(p.geburtsdatum) : ""),
      pflicht("Straße und Hausnummer", p.strasse),
      pflicht("Postleitzahl", p.plz),
      pflicht("Wohnort", p.ort),
    ],
  };
}

function empfaengerAbschnitt(p: SvPerson): Abschnitt {
  const stelle = einzugsstelle(p);
  return {
    titel: "Empfänger",
    felder: [pflicht("Betriebsnummer der Einzugsstelle", stelle?.betriebsnummer ?? ""), feld("Einzugsstelle", stelle?.name ?? "")],
  };
}

/** Monate von `von` bis `bis` (JJJJ-MM-TT), je als [jahr, monat] */
function monate(von: string, bis: string): [number, number][] {
  const liste: [number, number][] = [];
  let [j, m] = [Number(von.slice(0, 4)), Number(von.slice(5, 7))];
  const ende = bis.slice(0, 7);
  while (monatsschluessel(j, m) <= ende) {
    liste.push([j, m]);
    [j, m] = m === 12 ? [j + 1, 1] : [j, m + 1];
  }
  return liste;
}

/**
 * Entgelt des Meldezeitraums: das in der Rentenversicherung beitragspflichtige Arbeitsentgelt (§ 28a Abs. 3 Satz 2
 * Nr. 2 b SGB IV), im Übergangsbereich die reduzierte beitragspflichtige Einnahme mit Kennzeichen und zusätzlich das
 * Entgelt ohne Übergangsbereich als Entgelt für die Rentenberechnung (Nr. 2 c; § 5 Abs. 10 DEÜV; DRV, summa summarum,
 * Lexikon „Übergangsbereich“). Kennzeichen 1: in allen Monaten im Übergangsbereich, 2: nur in einzelnen.
 */
function entgeltAbschnitt(e: MeldungenEingabe, von: string, bis: string): { abschnitt: Abschnitt; hinweise: string[] } {
  const zeitraum = monate(von, bis);
  const imZeitraum = zeitraum.map(([j, m]) => e.abrechnungen.find((a) => a.jahr === j && a.monat === m));
  const fehlend = zeitraum.filter((_, i) => !imZeitraum[i]).map(([j, m]) => `${String(m).padStart(2, "0")}/${j}`);
  const hinweise: string[] = [];
  if (fehlend.length > 0)
    hinweise.push(`Ohne festgeschriebene Abrechnung: ${fehlend.join(", ")}. Das Entgelt steht erst da, wenn alle Monate abgerechnet sind.`);
  const vorhanden = imZeitraum.filter((a): a is SvAbrechnung => a !== undefined);
  // Minijob mit Mindestbemessung (§ 163 Abs. 8 SGB VI): ob 175 € oder das tatsächliche Entgelt zu melden ist, entscheidet Haben nicht
  const mindestbemessung = vorhanden.filter((a) => a.person.lohn.art === "minijob" && a.sv.bemessung.rvAv > a.svBrutto);
  if (mindestbemessung.length > 0) {
    hinweise.push(
      "Im Minijob lag das Entgelt unter der Mindestbeitragsbemessungsgrundlage der Rentenversicherung (§ 163 Abs. 8 SGB VI). Welches Entgelt dann zu melden ist, entscheidet Haben nicht; bei der Minijob-Zentrale klären.",
    );
  }
  const offen = fehlend.length > 0 || mindestbemessung.length > 0;
  const uebergang = vorhanden.filter((a) => a.sv.bemessung.arbeitnehmer !== null).length;
  const kennzeichen = uebergang === 0 ? "0" : uebergang === zeitraum.length ? "1" : "2";
  const beitragspflichtig = vorhanden.reduce((s, a) => s + a.sv.bemessung.rvAv, 0);
  const rentenberechnung = vorhanden.reduce((s, a) => s + (a.sv.bemessung.arbeitnehmer !== null ? a.svBrutto : a.sv.bemessung.rvAv), 0);
  const betrag = (cents: Cents) =>
    offen ? feld("", "", { fehlt: true, hinweis: "siehe Hinweise" }) : feld("", vollerEuro(cents), { hinweis: "volle Euro (§ 5 Abs. 4 DEÜV)" });
  const felder: Feld[] = [
    { ...betrag(beitragspflichtig), name: "Beitragspflichtiges Bruttoarbeitsentgelt in Euro" },
    feld("Kennzeichen Übergangsbereich", offen ? "" : kennzeichen, { hinweis: "0 kein, 1 in allen Monaten, 2 in einzelnen Monaten im Übergangsbereich" }),
    ...(kennzeichen !== "0" ? [{ ...betrag(rentenberechnung), name: "Entgelt Rentenberechnung in Euro" }] : []),
  ];
  return { abschnitt: { titel: "Entgelt", felder }, hinweise };
}

/** Angaben zur Steuer im Minijob bei Entgeltmeldungen (§ 28a Abs. 3 Satz 2 Nr. 2 f SGB IV) */
function steuerAbschnitt(e: MeldungenEingabe): Abschnitt[] {
  if (e.person.lohn.art !== "minijob") return [];
  return [
    {
      titel: "Angaben zur Steuer",
      felder: [
        pflicht("Steuernummer des Arbeitgebers", e.steuernummer, "fehlt in den Firmendaten"),
        pflicht("Steuer-ID des Beschäftigten", e.person.steuerId),
        feld("Art der Besteuerung", "Pauschsteuer 2 %", { hinweis: "einheitliche Pauschsteuer nach § 40a Abs. 2 EStG" }),
      ],
    },
  ];
}

function meldesachverhalt(art: MeldungArt, p: SvPerson, von: string, bis: string | null): Abschnitt {
  const felder: Feld[] = [
    feld("Meldegrund", GRUND[art]),
    feld("Beschäftigungszeit von", datumText(von)),
    ...(bis ? [feld("Beschäftigungszeit bis", datumText(bis))] : []),
    pflicht("Personengruppe", p.personengruppe),
    pflicht("Beitragsgruppe", p.beitragsgruppen),
    pflicht("Tätigkeitsschlüssel", p.taetigkeitsschluessel),
    feld("Mehrfachbeschäftigung", "nein", { hinweis: "Haben rechnet keine Mehrfachbeschäftigung" }),
  ];
  if (art === "anmeldung") {
    felder.push(feld("Staatsangehörigkeit", "", { hinweis: "kennt Haben nicht; Schlüssel im Portal wählen (§ 28a Abs. 3 Satz 2 Nr. 1 f SGB IV)" }));
    if (p.lohn.art === "beschaeftigt") {
      felder.push(
        feld("Statuskennzeichen", "", {
          hinweis:
            "nur bei Ehegatte, Lebenspartner oder Abkömmling des Arbeitgebers (1) oder geschäftsführendem GmbH-Gesellschafter (2), § 28a Abs. 3 Satz 2 Nr. 1 d und e SGB IV; kennt Haben nicht",
        }),
      );
    }
    if (p.lohn.art === "minijob") {
      felder.push(
        feld("Befreiung von der Rentenversicherungspflicht", p.lohn.minijob.rvBefreit ? "ja" : "nein", {
          hinweis: "Antrag nach § 6 Abs. 1b SGB VI, gesondert zu kennzeichnen (§ 5 Abs. 12 DEÜV); den Tag des Eingangs kennt Haben nicht",
        }),
      );
    }
  }
  return { titel: "Meldung", felder };
}

function fertig(m: Omit<DeuevMeldung, "vollstaendig" | "hinweise">, hinweise: string[]): DeuevMeldung {
  const vollstaendig = m.abschnitte.every((a) => a.felder.every((f) => !f.fehlt));
  return { ...m, hinweise, vollstaendig };
}

/** Das spätere von zwei Daten JJJJ-MM-TT */
const spaeter = (a: string, b: string): string => [a, b].sort()[1]!;

const nameVon = (p: SvPerson) => `${p.vorname} ${p.nachname}`;

const ohneVersicherungsnummer = (p: SvPerson) =>
  p.svNummer
    ? []
    : [
        `Ohne Versicherungsnummer braucht die Meldung Geburtsname, Geburtsort, Geburtsland, Geschlecht und Staatsangehörigkeit (§ 5 Abs. 7 DEÜV); die kennt Haben nicht. Besser vorher die Versicherungsnummer im Portal abfragen (Kap. 4.3 des Benutzerhandbuchs).`,
      ];

export function anmeldung(e: MeldungenEingabe): DeuevMeldung {
  const p = e.person;
  const beginn = p.lohn.eintritt;
  return fertig(
    {
      gegenstand: meldungGegenstand("anmeldung", e.employeeId, beginn),
      art: "anmeldung",
      grund: GRUND.anmeldung,
      titel: `Anmeldung ${nameVon(p)} (Beginn ${datumText(beginn)})`,
      formular: FORMULAR.anmeldung,
      anlass: beginn,
      frist: anmeldungFrist(beginn, e.zahltage),
      abschnitte: [empfaengerAbschnitt(p), personAbschnitt(p), meldesachverhalt("anmeldung", p, beginn, null)],
    },
    [...ohneVersicherungsnummer(p), ...schluesselHinweise(p)],
  );
}

/**
 * Sofortmeldung an die Datenstelle der Rentenversicherung, spätestens bei Aufnahme der Beschäftigung, nur in den
 * Wirtschaftsbereichen nach § 28a Abs. 4 SGB IV. Ob die Firma dazugehört, weiß Haben nicht; daher ohne Frist.
 */
export function sofortmeldung(e: MeldungenEingabe): DeuevMeldung {
  const p = e.person;
  const beginn = p.lohn.eintritt;
  return fertig(
    {
      gegenstand: meldungGegenstand("sofortmeldung", e.employeeId, beginn),
      art: "sofortmeldung",
      grund: GRUND.sofortmeldung,
      titel: `Sofortmeldung ${nameVon(p)} (Beginn ${datumText(beginn)})`,
      formular: FORMULAR.sofortmeldung,
      anlass: beginn,
      frist: null,
      abschnitte: [
        personAbschnitt(p),
        { titel: "Meldung", felder: [feld("Meldegrund", GRUND.sofortmeldung), feld("Tag der Beschäftigungsaufnahme", datumText(beginn))] },
      ],
    },
    [
      "Nur nötig im Bau-, Gaststätten-, Beherbergungs-, Personenbeförderungs-, Speditions-, Transport- und Logistik-, Schausteller-, Gebäudereinigungs-, Messebau-, Fleisch-, Prostitutions-, Wach- und Sicherheits-, Friseur- und Kosmetikgewerbe (§ 28a Abs. 4 SGB IV), dann spätestens bei Aufnahme der Beschäftigung. Sie ersetzt die Anmeldung nicht.",
    ],
  );
}

export function abmeldung(e: MeldungenEingabe): DeuevMeldung | null {
  const p = e.person;
  const ende = p.lohn.austritt;
  if (!ende) return null;
  // Meldezeiträume enden mit dem Kalenderjahr (§ 5 Abs. 3 DEÜV); davor steht die Jahresmeldung
  const von = spaeter(p.lohn.eintritt, `${ende.slice(0, 4)}-01-01`);
  const entgelt = entgeltAbschnitt(e, von, ende);
  return fertig(
    {
      gegenstand: meldungGegenstand("abmeldung", e.employeeId, ende),
      art: "abmeldung",
      grund: GRUND.abmeldung,
      titel: `Abmeldung ${nameVon(p)} (Ende ${datumText(ende)})`,
      formular: FORMULAR.abmeldung,
      anlass: ende,
      frist: abmeldungFrist(ende, e.zahltage),
      abschnitte: [empfaengerAbschnitt(p), personAbschnitt(p), meldesachverhalt("abmeldung", p, von, ende), entgelt.abschnitt, ...steuerAbschnitt(e)],
    },
    [
      ...entgelt.hinweise,
      ...schluesselHinweise(p),
      ...(addDays(p.lohn.eintritt, 42) >= ende
        ? ["Endet die Beschäftigung innerhalb der Frist der Anmeldung, gehen An- und Abmeldung zusammen als Meldegrund 40 (§ 8 Abs. 2 DEÜV)."]
        : []),
    ],
  );
}

export function jahresmeldung(e: MeldungenEingabe, jahr: number): DeuevMeldung {
  const p = e.person;
  const von = spaeter(p.lohn.eintritt, `${jahr}-01-01`);
  const bis = `${jahr}-12-31`;
  const entgelt = entgeltAbschnitt(e, von, bis);
  return fertig(
    {
      gegenstand: meldungGegenstand("jahresmeldung", e.employeeId, String(jahr)),
      art: "jahresmeldung",
      grund: GRUND.jahresmeldung,
      titel: `Jahresmeldung ${jahr} ${nameVon(p)}`,
      formular: FORMULAR.jahresmeldung,
      anlass: bis,
      frist: jahresmeldungFrist(jahr, e.zahltage),
      abschnitte: [empfaengerAbschnitt(p), personAbschnitt(p), meldesachverhalt("jahresmeldung", p, von, bis), entgelt.abschnitt, ...steuerAbschnitt(e)],
    },
    [...entgelt.hinweise, ...schluesselHinweise(p)],
  );
}

/**
 * Alle Meldungen, die für die Person bis zum Jahr `bisJahr` anfallen: Anmeldung (mit Sofortmeldung), Abmeldung, und je
 * Jahr, an dessen 31. Dezember sie beschäftigt ist, die Jahresmeldung; sie entfällt, wenn zum 31. Dezember abgemeldet
 * wird (§ 10 Abs. 1 Satz 2 DEÜV).
 */
export function meldungen(e: MeldungenEingabe, bisJahr: number): DeuevMeldung[] {
  const { lohn } = e.person;
  if (lohn.art === "ggf") return [];
  const liste = [anmeldung(e), sofortmeldung(e)];
  const ab = abmeldung(e);
  const erstes = Number(lohn.eintritt.slice(0, 4));
  for (let jahr = erstes; jahr <= bisJahr; jahr++) {
    const silvester = `${jahr}-12-31`;
    if (lohn.austritt !== null && lohn.austritt <= silvester) break;
    liste.push(jahresmeldung(e, jahr));
  }
  if (ab) liste.push(ab);
  return liste;
}
