import { formatEuro, parseEuro, type KapgSteuerAngaben, type KapgSteuern as Steuern } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState, type FormEvent } from "react";
import { useAction } from "../lib/use-action.ts";
import { bookSteuerrueckstellungenFn, saveKapgAngabenFn } from "../server/functions/abschluss.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

export interface KapgSteuernData {
  angaben: KapgSteuerAngaben | null;
  gespeichert: boolean;
  steuern: Steuern | null;
}

const euroInput = (cents: number | undefined) => (cents === undefined ? "" : formatEuro(cents).replace(/\s*€$/, ""));

/** Körperschaft- und Gewerbesteuer des Jahres: Angaben, Rechnung, Rückstellungen buchen */
export function KapgSteuern({ year, data, closed }: { year: number; data: KapgSteuernData; closed: boolean }) {
  const router = useRouter();
  const save = useServerFn(saveKapgAngabenFn);
  const book = useServerFn(bookSteuerrueckstellungenFn);
  const { busy, notice, setNotice, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const formId = useId();
  const [hebesatz, setHebesatz] = useState(data.angaben ? String(data.angaben.hebesatz) : "");
  const [vortragKst, setVortragKst] = useState(euroInput(data.angaben?.verlustvortragKst));
  const [vortragGewst, setVortragGewst] = useState(euroInput(data.angaben?.verlustvortragGewst));
  const [ruecktrag, setRuecktrag] = useState(euroInput(data.angaben?.verlustruecktrag || undefined));
  const s = data.steuern;

  function submit(event: FormEvent) {
    event.preventDefault();
    const kst = vortragKst.trim() === "" ? 0 : parseEuro(vortragKst);
    const gewst = vortragGewst.trim() === "" ? 0 : parseEuro(vortragGewst);
    const rueck = ruecktrag.trim() === "" ? 0 : parseEuro(ruecktrag);
    if (kst === null || gewst === null || rueck === null || !/^\d+$/.test(hebesatz.trim())) {
      setNotice({ tone: "danger", text: "Hebesatz in ganzen Prozent und Verlustvorträge als Betrag eingeben." });
      return;
    }
    void run(async () => {
      await save({ data: { year, angaben: { hebesatz: Number(hebesatz), verlustvortragKst: kst, verlustvortragGewst: gewst, verlustruecktrag: rueck } } });
      await router.invalidate();
    }, "Angaben gespeichert.");
  }

  const row = (label: string, betrag: number, strong = false) => (
    <tr key={label}>
      <th scope="row" style={strong ? { fontWeight: 600 } : undefined}>
        {label}
      </th>
      <td className="num" style={strong ? { fontWeight: 600 } : undefined}>
        {formatEuro(betrag)}
      </td>
    </tr>
  );

  return (
    <section className="card" aria-labelledby="steuern-heading">
      <h2 id="steuern-heading" style={{ marginTop: 0 }}>
        Körperschaft- und Gewerbesteuer {year}
      </h2>
      <p className="small muted" style={{ marginTop: 0, maxWidth: 760 }}>
        Berechnet aus dem Jahresergebnis: gebuchte Steuern vom Einkommen und Ertrag, nicht abziehbare Bewirtung und Geschenke zurück, Verlustvortrag mit
        Mindestbesteuerung, Hinzurechnung nach § 8 Nr. 1 GewStG. Steuerfreie Erträge, Spenden, verdeckte Gewinnausschüttungen und Kürzungen rechnet Haben nicht;
        die klärt die Steuerberatung.
      </p>
      <form id={formId} onSubmit={submit} aria-label="Angaben zur Körperschaft- und Gewerbesteuer" className="stack" style={{ gap: 12, maxWidth: 520 }}>
        <label className="field">
          Hebesatz der Gemeinde (%)
          <input inputMode="numeric" value={hebesatz} onChange={(e) => setHebesatz(e.target.value)} required />
        </label>
        <label className="field">
          Verlustvortrag Körperschaftsteuer zum 31.12.{year - 1}
          <input inputMode="decimal" value={vortragKst} onChange={(e) => setVortragKst(e.target.value)} placeholder="0,00" />
        </label>
        <label className="field">
          Gewerbeverlust zum 31.12.{year - 1}
          <input inputMode="decimal" value={vortragGewst} onChange={(e) => setVortragGewst(e.target.value)} placeholder="0,00" />
        </label>
        <label className="field">
          Verlustrücktrag in die Vorjahre (nur bei Verlust; leer = Verzicht)
          <input inputMode="decimal" value={ruecktrag} onChange={(e) => setRuecktrag(e.target.value)} placeholder="0,00" />
        </label>
        {data.angaben && !data.gespeichert && (
          <p className="small muted" style={{ margin: 0 }}>
            Vorgeschlagen aus {year - 1}: Hebesatz und die Verlustvorträge nach der Rechnung des Vorjahres. Bitte mit dem Bescheid abgleichen und speichern.
          </p>
        )}
        <div className="actions">
          <button type="submit" className="btn" disabled={busy || closed}>
            Angaben speichern
          </button>
        </div>
      </form>

      {s && (
        <table className="report-table" style={{ marginTop: 16 }}>
          <tbody>
            {row("Jahresergebnis", s.jahresergebnis)}
            {s.hinzurechnungen.map((z) => row(`+ ${z.text}`, z.betrag))}
            {row("Einkommen vor Verlustabzug", s.einkommen, true)}
            {s.verlustabzugKst > 0 && row("− Verlustabzug (§ 10d EStG)", -s.verlustabzugKst)}
            {row("Zu versteuerndes Einkommen", s.zvE, true)}
            {row("Körperschaftsteuer 15 %", s.kst)}
            {row("Solidaritätszuschlag 5,5 %", s.soli)}
            {s.hinzurechnungGewst > 0 && row("+ Hinzurechnung nach § 8 Nr. 1 GewStG", s.hinzurechnungGewst)}
            {s.verlustabzugGewst > 0 && row("− Gewerbeverlust (§ 10a GewStG)", -s.verlustabzugGewst)}
            {row("Gewerbeertrag, auf volle 100 € abgerundet", s.gewerbeertrag, true)}
            {row("Steuermessbetrag 3,5 %", s.messbetrag)}
            {row(`Gewerbesteuer (Hebesatz ${data.angaben?.hebesatz ?? ""} %)`, s.gewst)}
            {row("Schon gebucht (Vorauszahlungen, Rückstellungen)", -(s.gebucht.kst + s.gebucht.soli + s.gebucht.gewst))}
            {row("Rückstellung Körperschaftsteuer und Soli", s.rueckstellung.kst, true)}
            {row("Rückstellung Gewerbesteuer", s.rueckstellung.gewst, true)}
            {row(`Verlustvortrag Körperschaftsteuer zum 31.12.${year}`, s.verlustvortragKst)}
            {row(`Gewerbeverlust zum 31.12.${year}`, s.verlustvortragGewst)}
          </tbody>
        </table>
      )}
      {s && (s.rueckstellung.kst < 0 || s.rueckstellung.gewst < 0) && (
        <p className="small" style={{ marginBottom: 0 }}>
          Die Vorauszahlungen übersteigen die Steuer: Die Erstattung bucht ihr als Forderung gegen das Finanzamt mit der Steuerberatung.
        </p>
      )}
      {s && !closed && (s.rueckstellung.kst > 0 || s.rueckstellung.gewst > 0) && (
        <div className="actions" style={{ marginTop: 12 }}>
          <button type="button" className="btn btn-primary" disabled={busy || !data.gespeichert} onClick={() => setConfirming(true)}>
            Rückstellungen zum 31.12.{year} buchen
          </button>
          <ConfirmDialog
            open={confirming}
            title={`Steuerrückstellungen ${year} buchen?`}
            confirmLabel="Rückstellungen buchen"
            facts={[
              { label: "Stichtag", value: `31.12.${year}` },
              ...(s.rueckstellung.kst > 0 ? [{ label: "Körperschaftsteuer und Soli", value: formatEuro(s.rueckstellung.kst) }] : []),
              ...(s.rueckstellung.gewst > 0 ? [{ label: "Gewerbesteuer", value: formatEuro(s.rueckstellung.gewst) }] : []),
            ]}
            onConfirm={() =>
              void run(async () => {
                await book({ data: { year } });
                await router.invalidate();
              }, `Steuerrückstellungen zum 31.12.${year} gebucht.`)
            }
            onClose={() => setConfirming(false)}
          >
            <p>Die Buchung wird festgeschrieben. Korrigieren lässt sie sich danach nur mit einer Gegenbuchung.</p>
          </ConfirmDialog>
        </div>
      )}
      <NoticeBanner notice={notice} />
    </section>
  );
}
