import { computeUstva, formatDecimal, formatEuro, parseEuro, parsePeriodKey, periodKey, periodLabel, quarterOfMonth } from "@haben/core";
import { Link, createFileRoute, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState, type FormEvent } from "react";
import { ElsterSubmit } from "../../../components/ElsterSubmit.tsx";
import { MeinElsterWerte } from "../../../components/MeinElsterWerte.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { VatFrequencyCard } from "../../../components/umsatzsteuer/VatFrequencyCard.tsx";
import { DauerfristCard } from "../../../components/umsatzsteuer/DauerfristCard.tsx";
import { AbgabeVermerken } from "../../../components/umsatzsteuer/AbgabeVermerken.tsx";
import { UstvaZahlung } from "../../../components/umsatzsteuer/UstvaZahlung.tsx";
import { ELSTER_KIND_LABEL, elsterNotice, zahllastFakt, type ElsterKind } from "../../../lib/elster.ts";
import { formatDate, formatDateTime, formatLongDate, errorMessage } from "../../../lib/format.ts";
import { createVatCorrection, getMeinElsterUstvaWerte, getVatPeriod, saveVatDraft, submitVatReturn } from "../../../server/functions/vat.ts";
import type { Notice } from "../../../lib/use-action.ts";

export const Route = createFileRoute("/_app/umsatzsteuer/$zeitraum")({
  loader: ({ params }) => {
    const period = parsePeriodKey(params.zeitraum);
    if (!period) throw notFound();
    return getVatPeriod({ data: period });
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `Umsatzsteuer ${loaderData ? periodLabel(loaderData.period) : ""} · Haben` }],
  }),
  component: VatPeriodPage,
});

const ELSTER_ABGABE_DOCS = "https://haben.app/elster-abgabe.html";

type PageData = Awaited<ReturnType<typeof getVatPeriod>>;
type FieldKey =
  | "kz81"
  | "kz86"
  | "kz21"
  | "kz45"
  | "kz48"
  | "kz66"
  | "kz46"
  | "kz47"
  | "kz84"
  | "kz85"
  | "kz67"
  | "kz39"
  | "kz41"
  | "kz43"
  | "kz89"
  | "kz93"
  | "kz61"
  | "kz62";
const FIELDS: FieldKey[] = [
  "kz81",
  "kz86",
  "kz21",
  "kz39",
  "kz41",
  "kz43",
  "kz45",
  "kz46",
  "kz47",
  "kz48",
  "kz61",
  "kz62",
  "kz66",
  "kz67",
  "kz84",
  "kz85",
  "kz89",
  "kz93",
];

type Figures = Pick<Record<FieldKey, number>, "kz81" | "kz86" | "kz66"> & Partial<Record<FieldKey, number>>;

/** Gleiche Kennzahlen? Fehlende Kz 21/45/48 (ältere Anmeldungen) zählen als 0 */
function sameFigures(a: Figures, b: Figures): boolean {
  return FIELDS.every((field) => (a[field] ?? 0) === (b[field] ?? 0));
}
type PeriodNotice = { key: string; notice: Notice };

/** „Kz 81 1.000,00 €, Kz 86 0,00 € und Kz 66 12,00 €“; Kz 21/45/48 nur, wenn belegt */
function describe(figures: Record<FieldKey, number>): string {
  const parts = FIELDS.filter((f) => ["kz81", "kz86", "kz66"].includes(f) || figures[f] !== 0).map((f) => `Kz ${f.slice(2)} ${formatEuro(figures[f])}`);
  return `${parts.slice(0, -1).join(", ")} und ${parts.at(-1)}`;
}

function VatPeriodPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const selectId = useId();
  const key = periodKey(data.period);
  // Meldungen überleben das Neuaufsetzen des Formulars nach dem Speichern
  // und gelten nur für den Zeitraum, in dem sie entstanden sind.
  const [periodNotice, setPeriodNotice] = useState<PeriodNotice | null>(null);
  const notice = periodNotice?.key === key ? periodNotice.notice : null;
  const setNotice = (next: Notice) => setPeriodNotice({ key, notice: next });
  // Zeiträume nach dem eingestellten Voranmeldungszeitraum, dazu der angezeigte, falls er nicht dazugehört
  const options = [...data.periods];
  if (!options.some((option) => periodKey(option) === key)) options.push(data.period);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Umsatzsteuer › Voranmeldung</div>
          <div className="title-with-status">
            <h1>{periodLabel(data.period)}</h1>
            <StatusPill current={data.current} filing={data.filings.find((f) => f.vatReturnId === data.current?.id)} />
          </div>
        </div>
        <label className="field" htmlFor={selectId}>
          Zeitraum
          <select id={selectId} value={key} onChange={(event) => navigate({ to: "/umsatzsteuer/$zeitraum", params: { zeitraum: event.target.value } })}>
            {options.map((option) => (
              <option key={periodKey(option)} value={periodKey(option)}>
                {periodLabel(option)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {data.mode === "simuliert" && (
        <div className="banner banner-info" role="status">
          <Icon name="info" />
          <span>ERiC ist nicht eingerichtet. Prüfen und Senden laufen simuliert, nichts geht an das Finanzamt.</span>
        </div>
      )}
      {!data.herstellerIdConfigured && data.current?.status !== "sent" && (
        <div className="banner banner-info" role="status">
          <Icon name="info" />
          <span>
            Ohne eigene Hersteller-ID gibst du in Mein ELSTER ab: Entwurf speichern, „XML für Mein ELSTER“ herunterladen und dort im Formular
            Umsatzsteuer-Voranmeldung unter Datenübernahme › XML-Import hochladen. Prüfen und absenden machst du in Mein ELSTER.{" "}
            <a href={ELSTER_ABGABE_DOCS} target="_blank" rel="noreferrer">
              Abgabe in Mein ELSTER
            </a>
          </span>
        </div>
      )}
      {data.periodProblem && (
        <div className="banner" role="status">
          <Icon name="alert" />
          <span>{data.periodProblem}</span>
        </div>
      )}
      {data.companyIssues.length > 0 && (
        <div className="banner" role="status">
          <Icon name="alert" />
          <span>
            Firmendaten unvollständig: {data.companyIssues.join(", ")}. <Link to="/einstellungen">In den Einstellungen ergänzen</Link>
          </span>
        </div>
      )}

      {data.current?.status !== "sent" &&
        data.preflight.map((issue) => (
          <div key={issue.text} className={`banner ${issue.tone === "info" ? "banner-info" : ""}`} role="status">
            <Icon name={issue.tone === "info" ? "info" : "alert"} />
            <span>
              {issue.text}{" "}
              <Link to={issue.link}>
                {
                  {
                    "/bank": "Zur Bank",
                    "/belege": "Zu den Belegen",
                    "/rechnungen": "Zu den Rechnungen",
                    "/konten": "Zu den Konten",
                  }[issue.link]
                }
              </Link>
            </span>
          </div>
        ))}

      {(data.figures.kz21 !== 0 || data.figures.kz41 !== 0) && (
        <div className="banner banner-info" role="status">
          <Icon name="info" />
          <span>
            {data.figures.kz41 !== 0 ? "Leistungen und Lieferungen ins EU-Ausland (Kz 21, 41)" : "Leistungen ins EU-Ausland (Kz 21)"} meldest du je Quartal
            zusätzlich dem BZSt.{" "}
            <Link
              to="/umsatzsteuer/zm/$quartal"
              params={{
                quartal: periodKey({ year: data.period.year, month: data.period.month >= 41 ? data.period.month : quarterOfMonth(data.period.month) }),
              }}
            >
              Zur Zusammenfassenden Meldung
            </Link>
          </span>
        </div>
      )}

      {/* key: Formular bei Zeitraum- oder Anmeldungswechsel neu aufsetzen */}
      <VatReturnEditor key={`${key}-${data.current?.id ?? "neu"}-${data.current?.updatedAt ?? ""}`} data={data} notice={notice} setNotice={setNotice} />
      {/* Außerhalb des Editors: der baut sich nach jedem Speichern der Anmeldung neu auf und verwürfe sonst die Auswahl hier */}
      <div className="grid-main" style={{ marginTop: 16 }}>
        <VatFrequencyCard key={data.frequency.year} frequency={data.frequency} />
        <DauerfristCard key={`dauerfrist-${data.dauerfrist.year}`} overview={data.dauerfrist} setup={data} />
      </div>
    </>
  );
}

function VatReturnEditor({ data, notice, setNotice }: { data: PageData; notice: Notice; setNotice: (notice: Notice) => void }) {
  const router = useRouter();
  const save = useServerFn(saveVatDraft);
  const submit = useServerFn(submitVatReturn);
  const correct = useServerFn(createVatCorrection);
  const loadWerte = useServerFn(getMeinElsterUstvaWerte);

  const current = data.current;
  const locked = current?.status === "sent";
  // Kz 39: die Sondervorauszahlung, abgezogen in der letzten Voranmeldung des Jahres
  const computed = computeUstva({ ...data.figures, kz39: data.kz39 });
  const [mode, setMode] = useState<"berechnet" | "manuell">(current?.source === "manuell" ? "manuell" : "berechnet");
  const [values, setValues] = useState<Record<FieldKey, string>>(
    () => Object.fromEntries(FIELDS.map((f) => [f, formatDecimal(current?.source === "manuell" ? current[f] : computed[f])])) as Record<FieldKey, string>,
  );
  const [reason, setReason] = useState(current?.overrideReason ?? "");
  const [openSources, setOpenSources] = useState<string | null>(null);
  const toggleSources = (kz: string) => setOpenSources((open) => (open === kz ? null : kz));
  const [dirty, setDirty] = useState(!current);
  const [busy, setBusy] = useState(false);

  const parsed = Object.fromEntries(FIELDS.map((f) => [f, parseEuro(values[f])])) as Record<FieldKey, number | null>;
  // Negative Werte sind erlaubt, etwa wenn Gutschriften im Monat überwiegen
  const manualValid = Object.values(parsed).every((v) => v !== null) && reason.trim().length >= 10;
  const manualFigures = Object.fromEntries(FIELDS.map((f) => [f, parsed[f] ?? 0])) as Record<FieldKey, number>;
  // Ein Zeitraum, der nicht zum eingestellten Voranmeldungszeitraum passt, lässt sich nicht neu anmelden; berichtigen geht
  const allowed = !data.periodProblem || Boolean(current?.berichtigt);
  const valid = allowed && (mode === "berechnet" || manualValid);
  const shown = locked ? computeUstva(current!) : mode === "manuell" ? computeUstva(manualFigures) : computed;
  // Gespeicherter berechneter Entwurf, dessen Werte sich inzwischen geändert haben
  const stale = !locked && current?.source === "berechnet" && !sameFigures(current, computed);

  // Gesendete Anmeldung, deren Buchungen sich danach geändert haben (z. B. Zuordnung aufgehoben)
  const sentBasis = locked ? (current!.source === "berechnet" ? current! : current!.computed) : null;
  const drift = sentBasis !== null && sentBasis !== undefined && !sameFigures(sentBasis, computed);

  function update(field: FieldKey, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
  }

  function switchMode(next: "berechnet" | "manuell") {
    setMode(next);
    setDirty(true);
  }

  async function persist(): Promise<string> {
    const result = await save({
      data: mode === "berechnet" ? { mode: "berechnet", period: data.period } : { mode: "manuell", period: data.period, ...manualFigures, reason },
    });
    setDirty(false);
    return result.id;
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setNotice(null);
    try {
      await work();
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await persist();
      await router.invalidate();
      setNotice({ tone: "ok", text: "Entwurf gespeichert." });
    });
  };

  const onSubmit = (kind: ElsterKind, pin?: string) =>
    run(async () => {
      const id = dirty || !current ? await persist() : current.id;
      const result = await submit({ data: { id, kind, pin } });
      await router.invalidate();
      setNotice(elsterNotice(kind, result, "Voranmeldung übermittelt und festgeschrieben."));
    });

  const onCorrect = () =>
    run(async () => {
      await correct({ data: data.period });
      await router.invalidate();
      setNotice({ tone: "info", text: "Berichtigte Anmeldung angelegt. Werte prüfen und erneut senden." });
    });

  const editable = !locked && mode === "manuell";
  const revenue = (rate: number) => data.figures.revenue.filter((r) => r.treatment === "regulaer" && r.rate === rate);
  const treated = (treatment: string) => data.figures.revenue.filter((r) => r.treatment === treatment);
  const rows = [
    { kz: "81", field: "kz81" as const, label: "Steuerpflichtige Umsätze 19 %", base: shown.kz81, tax: shown.tax81 as number | null, sources: revenue(1900) },
    { kz: "86", field: "kz86" as const, label: "Steuerpflichtige Umsätze 7 %", base: shown.kz86, tax: shown.tax86 as number | null, sources: revenue(700) },
    {
      kz: "21",
      field: "kz21" as const,
      label: "Nicht steuerbare sonstige Leistungen im EU-Ausland (Reverse Charge)",
      base: shown.kz21,
      tax: null,
      sources: treated("reverse_charge"),
    },
    {
      kz: "45",
      field: "kz45" as const,
      label: "Übrige nicht steuerbare Umsätze (Leistungsort nicht im Inland)",
      base: shown.kz45,
      tax: null,
      sources: treated("drittland"),
    },
    { kz: "48", field: "kz48" as const, label: "Steuerfreie Umsätze ohne Vorsteuerabzug", base: shown.kz48, tax: null, sources: treated("steuerfrei") },
    {
      kz: "41",
      field: "kz41" as const,
      label: "Steuerfreie innergemeinschaftliche Lieferungen an Abnehmer mit USt-IdNr.",
      base: shown.kz41,
      tax: null,
      sources: treated("ig_lieferung"),
    },
    {
      kz: "43",
      field: "kz43" as const,
      label: "Weitere steuerfreie Umsätze mit Vorsteuerabzug (Ausfuhrlieferungen)",
      base: shown.kz43,
      tax: null,
      sources: treated("ausfuhr"),
    },
    // Kz 21, 45, 48, 41 und 43 nur zeigen, wenn es dort etwas gibt oder von Hand eingetragen wird
  ].filter((row) => ["81", "86"].includes(row.kz) || editable || row.base !== 0 || computed[row.field] !== 0);
  // § 13b als Leistungsempfänger: Bemessungsgrundlage und Steuer, nur wenn belegt oder von Hand
  const rcSources = (kind: "eu" | "drittland") => data.figures.reverseCharge.filter((r) => r.reverseCharge === kind);
  const rcRows = [
    {
      kz: "46",
      taxKz: "47",
      base: "kz46" as const,
      tax: "kz47" as const,
      label: "Sonstige Leistungen eines Unternehmers aus dem EU-Ausland (§ 13b Abs. 1 UStG)",
      sources: rcSources("eu"),
    },
    {
      kz: "84",
      taxKz: "85",
      base: "kz84" as const,
      tax: "kz85" as const,
      label: "Andere Leistungen, für die du die Steuer schuldest (§ 13b Abs. 2 UStG)",
      sources: rcSources("drittland"),
    },
  ].filter((row) => editable || shown[row.base] !== 0 || shown[row.tax] !== 0 || computed[row.base] !== 0 || computed[row.tax] !== 0);
  // Innergemeinschaftlicher Erwerb: Bemessungsgrundlage 89/93, die Steuer rechnet das Formular daraus; Vorsteuer in Kz 61
  const igeSources = (rate: number) => data.figures.igErwerb.filter((r) => r.rate === rate);
  const igeRows = [
    { kz: "89", field: "kz89" as const, label: "Steuerpflichtige innergemeinschaftliche Erwerbe 19 %", tax: shown.tax89, sources: igeSources(1900) },
    { kz: "93", field: "kz93" as const, label: "Steuerpflichtige innergemeinschaftliche Erwerbe 7 %", tax: shown.tax93, sources: igeSources(700) },
  ].filter((row) => editable || shown[row.field] !== 0 || computed[row.field] !== 0);

  return (
    <div className="grid-main">
      <form className="card" onSubmit={onSave} aria-labelledby="kz-heading">
        <h2 id="kz-heading">Kennzahlen</h2>
        {data.kleinunternehmer && (
          <div className="banner banner-info" role="status">
            <Icon name="info" />
            <span>
              Du bist als Kleinunternehmer (§ 19 UStG) eingetragen und gibst in der Regel keine Voranmeldung ab. Nötig ist sie nur, wenn du selbst Steuer
              schuldest, etwa für Leistungen ausländischer Unternehmer an dich (Reverse Charge).
            </span>
          </div>
        )}
        {!locked && (
          <div className="mode-switch" role="group" aria-label="Herkunft der Kennzahlen">
            <button
              type="button"
              className={`chip${mode === "berechnet" ? " active" : ""}`}
              aria-pressed={mode === "berechnet"}
              onClick={() => switchMode("berechnet")}
            >
              Aus Buchungen berechnet
            </button>
            <button
              type="button"
              className={`chip${mode === "manuell" ? " active" : ""}`}
              aria-pressed={mode === "manuell"}
              onClick={() => switchMode("manuell")}
            >
              Manuell überschreiben
            </button>
          </div>
        )}
        {drift && (
          <div className="banner" role="alert">
            Seit der Übermittlung haben sich die Buchungen dieses Monats geändert. Aus den Buchungen ergäben sich jetzt {describe(computed)}. Prüfe die Änderung
            und lege bei Bedarf eine berichtigte Anmeldung an.
          </div>
        )}
        {stale && mode === "berechnet" && (
          <div className="banner banner-info" role="status">
            Die Buchungen haben sich seit dem Speichern geändert; angezeigt sind die aktuellen Werte. Beim Senden werden sie übernommen.
          </div>
        )}
        <div className="kz-table">
          <div className="kz-row head">
            <div>Kz</div>
            <div>Bezeichnung</div>
            <div style={{ textAlign: "right" }}>Bemessung</div>
            <div style={{ textAlign: "right" }}>Steuer</div>
          </div>
          {rows.map((row) => (
            <div key={row.kz}>
              <div className="kz-row">
                <div className="kz-num">{row.kz}</div>
                <div className="kz-label">
                  <label htmlFor={`kz-${row.kz}`}>{row.label}</label>
                  {!locked && (
                    <SourcesToggle
                      kind="revenue"
                      rows={row.sources}
                      open={openSources === row.kz}
                      controls={`kz-${row.kz}-quellen`}
                      onToggle={() => toggleSources(row.kz)}
                    />
                  )}
                </div>
                {editable ? (
                  <input
                    id={`kz-${row.kz}`}
                    inputMode="decimal"
                    value={values[row.field]}
                    onChange={(event) => update(row.field, event.target.value)}
                    aria-invalid={parsed[row.field] === null}
                    aria-describedby="kz-hint"
                  />
                ) : (
                  <output id={`kz-${row.kz}`} className="kz-amount">
                    {formatEuro(row.base)}
                  </output>
                )}
                <div className="kz-amount">{row.tax === null ? "" : formatEuro(row.tax)}</div>
              </div>
              {!locked && openSources === row.kz && <SourcesTable id={`kz-${row.kz}-quellen`} kind="revenue" rows={row.sources} />}
            </div>
          ))}
          {igeRows.map((row) => (
            <div key={row.kz}>
              <div className="kz-row">
                <div className="kz-num">{row.kz}</div>
                <div className="kz-label">
                  <label htmlFor={`kz-${row.kz}`}>{row.label}</label>
                  {!locked && (
                    <SourcesToggle
                      kind="inputTax"
                      rows={row.sources}
                      open={openSources === row.kz}
                      controls={`kz-${row.kz}-quellen`}
                      onToggle={() => toggleSources(row.kz)}
                    />
                  )}
                </div>
                {editable ? (
                  <input
                    id={`kz-${row.kz}`}
                    inputMode="decimal"
                    value={values[row.field]}
                    onChange={(event) => update(row.field, event.target.value)}
                    aria-invalid={parsed[row.field] === null}
                  />
                ) : (
                  <output id={`kz-${row.kz}`} className="kz-amount">
                    {formatEuro(shown[row.field])}
                  </output>
                )}
                <div className="kz-amount">{formatEuro(row.tax)}</div>
              </div>
              {!locked && openSources === row.kz && <SourcesTable id={`kz-${row.kz}-quellen`} kind="inputTax" rows={row.sources} />}
            </div>
          ))}
          <div className="kz-row">
            <div className="kz-num">66</div>
            <div className="kz-label">
              <label htmlFor="kz-66">Vorsteuer aus Rechnungen anderer Unternehmer</label>
              {!locked && (
                <SourcesToggle
                  kind="inputTax"
                  rows={data.figures.inputTax}
                  open={openSources === "66"}
                  controls="kz-66-quellen"
                  onToggle={() => toggleSources("66")}
                />
              )}
            </div>
            <div />
            {editable ? (
              <input
                id="kz-66"
                inputMode="decimal"
                value={values.kz66}
                onChange={(event) => update("kz66", event.target.value)}
                aria-invalid={parsed.kz66 === null}
              />
            ) : (
              <output id="kz-66" className="kz-amount">
                {formatEuro(shown.kz66)}
              </output>
            )}
          </div>
          {!locked && openSources === "66" && <SourcesTable id="kz-66-quellen" kind="inputTax" rows={data.figures.inputTax} />}
          {rcRows.map((row) => (
            <div key={row.kz}>
              <div className="kz-row">
                <div className="kz-num">
                  {row.kz}/{row.taxKz}
                </div>
                <div className="kz-label">
                  <label htmlFor={`kz-${row.kz}`}>{row.label}</label>
                  {!locked && (
                    <SourcesToggle
                      kind="inputTax"
                      rows={row.sources}
                      open={openSources === row.kz}
                      controls={`kz-${row.kz}-quellen`}
                      onToggle={() => toggleSources(row.kz)}
                    />
                  )}
                </div>
                {editable ? (
                  <>
                    <input
                      id={`kz-${row.kz}`}
                      inputMode="decimal"
                      value={values[row.base]}
                      onChange={(event) => update(row.base, event.target.value)}
                      aria-invalid={parsed[row.base] === null}
                    />
                    <input
                      aria-label={`Steuer zu Kz ${row.kz} (Kz ${row.taxKz})`}
                      inputMode="decimal"
                      value={values[row.tax]}
                      onChange={(event) => update(row.tax, event.target.value)}
                      aria-invalid={parsed[row.tax] === null}
                    />
                  </>
                ) : (
                  <>
                    <output id={`kz-${row.kz}`} className="kz-amount">
                      {formatEuro(shown[row.base])}
                    </output>
                    <div className="kz-amount">{formatEuro(shown[row.tax])}</div>
                  </>
                )}
              </div>
              {!locked && openSources === row.kz && <SourcesTable id={`kz-${row.kz}-quellen`} kind="inputTax" rows={row.sources} />}
            </div>
          ))}
          {(rcRows.length > 0 || shown.kz67 !== 0) && (
            <div className="kz-row">
              <div className="kz-num">67</div>
              <div className="kz-label">
                <label htmlFor="kz-67">Vorsteuer aus Leistungen nach § 13b UStG</label>
              </div>
              <div />
              {editable ? (
                <input
                  id="kz-67"
                  inputMode="decimal"
                  value={values.kz67}
                  onChange={(event) => update("kz67", event.target.value)}
                  aria-invalid={parsed.kz67 === null}
                />
              ) : (
                <output id="kz-67" className="kz-amount">
                  {formatEuro(shown.kz67)}
                </output>
              )}
            </div>
          )}
          {(igeRows.length > 0 || shown.kz61 !== 0) && (
            <div className="kz-row">
              <div className="kz-num">61</div>
              <div className="kz-label">
                <label htmlFor="kz-61">Vorsteuer aus dem innergemeinschaftlichen Erwerb von Gegenständen</label>
              </div>
              <div />
              {editable ? (
                <input
                  id="kz-61"
                  inputMode="decimal"
                  value={values.kz61}
                  onChange={(event) => update("kz61", event.target.value)}
                  aria-invalid={parsed.kz61 === null}
                />
              ) : (
                <output id="kz-61" className="kz-amount">
                  {formatEuro(shown.kz61)}
                </output>
              )}
            </div>
          )}
          {(shown.kz62 !== 0 || computed.kz62 !== 0) && (
            <div className="kz-row">
              <div className="kz-num">62</div>
              <div className="kz-label">
                <label htmlFor="kz-62">Entstandene Einfuhrumsatzsteuer (§ 15 Abs. 1 Satz 1 Nr. 2 UStG)</label>
              </div>
              <div />
              {editable ? (
                <input
                  id="kz-62"
                  inputMode="decimal"
                  value={values.kz62}
                  onChange={(event) => update("kz62", event.target.value)}
                  aria-invalid={parsed.kz62 === null}
                />
              ) : (
                <output id="kz-62" className="kz-amount">
                  {formatEuro(shown.kz62)}
                </output>
              )}
            </div>
          )}
          {(shown.kz39 !== 0 || computed.kz39 !== 0) && (
            <div className="kz-row">
              <div className="kz-num">39</div>
              <div className="kz-label">
                <label htmlFor="kz-39">Abzug der festgesetzten Sondervorauszahlung (Dauerfristverlängerung)</label>
              </div>
              <div />
              {editable ? (
                <input
                  id="kz-39"
                  inputMode="decimal"
                  value={values.kz39}
                  onChange={(event) => update("kz39", event.target.value)}
                  aria-invalid={parsed.kz39 === null}
                />
              ) : (
                <output id="kz-39" className="kz-amount">
                  {formatEuro(shown.kz39)}
                </output>
              )}
            </div>
          )}
          <div className="kz-row total">
            <div className="kz-num">83</div>
            <div>{shown.kz83 < 0 ? "Verbleibender Überschuss (Erstattung)" : "Verbleibende Umsatzsteuer-Vorauszahlung"}</div>
            <div />
            <div className="kz-amount">{formatEuro(shown.kz83)}</div>
          </div>
        </div>
        {editable && (
          <label className="field">
            Begründung der Abweichung (Pflicht)
            <textarea
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setDirty(true);
              }}
              aria-invalid={reason.trim().length < 10}
              placeholder="z. B. Zahlung vom 30.09. erst im Oktober zugeordnet"
            />
            <span className="small">Berechnet wären {describe(computed)}.</span>
          </label>
        )}
        {locked && current?.source === "manuell" && current.overrideReason && (
          <p className="small muted" style={{ margin: 0 }}>
            Manuell überschrieben: {current.overrideReason}
          </p>
        )}
        <p id="kz-hint" className="small muted" style={{ margin: 0 }}>
          Bemessungsgrundlagen meldet ELSTER in vollen Euro; Cent werden abgeschnitten.{" "}
          {data.figures.versteuerung === "ist"
            ? "Versteuerung nach vereinnahmten Entgelten (Ist): Umsatzsteuer nach Zahlungseingang, Vorsteuer nach Belegdatum."
            : "Versteuerung nach vereinbarten Entgelten (Soll): Umsatzsteuer nach Rechnungsdatum, Vorsteuer nach Belegdatum."}{" "}
          Fällig am {formatLongDate(data.dueDate)}.
        </p>
        {!locked && (
          <div className="actions">
            <button type="submit" className="btn" disabled={busy || !valid || (!dirty && Boolean(current) && !stale)}>
              Entwurf speichern
            </button>
            {current && !dirty && !stale && data.companyIssues.length === 0 && (
              <a className="btn" href={`/api/ustva/${current.id}`} download>
                XML für Mein ELSTER
              </a>
            )}
          </div>
        )}
        {locked && (
          <div className="actions">
            <button type="button" className="btn" onClick={onCorrect} disabled={busy}>
              Berichtigte Anmeldung anlegen
            </button>
          </div>
        )}
        <NoticeBanner notice={notice} />
      </form>

      <div className="stack">
        {!locked && (
          <ElsterSubmit
            setup={data}
            title="An ELSTER übermitteln"
            ready={valid && data.companyIssues.length === 0}
            busy={busy}
            confirmTitle="Voranmeldung verbindlich senden?"
            confirmFacts={[
              { label: "Steuerart", value: "Umsatzsteuer-Voranmeldung" },
              { label: "Zeitraum", value: periodLabel(data.period) },
              zahllastFakt(shown.kz83),
            ]}
            confirmText="Die Voranmeldung geht an das Finanzamt und wird danach festgeschrieben."
            footer="ERiC prüft die Daten vor dem Versand. Das Übertragungsprotokoll wird als PDF abgelegt. Die PIN wird nicht gespeichert."
            onSubmit={onSubmit}
          />
        )}
        <UstvaZahlung posten={data.posten} />
        {!locked && current && (
          <AbgabeVermerken
            returnId={current.id}
            kz83={shown.kz83}
            blocked={dirty || stale}
            today={data.today}
            onFiled={() => setNotice({ tone: "ok", text: "Abgabe vermerkt und Voranmeldung festgeschrieben. Die Zahllast steht jetzt im Bankabgleich." })}
          />
        )}
        {!data.herstellerIdConfigured && !locked && current && (
          <MeinElsterWerte
            load={() => loadWerte({ data: { id: current.id } })}
            label={`Umsatzsteuer-Voranmeldung ${periodLabel(data.period)}`}
            blocked={dirty || stale || data.companyIssues.length > 0}
          />
        )}
        <History data={data} />
      </div>
    </div>
  );
}

/** Aufklappbare Liste der Zahlungen, Rechnungen bzw. Belege hinter einer Kennzahl */
type SourceRows = PageData["figures"]["revenue"] | PageData["figures"]["inputTax"];

function SourcesToggle({
  kind,
  rows,
  open,
  controls,
  onToggle,
}: {
  kind: "revenue" | "inputTax";
  rows: SourceRows;
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  if (rows.length === 0) return <span className="small muted">keine Buchungen</span>;
  const count = (type: string) => rows.filter((row) => "type" in row && row.type === type).length;
  const plural = (n: number, one: string, many: string) => (n > 0 ? [`${n} ${n === 1 ? one : many}`] : []);
  const summary =
    kind === "inputTax"
      ? `${rows.length} ${rows.length === 1 ? "Beleg" : "Belege"}`
      : [
          ...plural(count("payment"), "Zahlungseingang", "Zahlungseingänge"),
          ...plural(count("invoice"), "Rechnung", "Rechnungen"),
          ...plural(count("entnahme"), "Privatnutzung", "Privatnutzungen"),
          ...plural(count("ausbuchung"), "Ausbuchung", "Ausbuchungen"),
          ...plural(count("direkt"), "Direktbuchung", "Direktbuchungen"),
        ].join(", ");
  return (
    <button type="button" className="kz-sources-toggle" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      <span aria-hidden="true">{open ? "▾" : "▸"}</span> {summary}
    </button>
  );
}

function SourcesTable({ id, kind, rows }: { id: string; kind: "revenue" | "inputTax"; rows: SourceRows }) {
  return (
    <div id={id} className="kz-sources">
      <table>
        <thead>
          <tr>
            <th>Datum</th>
            <th>{kind === "inputTax" ? "Beleg" : "Rechnung"}</th>
            <th className="num">Netto</th>
            <th className="num">Steuer</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="date">{formatDate(row.date)}</td>
              <td>
                {"assetId" in row && row.assetId ? (
                  <Link to="/anlagen/$id" params={{ id: row.assetId }}>
                    Privatnutzung · {row.customer}
                  </Link>
                ) : "transactionId" in row && row.transactionId ? (
                  <Link to="/bank" search={{ umsatz: row.transactionId }}>
                    Direkt gebucht · {row.customer}
                  </Link>
                ) : "invoiceId" in row ? (
                  <Link to="/rechnungen/$id" params={{ id: row.invoiceId }}>
                    {row.number} · {row.customer}
                  </Link>
                ) : (
                  <Link to="/belege/$id" params={{ id: row.documentId }}>
                    {row.supplier}
                    {row.number ? ` · ${row.number}` : ""}
                  </Link>
                )}
              </td>
              <td className="num">{formatEuro(row.base)}</td>
              <td className="num">{formatEuro(row.tax)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ current, filing }: { current: PageData["current"]; filing: PageData["filings"][number] | undefined }) {
  if (!current) return <span className="pill">Noch nicht angelegt</span>;
  if (current.status === "sent") {
    return (
      <span className="pill pill-ok">
        {filing ? `Abgegeben ${formatDate(filing.filedOn)} (vermerkt)` : `Gesendet ${formatDate(current.sentAt!)}`}
        {current.berichtigt ? " · berichtigt" : ""}
      </span>
    );
  }
  return <span className="pill pill-info">Entwurf{current.berichtigt ? " · berichtigte Anmeldung" : ""}</span>;
}

function History({ data }: { data: PageData }) {
  return (
    <section className="card" aria-labelledby="history-heading">
      <h2 id="history-heading">Verlauf {periodLabel(data.period)}</h2>
      {data.filings.map((filing) => (
        <div key={filing.id} className="history-row">
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontWeight: 500 }}>
              Abgabe vermerkt <span className="pill pill-ok">außerhalb von Haben</span>
            </span>
            <span className="small muted" style={{ overflowWrap: "anywhere" }}>
              abgegeben {formatDate(filing.filedOn)} · vermerkt {formatDateTime(filing.createdAt)} · Ticket {filing.transferTicket} · Kz 83{" "}
              {formatEuro(filing.kz83)}
            </span>
          </div>
          <a href={`/api/protokoll/${filing.id}`} target="_blank" rel="noreferrer" className="small">
            Protokoll
          </a>
        </div>
      ))}
      {data.submissions.length === 0 && data.filings.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Noch nichts geprüft oder gesendet.
        </p>
      ) : (
        data.submissions.map((entry) => (
          <div key={entry.id} className="history-row">
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontWeight: 500 }}>
                {ELSTER_KIND_LABEL[entry.kind]}{" "}
                <span className={`pill ${entry.ok ? "pill-ok" : "pill-danger"}`}>{entry.ok ? "OK" : `Fehler ${entry.code}`}</span>
              </span>
              <span className="small muted" style={{ overflowWrap: "anywhere" }}>
                {formatDateTime(entry.createdAt)}
                {entry.transferTicket ? ` · Ticket ${entry.transferTicket}` : ""}
                {!entry.ok ? ` · ${entry.message}` : ""}
              </span>
            </div>
            {entry.hasPdf && (
              <a href={`/api/protokoll/${entry.id}`} target="_blank" rel="noreferrer" className="small">
                Protokoll
              </a>
            )}
          </div>
        ))
      )}
      {data.recent.length > 0 && (
        <>
          <h2 style={{ marginTop: 8 }}>Gesendete Voranmeldungen</h2>
          {data.recent.map((entry) => (
            <div key={entry.id} className="history-row">
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Link to="/umsatzsteuer/$zeitraum" params={{ zeitraum: periodKey(entry) }}>
                  {periodLabel(entry)}
                  {entry.berichtigt ? " (berichtigt)" : ""}
                </Link>
                <span className="small muted">gesendet {formatDate(entry.sentAt!)}</span>
              </div>
              <span className="mono">{formatEuro(entry.kz83)}</span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
