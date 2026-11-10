import { formatEuro, parseEuro } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { formatDate } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { entwurfLoeschenFn, entwurfNeuBerechnenFn, festschreibenFn, nachbuchenFn, stornierenFn, type getLohn } from "../../server/functions/lohn.ts";
import { NoticeBanner } from "../NoticeBanner.tsx";
import { ConfirmDialog } from "../ConfirmDialog.tsx";
import { Field } from "../Field.tsx";

/*
 * Eine Abrechnung im Monat: Beträge, Hinweise und je nach Stand die Aktionen. Ein Entwurf lässt sich neu rechnen (auf
 * Wunsch mit einem anderen Entgelt dieses Monats), löschen und festschreiben (das bucht sie); eine festgeschriebene nur
 * stornieren (mit Gegenbuchung). Eine vor der Lohnbuchung festgeschriebene Abrechnung lässt sich nachbuchen.
 */

type Lohn = Awaited<ReturnType<typeof getLohn>>;
export type Abrechnung = Lohn["monat"]["zeilen"][number]["payslips"][number];

const STUFE = { A: "Stufe A", B: "Stufe B", C: "Stufe C" } as const;

function status(p: Abrechnung): { text: string; tone: string } {
  if (p.storno) return { text: `storniert am ${formatDate(p.storno.date)}`, tone: "pill-danger" };
  if (p.lockedAt) return { text: p.gebucht ? "festgeschrieben und gebucht" : "festgeschrieben", tone: "pill-ok" };
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

/** Zustand der Aktionen; liegt in der Karte, damit die Meldung bleibt, wenn der Entwurf nach dem Festschreiben verschwindet */
type Aktion = ReturnType<typeof useAction>;

function abrechnungFakten(name: string, p: Abrechnung) {
  return [
    { label: "Person", value: name },
    { label: "Brutto", value: formatEuro(p.brutto) },
    { label: "Auszahlung", value: formatEuro(p.auszahlung), strong: true },
  ];
}

function EntwurfAktionen({ p, name, aktion }: { p: Abrechnung; name: string; aktion: Aktion }) {
  const router = useRouter();
  const neu = useServerFn(entwurfNeuBerechnenFn);
  const loeschen = useServerFn(entwurfLoeschenFn);
  const fest = useServerFn(festschreibenFn);
  const { busy, setNotice, run } = aktion;
  const [entgelt, setEntgelt] = useState("");
  const [geprueft, setGeprueft] = useState(false);
  const [bestaetigen, setBestaetigen] = useState(false);
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
        <Field label="Entgelt dieses Monats (leer: Monatsgehalt)">
          {(control) => (
            <input {...control} inputMode="decimal" value={entgelt} onChange={(e) => setEntgelt(e.target.value)} placeholder={formatEuro(p.brutto)} />
          )}
        </Field>
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
        <button type="button" className="btn btn-primary" disabled={busy || sperre} onClick={() => setBestaetigen(true)}>
          Festschreiben
        </button>
      </div>
      <ConfirmDialog
        open={bestaetigen}
        title={`Abrechnung mit Zahltag ${formatDate(p.zahltag)} festschreiben?`}
        facts={abrechnungFakten(name, p)}
        confirmLabel="Festschreiben"
        onConfirm={() =>
          void run(async () => {
            await fest({ data: { id: p.id, gegengeprueft: geprueft } });
            await router.invalidate();
          }, "Abrechnung festgeschrieben.")
        }
        onClose={() => setBestaetigen(false)}
      >
        <p>Festgeschrieben ist die Abrechnung unveränderbar und gebucht; korrigieren geht dann nur mit Storno.</p>
      </ConfirmDialog>
    </div>
  );
}

/** Festgeschrieben, aber noch nicht gebucht: vor der Lohnbuchung festgeschrieben */
function Nachbuchen({ p, aktion }: { p: Abrechnung; aktion: Aktion }) {
  const router = useRouter();
  const buchen = useServerFn(nachbuchenFn);
  const { busy, run } = aktion;
  return (
    <div className="banner banner-info stack" role="note" style={{ gap: 8 }}>
      <span>Diese Abrechnung ist festgeschrieben, aber noch nicht gebucht.</span>
      <div className="actions">
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await buchen({ data: p.id });
              await router.invalidate();
            }, "Abrechnung gebucht.")
          }
        >
          Jetzt buchen
        </button>
      </div>
    </div>
  );
}

function Storno({ p, name, aktion }: { p: Abrechnung; name: string; aktion: Aktion }) {
  const router = useRouter();
  const storno = useServerFn(stornierenFn);
  const { busy, run } = aktion;
  const [offen, setOffen] = useState(false);
  const [grund, setGrund] = useState("");
  return (
    <div className="actions">
      <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => setOffen(true)}>
        Stornieren
      </button>
      <ConfirmDialog
        open={offen}
        title={`Abrechnung mit Zahltag ${formatDate(p.zahltag)} stornieren?`}
        facts={abrechnungFakten(name, p)}
        confirmLabel="Stornieren"
        danger
        onConfirm={() =>
          void run(async () => {
            const r = await storno({ data: { id: p.id, grund } });
            await router.invalidate();
            if (r.meldung) throw new Error(`Storniert. Eine neue Abrechnung ließ sich nicht rechnen: ${r.meldung}`);
          }, "Storniert; die neue Abrechnung steht als Entwurf bereit.")
        }
        onClose={() => setOffen(false)}
      >
        <p>
          Haben hält das Storno mit Tag und Grund fest, lässt die Abrechnung unverändert, bucht gegen und legt gleich einen neuen Entwurf für denselben Monat
          an.
        </p>
        <Field label="Grund des Stornos">{(control) => <input {...control} value={grund} onChange={(e) => setGrund(e.target.value)} maxLength={500} />}</Field>
      </ConfirmDialog>
    </div>
  );
}

/** `nummer`: die wievielte Abrechnung des Mitarbeiters im Monat, damit jede Karte nach Stornos einen eigenen Namen hat */
export function AbrechnungKarte({ p, nummer, name }: { p: Abrechnung; nummer: number; name: string }) {
  const aktion = useAction();
  const s = status(p);
  const titel = `${nummer}. Abrechnung ${STUFE[p.stufe]}, Zahltag ${formatDate(p.zahltag)}`;
  return (
    <section className="stack" style={{ gap: 10 }} aria-label={`${titel}, ${s.text}`}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>{titel}</h3>
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
      {!p.lockedAt && <EntwurfAktionen p={p} name={name} aktion={aktion} />}
      {p.lockedAt && !p.storno && !p.gebucht && <Nachbuchen p={p} aktion={aktion} />}
      {p.lockedAt && !p.storno && <Storno p={p} name={name} aktion={aktion} />}
      <NoticeBanner notice={aktion.notice} />
    </section>
  );
}
