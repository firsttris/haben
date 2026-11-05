import { formatEuro, parseEuro } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState } from "react";
import { formatDate } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { entwurfLoeschenFn, entwurfNeuBerechnenFn, festschreibenFn, stornierenFn, type getLohn } from "../../server/functions/lohn.ts";
import { NoticeBanner } from "../NoticeBanner.tsx";

/*
 * Eine Abrechnung im Monat: Beträge, Hinweise und je nach Stand die Aktionen. Ein Entwurf lässt sich neu rechnen (auf
 * Wunsch mit einem anderen Entgelt dieses Monats), löschen und festschreiben; eine festgeschriebene nur stornieren.
 */

type Lohn = Awaited<ReturnType<typeof getLohn>>;
export type Abrechnung = Lohn["monat"]["zeilen"][number]["payslips"][number];

const STUFE = { A: "Stufe A", B: "Stufe B", C: "Stufe C" } as const;

function status(p: Abrechnung): { text: string; tone: string } {
  if (p.storno) return { text: `storniert am ${formatDate(p.storno.date)}`, tone: "pill-danger" };
  if (p.lockedAt) return { text: "festgeschrieben", tone: "pill-ok" };
  if (p.gegenpruefen) return { text: "Entwurf, gegenprüfen", tone: "pill-warn" };
  return { text: "Entwurf", tone: "pill-info" };
}

function Betraege({ p }: { p: Abrechnung }) {
  const zeilen: [string, number][] = [
    ["Brutto", p.brutto],
    ["Lohnsteuer", -p.lohnsteuer],
    ["Solidaritätszuschlag", -p.soli],
    ["Kirchensteuer", -p.kirchensteuer],
    ["Sozialversicherung (Anteil Beschäftigte)", -p.svArbeitnehmer],
    ["Netto", p.netto],
    ["Auszahlung", p.auszahlung],
    ["Arbeitgeber zusätzlich (Anteile, Umlagen, Pauschsteuer)", p.svArbeitgeber],
  ];
  return (
    <table className="report-table" aria-label="Beträge">
      <tbody>
        {zeilen.map(([label, betrag]) => (
          <tr key={label} style={label === "Auszahlung" ? { fontWeight: 600 } : undefined}>
            <th scope="row">{label}</th>
            <td className="num">{formatEuro(betrag)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EntwurfAktionen({ p }: { p: Abrechnung }) {
  const router = useRouter();
  const neu = useServerFn(entwurfNeuBerechnenFn);
  const loeschen = useServerFn(entwurfLoeschenFn);
  const fest = useServerFn(festschreibenFn);
  const { busy, notice, setNotice, run } = useAction();
  const [entgelt, setEntgelt] = useState("");
  const [geprueft, setGeprueft] = useState(false);
  const [bestaetigen, setBestaetigen] = useState(false);
  const entgeltId = useId();
  const sperre = p.fehlend.length > 0 || p.veraltet || (p.gegenpruefen && !geprueft);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <form
        className="actions"
        style={{ alignItems: "end" }}
        aria-label="Entwurf neu berechnen"
        onSubmit={(event) => {
          event.preventDefault();
          const betrag = entgelt.trim() ? parseEuro(entgelt) : null;
          if (entgelt.trim() && !betrag) {
            setNotice({ tone: "danger", text: "Das Entgelt ist kein gültiger Betrag." });
            return;
          }
          void run(async () => {
            await neu({ data: { id: p.id, entgelt: betrag } });
            setEntgelt("");
            await router.invalidate();
          }, "Entwurf neu berechnet.");
        }}
      >
        <label className="field" htmlFor={entgeltId}>
          Entgelt dieses Monats (leer: Monatsgehalt)
          <input id={entgeltId} inputMode="decimal" value={entgelt} onChange={(e) => setEntgelt(e.target.value)} placeholder={formatEuro(p.brutto)} />
        </label>
        <button type="submit" className="btn btn-sm" disabled={busy}>
          Neu berechnen
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await loeschen({ data: p.id });
              await router.invalidate();
            })
          }
        >
          Entwurf löschen
        </button>
      </form>
      {p.gegenpruefen && (
        <label className="checkbox">
          <input type="checkbox" checked={geprueft} onChange={(e) => setGeprueft(e.target.checked)} />
          Gegen ein Lohnprogramm oder die Steuerberatung gegengeprüft
        </label>
      )}
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || sperre}
          onClick={() =>
            bestaetigen
              ? void run(async () => {
                  await fest({ data: { id: p.id, gegengeprueft: geprueft } });
                  await router.invalidate();
                }, "Abrechnung festgeschrieben.")
              : setBestaetigen(true)
          }
        >
          {bestaetigen ? "Jetzt festschreiben" : "Festschreiben"}
        </button>
      </div>
      {bestaetigen && (
        <p className="small muted" style={{ margin: 0 }}>
          Festgeschrieben ist die Abrechnung unveränderbar; korrigieren geht dann nur mit Storno.
        </p>
      )}
      <NoticeBanner notice={notice} />
    </div>
  );
}

function Storno({ p }: { p: Abrechnung }) {
  const router = useRouter();
  const storno = useServerFn(stornierenFn);
  const { busy, notice, run } = useAction();
  const [offen, setOffen] = useState(false);
  const [grund, setGrund] = useState("");
  const grundId = useId();
  if (!offen) {
    return (
      <div className="actions">
        <button type="button" className="btn btn-sm btn-danger" onClick={() => setOffen(true)}>
          Stornieren
        </button>
      </div>
    );
  }
  return (
    <form
      className="stack"
      style={{ gap: 8 }}
      aria-label="Abrechnung stornieren"
      onSubmit={(event) => {
        event.preventDefault();
        void run(async () => {
          const r = await storno({ data: { id: p.id, grund } });
          await router.invalidate();
          if (r.meldung) throw new Error(`Storniert. Eine neue Abrechnung ließ sich nicht rechnen: ${r.meldung}`);
        }, "Storniert; die neue Abrechnung steht als Entwurf bereit.");
      }}
    >
      <label className="field" htmlFor={grundId}>
        Grund des Stornos
        <input id={grundId} value={grund} onChange={(e) => setGrund(e.target.value)} maxLength={500} />
      </label>
      <div className="actions">
        <button type="submit" className="btn btn-sm btn-danger" disabled={busy}>
          Jetzt stornieren
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}

export function AbrechnungKarte({ p }: { p: Abrechnung }) {
  const s = status(p);
  const headingId = useId();
  return (
    <section className="stack" style={{ gap: 10 }} aria-labelledby={headingId}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <h3 id={headingId} style={{ margin: 0 }}>
          Abrechnung {STUFE[p.stufe]}, Zahltag {formatDate(p.zahltag)}
        </h3>
        <span className={`pill ${s.tone}`}>{s.text}</span>
      </div>
      <Betraege p={p} />
      {p.hinweise.map((h) => (
        <div key={h} className="banner banner-info" role="note">
          {h}
        </div>
      ))}
      {!p.lockedAt && p.fehlend.length > 0 && (
        <div className="banner banner-danger" role="note">
          Für die Entgeltbescheinigung fehlt: {p.fehlend.join(", ")}. Ergänze die Stammdaten und rechne den Entwurf neu.
        </div>
      )}
      {p.veraltet && (
        <div className="banner banner-danger" role="note">
          Die Stammdaten haben sich seit dem Entwurf geändert. Rechne den Entwurf neu, bevor du ihn festschreibst.
        </div>
      )}
      {p.storno?.reason && <p className="small muted">Grund des Stornos: {p.storno.reason}</p>}
      <div className="actions">
        <a href={`/api/lohn/abrechnung/${p.id}`} target="_blank" rel="noreferrer">
          {p.lockedAt ? "Entgeltabrechnung (PDF)" : "Entwurf ansehen (PDF)"}
        </a>
      </div>
      {!p.lockedAt && <EntwurfAktionen p={p} />}
      {p.lockedAt && !p.storno && <Storno p={p} />}
    </section>
  );
}
