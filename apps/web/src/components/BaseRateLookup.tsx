import { formatDecimal, formatRateMonth } from "@haben/core";
import { useServerFn } from "@tanstack/react-start";
import { useAction } from "../lib/use-action.ts";
import { fetchBaseRateFn } from "../server/functions/dunning.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";

/** Einstellungen → Mahnwesen: Basiszinssatz bei der Bundesbank abfragen und ins Feld übernehmen; gespeichert wird mit dem Formular */
export function BaseRateLookup({ onFound }: { onFound: (value: string) => void }) {
  const lookup = useServerFn(fetchBaseRateFn);
  const { busy, notice, setNotice, run } = useAction();

  function onClick() {
    void run(async () => {
      const rate = await lookup();
      const value = formatDecimal(rate.basisPoints);
      // Ein Wert aus dem vorigen Halbjahr bleibt draußen, sonst stünden falsche Zinsen in der nächsten Mahnung
      if (rate.current) onFound(value);
      setNotice(
        rate.current
          ? { tone: "ok", text: `Basiszinssatz ${value} % eingetragen (Bundesbank, Stand ${formatRateMonth(rate.month)}). Gilt nach dem Speichern.` }
          : {
              tone: "info",
              text: `Die Bundesbank meldet ${value} % mit Stand ${formatRateMonth(rate.month)}, der Satz für das neue Halbjahr steht noch nicht in der Zeitreihe. Das Feld bleibt unverändert; später erneut abrufen oder von Hand eintragen.`,
            },
      );
    });
  }

  return (
    <>
      <div className="actions">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={onClick}>
          Bei der Bundesbank abrufen
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </>
  );
}
