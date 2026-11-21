import {
  formatEuro,
  FREIE_STEUERSCHLUESSEL,
  freieBuchungIssues,
  freieBuchungKonto,
  SACHENTNAHME_KONTEN,
  freieBuchungPosting,
  type FreierSteuerschluessel,
  isKapitalgesellschaft,
  MANUAL_MAX_LINES,
  manualPostingIssues,
  parseEuro,
  type ManualKind,
  type ManualLine,
} from "@haben/core";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState, type FormEvent } from "react";
import { DatevEroeffnung } from "../../../components/DatevEroeffnung.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { useAction } from "../../../lib/use-action.ts";
import { useSubmitCheck } from "../../../lib/use-submit-check.ts";
import { createManualEntryFn, getManualEntryForm } from "../../../server/functions/journal.ts";
import styles from "../../../styles/auswertungen.css?url";
import { Field } from "../../../components/Field.tsx";
import { buchungsdatumFehler } from "./-buchungsdatum.ts";

export const Route = createFileRoute("/_app/buchungen/neu")({
  loader: () => getManualEntryForm(),
  head: () => ({ meta: [{ title: "Buchung erfassen · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: ManualEntryPage,
});

/** Eine Zeile, wie sie im Formular steht: Beträge als Text, bis zum Buchen */
interface Row {
  key: number;
  account: string;
  debit: string;
  credit: string;
  /** Steuerschlüssel einer freien Buchung; der Betrag ist dann brutto */
  taxCode: FreierSteuerschluessel | "";
}

const emptyRow = (key: number): Row => ({ key, account: "", debit: "", credit: "", taxCode: "" });

/** Steuerschlüssel freier Buchungen, wie sie die Auswahl nennt (docs/adr/journal-als-quelle.md, Entscheidung 4) */
const SCHLUESSEL_NAME: Record<FreierSteuerschluessel, string> = { USt19: "USt 19 %", USt7: "USt 7 %", frei: "0 %" };

/** Betrag aus dem Feld; leer = 0, unlesbar = NaN, damit die Prüfung „Betrag ungültig“ meldet */
const amountOf = (text: string) => (text.trim() === "" ? 0 : (parseEuro(text) ?? Number.NaN));

function ManualEntryPage() {
  const data = Route.useLoaderData();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/buchungen">Buchungen</Link> › Manuell
          </div>
          <h1>Buchung erfassen</h1>
        </div>
      </div>
      <ManualEntryForm data={data} />
    </>
  );
}

type Data = Awaited<ReturnType<typeof getManualEntryForm>>;

function ManualEntryForm({ data }: { data: Data }) {
  const navigate = useNavigate();
  const create = useServerFn(createManualEntryFn);
  const { busy, notice, run } = useAction();
  const [kind, setKind] = useState<ManualKind>("umbuchung");
  const [date, setDate] = useState(data.today);
  const [description, setDescription] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow(1), emptyRow(2)]);
  const [nextKey, setNextKey] = useState(3);

  const gmbh = isKapitalgesellschaft(data.rechtsform);
  // Steuerschlüssel gibt es für Umbuchungen, nicht als Kleinunternehmer (§ 19 Abs. 1 UStG)
  const mitSchluesseln = kind === "umbuchung" && !data.kleinunternehmer;
  const lines: ManualLine[] = rows.map((r) => ({
    account: r.account.trim(),
    debit: amountOf(r.debit),
    credit: amountOf(r.credit),
    taxCode: mitSchluesseln && r.taxCode ? r.taxCode : null,
  }));
  const mitSchluessel = lines.some((l) => l.taxCode);
  const issues = [
    ...manualPostingIssues(lines, data.kontenrahmen, data.rechtsform, kind),
    ...(kind === "umbuchung" && (!gmbh || mitSchluessel)
      ? freieBuchungIssues(lines, { kontenrahmen: data.kontenrahmen, rechtsform: data.rechtsform, kleinunternehmer: data.kleinunternehmer })
      : []),
  ];
  const sum = (side: "debit" | "credit") => lines.reduce((s, l) => s + (Number.isFinite(l[side]) ? l[side] : 0), 0);
  const difference = sum("debit") - sum("credit");
  const touched = rows.some((r) => r.account || r.debit || r.credit);
  // Was gebucht wird, wenn eine Zeile einen Steuerschlüssel trägt: brutto geteilt in Netto und Steuer
  const gebucht = mitSchluessel && issues.length === 0 ? freieBuchungPosting(lines, data.kontenrahmen) : null;
  // Was an den Zeilen fehlt, steht als Liste unter der Tabelle; das Konto der ersten Zeile zeigt darauf und bekommt den Fokus
  const zeilenFehlerId = useId();
  const { form, error, check } = useSubmitCheck({
    date: buchungsdatumFehler(date, data.today, kind),
    description: description.trim().length < 3 ? "Trag einen Buchungstext mit mindestens 3 Zeichen ein." : null,
    // Steht nicht am Feld, sondern als Liste unter der Tabelle (zeilenFehlerId)
    zeilen: issues.length > 0 ? issues.join(" ") : null,
  });
  const zeilenFehler = Boolean(error("zeilen"));

  const update = (key: number, patch: Partial<Row>) => setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  function addRow() {
    setRows((current) => [...current, emptyRow(nextKey)]);
    setNextKey((k) => k + 1);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!check()) return;
    void run(async () => {
      await create({ data: { kind, date, description, lines: lines.map((l) => ({ ...l, taxCode: l.taxCode ?? null })) } });
      await navigate({ to: "/buchungen", search: { jahr: Number(date.slice(0, 4)), monat: Number(date.slice(5, 7)) } });
    });
  }

  return (
    <>
      <form ref={form} className="card stack" onSubmit={onSubmit} aria-label="Manuelle Buchung" noValidate>
        <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
          Soll an Haben auf frei gewählten Konten ({data.kontenrahmen}),{" "}
          {gmbh ? "etwa das Stammkapital, ein Gesellschafterdarlehen oder eine falsche Kontierung" : "etwa eine Ausgabe ohne Beleg gegen Privat"}. Bank, Kasse,
          offene Posten, Umsatzsteuer, Erlöse aus Rechnungen und Anlagen führen ihre eigenen Seiten und lassen sich hier nicht bebuchen.
          {mitSchluesseln &&
            ` Mit Steuerschlüssel bucht eine Zeile auf das Erlöskonto des Satzes, etwa eine Leistung für private Zwecke gegen ${gmbh ? "das Gesellschafter-Verrechnungskonto" : "Privat"}, oder als Sachentnahme auf ${SACHENTNAHME_KONTEN[data.kontenrahmen][1900]} (19 %) bzw. ${SACHENTNAHME_KONTEN[data.kontenrahmen][700]} (7 %), wenn Waren oder Gegenstände des Betriebs privat entnommen werden; der Betrag ist brutto, Haben teilt ihn in Netto und Umsatzsteuer. Vorsteuer gibt es nur mit Beleg.`}{" "}
          Die Buchung ist sofort festgeschrieben; korrigiert wird per Storno.
        </p>
        {gmbh && (
          <ArtDerBuchung
            kind={kind}
            umbuchung={() => setKind("umbuchung")}
            eroeffnung={() => {
              setKind("eroeffnung");
              setDate(`${date.slice(0, 4)}-01-01`);
            }}
          />
        )}
        <div className="form-row cols-2">
          <Field label="Datum" error={error("date")}>
            {(control) => <input {...control} type="date" value={date} max={data.today} onChange={(e) => setDate(e.target.value)} required />}
          </Field>
          <Field label="Buchungstext" error={error("description")}>
            {(control) => <input {...control} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} required minLength={3} />}
          </Field>
        </div>

        {/* Am Handy scrollt die Tabelle für sich (styles.css); relativ, damit die unsichtbaren Spaltennamen (visually-hidden,
            absolut) im Scrollbereich bleiben und die Seite nicht verbreitern */}
        <table className="report-table" style={{ position: "relative" }}>
          <caption className="visually-hidden">Buchungszeilen</caption>
          <thead>
            <tr>
              <th scope="col">Konto</th>
              <th scope="col">Bezeichnung</th>
              <th scope="col" className="num">
                Soll
              </th>
              <th scope="col" className="num">
                Haben
              </th>
              {mitSchluesseln && <th scope="col">Steuerschlüssel</th>}
              <th scope="col">
                <span className="visually-hidden">Entfernen</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, index) => (
              <BuchungsZeile
                key={r.key}
                r={r}
                index={index}
                kontoName={data.accounts[r.account.trim()] ?? ""}
                kontenrahmen={data.kontenrahmen}
                mitSchluesseln={mitSchluesseln}
                fehlerId={zeilenFehler && index === 0 ? zeilenFehlerId : null}
                entfernbar={rows.length > 2}
                update={update}
                entfernen={() => setRows((current) => current.filter((x) => x.key !== r.key))}
              />
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                Summe{difference !== 0 && ` · Differenz ${formatEuro(Math.abs(difference))}`}
              </th>
              <td className="num">{formatEuro(sum("debit"))}</td>
              <td className="num">{formatEuro(sum("credit"))}</td>
              {mitSchluesseln && <td />}
              <td />
            </tr>
          </tfoot>
        </table>

        <div className="actions">
          <button type="button" className="btn" onClick={addRow} disabled={rows.length >= MANUAL_MAX_LINES}>
            Zeile hinzufügen
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Buchen
          </button>
        </div>
        {gebucht && (
          <div className="small" role="status" aria-label="Gebucht wird">
            <p className="muted" style={{ margin: 0 }}>
              Gebucht wird, brutto geteilt:
            </p>
            <ul style={{ margin: 0 }}>
              {gebucht.map((l, i) => (
                <li key={`${l.account}-${i}`}>
                  <span className="mono">{l.account}</span> {data.accounts[l.account] ?? ""} · {l.debit > 0 ? "Soll" : "Haben"}{" "}
                  {formatEuro(l.debit || l.credit)}
                  {l.taxCode && ` · ${SCHLUESSEL_NAME[l.taxCode as FreierSteuerschluessel]}`}
                </li>
              ))}
            </ul>
          </div>
        )}
        {(touched || zeilenFehler) && issues.length > 0 && (
          // Die id an der Liste selbst: Ein aria-label daran ersetzte für aria-describedby ihren Text
          <div role="status" aria-label="Noch nicht buchbar">
            <ul id={zeilenFehlerId} className={zeilenFehler ? "small field-error" : "small"} style={{ margin: 0 }}>
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        )}
        <NoticeBanner notice={notice} />
      </form>
      {kind === "eroeffnung" && data.datevEroeffnung && <DatevEroeffnung data={data.datevEroeffnung} />}
    </>
  );
}

/** Eine Zeile der Buchung; fehlerId verbindet das Konto der ersten Zeile mit der Liste dessen, was noch fehlt */
function BuchungsZeile({
  r,
  index,
  kontoName,
  kontenrahmen,
  mitSchluesseln,
  fehlerId,
  entfernbar,
  update,
  entfernen,
}: {
  r: Row;
  index: number;
  kontoName: string;
  kontenrahmen: Data["kontenrahmen"];
  mitSchluesseln: boolean;
  fehlerId: string | null;
  entfernbar: boolean;
  update: (key: number, patch: Partial<Row>) => void;
  entfernen: () => void;
}) {
  return (
    <tr>
      <td>
        <input
          aria-label={`Konto Zeile ${index + 1}`}
          aria-invalid={fehlerId ? true : undefined}
          aria-describedby={fehlerId ?? undefined}
          className="mono"
          inputMode="numeric"
          maxLength={4}
          size={6}
          value={r.account}
          onChange={(e) => update(r.key, { account: e.target.value.replace(/\D/g, "") })}
        />
      </td>
      <td className="small muted">{kontoName}</td>
      <td className="num">
        <input
          aria-label={`Soll Zeile ${index + 1}`}
          inputMode="decimal"
          size={10}
          value={r.debit}
          onChange={(e) => update(r.key, { debit: e.target.value })}
        />
      </td>
      <td className="num">
        <input
          aria-label={`Haben Zeile ${index + 1}`}
          inputMode="decimal"
          size={10}
          value={r.credit}
          onChange={(e) => update(r.key, { credit: e.target.value })}
        />
      </td>
      {mitSchluesseln && (
        <td>
          {/* biome-ignore lint/plugin: Zelle der Buchungstabelle: der Spaltenkopf und aria-label benennen sie, eine Hülle `.field` je Zelle sprengte die Zeile */}
          <select
            aria-label={`Steuerschlüssel Zeile ${index + 1}`}
            style={{ minWidth: 136 }}
            value={r.taxCode}
            onChange={(e) => {
              const taxCode = e.target.value as Row["taxCode"];
              // Ein Schlüssel gehört zu genau einem Erlöskonto; ein leeres Konto füllt Haben vor
              update(r.key, { taxCode, ...(taxCode && !r.account ? { account: freieBuchungKonto(kontenrahmen, taxCode) } : {}) });
            }}
          >
            <option value="">ohne</option>
            {(Object.keys(FREIE_STEUERSCHLUESSEL) as FreierSteuerschluessel[]).map((code) => (
              <option key={code} value={code}>
                {SCHLUESSEL_NAME[code]}
              </option>
            ))}
          </select>
        </td>
      )}
      <td>
        {entfernbar && (
          <button type="button" className="icon-btn" onClick={entfernen} aria-label={`Zeile ${index + 1} entfernen`}>
            <Icon name="close" size={16} />
          </button>
        )}
      </td>
    </tr>
  );
}

/** Umbuchung oder Eröffnungsbuchung; die Wahl gibt es nur bei GmbH und UG */
function ArtDerBuchung({ kind, umbuchung, eroeffnung }: { kind: ManualKind; umbuchung: () => void; eroeffnung: () => void }) {
  return (
    <fieldset className="mode-switch" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="visually-hidden">Art der Buchung</legend>
      <label className="checkbox">
        <input type="radio" name="kind" checked={kind === "umbuchung"} onChange={umbuchung} />
        Umbuchung
      </label>
      <label className="checkbox">
        <input type="radio" name="kind" checked={kind === "eroeffnung"} onChange={eroeffnung} aria-describedby="kind-eroeffnung-hint" />
        Eröffnungsbuchung
      </label>
      <span id="kind-eroeffnung-hint" className="small muted" style={{ display: "block" }}>
        Salden aus der bisherigen Buchhaltung zum 1. Januar des ersten Jahres in Haben: Bestandskonten und der Kontostand der Bank gegen 9000 Saldenvorträge.
        Offene Rechnungen und Belege kommen einzeln über den Umzug, Anlagen über das Anlagenverzeichnis. Liegt der DATEV-Stapel der bisherigen Buchhaltung im
        Archiv, schlägt Haben die ganze Eröffnung aus seiner Schlussbilanz vor (unter dem Formular).
      </span>
    </fieldset>
  );
}
