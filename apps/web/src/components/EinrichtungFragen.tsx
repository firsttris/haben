import { Link } from "@tanstack/react-router";
import { useId } from "react";
import { BEREICHE, type BereichId } from "../lib/bereiche.ts";
import { type Antworten, SELBSTAENDIG, type Selbstaendig, type Stand } from "../lib/einrichtung.ts";
import type { SettingsLocks } from "../server/modules/auswertungen/index.ts";
import { Field } from "./Field.tsx";

/*
 * Die Fragen zur Einrichtung (#266), je Schritt eine Komponente. Jede Frage hat „weiß ich nicht“; das lässt die
 * Firmendaten, wie sie sind. Was gerade gesperrt ist (Buchungen im Jahr, Rechtsform fest), steht als Hinweis an der Frage.
 */

type Option<T> = { value: T; label: string; disabled?: boolean };

/** Eine Frage als Gruppe von Optionsfeldern; null ist „weiß ich nicht“ */
export function Frage<T extends string | boolean>({
  frage,
  hinweis,
  optionen,
  wert,
  onChange,
  unbekannt = "Weiß ich nicht",
}: {
  frage: string;
  hinweis?: string | null;
  optionen: readonly Option<T>[];
  wert: T | null;
  onChange: (wert: T | null) => void;
  unbekannt?: string;
}) {
  const id = useId();
  const alle: Option<T | null>[] = [...optionen, { value: null, label: unbekannt }];
  return (
    <fieldset className="choice-group frage" aria-describedby={hinweis ? `${id}-hinweis` : undefined}>
      <legend>{frage}</legend>
      {hinweis && (
        <p id={`${id}-hinweis`} className="field-hint">
          {hinweis}
        </p>
      )}
      {alle.map((option) => (
        <label key={String(option.value)} className="checkbox">
          <input type="radio" name={id} checked={wert === option.value} disabled={option.disabled} onChange={() => onChange(option.value)} />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

const JA_NEIN = [
  { value: true, label: "Ja" },
  { value: false, label: "Nein" },
] as const;

type Setzen = <K extends keyof Antworten>(key: K, wert: Antworten[K]) => void;

export interface UnternehmenProps {
  antworten: Antworten;
  setzen: Setzen;
  stand: Stand;
  locks: SettingsLocks;
  steuerberatung: boolean | null;
  setSteuerberatung: (wert: boolean | null) => void;
}

/** Schritt 1: Art des Unternehmens und Umsatzsteuer; schreibt die vorhandenen Felder der Firmendaten */
export function UnternehmenFragen({ antworten, setzen, stand, locks, steuerberatung, setSteuerberatung }: UnternehmenProps) {
  const rechtsformVon = (art: Selbstaendig) => (art === "gmbh" || art === "ug" ? art : "einzelunternehmen");
  // Gesperrt: nur Antworten, die die Rechtsform ändern; Freiberufler und Gewerbe ändern nur die Einkunftsart
  const arten = (Object.keys(SELBSTAENDIG) as Selbstaendig[]).map((art) => ({
    value: art,
    label: art === "freiberufler" ? "Freiberuflich, z. B. Entwicklung, Beratung, Design" : art === "gewerbe" ? "Mit Gewerbeanmeldung" : SELBSTAENDIG[art],
    disabled: Boolean(locks.rechtsform) && rechtsformVon(art) !== stand.rechtsform,
  }));
  const kleinGesperrt = Boolean(locks.kleinunternehmer) && !stand.kleinunternehmer;
  return (
    <>
      <Frage
        frage="Wie bist du selbständig?"
        hinweis={locks.rechtsform ?? "Bestimmt EÜR oder Bilanz, Einkommen- oder Körperschaftsteuer und ob Gewerbesteuer anfällt."}
        optionen={arten}
        wert={antworten.selbstaendig}
        onChange={(wert) => setzen("selbstaendig", wert)}
      />
      <Frage
        frage="Bist du Kleinunternehmer?"
        hinweis={
          kleinGesperrt
            ? locks.kleinunternehmer
            : "Nach § 19 UStG, wenn der Umsatz im Vorjahr höchstens 25.000 € war und im laufenden Jahr 100.000 € nicht übersteigt. Dann Rechnungen ohne Umsatzsteuer und keine Voranmeldung."
        }
        optionen={[
          { value: true, label: "Ja", disabled: kleinGesperrt },
          { value: false, label: "Nein" },
        ]}
        wert={antworten.kleinunternehmer}
        onChange={(wert) => setzen("kleinunternehmer", wert)}
      />
      {antworten.kleinunternehmer !== true && (
        <>
          <Frage
            frage="Wann zahlst du die Umsatzsteuer?"
            hinweis={
              locks.versteuerung ??
              "Ist: wenn das Geld da ist (auf Antrag, § 20 UStG). Soll: mit der Rechnung. Was gilt, steht im Schreiben des Finanzamts zur steuerlichen Erfassung."
            }
            optionen={[
              { value: "ist", label: "Ist-Versteuerung, nach Zahlungseingang", disabled: Boolean(locks.versteuerung) && stand.versteuerung !== "ist" },
              { value: "soll", label: "Soll-Versteuerung, nach Rechnung", disabled: Boolean(locks.versteuerung) && stand.versteuerung !== "soll" },
            ]}
            wert={antworten.versteuerung}
            onChange={(wert) => setzen("versteuerung", wert)}
          />
          <Frage
            frage="Wie oft gibst du die Voranmeldung ab?"
            hinweis="So, wie es das Finanzamt festgelegt hat (§ 18 Abs. 2 UStG). Gilt ab Januar dieses Jahres; ein Wechsel im Jahr geht auf der Seite der Voranmeldung."
            optionen={[
              { value: "monatlich", label: "Monatlich" },
              { value: "vierteljaehrlich", label: "Vierteljährlich" },
            ]}
            wert={antworten.voranmeldung}
            onChange={(wert) => setzen("voranmeldung", wert)}
          />
        </>
      )}
      <Frage
        frage="Hast du nur steuerfreie Umsätze ohne Vorsteuerabzug, etwa Heilbehandlung oder Unterricht?"
        hinweis="Nach § 4 Nr. 14 und 21 UStG: Belege werden dann ohne Vorsteuer gebucht. Am einzelnen Beleg änderbar."
        optionen={JA_NEIN}
        wert={antworten.ohneVorsteuerabzug}
        onChange={(wert) => setzen("ohneVorsteuerabzug", wert)}
      />
      <Frage
        frage="Arbeitest du mit einer Steuerberatung?"
        hinweis="Dann zählt ihr Kontenrahmen. Den Buchungsstapel für DATEV gibt es unter Einstellungen › Export."
        optionen={JA_NEIN}
        wert={steuerberatung}
        onChange={(wert) => {
          setSteuerberatung(wert);
          setzen("kontenrahmen", wert ? (antworten.kontenrahmen ?? stand.kontenrahmen) : null);
        }}
      />
      {steuerberatung && (
        <Field label="Kontenrahmen der Steuerberatung" hint={locks.kontenrahmen ?? "Ohne Angabe SKR03."}>
          {(control) => (
            <select
              {...control}
              value={antworten.kontenrahmen ?? stand.kontenrahmen}
              disabled={Boolean(locks.kontenrahmen)}
              onChange={(e) => setzen("kontenrahmen", e.target.value === "SKR04" ? "SKR04" : "SKR03")}
            >
              <option value="SKR03">SKR03</option>
              <option value="SKR04">SKR04</option>
            </select>
          )}
        </Field>
      )}
    </>
  );
}

/** Schritt 2: neu oder Umzug. Speichert nichts, zeigt nur den Weg zum Umzug */
export function StartFrage({
  wechsel,
  setWechsel,
  einzelunternehmen,
}: {
  wechsel: boolean | null;
  setWechsel: (wert: boolean | null) => void;
  einzelunternehmen: boolean;
}) {
  return (
    <>
      <Frage
        frage="Fängst du neu an oder wechselst du von einem anderen Programm?"
        optionen={[
          { value: false, label: "Ich fange neu an" },
          { value: true, label: "Ich wechsle von einem anderen Programm" },
        ]}
        wert={wechsel}
        onChange={setWechsel}
        unbekannt="Später entscheiden"
      />
      {wechsel && (
        <div className="stack einrichtung-umzug">
          <p>
            Rechnungen, Belege, Kontakte und Buchungen aus Lexware Office, sevDesk, BuchhaltungsButler, Accountable oder WISO übernimmst du im{" "}
            <Link to="/archiv">Archiv unter „Umzug“</Link>. Haben beginnt dann mit dem Tag, ab dem du hier buchst.
          </p>
          {einzelunternehmen && (
            <p className="small muted">
              Einen Kontostand zum Start buchst du im Einzelunternehmen nicht: Die EÜR zählt nur Einnahmen und Ausgaben (§ 4 Abs. 3 EStG). Die Bank beginnt mit
              den Umsätzen ab dem Start.
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** Schritt 3: Bereiche. „Nein“ blendet den Menüpunkt aus, „weiß ich noch nicht“ lässt ihn stehen */
export function BereichFragen({ bereiche, setzen }: { bereiche: Antworten["bereiche"]; setzen: (id: BereichId, wert: boolean | null) => void }) {
  return (
    <>
      <p className="small muted" style={{ margin: 0 }}>
        Was du nicht brauchst, verschwindet nur aus dem Menü. Daten, Auswertungen und Links bleiben, und unter Einstellungen › Bereiche schaltest du es
        jederzeit wieder ein.
      </p>
      {BEREICHE.map((bereich) => (
        <Frage
          key={bereich.id}
          frage={bereich.frage}
          hinweis={`Im Menü: ${bereich.menue}`}
          optionen={JA_NEIN}
          wert={bereiche[bereich.id] ?? null}
          onChange={(wert) => setzen(bereich.id, wert)}
          unbekannt="Weiß ich noch nicht"
        />
      ))}
    </>
  );
}
