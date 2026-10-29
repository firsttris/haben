import { formatExchangeRate, formatRateMonth } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { formatDateTime } from "../lib/format.ts";
import { useAction } from "../lib/use-action.ts";
import { NoticeBanner } from "./NoticeBanner.tsx";
import {
  deleteExchangeRateFn,
  importExchangeRatesFn,
  refreshExchangeRatesFn,
  saveExchangeRateFn,
  type getExchangeRates,
} from "../server/functions/company.ts";
import { ScrollTable } from "./ScrollTable.tsx";

type Data = Awaited<ReturnType<typeof getExchangeRates>>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** CSV-Dateien des BMF sind nicht immer UTF-8; ohne gültiges UTF-8 als Windows-1252 lesen */
async function readText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Einstellungen → Fremdwährung: Umsatzsteuer-Umrechnungskurse des BMF abrufen, hochladen oder von Hand eintragen */
export function ExchangeRatesCard({ data }: { data: Data }) {
  const router = useRouter();
  const refresh = useServerFn(refreshExchangeRatesFn);
  const save = useServerFn(saveExchangeRateFn);
  const remove = useServerFn(deleteExchangeRateFn);
  const upload = useServerFn(importExchangeRatesFn);
  const { busy, notice, setNotice, run } = useAction();
  const [year, setYear] = useState(String(new Date().getFullYear()));

  const summary = (r: { added: number; changed: number; applied: number }) =>
    `${plural(r.added, "Kurs", "Kurse")} neu, ${r.changed} geändert. ${r.applied > 0 ? `${plural(r.applied, "Beleg oder Entwurf", "Belege und Entwürfe")} in Euro umgerechnet.` : ""}`;

  function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void run(async () => {
      const { applied } = await save({
        data: { currency: String(values.get("currency") ?? ""), month: String(values.get("month") ?? ""), rate: String(values.get("rate") ?? "") },
      });
      form.reset();
      await router.invalidate();
      setNotice({ tone: "ok", text: `Kurs gespeichert.${applied > 0 ? ` ${plural(applied, "Beleg oder Entwurf", "Belege und Entwürfe")} in Euro umgerechnet.` : ""}` });
    });
  }

  return (
    <section className="card" aria-labelledby="rates-heading">
      <h2 id="rates-heading">Umsatzsteuer-Umrechnungskurse</h2>
      <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
        Beträge in Fremdwährung rechnet Haben mit dem Umsatzsteuer-Umrechnungskurs des Monats in Euro um (§ 16 Abs. 6 UStG). Das BMF veröffentlicht die
        Kurse am ersten Arbeitstag des Folgemonats; Haben ruft sie dann von selbst ab, sobald du Fremdwährung nutzt. Belege, die noch auf den Kurs warten,
        werden danach umgerechnet. Gebuchte Belege und festgeschriebene Rechnungen behalten ihren Kurs.
      </p>
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await refresh();
              await router.invalidate();
              setNotice({ tone: "ok", text: `Abgerufen bis ${result.latest ? formatRateMonth(result.latest) : "–"}: ${summary(result)}` });
            })
          }
        >
          Kurse jetzt abrufen
        </button>
      </div>
      <NoticeBanner notice={notice} />

      <form className="stack" style={{ gap: 8 }} onSubmit={onSave} aria-labelledby="rate-manual">
        <h3 id="rate-manual" style={{ margin: 0 }}>
          Kurs von Hand
        </h3>
        <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
          Für einen Monat, den das BMF noch nicht veröffentlicht hat (vorläufig), oder eine Währung, die dort fehlt. Veröffentlicht das BMF den Monat
          später, ersetzt der amtliche Kurs deinen.
        </p>
        <div className="form-row cols-3">
          <label className="field">
            Währung
            <input name="currency" required maxLength={3} placeholder="USD" className="mono" style={{ textTransform: "uppercase" }} />
          </label>
          <label className="field">
            Monat
            <input name="month" type="month" required />
          </label>
          <label className="field">
            1 EUR = …
            <input name="rate" required inputMode="decimal" placeholder="1,0812" className="mono" />
          </label>
        </div>
        <div className="actions">
          <button type="submit" className="btn" disabled={busy}>
            Kurs speichern
          </button>
        </div>
      </form>

      <div className="stack" style={{ gap: 8 }}>
        <h3 style={{ margin: 0 }}>CSV-Datei des BMF hochladen</h3>
        <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
          Falls der Server das Internet nicht erreicht: die Datei „Umsatzsteuer-Umrechnungskurse“ (CSV) aus dem Datenportal des BMF herunterladen und hier
          hochladen.
        </p>
        <div className="form-row cols-3">
          <label className="field">
            Jahr der Datei
            <input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} />
          </label>
          <label className="field">
            Datei
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                const input = e.currentTarget;
                const file = input.files?.[0];
                if (!file) return;
                void run(async () => {
                  const result = await upload({ data: { year: Number(year), text: await readText(file) } });
                  input.value = "";
                  await router.invalidate();
                  setNotice({ tone: "ok", text: `${plural(result.fetched, "Kurs", "Kurse")} gelesen: ${summary(result)}` });
                });
              }}
            />
          </label>
        </div>
      </div>

      {data.rates.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          Noch keine Kurse.
        </p>
      ) : (
        <ScrollTable className="report-table">
          <thead>
            <tr>
              <th>Monat</th>
              <th>Währung</th>
              <th className="num">1 EUR =</th>
              <th>Quelle</th>
              <th>
                <span className="visually-hidden">Aktion</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rates.map((r) => (
              <tr key={`${r.currency}-${r.month}`}>
                <td>{formatRateMonth(r.month)}</td>
                <td className="mono">{r.currency}</td>
                <td className="num mono">{formatExchangeRate(r.rate)}</td>
                <td className="small">{r.source === "bmf" ? `BMF, abgerufen ${formatDateTime(r.fetchedAt)}` : "von Hand"}</td>
                <td>
                  {r.source === "manuell" && (
                    <button
                      type="button"
                      className="link-button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await remove({ data: { currency: r.currency, month: r.month } });
                          await router.invalidate();
                        }, "Kurs gelöscht.")
                      }
                    >
                      Löschen
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        Quelle der Kurse: Bundesministerium der Finanzen, Datenlizenz Deutschland – Namensnennung – Version 2.0.
      </p>
    </section>
  );
}
