import { formatDecimal, formatEuro, parseEuro } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDate } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { fileAnnualElsewhere } from "../../server/functions/annual.ts";
import { Field } from "../Field.tsx";
import { FilePicker } from "../FilePicker.tsx";
import { FormDialog } from "../FormDialog.tsx";
import { NoticeBanner } from "../NoticeBanner.tsx";

/** Ein Vermerk, wie ihn annualOverview je Formular liefert */
export interface JahresvermerkStand {
  id: string;
  filedOn: string | null;
  transferTicket: string | null;
  note: string | null;
  amount: number | null;
  hasPdf: boolean;
}

const LABEL = { ust: "Umsatzsteuererklärung", euer: "Anlage EÜR" } as const;

/**
 * Abgabe außerhalb von Haben vermerken: Tag, Transferticket, Betrag, Begründung und optional das Protokoll. Ist die
 * Erklärung schon vermerkt, zeigt die Karte die Angaben und bietet keinen zweiten Vermerk an.
 *
 * Weicht der eingegebene Betrag vom in Haben gerechneten Wert ab, zeigt der Dialog beide Beträge und die Differenz und
 * verlangt einen Haken. Der Server prüft dasselbe noch einmal; hier ist es nur die Vorabprüfung.
 */
export function AbgabeVermerken({
  art,
  year,
  today,
  berechnet,
  vermerkt,
}: {
  art: "ust" | "euer";
  year: number;
  today: string;
  /** Betrag aus den Buchungen; dient als Vorschlag und zum Vergleich */
  berechnet: number;
  vermerkt: JahresvermerkStand | null;
}) {
  const router = useRouter();
  const vermerken = useServerFn(fileAnnualElsewhere);
  const { busy, notice, run } = useAction();
  const [open, setOpen] = useState(false);
  const [filedOn, setFiledOn] = useState(today);
  const [ticket, setTicket] = useState("");
  const [betrag, setBetrag] = useState(() => formatDecimal(berechnet));
  const [begruendung, setBegruendung] = useState("");
  const [file, setFile] = useState<File | null>(null);
  // Pflicht-Haken, sobald der eingegebene Betrag vom gerechneten Wert abweicht
  const [bestaetigt, setBestaetigt] = useState(false);
  // Hinweis aus dem Vergleich mit dem gerechneten Betrag; der Vermerk gilt auch bei Abweichung
  const [abweichung, setAbweichung] = useState<string | null>(null);
  const cents = parseEuro(betrag);
  const differenz = cents === null ? 0 : cents - berechnet;
  const weichtAb = cents !== null && differenz !== 0;
  const ready = filedOn !== "" && ticket.trim().length >= 10 && cents !== null && begruendung.trim().length >= 10 && (!weichtAb || bestaetigt);

  async function absenden(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || cents === null) return;
    await run(async () => {
      const data = new FormData();
      data.append("form", art);
      data.append("year", String(year));
      data.append("filedOn", filedOn);
      data.append("transferTicket", ticket.trim());
      data.append("amount", String(cents));
      data.append("note", begruendung.trim());
      if (bestaetigt) data.append("abweichungBestaetigt", "1");
      if (file) data.append("protokoll", file);
      const result = await vermerken({ data });
      if (!result.ok) throw new Error(result.message);
      setAbweichung(result.hinweis);
      setOpen(false);
      await router.invalidate();
    });
  }

  if (vermerkt) {
    return (
      <section className="card" aria-label={`Abgabe außerhalb von Haben: ${LABEL[art]} ${year}`}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Außerhalb von Haben abgegeben</h2>
          <span className="pill pill-ok">Abgegeben</span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {LABEL[art]} {year} wurde außerhalb von Haben abgegeben. Ein zweiter Vermerk ist nicht möglich.
        </p>
        {abweichung && (
          <p className="banner banner-info" role="status">
            {abweichung}
          </p>
        )}
        <dl className="confirm-dialog-facts">
          <div>
            <dt>Tag der Abgabe</dt>
            <dd>{vermerkt.filedOn ? formatDate(vermerkt.filedOn) : "–"}</dd>
          </div>
          <div>
            <dt>Transferticket</dt>
            <dd className="mono">{vermerkt.transferTicket ?? "–"}</dd>
          </div>
          <div>
            <dt>Betrag</dt>
            <dd>{vermerkt.amount === null ? "–" : formatEuro(vermerkt.amount)}</dd>
          </div>
          <div>
            <dt>Begründung</dt>
            <dd>{vermerkt.note ?? "–"}</dd>
          </div>
        </dl>
        {vermerkt.hasPdf && (
          <a href={`/api/protokoll/${vermerkt.id}`} target="_blank" rel="noreferrer" className="small">
            Übermittlungsprotokoll
          </a>
        )}
      </section>
    );
  }

  return (
    <section className="card" aria-label={`Abgabe außerhalb von Haben: ${LABEL[art]} ${year}`}>
      <h2 style={{ margin: 0 }}>Außerhalb von Haben abgegeben</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Hast du {LABEL[art]} {year} in WISO, Accountable oder im ELSTER-Portal abgegeben, hältst du das hier mit Tag, Transferticket und Betrag fest. Die Frist
        ist damit erledigt, und der Vorgang erscheint im Verlauf.
      </p>
      <div className="actions">
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Abgabe vermerken
        </button>
      </div>
      <FormDialog open={open} title={`${LABEL[art]} ${year} als abgegeben vermerken`} onClose={() => !busy && setOpen(false)}>
        <form className="stack" style={{ gap: 12 }} onSubmit={absenden}>
          <Field label="Tag der Abgabe">
            {(control) => <input {...control} type="date" value={filedOn} max={today} onChange={(event) => setFiledOn(event.target.value)} required />}
          </Field>
          <Field label="Transferticket" hint="Steht im Übermittlungsprotokoll; mindestens 10 Zeichen.">
            {(control) => (
              <input
                {...control}
                value={ticket}
                onChange={(event) => setTicket(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                minLength={10}
                required
              />
            )}
          </Field>
          <Field label="Betrag" hint={`Aus den Buchungen gerechnet: ${formatEuro(berechnet)}.`}>
            {(control) => (
              <input
                {...control}
                inputMode="decimal"
                className="mono"
                value={betrag}
                onChange={(event) => {
                  setBetrag(event.target.value);
                  // Ein neuer Betrag ist eine neue Abweichung; der alte Haken darf nicht weiter gelten
                  setBestaetigt(false);
                }}
                aria-invalid={(betrag !== "" && cents === null) || undefined}
                required
              />
            )}
          </Field>
          {weichtAb && cents !== null && (
            <>
              <p className="banner banner-warn" role="status">
                Der Betrag weicht um {formatEuro(Math.abs(differenz))} vom in Haben gerechneten Wert ({formatEuro(berechnet)}) ab. Der Betrag laut Protokoll
                wird gespeichert; die Abweichung bleibt am Vermerk stehen.
              </p>
              <label className="checkbox">
                <input type="checkbox" checked={bestaetigt} onChange={(event) => setBestaetigt(event.target.checked)} required />
                Abweichung geprüft und bewusst übernommen
              </label>
            </>
          )}
          <Field label="Begründung" hint="Warum außerhalb von Haben, mindestens 10 Zeichen.">
            {(control) => (
              <textarea {...control} value={begruendung} onChange={(event) => setBegruendung(event.target.value)} rows={3} maxLength={2000} required />
            )}
          </Field>
          <Field label="Übermittlungsprotokoll (PDF, optional)">
            {(control) => <FilePicker {...control} accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />}
          </Field>
          <div className="actions form-footer">
            <button type="button" className="btn" disabled={busy} onClick={() => setOpen(false)}>
              Abbrechen
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !ready}>
              Vermerken
            </button>
          </div>
          <NoticeBanner notice={notice} />
        </form>
      </FormDialog>
    </section>
  );
}
