import { formatEuro, parseEuro } from "@haben/core";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { elsterNotice } from "../lib/elster.ts";
import { useAction } from "../lib/use-action.ts";
import { type getAnnualReturns, saveKapgErklaerung, submitKapgReturn } from "../server/functions/annual.ts";
import { ElsterSubmit } from "./ElsterSubmit.tsx";
import { Icon } from "./Icon.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

/*
 * GmbH und UG auf der Seite Jahreserklärung: Körperschaftsteuer- und Gewerbesteuererklärung mit den Werten aus der
 * Steuerberechnung des Jahresabschlusses, dazu die Angaben, die nur die Erklärung braucht (Anteilseigner, Verträge).
 */

type Data = Awaited<ReturnType<typeof getAnnualReturns>>;
type Kapg = NonNullable<Data["kapg"]>;
type Angaben = Kapg["angaben"];
type Hinweis = Kapg["kst"]["issues"][number];

const LINK_LABEL = { "/einstellungen": "Zu den Einstellungen", "/abschluss": "Zum Jahresabschluss" } as const;
const euro = (cents: number) => formatEuro(cents).replace(/\s*€$/, "");
const ganzeEuro = (euros: number) => formatEuro(euros * 100);

/** Hinweise einer Erklärung: je Ton ein Kasten, mehrere als Liste darin, statt eines Kastens je Hinweis */
function Hinweise({ issues }: { issues: Hinweis[] }) {
  const warnungen = issues.filter((issue) => issue.tone !== "hinweis");
  const infos = issues.filter((issue) => issue.tone === "hinweis");
  return (
    <>
      <HinweisKasten issues={warnungen} info={false} />
      <HinweisKasten issues={infos} info />
    </>
  );
}

function HinweisText({ issue }: { issue: Hinweis }) {
  return (
    <>
      {issue.text} {issue.link && <Link to={issue.link}>{LINK_LABEL[issue.link]}</Link>}
    </>
  );
}

function HinweisKasten({ issues, info }: { issues: Hinweis[]; info: boolean }) {
  if (issues.length === 0) return null;
  return (
    <div className={`banner ${info ? "banner-info" : ""}`} role="status">
      <Icon name={info ? "info" : "alert"} />
      {issues.length === 1 ? (
        <span>
          <HinweisText issue={issues[0]!} />
        </span>
      ) : (
        <ul className="banner-list">
          {issues.map((issue) => (
            <li key={issue.text}>
              <HinweisText issue={issue} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Zeile({ label, value, total }: { label: string; value: string; total?: boolean }) {
  return (
    <tr style={total ? { fontWeight: 600 } : undefined}>
      <th scope="row" style={total ? { fontWeight: 600 } : undefined}>
        {label}
      </th>
      <td className="num">{value}</td>
    </tr>
  );
}

function Senden({ form, data, blocked, sent }: { form: "kst" | "gewst"; data: Data; blocked: boolean; sent: boolean }) {
  const router = useRouter();
  const submit = useServerFn(submitKapgReturn);
  const { busy, notice, setNotice, run } = useAction();
  const name = form === "kst" ? "Körperschaftsteuererklärung" : "Gewerbesteuererklärung";
  const kapg = data.kapg!;
  return (
    <ElsterSubmit
      setup={data}
      title={`${name} übermitteln`}
      ready={!blocked}
      busy={busy}
      notice={notice}
      lockedHint={
        sent
          ? "Schon übermittelt. Eine Berichtigung geht über das ELSTER-Portal."
          : kapg.closed
            ? undefined
            : `Echt senden erst, wenn ${data.year} abgeschlossen ist.`
      }
      confirmText={`Die ${name} ${data.year} geht verbindlich an das Finanzamt. Noch einmal klicken zum Senden.`}
      footer="„Nur prüfen“ lässt ERiC die Erklärung gegen die Vorgaben des Jahres prüfen, ohne zu senden. Die PIN wird nicht gespeichert."
      onSubmit={(kind, pin) =>
        run(async () => {
          const result = await submit({ data: { form, year: data.year, kind, pin } });
          setNotice(elsterNotice(kind, result, "Übermittelt."));
          await router.invalidate();
        })
      }
    />
  );
}

export function KstSection({ data }: { data: Data }) {
  const k = data.kapg!.kst;
  const w = k.werte;
  const blocked = k.issues.some((i) => i.tone === "fehler");
  return (
    <section className="grid-main jump-target" id="kst" aria-labelledby="kst-heading">
      <div className="card" style={{ gap: 12 }}>
        <h2 id="kst-heading" style={{ margin: 0 }}>
          Körperschaftsteuererklärung {k.sent && <span className="pill pill-ok">übermittelt</span>}
        </h2>
        <Hinweise issues={k.issues} />
        {w && (
          <table className="report-table">
            <tbody>
              <Zeile label="Einkünfte aus Gewerbebetrieb (Anlage GK, Zeile 300)" value={ganzeEuro(w.einkuenfte)} />
              {w.verlustabzug.sockel + w.verlustabzug.quote > 0 && (
                <Zeile label="Verlustabzug (Anlage Verluste)" value={`−${ganzeEuro(w.verlustabzug.sockel + w.verlustabzug.quote)}`} />
              )}
              <Zeile label="Zu versteuerndes Einkommen" value={ganzeEuro(w.zvE)} total />
              <Zeile label="Körperschaftsteuer 15 %" value={ganzeEuro(w.kst)} total />
              {w.verlust && <Zeile label={`Verbleibender Verlustvortrag zum 31.12.${data.year}`} value={ganzeEuro(w.verlust.ende)} />}
            </tbody>
          </table>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Mit Anlage GK, ZVE, WA, KSt 1 F und, wenn es Verluste gibt, Anlage Verluste; in vollen Euro. Den Solidaritätszuschlag setzt das Finanzamt fest.
        </p>
      </div>
      <Senden form="kst" data={data} blocked={blocked} sent={k.sent} />
    </section>
  );
}

export function GewstSection({ data }: { data: Data }) {
  const g = data.kapg!.gewst;
  const w = g.werte;
  const blocked = g.issues.some((i) => i.tone === "fehler");
  return (
    <section className="grid-main jump-target" id="gewst" aria-labelledby="gewst-heading">
      <div className="card" style={{ gap: 12 }}>
        <h2 id="gewst-heading" style={{ margin: 0 }}>
          Gewerbesteuererklärung {g.sent && <span className="pill pill-ok">übermittelt</span>}
        </h2>
        <Hinweise issues={g.issues} />
        {w && (
          <table className="report-table">
            <tbody>
              <Zeile label="Gewinn aus Gewerbebetrieb (Zeile 39)" value={formatEuro(w.gewinn)} />
              <Zeile label="Gewerbeertrag (berechnet)" value={formatEuro(w.gewerbeertrag)} />
              <Zeile label="Steuermessbetrag (berechnet)" value={formatEuro(w.messbetrag)} />
              <Zeile label="Gewerbesteuer (berechnet)" value={formatEuro(w.gewst)} total />
            </tbody>
          </table>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Gesendet werden Gewinn, Hinzurechnungen nach § 8 Nr. 1 GewStG in voller Höhe und der Gewerbeverlust des Vorjahres; Messbetrag und Steuer setzen
          Finanzamt und Gemeinde fest.
        </p>
      </div>
      <Senden form="gewst" data={data} blocked={blocked} sent={g.sent} />
    </section>
  );
}

/** Anteil als Text: 10000 → "100", 3333 → "33,33" */
const anteilText = (anteil: number) => (anteil / 100).toLocaleString("de-DE", { maximumFractionDigits: 2 });
function parseAnteil(text: string): number | null {
  const n = Number(text.trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 && n <= 100 ? Math.round(n * 100) : null;
}

type Person = {
  name: string;
  strasse: string;
  plzOrt: string;
  nummer: string;
  beteiligung: string;
  anteil: string;
  geaendert: boolean;
  /** Kirchensteuerabzugsmerkmal für Ausschüttungen: Satz und Religionsschlüssel */
  kirchensteuer: 0 | 8 | 9;
  religionsschluessel: string;
  /** Für die Steuerbescheinigung (Muster II): Name der kirchensteuererhebenden Religionsgemeinschaft */
  religionsgemeinschaft: string;
};
type Vertrag = { art: string; datum: string; partner: string; verguetung: string };

export function KapgAngaben({ data }: { data: Data }) {
  const router = useRouter();
  const save = useServerFn(saveKapgErklaerung);
  const { busy, notice, setNotice, run } = useAction();
  const a: Angaben = data.kapg!.angaben;
  const [gruendung, setGruendung] = useState(a.gruendung ?? "");
  const [einlagekonto, setEinlagekonto] = useState(euro(a.einlagekonto));
  const [rechte, setRechte] = useState(euro(a.rechteBeschraenktStpfl));
  const [personen, setPersonen] = useState<Person[]>(
    a.anteilseigner.map((p) => ({
      name: p.name,
      strasse: p.strasse,
      plzOrt: p.plzOrt,
      nummer: p.idnr ?? p.steuernummer13 ?? "",
      beteiligung: euro(p.beteiligung),
      anteil: anteilText(p.anteil),
      geaendert: p.geaendert,
      kirchensteuer: p.kirchensteuer,
      religionsschluessel: p.religionsschluessel ?? "",
      religionsgemeinschaft: p.religionsgemeinschaft ?? "",
    })),
  );
  const [vertraege, setVertraege] = useState<Vertrag[]>(a.vertraege.map((v) => ({ ...v, verguetung: euro(v.verguetung) })));
  const setPerson = (i: number, patch: Partial<Person>) => setPersonen(personen.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const setVertrag = (i: number, patch: Partial<Vertrag>) => setVertraege(vertraege.map((v, j) => (j === i ? { ...v, ...patch } : v)));

  function submit(event: FormEvent) {
    event.preventDefault();
    const betrag = (text: string) => (text.trim() === "" ? 0 : parseEuro(text));
    const anteilseigner = personen.map((p) => ({
      name: p.name,
      strasse: p.strasse,
      plzOrt: p.plzOrt,
      ...(p.nummer.replace(/\D/g, "").length === 13 ? { steuernummer13: p.nummer.replace(/\D/g, "") } : { idnr: p.nummer.replace(/\D/g, "") }),
      beteiligung: betrag(p.beteiligung),
      anteil: parseAnteil(p.anteil),
      geaendert: p.geaendert,
      kirchensteuer: p.kirchensteuer,
      ...(p.kirchensteuer > 0 ? { religionsschluessel: p.religionsschluessel.trim(), religionsgemeinschaft: p.religionsgemeinschaft.trim() } : {}),
    }));
    const vertragsliste = vertraege.map((v) => ({ art: v.art, datum: v.datum, partner: v.partner, verguetung: betrag(v.verguetung) }));
    const konto = betrag(einlagekonto);
    const beschraenkt = betrag(rechte);
    if (
      konto === null ||
      beschraenkt === null ||
      anteilseigner.some((p) => p.beteiligung === null || p.anteil === null) ||
      vertragsliste.some((v) => v.verguetung === null)
    ) {
      setNotice({ tone: "danger", text: "Beträge als Euro (z. B. 25.000,00) und Anteile in Prozent (z. B. 50) eingeben." });
      return;
    }
    void run(async () => {
      await save({
        data: {
          year: data.year,
          angaben: {
            gruendung: gruendung || null,
            einlagekonto: konto,
            rechteBeschraenktStpfl: beschraenkt,
            anteilseigner: anteilseigner as Angaben["anteilseigner"],
            vertraege: vertragsliste as Angaben["vertraege"],
          },
        },
      });
      await router.invalidate();
    }, "Angaben gespeichert.");
  }

  return (
    <section className="card jump-target" id="kapg-angaben" aria-labelledby="kapg-angaben-heading">
      <h2 id="kapg-angaben-heading" style={{ marginTop: 0 }}>
        Angaben zu den Erklärungen {data.year}
      </h2>
      {!data.kapg!.gespeichert && a.anteilseigner.length > 0 && <p className="small muted">Aus {data.year - 1} übernommen; bitte prüfen und speichern.</p>}
      <form onSubmit={submit} aria-label="Angaben zur Körperschaft- und Gewerbesteuererklärung" className="stack" style={{ gap: 16 }}>
        <div className="form-row cols-3">
          <label className="field">
            Gegründet am (nur im Gründungsjahr)
            <input type="date" value={gruendung} onChange={(e) => setGruendung(e.target.value)} />
          </label>
          <label className="field">
            Steuerliches Einlagekonto zum 31.12.{data.year - 1}
            <input inputMode="decimal" value={einlagekonto} onChange={(e) => setEinlagekonto(e.target.value)} />
          </label>
          <label className="field">
            Lizenzen an beschränkt Steuerpflichtige (§ 50a EStG)
            <input inputMode="decimal" value={rechte} onChange={(e) => setRechte(e.target.value)} />
          </label>
        </div>

        <fieldset className="stack fieldset-plain" style={{ gap: 16 }}>
          <legend>Anteilseigner</legend>
          {personen.map((p, i) => (
            <div key={i} className="stack sub-group" style={{ gap: 12 }} role="group" aria-label={`Anteilseigner ${i + 1}`}>
              <div className="sub-group-title" aria-hidden="true">
                Anteilseigner {i + 1}
              </div>
              <div className="form-row cols-3 align-end">
                <label className="field">
                  Name<span className="visually-hidden"> Anteilseigner {i + 1}</span>
                  <input value={p.name} onChange={(e) => setPerson(i, { name: e.target.value })} required />
                </label>
                <label className="field">
                  Straße und Hausnummer<span className="visually-hidden"> Anteilseigner {i + 1}</span>
                  <input value={p.strasse} onChange={(e) => setPerson(i, { strasse: e.target.value })} required />
                </label>
                <label className="field">
                  PLZ und Ort<span className="visually-hidden"> Anteilseigner {i + 1}</span>
                  <input value={p.plzOrt} onChange={(e) => setPerson(i, { plzOrt: e.target.value })} required />
                </label>
              </div>
              <div className="form-row cols-3 align-end">
                <label className="field">
                  Identifikationsnummer oder Steuernummer (13 Ziffern)<span className="visually-hidden"> Anteilseigner {i + 1}</span>
                  <input inputMode="numeric" value={p.nummer} onChange={(e) => setPerson(i, { nummer: e.target.value })} required />
                </label>
                <label className="field">
                  Beteiligung in Euro<span className="visually-hidden"> Anteilseigner {i + 1}</span>
                  <input inputMode="decimal" value={p.beteiligung} onChange={(e) => setPerson(i, { beteiligung: e.target.value })} required />
                </label>
                <label className="field">
                  Anteil in Prozent<span className="visually-hidden"> Anteilseigner {i + 1}</span>
                  <input inputMode="decimal" value={p.anteil} onChange={(e) => setPerson(i, { anteil: e.target.value })} required />
                </label>
              </div>
              <div className="form-row cols-3 align-end">
                <label className="field">
                  Kirchensteuer bei Ausschüttungen<span className="visually-hidden"> Anteilseigner {i + 1}</span>
                  <select value={p.kirchensteuer} onChange={(e) => setPerson(i, { kirchensteuer: Number(e.target.value) as Person["kirchensteuer"] })}>
                    <option value={0}>keine</option>
                    <option value={8}>8 % (Bayern, Baden-Württemberg)</option>
                    <option value={9}>9 %</option>
                  </select>
                </label>
                {p.kirchensteuer > 0 && (
                  <label className="field">
                    Religionsschlüssel aus dem Kirchensteuerabzugsmerkmal<span className="visually-hidden"> Anteilseigner {i + 1}</span>
                    <input
                      inputMode="numeric"
                      value={p.religionsschluessel}
                      onChange={(e) => setPerson(i, { religionsschluessel: e.target.value })}
                      placeholder="z. B. 010100"
                      required
                    />
                  </label>
                )}
                {p.kirchensteuer > 0 && (
                  <label className="field">
                    Kirchensteuererhebende Religionsgemeinschaft<span className="visually-hidden"> Anteilseigner {i + 1}</span>
                    <input
                      value={p.religionsgemeinschaft}
                      onChange={(e) => setPerson(i, { religionsgemeinschaft: e.target.value })}
                      placeholder="z. B. römisch-katholisch"
                    />
                  </label>
                )}
              </div>
              <div className="actions" style={{ justifyContent: "space-between" }}>
                <label className="checkbox">
                  <input type="checkbox" checked={p.geaendert} onChange={(e) => setPerson(i, { geaendert: e.target.checked })} />
                  Angaben gegenüber dem Vorjahr geändert
                </label>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => setPersonen(personen.filter((_, j) => j !== i))}>
                  Anteilseigner {i + 1} entfernen
                </button>
              </div>
            </div>
          ))}
          <div>
            <button
              type="button"
              className="btn"
              onClick={() =>
                setPersonen([
                  ...personen,
                  {
                    name: "",
                    strasse: "",
                    plzOrt: "",
                    nummer: "",
                    beteiligung: "",
                    anteil: "",
                    geaendert: true,
                    kirchensteuer: 0,
                    religionsschluessel: "",
                    religionsgemeinschaft: "",
                  },
                ])
              }
            >
              Anteilseigner hinzufügen
            </button>
          </div>
        </fieldset>

        <fieldset className="stack fieldset-plain" style={{ gap: 16 }}>
          <legend>Verträge mit Anteilseignern und nahestehenden Personen (Anlage WA)</legend>
          {vertraege.map((v, i) => (
            <div key={i} className="stack sub-group" style={{ gap: 12 }} role="group" aria-label={`Vertrag ${i + 1}`}>
              <div className="form-row cols-2 align-end">
                <label className="field">
                  Vertragsart<span className="visually-hidden"> Vertrag {i + 1}</span>
                  <input value={v.art} onChange={(e) => setVertrag(i, { art: e.target.value })} placeholder="z. B. Geschäftsführervertrag" required />
                </label>
                <label className="field">
                  Abschluss oder letzte Änderung<span className="visually-hidden"> Vertrag {i + 1}</span>
                  <input type="date" value={v.datum} onChange={(e) => setVertrag(i, { datum: e.target.value })} required />
                </label>
                <label className="field">
                  Vertragspartner<span className="visually-hidden"> Vertrag {i + 1}</span>
                  <input value={v.partner} onChange={(e) => setVertrag(i, { partner: e.target.value })} required />
                </label>
                <label className="field">
                  Vergütung im Jahr<span className="visually-hidden"> Vertrag {i + 1}</span>
                  <input inputMode="decimal" value={v.verguetung} onChange={(e) => setVertrag(i, { verguetung: e.target.value })} required />
                </label>
              </div>
              <div>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => setVertraege(vertraege.filter((_, j) => j !== i))}>
                  Vertrag {i + 1} entfernen
                </button>
              </div>
            </div>
          ))}
          <div>
            <button type="button" className="btn btn-dashed" onClick={() => setVertraege([...vertraege, { art: "", datum: "", partner: "", verguetung: "" }])}>
              Vertrag hinzufügen
            </button>
          </div>
        </fieldset>
        <NoticeBanner notice={notice} />
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Angaben speichern
          </button>
        </div>
      </form>
    </section>
  );
}
