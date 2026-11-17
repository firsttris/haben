import { useServerFn } from "@tanstack/react-start";
import { useId, useState, type FormEvent } from "react";
import { errorMessage } from "../lib/format.ts";
import { useSubmitCheck } from "../lib/use-submit-check.ts";
import { cancelFints, continueFints } from "../server/functions/fints.ts";
import { Field } from "./Field.tsx";

/*
 * Ein Schritt beim Verbinden oder Abrufen über FinTS (#654), zwischen zwei Anfragen an die Bank: TAN-Verfahren oder
 * -Medium wählen, TAN eingeben oder in der App freigeben, beim Verbinden die Konten wählen.
 */

export type Schritt = Awaited<ReturnType<typeof continueFints>>;
export type Offen = Exclude<Schritt, { art: "fertig" }>;

/** Die Konten, die die Bank für den Abruf meldet: Nur die angehakten übernimmt Haben */
function KontenWahl({
  konten,
  auswahl,
  setAuswahl,
  fehler,
}: {
  konten: Extract<Offen, { art: "konten" }>["konten"];
  auswahl: string[];
  setAuswahl: (auswahl: string[]) => void;
  fehler: string | undefined;
}) {
  const id = useId();
  return (
    <fieldset className="choice-group" aria-describedby={`${id}-hinweis`}>
      <legend>Konten</legend>
      <p id={`${id}-hinweis`} className="field-hint" style={{ margin: 0 }}>
        Nur die angehakten Konten legt Haben an und ruft ihre Umsätze ab.
      </p>
      {konten.map((k) => (
        <label key={k.iban} className="checkbox">
          <input
            type="checkbox"
            checked={auswahl.includes(k.iban)}
            onChange={(e) => setAuswahl(e.target.checked ? [...auswahl, k.iban] : auswahl.filter((iban) => iban !== k.iban))}
            aria-invalid={fehler ? true : undefined}
            aria-describedby={fehler ? `${id}-fehler` : undefined}
          />
          {k.name} …{k.iban.slice(-4)}
        </label>
      ))}
      {fehler && (
        <span id={`${id}-fehler`} className="field-error">
          {fehler}
        </span>
      )}
    </fieldset>
  );
}

/** Was die Bank gerade will: ein TAN-Verfahren oder -Medium wählen, eine TAN eingeben oder in der App freigeben; oder die Konten */
export function SchrittForm({ schritt, onSchritt, onAbbrechen }: { schritt: Offen; onSchritt: (s: Schritt) => Promise<void>; onAbbrechen: () => void }) {
  const weiter = useServerFn(continueFints);
  const verwerfen = useServerFn(cancelFints);
  const medien = schritt.art === "verfahren" && schritt.verfahren.length === 1 ? schritt.verfahren[0]!.medien : [];
  const [wahl, setWahl] = useState(schritt.art === "verfahren" ? (medien[0] ?? String(schritt.verfahren[0]?.id ?? "")) : "");
  const [auswahl, setAuswahl] = useState(schritt.art === "konten" ? schritt.konten.filter((k) => k.gewaehlt).map((k) => k.iban) : []);
  const [tan, setTan] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    form,
    error: fehler,
    check,
  } = useSubmitCheck({
    tan: schritt.art === "tan" && !schritt.entkoppelt && !tan.trim() ? "Bitte die TAN eingeben." : null,
    konten: schritt.art === "konten" && auswahl.length === 0 ? "Wähle mindestens ein Konto." : null,
  });

  /** Die Antwort an die Bank für diesen Schritt */
  function eingabe() {
    const { vorgang } = schritt;
    if (schritt.art === "tan") return { vorgang, tan: schritt.entkoppelt ? undefined : tan };
    if (schritt.art === "konten") return { vorgang, konten: auswahl };
    return medien.length > 0 ? { vorgang, verfahren: schritt.verfahren[0]!.id, medium: wahl } : { vorgang, verfahren: Number(wahl) };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !check()) return;
    setBusy(true);
    setError(null);
    try {
      await onSchritt(await weiter({ data: eingabe() }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function abbrechen() {
    void verwerfen({ data: schritt.vorgang }).catch(() => undefined);
    onAbbrechen();
  }

  return (
    <form
      ref={form}
      onSubmit={onSubmit}
      className="stack"
      style={{ gap: 12, maxWidth: 560 }}
      aria-label={schritt.art === "konten" ? "Konten wählen" : "Freigabe bei der Bank"}
      noValidate
    >
      {schritt.art === "konten" ? (
        <KontenWahl konten={schritt.konten} auswahl={auswahl} setAuswahl={setAuswahl} fehler={fehler("konten")} />
      ) : schritt.art === "verfahren" ? (
        <Field
          label={medien.length > 0 ? "TAN-Medium" : "TAN-Verfahren"}
          hint="Wie du Aufträge bei deiner Bank freigibst; die Bank nennt nur, was für deinen Zugang geht."
        >
          {(control) => (
            <select {...control} value={wahl} onChange={(e) => setWahl(e.target.value)}>
              {medien.length > 0
                ? medien.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))
                : schritt.verfahren.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
            </select>
          )}
        </Field>
      ) : (
        <>
          <p style={{ margin: 0, whiteSpace: "pre-line" }}>{schritt.text}</p>
          {schritt.bild && <img src={schritt.bild} alt="Grafik der Bank für die photoTAN" style={{ maxWidth: 240 }} />}
          {schritt.hinweis && (
            <div className="banner banner-info" role="status">
              {schritt.hinweis}
            </div>
          )}
          {!schritt.entkoppelt && (
            <Field label="TAN" error={fehler("tan")}>
              {(control) => (
                <input {...control} value={tan} onChange={(e) => setTan(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required autoFocus />
              )}
            </Field>
          )}
        </>
      )}
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn" onClick={abbrechen} disabled={busy}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Warte auf die Bank …" : schritt.art !== "tan" ? "Weiter" : schritt.entkoppelt ? "Freigegeben, weiter" : "TAN senden"}
        </button>
      </div>
    </form>
  );
}
