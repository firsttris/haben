import { EVATR_FRIST_TAGE } from "@haben/core";
import { useLocation, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { errorMessage } from "../../lib/format.ts";
import { useGemerkteMeldung } from "../../lib/gemerkte-meldung.ts";
import { bestaetigeZmNummernFn } from "../../server/functions/zm.ts";
import { NoticeBanner } from "../NoticeBanner.tsx";

/**
 * Gemeldete USt-IdNrn. der Zusammenfassenden Meldung beim BZSt bestätigen (#1385): fragt jede Nummer, deren letzte Antwort
 * nicht gültig oder älter als 30 Tage ist, einfach ab; was das BZSt meldet, steht danach oben in der Vorprüfung.
 */
export function ZmBestaetigung({ period, offen }: { period: { year: number; month: number }; offen: number }) {
  const router = useRouter();
  const bestaetige = useServerFn(bestaetigeZmNummernFn);
  const [busy, setBusy] = useState(false);
  // Die Meldung übersteht einen Neuaufbau der Seite nach dem Neuladen und gilt für diesen Besuch der Seite (gemerkte-meldung.ts)
  const besuch = useLocation({ select: (location) => location.state.__TSR_key ?? location.href });
  const [notice, setNotice] = useGemerkteMeldung(`zm-bestaetigung-${period.year}-${period.month}`, besuch);
  const nummern = (n: number) => `${n} gemeldete ${n === 1 ? "USt-IdNr." : "USt-IdNrn."}`;

  async function bestaetigen() {
    setBusy(true);
    setNotice(null);
    try {
      const ergebnis = await bestaetige({ data: period });
      if (ergebnis.hinweise.length) setNotice({ tone: "info", text: ergebnis.hinweise.join(" · ") });
      else setNotice({ tone: "ok", text: `${nummern(ergebnis.gefragt)} beim BZSt angefragt; das Ergebnis steht in der Vorprüfung oben.` });
      await router.invalidate();
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <NoticeBanner notice={notice} />
      <p className="small muted" style={{ margin: 0 }}>
        {offen
          ? `${nummern(offen)}: letzte Antwort des BZSt nicht gültig oder älter als ${EVATR_FRIST_TAGE} Tage.`
          : `Jede gemeldete USt-IdNr. hat eine gültige Bestätigung des BZSt aus den letzten ${EVATR_FRIST_TAGE} Tagen.`}
      </p>
      {offen > 0 && (
        <div className="actions">
          <button type="button" className="btn" disabled={busy} onClick={() => void bestaetigen()}>
            {busy ? "Frage beim BZSt an …" : "Beim BZSt bestätigen"}
          </button>
        </div>
      )}
    </div>
  );
}
