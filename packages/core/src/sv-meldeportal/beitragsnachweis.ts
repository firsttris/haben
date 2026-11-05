import { monatsgrenzen } from "../lohnabrechnung/index.ts";
import type { Cents } from "../money.ts";
import type { SvAnteile } from "../sozialversicherung/index.ts";
import { type Beitragstermine, beitragstermine } from "./termine.ts";
import { type Abschnitt, betragText, datumText, type Einzugsstelle, type Feld, monatsschluessel, type SvAbrechnung, type SvPerson } from "./typen.ts";

/*
 * Beitragsnachweis je Monat und Einzugsstelle zum Abtippen im SV-Meldeportal (Benutzerhandbuch SV-Meldeportal, Stand
 * 01.12.2025, Kap. 4.2: „Beitragsnachweis (Allgemein, Knappschaft, See)“ und „Beitragsnachweis geringfügig
 * Beschäftigte“, https://info.sv-meldeportal.de/wp-content/uploads/de-benutzerhandbuch.pdf). Das Portal rechnet nicht;
 * die Beträge kommen aus den festgeschriebenen Abrechnungen. Inhalt nach § 28f Abs. 3 SGB IV: Beiträge je
 * Beitragsgruppe, Umlagen U1 und U2 und die Insolvenzgeldumlage (TK-Beratungsblatt „Beitragsnachweis“ 07/2026,
 * Abschnitt 1); der kassenindividuelle Zusatzbeitrag steht gesondert (§ 271 Abs. 1a SGB V). Bei Minijobs mit
 * Pauschsteuer gehören die Steuernummer des Arbeitgebers und die Pauschsteuer dazu (§ 28f Abs. 3 Satz 4 SGB IV).
 *
 * Schlüssel der Beitragsgruppen (Gemeinsames Rundschreiben zum gemeinsamen Meldeverfahren, Beitragsgruppenschlüssel):
 * 1000 KV allgemeiner Beitrag, 6000 KV Pauschalbeitrag für geringfügig Beschäftigte, 0100 RV voller Beitrag, 0500 RV
 * Pauschalbeitrag für geringfügig Beschäftigte, 0010 AV voller Beitrag, 0001 PV voller Beitrag, 0050
 * Insolvenzgeldumlage. Andere Gruppen (ermäßigter KV-Beitrag, halbe Beiträge) rechnet Haben nicht.
 */

/** Betriebsnummer der Minijob-Zentrale (Deutsche Rentenversicherung Knappschaft-Bahn-See) */
export const MINIJOB_ZENTRALE: Einzugsstelle = { art: "minijob-zentrale", name: "Minijob-Zentrale", betriebsnummer: "98000006" };

/** Einzugsstelle eines Mitarbeiters; der Gesellschafter-Geschäftsführer ohne SV-Pflicht hat keine */
export function einzugsstelle(p: SvPerson): Einzugsstelle | null {
  if (p.lohn.art === "minijob") return MINIJOB_ZENTRALE;
  if (p.lohn.art === "beschaeftigt") return { art: "krankenkasse", name: p.krankenkasse, betriebsnummer: p.krankenkasseBetriebsnummer };
  return null;
}

/** Schlüssel, unter dem Haben den Vermerk „im Portal abgegeben“ zum Beitragsnachweis führt */
export const beitragsnachweisGegenstand = (jahr: number, monat: number, betriebsnummer: string): string =>
  `beitragsnachweis:${monatsschluessel(jahr, monat)}:${betriebsnummer}`;

/**
 * Beitragsgruppenschlüssel, mit dem Haben gerechnet hat (KV-RV-AV-PV): Beschäftigte gesetzlich zum allgemeinen Satz
 * mit allen Zweigen (1111); Minijobs mit Pauschalbeitrag zur KV, wenn gesetzlich versichert (6, sonst 0), RV voll
 * oder nach Befreiung pauschal (1 bzw. 5), ohne AV und PV.
 */
export function gerechneteBeitragsgruppen(p: SvPerson): string | null {
  const l = p.lohn;
  if (l.art === "beschaeftigt") return l.kv.art === "gesetzlich" ? "1111" : null;
  if (l.art === "minijob") return `${l.kv.art === "gesetzlich" ? 6 : 0}${l.minijob.rvBefreit ? 5 : 1}00`;
  return null;
}

/** Personengruppe, für die Haben rechnet: 101 sozialversicherungspflichtig ohne Besonderheiten, 109 geringfügig entlohnt */
export function gerechnetePersonengruppe(p: SvPerson): string | null {
  return p.lohn.art === "beschaeftigt" ? "101" : p.lohn.art === "minijob" ? "109" : null;
}

/** Hinweise, wenn die Schlüssel in den Stammdaten fehlen oder nicht zu dem passen, womit Haben gerechnet hat */
export function schluesselHinweise(p: SvPerson): string[] {
  const name = `${p.vorname} ${p.nachname}`;
  const hinweise: string[] = [];
  const pruefe = (label: string, wert: string, gerechnet: string | null) => {
    if (!gerechnet) return;
    if (!wert) hinweise.push(`${name}: ${label} fehlt in den Stammdaten; Haben hat mit ${gerechnet} gerechnet.`);
    else if (wert !== gerechnet)
      hinweise.push(`${name}: ${label} in den Stammdaten ist ${wert}, Haben hat aber mit ${gerechnet} gerechnet. Prüfen, bevor du abtippst.`);
  };
  pruefe("Der Beitragsgruppenschlüssel", p.beitragsgruppen, gerechneteBeitragsgruppen(p));
  pruefe("Der Personengruppenschlüssel", p.personengruppe, gerechnetePersonengruppe(p));
  return hinweise;
}

const summe = (z: SvAnteile) => z.an + z.ag;
const summeVon = (abrechnungen: SvAbrechnung[], f: (a: SvAbrechnung) => Cents) => abrechnungen.reduce((s, a) => s + f(a), 0);

function beitragsfeld(schluessel: string | undefined, name: string, betrag: Cents, hinweis?: string): Feld {
  return { name, wert: betragText(betrag), ...(schluessel ? { schluessel } : {}), ...(hinweis ? { hinweis } : {}) };
}

function beitraegeAllgemein(a: SvAbrechnung[]): Feld[] {
  return [
    beitragsfeld(
      "1000",
      "Beiträge zur Krankenversicherung, allgemeiner Beitrag",
      summeVon(a, (x) => summe(x.sv.kv)),
    ),
    beitragsfeld(
      undefined,
      "Zusatzbeitrag zur Krankenversicherung",
      summeVon(a, (x) => summe(x.sv.kvZusatz)),
      "kassenindividuell, gesondert (§ 271 Abs. 1a SGB V)",
    ),
    beitragsfeld(
      "0100",
      "Beiträge zur Rentenversicherung, voller Beitrag",
      summeVon(a, (x) => summe(x.sv.rv)),
    ),
    beitragsfeld(
      "0010",
      "Beiträge zur Arbeitsförderung, voller Beitrag",
      summeVon(a, (x) => summe(x.sv.av)),
    ),
    beitragsfeld(
      "0001",
      "Beiträge zur Pflegeversicherung, voller Beitrag",
      summeVon(a, (x) => summe(x.sv.pv)),
      "mit Zuschlag für Kinderlose",
    ),
    beitragsfeld(
      undefined,
      "Umlage für Krankheitsaufwendungen (U1)",
      summeVon(a, (x) => x.sv.umlagen.u1),
    ),
    beitragsfeld(
      undefined,
      "Umlage für Mutterschaftsaufwendungen (U2)",
      summeVon(a, (x) => x.sv.umlagen.u2),
    ),
    beitragsfeld(
      "0050",
      "Insolvenzgeldumlage",
      summeVon(a, (x) => x.sv.umlagen.insolvenzgeld),
    ),
  ];
}

function beitraegeMinijob(a: SvAbrechnung[]): Feld[] {
  const befreit = (x: SvAbrechnung) => x.person.lohn.minijob.rvBefreit;
  return [
    beitragsfeld(
      "6000",
      "Pauschalbeiträge zur Krankenversicherung für geringfügig Beschäftigte",
      summeVon(a, (x) => summe(x.sv.kv)),
    ),
    beitragsfeld(
      "0100",
      "Beiträge zur Rentenversicherung, voller Beitrag",
      summeVon(a, (x) => (befreit(x) ? 0 : summe(x.sv.rv))),
      "ohne Befreiung, mit Anteil des Beschäftigten",
    ),
    beitragsfeld(
      "0500",
      "Pauschalbeiträge zur Rentenversicherung für geringfügig Beschäftigte",
      summeVon(a, (x) => (befreit(x) ? summe(x.sv.rv) : 0)),
      "von der Rentenversicherungspflicht befreit",
    ),
    beitragsfeld(
      undefined,
      "Umlage für Krankheitsaufwendungen (U1)",
      summeVon(a, (x) => x.sv.umlagen.u1),
    ),
    beitragsfeld(
      undefined,
      "Umlage für Mutterschaftsaufwendungen (U2)",
      summeVon(a, (x) => x.sv.umlagen.u2),
    ),
    beitragsfeld(
      "0050",
      "Insolvenzgeldumlage",
      summeVon(a, (x) => x.sv.umlagen.insolvenzgeld),
    ),
    beitragsfeld(
      undefined,
      "Einheitliche Pauschsteuer",
      summeVon(a, (x) => x.sv.pauschsteuer),
      "2 % nach § 40a Abs. 2 EStG",
    ),
  ];
}

export interface Beitragsnachweis {
  gegenstand: string;
  jahr: number;
  monat: number;
  einzugsstelle: Einzugsstelle;
  /** Formular im SV-Meldeportal (Bereich Beitragsnachweis) */
  formular: string;
  abschnitte: Abschnitt[];
  summe: Cents;
  /** Namen der Beschäftigten, deren Abrechnung enthalten ist */
  personen: string[];
  termine: Beitragstermine;
  hinweise: string[];
}

export interface BeitragsnachweisEingabe {
  jahr: number;
  monat: number;
  einzugsstelle: Einzugsstelle;
  /** Festgeschriebene, nicht stornierte Abrechnungen des Monats für diese Einzugsstelle */
  abrechnungen: SvAbrechnung[];
  /** Beschäftigte dieser Einzugsstelle, die im Monat noch keine festgeschriebene Abrechnung haben */
  ohneAbrechnung: string[];
  /** Steuernummer des Arbeitgebers, für die Pauschsteuer im Minijob */
  steuernummer: string;
}

/** Beitragsnachweis eines Monats für eine Einzugsstelle, Abschnitt für Abschnitt wie im Formular */
export function beitragsnachweis(e: BeitragsnachweisEingabe): Beitragsnachweis {
  const minijob = e.einzugsstelle.art === "minijob-zentrale";
  const beitraege = minijob ? beitraegeMinijob(e.abrechnungen) : beitraegeAllgemein(e.abrechnungen);
  const gesamt = summeVon(e.abrechnungen, (x) => x.sv.arbeitnehmer + x.sv.arbeitgeber);
  const { erster, letzter } = monatsgrenzen(e.jahr, e.monat);
  const pauschsteuer = summeVon(e.abrechnungen, (x) => x.sv.pauschsteuer) > 0;
  const kopf: Feld[] = [
    {
      name: "Betriebsnummer der Einzugsstelle",
      wert: e.einzugsstelle.betriebsnummer,
      hinweis: e.einzugsstelle.name,
      ...(e.einzugsstelle.betriebsnummer ? {} : { fehlt: true }),
    },
    { name: "Zeitraum von", wert: datumText(erster) },
    { name: "Zeitraum bis", wert: datumText(letzter) },
    { name: "Dauer-Beitragsnachweis", wert: "nein", hinweis: "Haben weist jeden Monat einzeln nach" },
    ...(minijob && pauschsteuer
      ? [{ name: "Steuernummer des Arbeitgebers", wert: e.steuernummer, ...(e.steuernummer ? {} : { fehlt: true }), hinweis: "§ 28f Abs. 3 Satz 4 SGB IV" }]
      : []),
  ];
  const hinweise = [
    ...(e.ohneAbrechnung.length > 0
      ? [
          `Ohne festgeschriebene Abrechnung nicht enthalten: ${e.ohneAbrechnung.join(", ")}. Der Nachweis nennt die voraussichtliche Beitragsschuld des Monats (§ 23 Abs. 1 SGB IV); erst abrechnen und festschreiben, dann abtippen.`,
        ]
      : []),
    ...[...new Map(e.abrechnungen.map((a) => [a.person.personalnummer, a.person])).values()].flatMap(schluesselHinweise),
  ];
  return {
    gegenstand: beitragsnachweisGegenstand(e.jahr, e.monat, e.einzugsstelle.betriebsnummer),
    jahr: e.jahr,
    monat: e.monat,
    einzugsstelle: e.einzugsstelle,
    formular: minijob ? "Beitragsnachweis › Beitragsnachweis geringfügig Beschäftigte" : "Beitragsnachweis › Beitragsnachweis (Allgemein, Knappschaft, See)",
    abschnitte: [
      { titel: "Kopf", felder: kopf },
      { titel: "Beiträge und Umlagen", felder: beitraege },
      { titel: "Summe", felder: [{ name: "Gesamtsumme", wert: betragText(gesamt) }] },
    ],
    summe: gesamt,
    personen: [...new Set(e.abrechnungen.map((a) => `${a.person.vorname} ${a.person.nachname}`))],
    termine: beitragstermine(e.jahr, e.monat),
    hinweise,
  };
}
