import { formatDecimal, parseEuro } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { KIRCHENSTEUER_FORTSCHREIBUNG } from "../../lib/kirchensteuer.ts";
import { Field } from "../../components/Field.tsx";
import { type Basis, type Data, prepaymentLetter } from "./-finanzamt-daten.ts";
import { MessageForm } from "./-finanzamt-nachrichten.tsx";
import { Schaetzung } from "./-finanzamt-schaetzung.tsx";

export function PrepaymentForm({ data, basis: b }: { data: Data; basis: Basis }) {
  const [current, setCurrent] = useState("");
  const p = b.prognose;
  const [wanted, setWanted] = useState(p.jeQuartal > 0 ? formatDecimal(p.jeQuartal) : "");
  const [reason, setReason] = useState("");
  const [usePrognose, setUsePrognose] = useState(true);
  const currentCents = current.trim() ? parseEuro(current) : null;
  const wantedCents = wanted.trim() ? parseEuro(wanted) : null;
  const letter = prepaymentLetter(data, b, currentCents, wantedCents, reason, usePrognose);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <section className="card" aria-labelledby="basis-heading">
        <h2 id="basis-heading">Einkommensteuer-Vorauszahlungen {b.year}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Das Finanzamt setzt die Vorauszahlungen (fällig 10.3., 10.6., 10.9. und 10.12.) nach dem letzten Bescheid fest. Verdienst du weniger, kannst du
          formlos eine Herabsetzung beantragen. Haben schreibt den Antrag mit den Zahlen aus deiner EÜR; du prüfst den Text und schickst ihn als Nachricht an
          dein Finanzamt.
        </p>
        <Schaetzung basis={b} />
        {/* Die Prognose übernimmt die Angaben des Vorjahres; ohne den Hinweis bleibt eine fehlende
            Lohnkirchensteuer dort unbemerkt (#1451). Lohnkirchensteuer gibt es nur mit Arbeitslohn,
            für Freiberufler ohne Lohn wäre der Satz nur Rauschen */}
        {p.einkuenfteArbeit !== 0 && b.angabenAus !== null && b.angabenAus < b.year && (
          <p className="small muted" style={{ margin: 0 }}>
            {KIRCHENSTEUER_FORTSCHREIBUNG}
          </p>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          {b.angabenAus === null
            ? "Ohne gespeicherte Angaben zur Einkommensteuer (Vorsorge, Kinder …) rechnet Haben nur mit dem Sonderausgaben-Pauschbetrag. "
            : b.angabenAus < b.year
              ? `Abzüge aus deinen Angaben zur Einkommensteuer ${b.angabenAus}. `
              : ""}
          {b.priorBenefitsOmitted && `Einkommensersatzleistungen aus ${b.angabenAus} sind in dieser Schätzung für ${b.year} nicht enthalten. `}
          Grundlage sind der Gewinn aus der Buchhaltung und der Arbeitslohn aus deinen Angaben; Vermietung und Kapitalerträge fehlen. Eine Schätzung, keine
          Steuerberechnung.{" "}
          <Link to="/jahreserklaerung/$jahr" params={{ jahr: String(b.year) }}>
            Angaben bearbeiten
          </Link>
        </p>
        <label className="checkbox">
          <input type="checkbox" checked={usePrognose} onChange={(e) => setUsePrognose(e.target.checked)} />
          Voraussichtliche Steuer im Antrag nennen
        </label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Field label="Bisherige Vorauszahlung je Quartal (€)" style={{ flex: "1 1 200px" }}>
            {(control) => (
              <input
                {...control}
                inputMode="decimal"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                placeholder="laut letztem Bescheid"
                aria-invalid={current.trim() !== "" && currentCents === null}
              />
            )}
          </Field>
          <Field label="Gewünschte Vorauszahlung je Quartal (€)" style={{ flex: "1 1 200px" }}>
            {(control) => (
              <input
                {...control}
                inputMode="decimal"
                value={wanted}
                onChange={(e) => setWanted(e.target.value)}
                placeholder="z. B. 1.000,00"
                aria-invalid={wanted.trim() !== "" && wantedCents === null}
              />
            )}
          </Field>
        </div>
        <Field label="Weitere Begründung (optional)">
          {(control) => (
            <textarea {...control} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. ein großer Auftrag ist weggefallen" />
          )}
        </Field>
        <p className="small muted" style={{ margin: 0 }}>
          Die Hochrechnung nimmt den bisherigen Gewinn taggenau aufs Jahr. Die gewünschte Vorauszahlung ist mit einem Viertel der voraussichtlichen Steuer
          vorbelegt, du kannst sie ändern.
        </p>
      </section>
      <MessageForm data={data} topic="vorauszahlung" initial={letter} figures={{ ...b, current: currentCents, wanted: wantedCents }} />
    </div>
  );
}
