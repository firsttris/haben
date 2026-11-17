import { formatEuro } from "@haben/core";
import { abgabePille } from "../../lib/elster.ts";
import { Status } from "../Status.tsx";
import type { Data } from "./typen.ts";

type Teil = Data["ust"];

/** Stand der Abgabe; `verwaltet` ist false für die Einkommensteuer, deren Abgabe Haben ohne Vermerk nicht kennt (#869) */
export function SentPill({ sent, submitted, verwaltet }: { sent: Teil["sent"]; submitted: Teil["submitted"]; verwaltet?: boolean }) {
  const pille = abgabePille({ sent: sent?.createdAt ?? null, submitted, verwaltet });
  return (
    <Status tone={pille.ok ? "ok" : undefined} inline>
      {pille.text}
    </Status>
  );
}

type Id = "ust" | "euer" | "est";

/** Die Reihenfolge der Seite; der Halbsatz sagt, woher die Erklärung ihre Zahlen hat */
const SCHRITTE: readonly { id: Id; label: string; woher: string }[] = [
  { id: "ust", label: "Umsatzsteuer", woher: "aus den Buchungen, verrechnet mit den gesendeten Voranmeldungen" },
  { id: "euer", label: "Anlage EÜR", woher: "Einnahmen und Ausgaben aus den Buchungen, daraus der Gewinn" },
  {
    id: "est",
    label: "Einkommensteuer",
    woher: "übernimmt den Gewinn aus der EÜR; Arbeitslohn, Vorsorge, Sonderausgaben, Kinder und Kapitalerträge trägst du ein",
  },
];

type Stand = Pick<Teil, "sent" | "submitted" | "issues"> & { verwaltet?: boolean; geschuldet?: boolean };

const erledigt = (teil: Stand) => Boolean(teil.sent || teil.submitted);

/**
 * Die erste Erklärung in der Reihenfolge, die weder übermittelt noch als abgegeben vermerkt ist, und was dort zu tun ist:
 * mit Fehlern in den Hinweisen zuerst diese klären, sonst prüfen und übermitteln. Eine Erklärung, die Haben nicht verwaltet
 * (die Einkommensteuer ohne Vermerk: Haben weiß nicht, ob sie außerhalb abgegeben wurde, #869), ist keine offene Pflicht
 * und wird nie der nächste Schritt; ebenso nicht eine Erklärung, die gar nicht geschuldet ist (die Umsatzsteuererklärung
 * eines Kleinunternehmers ab 2024, § 18 Abs. 3 UStG): ihr Fehlerhinweis lässt sich nicht klären. Null, wenn nichts bleibt.
 */
export function naechsterSchritt(data: Record<Id, Stand>): { id: Id; text: string } | null {
  const offen = SCHRITTE.find((s) => !erledigt(data[s.id]) && data[s.id].verwaltet !== false && data[s.id].geschuldet !== false);
  if (!offen) return null;
  const blockiert = data[offen.id].issues.some((i) => i.tone === "fehler");
  return { id: offen.id, text: blockiert ? `Hinweise zur ${offen.label} klären` : `${offen.label} prüfen und übermitteln` };
}

/** Stand der drei Erklärungen in der Reihenfolge, in der sie anstehen, mit dem nächsten Schritt; die Namen führen zum Abschnitt */
export function Reihenfolge({ data }: { data: Data }) {
  const schritt = naechsterSchritt(data);
  const teile: Record<Id, Stand> = data;
  const geschuldet = SCHRITTE.filter((s) => teile[s.id].geschuldet !== false);
  return (
    <section className="card" aria-label="Reihenfolge der Erklärungen" style={{ gap: 12 }}>
      <ol className="reihenfolge">
        {SCHRITTE.map((s) => {
          const teil = data[s.id];
          const betrag = teil.submitted?.amount;
          return (
            <li key={s.id}>
              <div className="reihenfolge-zeile">
                <span className="reihenfolge-text">
                  <a href={`#${s.id}`}>{s.label}</a>
                  <span className="small muted">{s.woher}</span>
                </span>
                <SentPill sent={teil.sent} submitted={teil.submitted} verwaltet={"verwaltet" in teil ? teil.verwaltet : true} />
                {betrag !== null && betrag !== undefined && <span className="num">{formatEuro(betrag)}</span>}
              </div>
            </li>
          );
        })}
      </ol>
      <p style={{ margin: 0 }}>
        {schritt ? (
          <>
            <strong>Nächster Schritt:</strong> <a href={`#${schritt.id}`}>{schritt.text}</a>
          </>
        ) : geschuldet.every((s) => erledigt(teile[s.id])) ? (
          <strong>{`Alle ${geschuldet.length === SCHRITTE.length ? "drei " : ""}Erklärungen sind abgegeben.`}</strong>
        ) : (
          <>
            <strong>Nächster Schritt:</strong> keiner, den Haben kennt. Die Einkommensteuer gilt erst mit Übermittlung oder Vermerk als abgegeben.
          </>
        )}
      </p>
      <p className="small muted" style={{ margin: 0 }}>
        Weiter unten: <a href="#vast">Belege von ELSTER</a>, <a href="#verlauf">Verlauf</a>
      </p>
    </section>
  );
}
