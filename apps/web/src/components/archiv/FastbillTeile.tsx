import { Link } from "@tanstack/react-router";
import { formatDateTime, formatTime } from "../../lib/format.ts";
import { Field } from "../Field.tsx";

/* Teile der Seite Archiv › Umzug, die nur FastBill braucht: Login-E-Mail und Tarif beim Zugang, Hinweise beim Warten des Abrufs, der Weg zu den Artikeln. */

/** Ab so langer Stille im laufenden Abruf erklärt die Seite, worauf er wartet */
const STALLED_MS = 60_000;

/** Login-E-Mail und Tarif; der Tarif bestimmt die Stundengrenze der API */
export function FastbillLoginFields({
  email,
  onEmail,
  emailError,
  callsPerHour,
  onCallsPerHour,
  plans,
}: {
  email: string;
  onEmail: (value: string) => void;
  emailError: string | undefined;
  callsPerHour: number;
  onCallsPerHour: (value: number) => void;
  plans: readonly { callsPerHour: number; label: string }[];
}) {
  return (
    <>
      <Field label="Login-E-Mail von FastBill" error={emailError}>
        {(control) => (
          <input
            {...control}
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={email}
            onChange={(event) => onEmail(event.target.value)}
            aria-invalid={emailError ? true : undefined}
          />
        )}
      </Field>
      <Field label="Tarif">
        {(control) => (
          <select {...control} value={callsPerHour} onChange={(event) => onCallsPerHour(Number(event.target.value))}>
            {plans.map((p) => (
              <option key={p.callsPerHour} value={p.callsPerHour}>
                {p.label} ({p.callsPerHour} Anfragen pro Stunde)
              </option>
            ))}
          </select>
        )}
      </Field>
    </>
  );
}

/** Warum ein laufender Abruf gerade nicht vorankommt: Stundengrenze erreicht oder FastBill antwortet langsam */
export function ImportWaitNotice({ waitingUntil, fastbill, updatedAt }: { waitingUntil: string | null | undefined; fastbill: boolean; updatedAt: Date }) {
  if (waitingUntil && Date.parse(waitingUntil) > Date.now()) {
    return (
      <div className="banner banner-info" role="status">
        Wartet bis {formatDateTime(new Date(waitingUntil))}: Die Anfragen dieser Stunde sind aufgebraucht, danach geht der Abruf von selbst weiter.
      </div>
    );
  }
  // Der Fortschritt wird bei jeder Bewegung gespeichert; steht er still, wartet der Abruf auf die Gegenseite
  if (!fastbill || Date.now() - new Date(updatedAt).getTime() <= STALLED_MS) return null;
  return (
    <div className="banner banner-info" role="status">
      FastBill antwortet gerade langsam oder bremst die Anfragen, etwa weil andere Programme dieselbe Stundengrenze nutzen. Der Abruf versucht es weiter; letzte
      Bewegung {formatDateTime(new Date(updatedAt))}. Endet er mit einem Fehler, starte ihn später neu: Übernommenes bleibt.
    </div>
  );
}

/** Artikel sind keine Belege: Sie kommen über den CSV-Import mit dessen Vorschau in den Artikelkatalog, nicht ins Archiv */
export function FastbillArticles() {
  return (
    <section className="card stack" aria-labelledby="fastbill-articles-heading">
      <h2 id="fastbill-articles-heading" style={{ margin: 0 }}>
        Artikel
      </h2>
      <p className="muted small" style={{ margin: 0 }}>
        Artikel kommen nicht ins Archiv, sondern in den Artikelkatalog. Haben holt sie mit deinem API-Schlüssel und zeigt sie im CSV-Import zur Prüfung;
        übernommen wird erst dort. Brutto eingegebene Preise bleiben Endpreise.
      </p>
      <div className="actions">
        <Link to="/csv-import" search={{ art: "artikel", quelle: "fastbill" }} className="btn">
          Artikel aus FastBill übernehmen
        </Link>
      </div>
    </section>
  );
}

/**
 * Anfragen der letzten Stunde, wie Haben sie gezählt hat. FastBill nennt den Rest nicht; Anfragen anderer Programme mit
 * demselben Schlüssel kennt Haben nicht.
 */
export function fastbillUsageText(usage: { used: number; freeAt: string | null } | null | undefined, callsPerHour: number): string {
  if (!usage || usage.used === 0) return "";
  const free = Math.max(0, callsPerHour - usage.used);
  const next = usage.freeAt ? `, die nächste wird um ${formatTime(usage.freeAt)} Uhr frei` : "";
  return ` In der letzten Stunde hat Haben ${usage.used} davon genutzt, ${free} ${free === 1 ? "ist" : "sind"} noch frei${free === 0 ? next : ""}. Anfragen anderer Programme mit demselben Schlüssel zählt FastBill mit, Haben sieht sie nicht.`;
}
