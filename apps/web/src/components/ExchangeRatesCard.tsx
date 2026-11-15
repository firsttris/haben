import { currentYear, formatRateMonth } from "@haben/core";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useState } from "react";
import type { ExchangeRateViewMode } from "../lib/exchange-rate-view.ts";
import { useAction } from "../lib/use-action.ts";
import { useSubmitCheck } from "../lib/use-submit-check.ts";
import { deleteExchangeRateFn, type getExchangeRates, importExchangeRatesFn, refreshExchangeRatesFn, saveExchangeRateFn } from "../server/functions/company.ts";
import { ExchangeRatesList } from "./ExchangeRatesList.tsx";
import { Field } from "./Field.tsx";
import { FilePicker } from "./FilePicker.tsx";
import { MonthPicker } from "./MonthPicker.tsx";
import { NoticeBanner } from "./NoticeBanner.tsx";

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

function ManualExchangeRateForm({ busy, onSave }: { busy: boolean; onSave: (currency: string, month: string, rate: string, reset: () => void) => void }) {
  const [currency, setCurrency] = useState("");
  const [month, setMonth] = useState("");
  const [rate, setRate] = useState("");
  const {
    form: rateForm,
    error,
    check,
  } = useSubmitCheck({
    currency: currency.trim() === "" ? "Trag die Währung ein." : null,
    month: month === "" ? "Wähle den Monat." : null,
    rate: rate.trim() === "" ? "Trag den Kurs ein." : null,
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check()) return;
    onSave(currency.trim(), month, rate.trim(), () => {
      setCurrency("");
      setMonth("");
      setRate("");
    });
  }

  return (
    <form ref={rateForm} className="stack" style={{ gap: 8 }} onSubmit={onSubmit} aria-labelledby="rate-manual" noValidate>
      <h3 id="rate-manual" style={{ margin: 0 }}>
        Kurs von Hand
      </h3>
      <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
        Für einen Monat, den das BMF noch nicht veröffentlicht hat (vorläufig), oder eine Währung, die dort fehlt. Veröffentlicht das BMF den Monat später,
        ersetzt der amtliche Kurs deinen.
      </p>
      <div className="form-row cols-3">
        <Field label="Währung" error={error("currency")}>
          {(control) => (
            <input
              {...control}
              name="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              required
              maxLength={3}
              placeholder="USD"
              className="mono"
              style={{ textTransform: "uppercase" }}
            />
          )}
        </Field>
        <Field label="Monat" error={error("month")}>
          {(control) => <MonthPicker {...control} name="month" value={month} onChange={setMonth} />}
        </Field>
        <Field label="1 EUR = …" error={error("rate")}>
          {(control) => (
            <input
              {...control}
              name="rate"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              required
              inputMode="decimal"
              placeholder="1,0812"
              className="mono"
            />
          )}
        </Field>
      </div>
      <div className="actions">
        <button type="submit" className="btn" disabled={busy}>
          Kurs speichern
        </button>
      </div>
    </form>
  );
}

function BmfUploadSection({
  year,
  uploads,
  busy,
  onYearChange,
  onFile,
}: {
  year: string;
  uploads: number;
  busy: boolean;
  onYearChange: (year: string) => void;
  onFile: (file: File) => void;
}) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <h3 style={{ margin: 0 }}>CSV-Datei des BMF hochladen</h3>
      <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
        Falls der Server das Internet nicht erreicht: die Datei „Umsatzsteuer-Umrechnungskurse“ (CSV) aus dem Datenportal des BMF herunterladen und hier
        hochladen.
      </p>
      <div className="form-row cols-3">
        <Field label="Jahr der Datei">
          {(control) => <input {...control} inputMode="numeric" value={year} onChange={(e) => onYearChange(e.target.value.replace(/\D/g, "").slice(0, 4))} />}
        </Field>
        <Field label="Datei">
          {(control) => (
            <FilePicker
              key={uploads}
              {...control}
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file) onFile(file);
              }}
            />
          )}
        </Field>
      </div>
    </div>
  );
}

/** Einstellungen → Fremdwährung: Umsatzsteuer-Umrechnungskurse des BMF abrufen, hochladen oder von Hand eintragen */
export function ExchangeRatesCard({ data }: { data: Data }) {
  const router = useRouter();
  const refresh = useServerFn(refreshExchangeRatesFn);
  const save = useServerFn(saveExchangeRateFn);
  const remove = useServerFn(deleteExchangeRateFn);
  const upload = useServerFn(importExchangeRatesFn);
  const { busy, notice, setNotice, run } = useAction();
  const [year, setYear] = useState(String(currentYear()));
  // Ein neuer key leert das Dateifeld samt angezeigtem Namen nach dem Hochladen
  const [uploads, setUploads] = useState(0);
  const [mode, setMode] = useState<ExchangeRateViewMode>("month");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [selectedCurrency, setSelectedCurrency] = useState("");
  const [currencyQuery, setCurrencyQuery] = useState("");

  const summary = (r: { added: number; changed: number; applied: number }) =>
    `${plural(r.added, "Kurs", "Kurse")} neu, ${r.changed} geändert. ${r.applied > 0 ? `${plural(r.applied, "Beleg oder Entwurf", "Belege und Entwürfe")} in Euro umgerechnet.` : ""}`;

  return (
    <section className="card" aria-labelledby="rates-heading">
      <h2 id="rates-heading">Umsatzsteuer-Umrechnungskurse</h2>
      <p className="small muted" style={{ margin: 0, maxWidth: 760 }}>
        Beträge in Fremdwährung rechnet Haben mit dem Umsatzsteuer-Umrechnungskurs des Monats in Euro um (§ 16 Abs. 6 UStG). Das BMF veröffentlicht die Kurse am
        ersten Arbeitstag des Folgemonats; Haben ruft sie dann von selbst ab, sobald du Fremdwährung nutzt. Belege, die noch auf den Kurs warten, werden danach
        umgerechnet. Gebuchte Belege und festgeschriebene Rechnungen behalten ihren Kurs.
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
      <ManualExchangeRateForm
        busy={busy}
        onSave={(currency, month, rate, reset) =>
          void run(async () => {
            const { applied } = await save({ data: { currency, month, rate } });
            reset();
            if (month) setSelectedMonth(month);
            if (currency) setSelectedCurrency(currency.toUpperCase());
            setCurrencyQuery("");
            await router.invalidate();
            setNotice({
              tone: "ok",
              text: `Kurs gespeichert.${applied > 0 ? ` ${plural(applied, "Beleg oder Entwurf", "Belege und Entwürfe")} in Euro umgerechnet.` : ""}`,
            });
          })
        }
      />
      <BmfUploadSection
        year={year}
        uploads={uploads}
        busy={busy}
        onYearChange={setYear}
        onFile={(file) =>
          void run(async () => {
            const result = await upload({ data: { year: Number(year), text: await readText(file) } });
            setUploads((n) => n + 1);
            await router.invalidate();
            setNotice({ tone: "ok", text: `${plural(result.fetched, "Kurs", "Kurse")} gelesen: ${summary(result)}` });
          })
        }
      />
      <ExchangeRatesList
        rates={data.rates}
        mode={mode}
        month={selectedMonth}
        currency={selectedCurrency}
        currencyQuery={currencyQuery}
        busy={busy}
        onModeChange={(nextMode) => {
          setMode(nextMode);
          setCurrencyQuery("");
        }}
        onMonthChange={setSelectedMonth}
        onCurrencyChange={setSelectedCurrency}
        onCurrencyQueryChange={setCurrencyQuery}
        onDelete={(c, m, remainingManual) =>
          void run(async () => {
            await remove({ data: { currency: c, month: m } });
            if (remainingManual <= 0 && mode === "manual") setMode("month");
            await router.invalidate();
          }, "Kurs gelöscht.")
        }
      />
      <p className="small muted" style={{ margin: 0 }}>
        Quelle der Kurse: Bundesministerium der Finanzen, Datenlizenz Deutschland – Namensnennung – Version 2.0.
      </p>
    </section>
  );
}
