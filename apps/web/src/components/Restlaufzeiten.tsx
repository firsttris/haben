import { formatEuro, parseEuro } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState, type FormEvent } from "react";
import { formatDate, formatDateTime } from "../lib/format.ts";
import { sammelHinweise } from "../lib/hinweise.ts";
import { useAction } from "../lib/use-action.ts";
import type { RestlaufzeitBlock, RestlaufzeitenAnsicht } from "../server/modules/buchhaltung/index.ts";
import { saveRestlaufzeitenFn } from "../server/functions/abschluss.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";

const euroInput = (cents: number) => formatEuro(cents).replace(/\s*€$/, "");

const STAND: Record<RestlaufzeitBlock["stand"], string> = {
  keine: "Keine Forderungen oder Verbindlichkeiten.",
  fehlt: "Noch nicht bestätigt.",
  geaendert: "Die Salden haben sich seit der Bestätigung geändert; bitte prüfen und neu bestätigen.",
  bestaetigt: "Bestätigt.",
};

type Werte = Record<string, string>;
const anfang = (block: RestlaufzeitBlock | null): Werte =>
  Object.fromEntries((block?.zeilen ?? []).filter((z) => z.eingabe).map((z) => [z.account, euroInput(z.wert)]));

/** Tabelle eines Stichtags: je Konto Betrag und Teil mit mehr als einem Jahr, fest oder als Eingabe */
function Stichtag({ block, werte, setWert }: { block: RestlaufzeitBlock; werte: Werte; setWert: (account: string, wert: string) => void }) {
  const id = useId();
  const datum = formatDate(block.stichtag);
  const hinweise = sammelHinweise(block.zeilen.map((z) => z.grund));
  return (
    <section aria-labelledby={`${id}-titel`} className="stack" style={{ gap: 8 }}>
      <h3 id={`${id}-titel`} style={{ margin: 0 }}>
        Zum {datum}
      </h3>
      <p className="small" style={{ margin: 0 }}>
        {STAND[block.stand]}
      </p>
      <div className="table-scroll">
        <table className="report-table">
          <thead>
            <tr>
              <th scope="col">Konto</th>
              <th scope="col" className="num">
                Betrag
              </th>
              <th scope="col" className="num">
                Davon mehr als ein Jahr
              </th>
              <th scope="col">Woher</th>
            </tr>
          </thead>
          <tbody>
            {block.zeilen.map((z) => (
              <tr key={z.account}>
                <th scope="row">
                  <span className="mono">{z.account}</span> {z.name}
                  <span className="small muted"> ({z.art === "forderung" ? "Forderung" : "Verbindlichkeit"})</span>
                </th>
                <td className="num">{formatEuro(z.betrag)}</td>
                <td className="num">
                  {z.eingabe ? (
                    <input
                      inputMode="decimal"
                      aria-label={`Konto ${z.account} zum ${datum}: davon Restlaufzeit von mehr als einem Jahr`}
                      value={werte[z.account] ?? ""}
                      onChange={(e) => setWert(z.account, e.target.value)}
                      size={12}
                    />
                  ) : (
                    formatEuro(z.vorschlag)
                  )}
                </td>
                <td className="small muted">{hinweise.has(z.grund) ? `Hinweis ${hinweise.get(z.grund)}` : z.grund}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hinweise.size > 0 && (
        <ol className="small muted" style={{ margin: 0, paddingLeft: 20 }} aria-label={`Hinweise zum ${datum}`}>
          {[...hinweise.keys()].map((grund, index) => (
            <li key={grund} value={index + 1}>
              {grund}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Restlaufzeiten zum Stichtag (§ 268 Abs. 4 Satz 1 und Abs. 5 Satz 1 HGB) auf der Seite „Jahresabschluss“: Haben schlägt
 * je Konto vor, die Nutzerin bestätigt; daraus entstehen die Davon-Vermerke in Bilanz, Hinterlegung und E-Bilanz.
 */
export function Restlaufzeiten({ year, data }: { year: number; data: RestlaufzeitenAnsicht }) {
  const router = useRouter();
  const save = useServerFn(saveRestlaufzeitenFn);
  const { busy, notice, setNotice, run } = useAction();
  const id = useId();
  const [jahr, setJahr] = useState(() => anfang(data.jahr));
  const [vorjahr, setVorjahr] = useState(() => anfang(data.vorjahr));

  const lesen = (werte: Werte): { account: string; ueber1Jahr: number }[] | null => {
    const result: { account: string; ueber1Jahr: number }[] = [];
    for (const [account, text] of Object.entries(werte)) {
      const cents = text.trim() === "" ? 0 : parseEuro(text);
      if (cents === null || cents < 0) return null;
      result.push({ account, ueber1Jahr: cents });
    }
    return result;
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    const j = lesen(jahr);
    const v = data.vorjahr ? lesen(vorjahr) : [];
    if (!j || !v) {
      setNotice({ tone: "danger", text: "Bitte je Konto einen Betrag von 0,00 bis zum Saldo eingeben." });
      return;
    }
    void run(async () => {
      await save({ data: { year, angaben: { jahr: j, vorjahr: data.vorjahr ? v : null } } });
      await router.invalidate();
    }, "Restlaufzeiten bestätigt.");
  }

  return (
    <section className="card" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} style={{ marginTop: 0 }}>
        Restlaufzeiten {year}
      </h2>
      <p className="small muted" style={{ marginTop: 0, maxWidth: 760 }}>
        Unter der Bilanz stehen bei den Forderungen der Betrag mit einer Restlaufzeit von mehr als einem Jahr und bei den Verbindlichkeiten die Beträge bis zu
        einem Jahr und darüber (§ 268 Abs. 4 und 5 HGB). Haben schlägt sie aus dem Konto und der Fälligkeit offener Rechnungen und Belege vor; Darlehen und
        Vereinbarungen mit dem Gesellschafter kennt Haben nicht. Prüfe die Werte, am besten mit der Steuerberatung, und bestätige sie.
      </p>
      <form onSubmit={submit} className="stack" style={{ gap: 20 }} aria-label={`Restlaufzeiten ${year}`}>
        <Stichtag block={data.jahr} werte={jahr} setWert={(account, wert) => setJahr((w) => ({ ...w, [account]: wert }))} />
        {data.vorjahr && <Stichtag block={data.vorjahr} werte={vorjahr} setWert={(account, wert) => setVorjahr((w) => ({ ...w, [account]: wert }))} />}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Restlaufzeiten bestätigen
          </button>
          {data.bestaetigtAm && <span className="small muted">Zuletzt bestätigt am {formatDateTime(data.bestaetigtAm)}</span>}
        </div>
      </form>
      <NoticeBanner notice={notice} />
    </section>
  );
}
