import { formatEuro, parseEuro } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useState } from "react";
import { anteilText, parseAnteil } from "../lib/anteil.ts";
import { useAction } from "../lib/use-action.ts";
import { type getAnnualReturns, saveKapgErklaerung } from "../server/functions/annual.ts";
import { KapgAnteilseigner, type Person } from "./KapgAnteilseigner.tsx";
import { Field } from "./Field.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

/*
 * Angaben, die nur die Körperschaft- und Gewerbesteuererklärung brauchen (Gründung, Einlagekonto, Anteilseigner,
 * Verträge), auf der Seite Jahreserklärung einer GmbH oder UG
 */

type Data = Awaited<ReturnType<typeof getAnnualReturns>>;
type Angaben = NonNullable<Data["kapg"]>["angaben"];
type Vertrag = { art: string; datum: string; partner: string; verguetung: string };

const euro = (cents: number) => formatEuro(cents).replace(/\s*€$/, "");
const ANGABEN_FEHLER = "Beträge als Euro (z. B. 25.000,00) und Anteile über 0 bis 100 % mit höchstens zwei Nachkommastellen (z. B. 50 oder 33,33) eingeben.";

const personAusAngabe = (p: Angaben["anteilseigner"][number]): Person => ({
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
});

const betrag = (text: string) => (text.trim() === "" ? 0 : parseEuro(text));

const anteilseignerAusFormular = (p: Person) => ({
  name: p.name,
  strasse: p.strasse,
  plzOrt: p.plzOrt,
  ...(p.nummer.replace(/\D/g, "").length === 13 ? { steuernummer13: p.nummer.replace(/\D/g, "") } : { idnr: p.nummer.replace(/\D/g, "") }),
  beteiligung: betrag(p.beteiligung),
  anteil: parseAnteil(p.anteil),
  geaendert: p.geaendert,
  kirchensteuer: p.kirchensteuer,
  ...(p.kirchensteuer > 0 ? { religionsschluessel: p.religionsschluessel.trim(), religionsgemeinschaft: p.religionsgemeinschaft.trim() } : {}),
});

type Formular = { gruendung: string; einlagekonto: string; rechte: string; personen: Person[]; vertraege: Vertrag[] };

/** Die Angaben aus dem Formular, oder null, wenn ein Betrag oder Anteil nicht lesbar ist */
function angabenAusFormular(f: Formular): Angaben | null {
  const anteilseigner = f.personen.map(anteilseignerAusFormular);
  const vertraege = f.vertraege.map((v) => ({ art: v.art, datum: v.datum, partner: v.partner, verguetung: betrag(v.verguetung) }));
  const einlagekonto = betrag(f.einlagekonto);
  const rechteBeschraenktStpfl = betrag(f.rechte);
  if (
    einlagekonto === null ||
    rechteBeschraenktStpfl === null ||
    anteilseigner.some((p) => p.beteiligung === null || p.anteil === null) ||
    vertraege.some((v) => v.verguetung === null)
  ) {
    return null;
  }
  return {
    gruendung: f.gruendung || null,
    einlagekonto,
    rechteBeschraenktStpfl,
    anteilseigner: anteilseigner as Angaben["anteilseigner"],
    vertraege: vertraege as Angaben["vertraege"],
  };
}

function VertragFelder({ v, i, set, remove }: { v: Vertrag; i: number; set: (patch: Partial<Vertrag>) => void; remove: () => void }) {
  return (
    <div className="stack sub-group" style={{ gap: 12 }} role="group" aria-label={`Vertrag ${i + 1}`}>
      <div className="form-row cols-2 align-end">
        <Field
          label={
            <>
              Vertragsart<span className="visually-hidden"> Vertrag {i + 1}</span>
            </>
          }
        >
          {(control) => <input {...control} value={v.art} onChange={(e) => set({ art: e.target.value })} placeholder="z. B. Geschäftsführervertrag" required />}
        </Field>
        <Field
          label={
            <>
              Abschluss oder letzte Änderung<span className="visually-hidden"> Vertrag {i + 1}</span>
            </>
          }
        >
          {(control) => <input {...control} type="date" value={v.datum} onChange={(e) => set({ datum: e.target.value })} required />}
        </Field>
        <Field
          label={
            <>
              Vertragspartner<span className="visually-hidden"> Vertrag {i + 1}</span>
            </>
          }
        >
          {(control) => <input {...control} value={v.partner} onChange={(e) => set({ partner: e.target.value })} required />}
        </Field>
        <Field
          label={
            <>
              Vergütung im Jahr<span className="visually-hidden"> Vertrag {i + 1}</span>
            </>
          }
        >
          {(control) => <input {...control} inputMode="decimal" value={v.verguetung} onChange={(e) => set({ verguetung: e.target.value })} required />}
        </Field>
      </div>
      <div>
        <button type="button" className="btn btn-sm btn-danger" onClick={remove}>
          Vertrag {i + 1} entfernen
        </button>
      </div>
    </div>
  );
}

function KapgVertraege({ vertraege, setVertraege }: { vertraege: Vertrag[]; setVertraege: (v: Vertrag[]) => void }) {
  const setVertrag = (i: number, patch: Partial<Vertrag>) => setVertraege(vertraege.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  return (
    <fieldset className="stack fieldset-plain" style={{ gap: 16 }}>
      <legend>Verträge mit Anteilseignern und nahestehenden Personen (Anlage WA)</legend>
      {vertraege.map((v, i) => (
        <VertragFelder key={i} v={v} i={i} set={(patch) => setVertrag(i, patch)} remove={() => setVertraege(vertraege.filter((_, j) => j !== i))} />
      ))}
      <div>
        <button type="button" className="btn btn-dashed" onClick={() => setVertraege([...vertraege, { art: "", datum: "", partner: "", verguetung: "" }])}>
          Vertrag hinzufügen
        </button>
      </div>
    </fieldset>
  );
}

export function KapgAngaben({ data }: { data: Data }) {
  const router = useRouter();
  const save = useServerFn(saveKapgErklaerung);
  const { busy, notice, setNotice, run } = useAction();
  const a: Angaben = data.kapg!.angaben;
  const [gruendung, setGruendung] = useState(a.gruendung ?? "");
  const [einlagekonto, setEinlagekonto] = useState(euro(a.einlagekonto));
  const [rechte, setRechte] = useState(euro(a.rechteBeschraenktStpfl));
  const [personen, setPersonen] = useState<Person[]>(a.anteilseigner.map(personAusAngabe));
  const [vertraege, setVertraege] = useState<Vertrag[]>(a.vertraege.map((v) => ({ ...v, verguetung: euro(v.verguetung) })));

  function submit(event: FormEvent) {
    event.preventDefault();
    const angaben = angabenAusFormular({ gruendung, einlagekonto, rechte, personen, vertraege });
    if (!angaben) {
      setNotice({ tone: "danger", text: ANGABEN_FEHLER });
      return;
    }
    void run(async () => {
      await save({ data: { year: data.year, angaben } });
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
          <Field label="Gegründet am (nur im Gründungsjahr)">
            {(control) => <input {...control} type="date" value={gruendung} onChange={(e) => setGruendung(e.target.value)} />}
          </Field>
          <Field label={<>Steuerliches Einlagekonto zum 31.12.{data.year - 1}</>}>
            {(control) => <input {...control} inputMode="decimal" value={einlagekonto} onChange={(e) => setEinlagekonto(e.target.value)} />}
          </Field>
          <Field label="Lizenzen an beschränkt Steuerpflichtige (§ 50a EStG)">
            {(control) => <input {...control} inputMode="decimal" value={rechte} onChange={(e) => setRechte(e.target.value)} />}
          </Field>
        </div>
        <KapgAnteilseigner personen={personen} setPersonen={setPersonen} />
        <KapgVertraege vertraege={vertraege} setVertraege={setVertraege} />
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
