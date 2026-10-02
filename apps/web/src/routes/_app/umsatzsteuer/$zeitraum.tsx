import {
  computeUstva,
  formatDecimal,
  formatEuro,
  parseEuro,
  parsePeriodKey,
  periodKey,
  periodLabel,
  previousPeriod,
  type VatPeriod,
} from "@haben/core";
import { Link, createFileRoute, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState, type FormEvent } from "react";
import { Icon } from "../../../components/Icon.tsx";
import { formatDate, formatDateTime, formatLongDate, errorMessage } from "../../../lib/format.ts";
import {
  createVatCorrection,
  getVatPeriod,
  saveVatDraft,
  submitVatReturn,
} from "../../../server/functions/vat.ts";

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

type PageData = Awaited<ReturnType<typeof getVatPeriod>>;
type FieldKey = "kz81" | "kz86" | "kz66";
type Notice = { tone: "ok" | "danger" | "info"; text: string } | null;
type PeriodNotice = { key: string; notice: Notice };

function periodOptions(today = new Date()): VatPeriod[] {
  let period: VatPeriod = { year: today.getFullYear(), month: today.getMonth() + 1 };
  const options: VatPeriod[] = [];
  for (let i = 0; i < 13; i++) {
    options.push(period);
    period = previousPeriod(period);
  }
  return options;
}

const KIND_LABEL = { validate: "Prüfung", test: "Testübermittlung", send: "Übermittlung" } as const;

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
  const options = periodOptions();
  if (!options.some((option) => periodKey(option) === key)) options.push(data.period);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Umsatzsteuer › Voranmeldung</div>
          <h1>{periodLabel(data.period)}</h1>
        </div>
        <label className="field" htmlFor={selectId}>
          Zeitraum
          <select
            id={selectId}
            value={key}
            onChange={(event) => navigate({ to: "/umsatzsteuer/$zeitraum", params: { zeitraum: event.target.value } })}
          >
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
      {data.companyIssues.length > 0 && (
        <div className="banner" role="status">
          <Icon name="alert" />
          <span>
            Firmendaten unvollständig: {data.companyIssues.join(", ")}.{" "}
            <Link to="/einstellungen">In den Einstellungen ergänzen</Link>
          </span>
        </div>
      )}

      {/* key: Formular bei Zeitraum- oder Anmeldungswechsel neu aufsetzen */}
      <VatReturnEditor
        key={`${key}-${data.current?.id ?? "neu"}-${data.current?.updatedAt ?? ""}`}
        data={data}
        notice={notice}
        setNotice={setNotice}
      />
    </>
  );
}

function VatReturnEditor({
  data,
  notice,
  setNotice,
}: {
  data: PageData;
  notice: Notice;
  setNotice: (notice: Notice) => void;
}) {
  const router = useRouter();
  const save = useServerFn(saveVatDraft);
  const submit = useServerFn(submitVatReturn);
  const correct = useServerFn(createVatCorrection);

  const current = data.current;
  const locked = current?.status === "sent";
  const [values, setValues] = useState<Record<FieldKey, string>>({
    kz81: formatDecimal(current?.kz81 ?? 0),
    kz86: formatDecimal(current?.kz86 ?? 0),
    kz66: formatDecimal(current?.kz66 ?? 0),
  });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const parsed = {
    kz81: parseEuro(values.kz81),
    kz86: parseEuro(values.kz86),
    kz66: parseEuro(values.kz66),
  };
  const valid = Object.values(parsed).every((v) => v !== null && v >= 0);
  const figures = computeUstva({ kz81: parsed.kz81 ?? 0, kz86: parsed.kz86 ?? 0, kz66: parsed.kz66 ?? 0 });

  function update(field: FieldKey, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    setDirty(true);
  }

  async function persist(): Promise<string> {
    const result = await save({
      data: { period: data.period, kz81: parsed.kz81!, kz86: parsed.kz86!, kz66: parsed.kz66! },
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

  const onSubmit = (kind: "validate" | "test" | "send", pin?: string) =>
    run(async () => {
      const id = dirty || !current ? await persist() : current.id;
      const result = await submit({ data: { id, kind, pin } });
      await router.invalidate();
      if (result.ok) {
        const ticket = result.transferTicket ? ` Transfer-Ticket ${result.transferTicket}.` : "";
        const text =
          kind === "validate"
            ? "ERiC hat die Daten geprüft, keine Fehler."
            : kind === "test"
              ? `Testübermittlung erfolgreich.${ticket}`
              : `Voranmeldung übermittelt und festgeschrieben.${ticket}`;
        setNotice({ tone: "ok", text });
      } else {
        setNotice({ tone: "danger", text: `${KIND_LABEL[kind]} fehlgeschlagen (${result.code}): ${result.message}` });
      }
    });

  const onCorrect = () =>
    run(async () => {
      await correct({ data: data.period });
      await router.invalidate();
      setNotice({ tone: "info", text: "Berichtigte Anmeldung angelegt. Werte anpassen und erneut senden." });
    });

  const rows: { kz: string; label: string; field?: FieldKey; base?: number; tax: number }[] = [
    { kz: "81", label: "Steuerpflichtige Umsätze 19 %", field: "kz81", base: figures.kz81, tax: figures.tax81 },
    { kz: "86", label: "Steuerpflichtige Umsätze 7 %", field: "kz86", base: figures.kz86, tax: figures.tax86 },
  ];

  return (
    <div className="grid-main">
      <form className="card" onSubmit={onSave} aria-labelledby="kz-heading">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 id="kz-heading">Kennzahlen</h2>
          <StatusPill current={current} />
        </div>
        <div className="kz-table">
          <div className="kz-row head">
            <div>Kz</div>
            <div>Bezeichnung</div>
            <div style={{ textAlign: "right" }}>Bemessung</div>
            <div style={{ textAlign: "right" }}>Steuer</div>
          </div>
          {rows.map((row) => (
            <div className="kz-row" key={row.kz}>
              <div className="kz-num">{row.kz}</div>
              <label htmlFor={`kz-${row.kz}`}>{row.label}</label>
              <input
                id={`kz-${row.kz}`}
                inputMode="decimal"
                value={values[row.field!]}
                onChange={(event) => update(row.field!, event.target.value)}
                readOnly={locked}
                aria-invalid={parsed[row.field!] === null}
                aria-describedby="kz-hint"
              />
              <div className="kz-amount">{formatEuro(row.tax)}</div>
            </div>
          ))}
          <div className="kz-row">
            <div className="kz-num">66</div>
            <label htmlFor="kz-66">Vorsteuer aus Rechnungen anderer Unternehmer</label>
            <div />
            <input
              id="kz-66"
              inputMode="decimal"
              value={values.kz66}
              onChange={(event) => update("kz66", event.target.value)}
              readOnly={locked}
              aria-invalid={parsed.kz66 === null}
            />
          </div>
          {!locked && data.inputTax !== 0 && data.inputTax !== parsed.kz66 && (
            <div className="small" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, padding: "0 4px 8px", flexWrap: "wrap" }}>
              <span className="muted">Vorsteuer aus gebuchten Belegen: {formatEuro(data.inputTax)}</span>
              <button type="button" className="btn" style={{ minHeight: 32, padding: "0 12px" }} onClick={() => update("kz66", formatDecimal(data.inputTax))}>
                Übernehmen
              </button>
            </div>
          )}
          <div className="kz-row total">
            <div className="kz-num">83</div>
            <div>{figures.kz83 < 0 ? "Verbleibender Überschuss (Erstattung)" : "Verbleibende Umsatzsteuer-Vorauszahlung"}</div>
            <div />
            <div className="kz-amount">{formatEuro(figures.kz83)}</div>
          </div>
        </div>
        <p id="kz-hint" className="small muted" style={{ margin: 0 }}>
          Bemessungsgrundlagen meldet ELSTER in vollen Euro; Cent werden abgeschnitten. Versteuerung nach vereinnahmten
          Entgelten (Ist). Fällig am {formatLongDate(data.dueDate)}.
        </p>
        {!locked && (
          <div className="actions">
            <button type="submit" className="btn" disabled={busy || !valid || (!dirty && Boolean(current))}>
              Entwurf speichern
            </button>
          </div>
        )}
        {locked && (
          <div className="actions">
            <button type="button" className="btn btn-dashed" onClick={onCorrect} disabled={busy}>
              Berichtigte Anmeldung anlegen
            </button>
          </div>
        )}
        {notice && (
          <div className={`banner banner-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"}>
            {notice.text}
          </div>
        )}
      </form>

      <div className="stack">
        {!locked && (
          <SubmitPanel data={data} busy={busy} valid={valid} onSubmit={onSubmit} />
        )}
        <History data={data} />
      </div>
    </div>
  );
}

function StatusPill({ current }: { current: PageData["current"] }) {
  if (!current) return <span className="pill">Noch nicht angelegt</span>;
  if (current.status === "sent") {
    return <span className="pill pill-ok">Gesendet {formatDate(current.sentAt!)}{current.berichtigt ? " · berichtigt" : ""}</span>;
  }
  return <span className="pill pill-info">Entwurf{current.berichtigt ? " · berichtigte Anmeldung" : ""}</span>;
}

function SubmitPanel({
  data,
  busy,
  valid,
  onSubmit,
}: {
  data: PageData;
  busy: boolean;
  valid: boolean;
  onSubmit: (kind: "validate" | "test" | "send", pin?: string) => Promise<void>;
}) {
  const [pin, setPin] = useState("");
  const [testOnly, setTestOnly] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const canSendLive = data.herstellerIdConfigured;
  const ready = valid && data.companyIssues.length === 0;

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!testOnly && !confirming) {
      setConfirming(true);
      return;
    }
    await onSubmit(testOnly ? "test" : "send", pin);
    setPin("");
    setConfirming(false);
  }

  return (
    <form className="card" onSubmit={send} aria-labelledby="elster-heading">
      <h2 id="elster-heading">An ELSTER übermitteln</h2>
      <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "12px 14px", background: "var(--ground)", borderRadius: 10 }}>
        <Icon name={data.certificate ? "check" : "alert"} />
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 500 }}>{data.certificate ? "Zertifikat hinterlegt" : "Kein Zertifikat hinterlegt"}</span>
          <span className="small muted">
            {data.certificate ? (
              <>
                {data.certificate.filename}
                {data.certificate.validUntil ? ` · gültig bis ${formatDate(data.certificate.validUntil)}` : ""}
              </>
            ) : (
              <Link to="/einstellungen">In den Einstellungen hochladen</Link>
            )}
          </span>
        </div>
      </div>
      <label className="field">
        Zertifikats-PIN
        <input
          type="password"
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          autoComplete="off"
          required
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={testOnly}
          onChange={(event) => {
            setTestOnly(event.target.checked);
            setConfirming(false);
          }}
          disabled={!canSendLive}
        />
        Nur Testübermittlung
      </label>
      {!canSendLive && (
        <p className="small muted" style={{ margin: 0 }}>
          Echtübermittlung erst mit eigener Hersteller-ID (ELSTER_HERSTELLER_ID).
        </p>
      )}
      {confirming && (
        <div className="banner" role="alert">
          Die Voranmeldung geht an das Finanzamt und wird danach festgeschrieben. Noch einmal klicken zum Senden.
        </div>
      )}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !ready || !data.certificate || pin.length === 0} style={{ flexGrow: 1 }}>
          {confirming ? "Jetzt verbindlich senden" : testOnly ? "Prüfen und testweise senden" : "Prüfen und senden"}
        </button>
        <button type="button" className="btn" disabled={busy || !ready} onClick={() => onSubmit("validate")}>
          Nur prüfen
        </button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        ERiC prüft die Daten vor dem Versand. Das Übertragungsprotokoll wird als PDF abgelegt. Die PIN wird nicht gespeichert.
      </p>
    </form>
  );
}

function History({ data }: { data: PageData }) {
  return (
    <section className="card" aria-labelledby="history-heading">
      <h2 id="history-heading">Verlauf {periodLabel(data.period)}</h2>
      {data.submissions.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>Noch nichts geprüft oder gesendet.</p>
      ) : (
        data.submissions.map((entry) => (
          <div key={entry.id} className="history-row">
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontWeight: 500 }}>
                {KIND_LABEL[entry.kind]}{" "}
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
