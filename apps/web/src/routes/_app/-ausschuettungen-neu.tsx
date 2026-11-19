import { formatEuro, parseEuro } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { formatDate } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { createAusschuettungFn, previewAusschuettung } from "../../server/functions/ausschuettung.ts";
import { Field } from "../../components/Field.tsx";

export type Vorschlag = Awaited<ReturnType<typeof previewAusschuettung>>;

/** Anmeldung und Abführung bis zum 10. des Folgemonats nach dem Zufluss (§ 44 Abs. 1 Satz 5 EStG) */
export function faelligkeit(zufluss: string): string {
  const [y, m] = zufluss.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-10` : `${y}-${String(m + 1).padStart(2, "0")}-10`;
}

export function EmpfaengerTabelle({ empfaenger }: { empfaenger: Vorschlag["empfaenger"] }) {
  const summe = (f: (e: Vorschlag["empfaenger"][number]) => number) => empfaenger.reduce((s, e) => s + f(e), 0);
  const zeilen = [...empfaenger, null];
  return (
    <table className="report-table stack-table">
      <thead>
        <tr>
          <th scope="col">Gesellschafter</th>
          <th scope="col" className="num">
            Brutto
          </th>
          <th scope="col" className="num">
            Aus Einlagekonto
          </th>
          <th scope="col" className="num">
            KapESt
          </th>
          <th scope="col" className="num">
            Soli
          </th>
          <th scope="col" className="num">
            KiSt
          </th>
          <th scope="col" className="num">
            Auszuzahlen
          </th>
        </tr>
      </thead>
      <tbody>
        {zeilen.map((e) => (
          <tr key={e?.name ?? "summe"} style={e ? undefined : { fontWeight: 600 }}>
            <th scope="row">{e ? `${e.name} (${(e.anteil / 100).toLocaleString("de-DE")} %)` : "Summe"}</th>
            <td className="num" data-label="Brutto">
              {formatEuro(e ? e.brutto : summe((x) => x.brutto))}
            </td>
            <td className="num" data-label="Aus Einlagekonto">
              {formatEuro(e ? e.ausEinlagekonto : summe((x) => x.ausEinlagekonto))}
            </td>
            <td className="num" data-label="KapESt">
              {formatEuro(e ? e.kapest : summe((x) => x.kapest))}
            </td>
            <td className="num" data-label="Soli">
              {formatEuro(e ? e.soli : summe((x) => x.soli))}
            </td>
            <td className="num" data-label="KiSt">
              {formatEuro(e ? e.kist : summe((x) => x.kist))}
            </td>
            <td className="num" data-label="Auszuzahlen">
              {formatEuro(e ? e.netto : summe((x) => x.netto))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Eingaben für Vorschau und Anlegen, null solange Beschluss, Geschäftsjahr oder Betrag fehlen */
function eingabe(beschluss: string, auszahlungstag: string, geschaeftsjahr: string, betrag: string) {
  const brutto = parseEuro(betrag);
  const jahr = Number(geschaeftsjahr);
  return brutto && beschluss && Number.isInteger(jahr) && jahr > 0 ? { beschluss, auszahlungstag: auszahlungstag || null, geschaeftsjahr: jahr, brutto } : null;
}

export function NeueAusschuettung() {
  const router = useRouter();
  const preview = useServerFn(previewAusschuettung);
  const create = useServerFn(createAusschuettungFn);
  const { busy, notice, setNotice, run } = useAction();
  const [beschluss, setBeschluss] = useState("");
  const [auszahlungstag, setAuszahlungstag] = useState("");
  const [geschaeftsjahr, setGeschaeftsjahr] = useState("");
  // Vorbelegt, bis jemand das Feld selbst ändert: Das Datumsfeld meldet beim Tippen Zwischenstände wie 0002-01-02
  const [jahrSelbstGesetzt, setJahrSelbstGesetzt] = useState(false);
  const [betrag, setBetrag] = useState("");
  const [vorschlag, setVorschlag] = useState<Vorschlag | null>(null);
  const input = () => eingabe(beschluss, auszahlungstag, geschaeftsjahr, betrag);

  function berechnen(event: FormEvent) {
    event.preventDefault();
    const data = input();
    if (!data) {
      setNotice({ tone: "danger", text: "Datum des Beschlusses, Geschäftsjahr und Betrag eingeben." });
      return;
    }
    void run(async () => setVorschlag(await preview({ data })));
  }

  return (
    <section className="card" aria-labelledby="neu-heading">
      <h2 id="neu-heading" style={{ marginTop: 0 }}>
        Gewinnverwendungsbeschluss buchen
      </h2>
      <form onSubmit={berechnen} aria-label="Neue Ausschüttung" className="stack" style={{ gap: 12 }}>
        <div className="form-row cols-2">
          <Field label="Datum des Beschlusses">
            {(control) => (
              <input
                {...control}
                type="date"
                value={beschluss}
                onChange={(e) => {
                  setBeschluss(e.target.value);
                  // Meist beschließt die Gesellschafterversammlung über den Gewinn des Vorjahres
                  if (!jahrSelbstGesetzt && /^\d{4}-/.test(e.target.value)) setGeschaeftsjahr(String(Number(e.target.value.slice(0, 4)) - 1));
                  setVorschlag(null);
                }}
                required
              />
            )}
          </Field>
          <Field label="Auszahlungstag laut Beschluss (optional)">
            {(control) => (
              <input
                {...control}
                type="date"
                value={auszahlungstag}
                onChange={(e) => {
                  setAuszahlungstag(e.target.value);
                  setVorschlag(null);
                }}
              />
            )}
          </Field>
          <Field label="Geschäftsjahr, dessen Gewinn ausgeschüttet wird">
            {(control) => (
              <input
                {...control}
                inputMode="numeric"
                value={geschaeftsjahr}
                onChange={(e) => {
                  setGeschaeftsjahr(e.target.value);
                  setJahrSelbstGesetzt(true);
                  setVorschlag(null);
                }}
                placeholder="z. B. 2025"
                required
              />
            )}
          </Field>
          <Field label="Ausschüttung brutto">
            {(control) => (
              <input
                {...control}
                inputMode="decimal"
                value={betrag}
                onChange={(e) => {
                  setBetrag(e.target.value);
                  setVorschlag(null);
                }}
                placeholder="0,00"
                required
              />
            )}
          </Field>
        </div>
        <div className="actions">
          <button type="submit" className="btn" disabled={busy}>
            Steuerabzug berechnen
          </button>
        </div>
      </form>
      {vorschlag && (
        <div className="stack" style={{ gap: 12, marginTop: 16 }} role="region" aria-label="Berechnung der Ausschüttung">
          <p className="small muted" style={{ margin: 0 }}>
            Zufluss am {formatDate(vorschlag.zufluss)}; Anmeldung bis {formatDate(faelligkeit(vorschlag.zufluss))}. Ausschüttbarer Gewinn nach § 27 KStG{" "}
            {formatEuro(vorschlag.ausschuettbarerGewinn)}
            {vorschlag.ausEinlagekonto > 0 ? `; ${formatEuro(vorschlag.ausEinlagekonto)} gehen ohne Steuerabzug aus dem Einlagekonto` : ""}.
          </p>
          <EmpfaengerTabelle empfaenger={vorschlag.empfaenger} />
          {vorschlag.issues.map((text) => (
            <div key={text} className="banner" role="status">
              {text}
            </div>
          ))}
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || vorschlag.issues.length > 0}
              onClick={() => {
                const data = input();
                if (!data) return;
                void run(async () => {
                  await create({ data });
                  setVorschlag(null);
                  setBetrag("");
                  await router.navigate({ to: "/ausschuettungen", search: { jahr: Number(vorschlag.zufluss.slice(0, 4)) } });
                  await router.invalidate();
                }, "Ausschüttung gebucht.");
              }}
            >
              Beschluss buchen
            </button>
          </div>
        </div>
      )}
      <NoticeBanner notice={notice} />
    </section>
  );
}
