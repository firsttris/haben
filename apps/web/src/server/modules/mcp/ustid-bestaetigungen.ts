import {
  EVATR_VERGLEICH,
  type EvatrVergleich,
  evatrFrisch,
  evatrFrischGueltig,
  evatrGueltig,
  evatrMeldung,
  evatrPruefbar,
  normalizeUstId,
  parsePeriodKey,
  periodKey,
  periodLabel,
  type VatPeriod,
} from "@haben/core";
import {
  evatrAbgeschaltet,
  findContactsByUstId,
  letzteBestaetigungen,
  listContacts,
  listUstIdBestaetigungen,
  type UstIdBestaetigung,
} from "../stammdaten/index.ts";
import { zmOverview, zmQuartale, zuBestaetigendeNummern } from "../umsatzsteuer/index.ts";
import { z } from "zod";

/*
 * Werkzeug ustid_bestaetigungen (#1492): die gespeicherten Antworten des BZSt zu USt-IdNrn. (§ 18e UStG, #1385), je
 * Nummer die letzte. Es fragt nie beim BZSt: Der Zugang ändert nichts, und jede Abfrage speicherte einen Nachweis. Name und
 * Anschrift, die an das BZSt gingen, und den empfangenen Datensatz gibt es nicht heraus, nur das Ergebnis je Angabe, damit
 * nicht mehr an den Anbieter des Modells geht als nötig (docs/ki-assistenten.md, Datenschutz).
 */

const ABGESCHALTET = "Die Bestätigung beim BZSt ist auf dieser Installation abgeschaltet (HABEN_EVATR=off); vorhandene Antworten stehen weiter hier.";
const NICHT_PRUEFBAR = "Bestätigen lässt sich nur die USt-IdNr. eines anderen EU-Mitgliedstaats mit passendem Aufbau.";
const NOCH_NICHT = "noch nicht bestätigt";
const KONTAKTE_HOECHSTENS = 10;

export const ustidBestaetigungenInput = {
  ustid: z.string().max(20).optional().describe("USt-IdNr., etwa ATU12345678"),
  kontakt: z.string().max(100).optional().describe("Name oder Kundennummer des Kontakts"),
  quartal: z
    .string()
    .regex(/^\d{4}-Q[1-4]$/)
    .optional()
    .describe("Quartal der Meldung als JJJJ-Q1 bis JJJJ-Q4"),
};

type Link = (path: string) => string;
type Stand = Pick<UstIdBestaetigung, "art" | "status" | "anfrageZeitpunkt" | "gueltigAb" | "gueltigBis" | "ergFirmenname" | "ergStrasse" | "ergPlz" | "ergOrt">;

const vergleich = (wert: string | null) => (wert && wert in EVATR_VERGLEICH ? EVATR_VERGLEICH[wert as EvatrVergleich] : null);

/** Letzte Antwort zu einer Nummer, ohne die gesendeten Angaben; frisch heißt höchstens EVATR_FRIST_TAGE alt */
function letzteAntwort(b: Stand | undefined, jetzt: Date) {
  if (!b) return NOCH_NICHT;
  return {
    zeitpunkt: new Date(b.anfrageZeitpunkt),
    art: b.art,
    status: b.status,
    meldung: evatrMeldung(b),
    gueltig: evatrGueltig(b.status),
    frisch: evatrFrisch(b.anfrageZeitpunkt, jetzt),
    ...(b.art === "qualifiziert" && {
      ergebnis: { name: vergleich(b.ergFirmenname), strasse: vergleich(b.ergStrasse), plz: vergleich(b.ergPlz), ort: vergleich(b.ergOrt) },
    }),
  };
}

/** Zu einer Nummer: die letzte Antwort, gleich an welchem Kontakt, wie in der ZM */
async function zurNummer(ustid: string, jetzt: Date, link: Link) {
  const nummer = normalizeUstId(ustid);
  if (!evatrPruefbar(nummer)) return { ustId: nummer, hinweis: NICHT_PRUEFBAR };
  const letzte = (await letzteBestaetigungen([nummer])).get(nummer);
  const kontakte = letzte ? [] : await findContactsByUstId(nummer);
  return {
    ustId: nummer,
    letzteAntwort: letzteAntwort(letzte, jetzt),
    ...(letzte
      ? { kontakt: link(`/kontakte/${letzte.contactId}`) }
      : { kontakteMitDieserNummer: kontakte.map((k) => ({ name: k.name, link: link(`/kontakte/${k.id}`) })) }),
  };
}

/** Zu Kontakten nach Name oder Nummer: je Nummer die letzte Antwort am Kontakt, auch zu früheren Nummern, wie die Karte */
async function zuKontakten(suche: string, jetzt: Date, link: Link) {
  const treffer = await listContacts(true, undefined, suche.trim());
  const kontakte = await Promise.all(
    treffer.slice(0, KONTAKTE_HOECHSTENS).map(async (k) => {
      const antworten = await listUstIdBestaetigungen(k.id);
      const aktuell = normalizeUstId(k.ustId);
      const nummern = [...new Set([aktuell, ...antworten.map((b) => b.angefragteUstid)])].filter(Boolean);
      return {
        name: k.name,
        kundennummer: k.kundennummer || null,
        archiviert: k.archivedAt !== null,
        nummern: nummern.map((nummer) => {
          const antwort = antworten.find((b) => b.angefragteUstid === nummer);
          // Ohne Antwort und nicht bestätigbar (etwa deutsch) der Hinweis wie zur Nummer, nicht „noch nicht bestätigt“
          const stand = antwort || evatrPruefbar(nummer) ? { letzteAntwort: letzteAntwort(antwort, jetzt) } : { hinweis: NICHT_PRUEFBAR };
          return { ustId: nummer, aktuell: nummer === aktuell, ...stand };
        }),
        link: link(`/kontakte/${k.id}`),
      };
    }),
  );
  return { anzahl: treffer.length, kontakte };
}

/** Die nächste Zusammenfassende Meldung: das früheste Quartal ohne Übermittlung, sonst das letzte mit Meldung */
async function naechstesQuartal(): Promise<VatPeriod | null> {
  const quartale = await zmQuartale();
  return quartale.find((q) => !q.sent) ?? quartale.at(-1) ?? null;
}

/** Nummern, die die Meldung des Quartals als Nächstes sendet und die keine frische gültige Antwort haben, wie die Vorprüfung */
async function zurZm(quartal: string | undefined, jetzt: Date, link: Link) {
  const period = quartal ? parsePeriodKey(quartal) : await naechstesQuartal();
  if (!period) return { zm: null, hinweis: "Es gibt keine Rechnung für eine Zusammenfassende Meldung." };
  const meldung = await zmOverview(period);
  const nummern = [...zuBestaetigendeNummern(meldung.naechste.zeilen)].filter(evatrPruefbar);
  const letzte = await letzteBestaetigungen(nummern);
  const offen = nummern.filter((nummer) => !evatrFrischGueltig(letzte.get(nummer), jetzt));
  return {
    zm: {
      quartal: periodKey(period),
      bezeichnung: periodLabel(period),
      frist: meldung.frist,
      berichtigung: meldung.naechste.berichtigt,
      nummern: nummern.length,
      link: link(`/umsatzsteuer/zm/${periodKey(period)}`),
    },
    ohneFrischeGueltigeAntwort: offen.map((nummer) => ({
      ustId: nummer,
      kunde: meldung.quellen.find((q) => q.ustId === nummer)?.customer ?? null,
      letzteAntwort: letzteAntwort(letzte.get(nummer), jetzt),
    })),
  };
}

export async function ustidBestaetigungen(args: { ustid?: string; kontakt?: string; quartal?: string }, link: Link, jetzt = new Date()) {
  const ergebnis = args.ustid
    ? await zurNummer(args.ustid, jetzt, link)
    : args.kontakt
      ? await zuKontakten(args.kontakt, jetzt, link)
      : await zurZm(args.quartal, jetzt, link);
  return evatrAbgeschaltet() ? { abgeschaltet: ABGESCHALTET, ...ergebnis } : ergebnis;
}
