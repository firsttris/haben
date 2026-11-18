import { FAHRZEUG_LABEL, formatEuro, PAUSCHALE_LABEL, REISETAG_LABEL, type Fahrzeug, type PauschaleArt, type Reisetag } from "@haben/core";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { formatDate } from "../../lib/format.ts";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { useAction } from "../../lib/use-action.ts";
import { reversePauschaleFn } from "../../server/functions/pauschalen.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { PauschaleStatus } from "../../components/PauschaleStatus.tsx";
import { type Data, MAHLZEIT_LABEL } from "./-pauschalen-formulare.tsx";

export type Entry = Data["entries"][number];

/** Homeoffice und Wege zur Betriebsstätte gelten für einen Monat, die anderen Pauschalen für einen Tag */
export const monatlich = (art: string) => art === "homeoffice" || art === "entfernung";

/** Ohne Jahr in der Liste unter der Überschrift mit dem Jahr, mit Jahr im Storno-Dialog */
export function pauschaleDatum(e: { art: string; date: string }, mitJahr = false): string {
  if (!monatlich(e.art)) return formatDate(e.date);
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: mitJahr ? "numeric" : undefined, timeZone: "UTC" }).format(new Date(`${e.date}T00:00:00Z`));
}

/** Die Beschriftung der Beschreibung wie im Formular der Pauschale */
export const BESCHREIBUNG_LABEL: Record<PauschaleArt, string> = {
  homeoffice: "Notiz",
  fahrt: "Anlass und Ziel",
  verpflegung: "Anlass und Ort",
  entfernung: "Betriebsstätte",
};

/** Was der Storno-Dialog nennt: dasselbe wie die Zeile, die er zurücknimmt (DESIGN.md, Rückfragen) */
export function stornoFakten(e: Entry) {
  return [
    { label: monatlich(e.art) ? "Monat" : "Datum", value: pauschaleDatum(e, true) },
    ...(e.description ? [{ label: BESCHREIBUNG_LABEL[e.art], value: e.description }] : []),
    { label: "Angaben", value: detailText(e) },
    { label: "Betrag", value: formatEuro(e.amount), strong: true },
  ];
}

export function detailText(entry: Entry): string {
  const d = entry.details;
  if (entry.art === "homeoffice") return `${d.tage} Tag${d.tage === 1 ? "" : "e"}`;
  if (entry.art === "entfernung") return `${d.tage} Tag${d.tage === 1 ? "" : "e"} × ${d.km} km einfache Entfernung`;
  if (entry.art === "fahrt") {
    const km = Number(d.km);
    const gesamt = d.hinUndZurueck ? km * 2 : km;
    return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(gesamt)} km${d.hinUndZurueck ? " (hin und zurück)" : ""} · ${FAHRZEUG_LABEL[d.fahrzeug as Fahrzeug]}`;
  }
  const gestellt = (Object.keys(MAHLZEIT_LABEL) as (keyof typeof MAHLZEIT_LABEL)[]).filter((k) => d[k]).map((k) => MAHLZEIT_LABEL[k]);
  return `${REISETAG_LABEL[d.tag as Reisetag]}${gestellt.length ? ` · gestellt: ${gestellt.join(", ")}` : ""}`;
}

/** GmbH und UG: keine Pauschalen; Auslagen des Gesellschafters gehen mit Beleg auf das Verrechnungskonto */
export function OnlyEinzelunternehmen() {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Ausgaben ohne Beleg</div>
          <h1>Pauschalen</h1>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0, maxWidth: 760 }}>
        Pauschalen gibt es nur im Einzelunternehmen. Erstattet die Gesellschaft dem Gesellschafter Reisekosten oder Auslagen, lade die Abrechnung unter{" "}
        <Link to="/belege">Belege</Link> hoch und wähle „Vom Gesellschafter ausgelegt“.
      </p>
    </>
  );
}

export function Liste({ data }: { data: Data }) {
  const router = useRouter();
  const reverse = useServerFn(reversePauschaleFn);
  const [confirm, setConfirm] = useState<(typeof data.entries)[number] | null>(null);
  const { busy, notice, run } = useAction();

  function storno(id: string) {
    void run(async () => {
      await reverse({ data: id });
      await router.invalidate();
    });
  }

  return (
    <section className="card" aria-labelledby="liste-heading">
      <h2 id="liste-heading" style={{ margin: 0, fontSize: 16 }}>
        Eingetragen in {data.year} <span className="small muted">({data.entries.length})</span>
      </h2>
      <NoticeBanner notice={notice} />
      <ConfirmDialog
        open={confirm !== null}
        title={`${confirm ? PAUSCHALE_LABEL[confirm.art] : ""} stornieren?`}
        facts={confirm ? stornoFakten(confirm) : undefined}
        confirmLabel="Stornieren"
        danger
        onConfirm={() => confirm && storno(confirm.id)}
        onClose={() => setConfirm(null)}
      >
        <p>Haben schreibt eine Gegenzeile mit negativem Betrag und eine Gegenbuchung am selben Tag. Das Original bleibt durchgestrichen stehen.</p>
      </ConfirmDialog>
      {data.entries.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Noch keine Pauschalen für {data.year}.
        </p>
      ) : (
        <table className="report-table stack-table">
          <thead>
            <tr>
              <th scope="col" style={{ width: 120 }}>
                Datum
              </th>
              <th scope="col">Pauschale</th>
              <th scope="col" className="num" style={{ width: 110 }}>
                Betrag
              </th>
              <th scope="col" style={{ width: 150 }}>
                <span className="visually-hidden">Aktion</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.id} style={e.storniert ? { color: "var(--muted)" } : undefined}>
                <td data-label="Datum">{pauschaleDatum(e)}</td>
                <td data-label="Pauschale">
                  <span style={{ fontWeight: 500, textDecoration: e.storniert ? "line-through" : undefined }}>
                    {PAUSCHALE_LABEL[e.art]}
                    {e.description ? `: ${e.description}` : ""}
                  </span>
                  <div className="small muted">{detailText(e)}</div>
                </td>
                <td data-label="Betrag" className="num">
                  {formatEuro(e.amount)}
                </td>
                <td>
                  {e.storniert ? (
                    <PauschaleStatus storniert />
                  ) : (
                    <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => setConfirm(e)}>
                      Stornieren
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
