import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { formatDate } from "../lib/format.ts";
import type { HinterlegungStand } from "../server/modules/buchhaltung/index.ts";
import { Icon } from "./Icon.tsx";

/** Eine Angabe unter der Bilanz: „Keine“ vorgewählt, sonst Freitext, den Haben unverändert unter die Bilanz setzt */
function Angabe({ name, legend, hint }: { name: string; legend: string; hint: string }) {
  const id = useId();
  const [vorhanden, setVorhanden] = useState(false);
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 6 }} aria-describedby={`${id}-hint`}>
      <legend style={{ fontWeight: 600, marginBottom: 2 }}>{legend}</legend>
      <span id={`${id}-hint`} className="field-hint">
        {hint}
      </span>
      <label className="checkbox">
        <input type="radio" name={`${name}-art`} checked={!vorhanden} onChange={() => setVorhanden(false)} />
        Keine
      </label>
      <label className="checkbox">
        <input type="radio" name={`${name}-art`} checked={vorhanden} onChange={() => setVorhanden(true)} />
        Ja, folgende
      </label>
      {vorhanden && (
        <label className="field">
          Angaben, wie sie unter der Bilanz stehen sollen
          <textarea name={name} required maxLength={2000} rows={3} />
        </label>
      )}
    </fieldset>
  );
}

/**
 * Bilanz zur Hinterlegung beim Unternehmensregister (§ 326 Abs. 2 HGB) auf der Abschluss-Seite. Das Formular lädt das PDF
 * direkt von /api/hinterlegung/<jahr>; gespeichert wird nichts.
 */
export function Hinterlegung({ year, stand, closed }: { year: number; stand: HinterlegungStand; closed: boolean }) {
  const id = useId();
  const blocked = stand.maengel.length > 0;
  return (
    <section className="card" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} style={{ marginTop: 0 }}>
        Hinterlegung beim Unternehmensregister {year}
      </h2>
      <p className="small muted" style={{ marginTop: 0, maxWidth: 760 }}>
        Als Kleinstkapitalgesellschaft hinterlegt die Gesellschaft nur die Bilanz, statt den Jahresabschluss offenzulegen (§ 326 Abs. 2 HGB). Haben erstellt
        sie als PDF mit Firma, Sitz und Registernummer, den Vorjahreszahlen und den Angaben unter der Bilanz, die den Anhang ersetzen. Das PDF lädst du auf
        der Publikations-Plattform des Bundesanzeiger Verlags (publikations-plattform.de) als Hinterlegungsauftrag hoch; der Verlag berechnet dafür eine Gebühr.
      </p>
      <p style={{ maxWidth: 760 }}>
        {stand.fristAbgelaufen ? (
          <strong>Die Frist ist am {formatDate(stand.frist)} abgelaufen; hinterlege so bald wie möglich, sonst droht ein Ordnungsgeld (§ 335 HGB).</strong>
        ) : (
          <>
            Frist: bis {formatDate(stand.frist)}, ein Jahr nach dem Bilanzstichtag (§ 325 Abs. 1a HGB).
          </>
        )}
      </p>
      {!closed && (
        <div className="banner banner-info" role="note" style={{ marginBottom: 16 }}>
          <Icon name="info" />
          <span>
            Das Jahr {year} ist noch nicht abgeschlossen. Hinterlege erst, wenn die Steuerberatung den Abschluss freigegeben, die Gesellschafterversammlung
            ihn festgestellt hat und das Jahr abgeschlossen ist; jede spätere Buchung ins Jahr ändert die Bilanz.
          </span>
        </div>
      )}
      {!stand.vorjahr && (
        <p className="small" style={{ maxWidth: 760 }}>
          Ohne Vorjahresspalte: Zum 1.1.{year} gibt es in Haben keine Salden. Im ersten Geschäftsjahr ist das richtig; sonst gehören die Vorjahreszahlen dazu
          (§ 265 Abs. 2 HGB), dann übernimm die Bestände mit einer Eröffnungsbuchung.
        </p>
      )}
      {blocked && (
        <div className="banner" role="note" style={{ marginBottom: 16 }}>
          <span>
            Noch nicht möglich: {stand.maengel.join(" ")} Sitz, Registergericht und Registernummer trägst du unter{" "}
            <Link to="/einstellungen">Einstellungen › Firmendaten</Link> ein.
          </span>
        </div>
      )}
      <form method="get" action={`/api/hinterlegung/${year}`} className="stack" style={{ gap: 16, maxWidth: 760 }} aria-label="Bilanz zur Hinterlegung">
        <label className="field" style={{ maxWidth: 260 }}>
          Tag der Feststellung
          <input type="date" name="festgestelltAm" required min={`${year + 1}-01-01`} aria-describedby={`${id}-feststellung`} />
          <span id={`${id}-feststellung`} className="small muted">
            An dem die Gesellschafter den Abschluss festgestellt haben (§ 46 Nr. 1 GmbHG); er steht unter der Bilanz (§ 328 Abs. 1a HGB).
          </span>
        </label>
        <Angabe
          name="haftungsverhaeltnisse"
          legend="Haftungsverhältnisse (§ 268 Abs. 7, § 251 HGB)"
          hint="Bürgschaften, Gewährleistungen und Sicherheiten für fremde Verbindlichkeiten, die nicht in der Bilanz stehen."
        />
        <Angabe
          name="organkredite"
          legend="Vorschüsse und Kredite an Geschäftsführer (§ 285 Nr. 9 Buchst. c HGB)"
          hint="Mit Zinssatz, wesentlichen Bedingungen und im Jahr zurückgezahlten Beträgen, ebenso Haftungsverhältnisse zugunsten der Geschäftsführer."
        />
        <div>
          <button type="submit" className="btn btn-primary" disabled={blocked}>
            Bilanz als PDF herunterladen
          </button>
        </div>
      </form>
    </section>
  );
}
