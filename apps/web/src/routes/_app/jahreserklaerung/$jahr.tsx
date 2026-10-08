import { formatDecimal, formatEuro, parseEuro } from "@haben/core";
import { Link, createFileRoute, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useId, useState, type FormEvent } from "react";
import { AnlageNFields, parseArbeitnehmer, toArbeitnehmerDraft } from "../../../components/AnlageN.tsx";
import { ElsterSubmit } from "../../../components/ElsterSubmit.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { VastBelege } from "../../../components/VastBelege.tsx";
import { ELSTER_KIND_LABEL, elsterNotice } from "../../../lib/elster.ts";
import { formatDate, formatDateTime } from "../../../lib/format.ts";
import { useAction } from "../../../lib/use-action.ts";
import { getAnnualReturns, saveIncomeTaxInputs, submitAnnualReturn } from "../../../server/functions/annual.ts";
import styles from "../../../styles/auswertungen.css?url";

export const Route = createFileRoute("/_app/jahreserklaerung/$jahr")({
  loader: ({ params }) => {
    const year = Number(params.jahr);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw notFound();
    return getAnnualReturns({ data: year });
  },
  head: ({ loaderData }) => ({ meta: [{ title: `Jahreserklärung ${loaderData?.year ?? ""} · Haben` }], links: [{ rel: "stylesheet", href: styles }] }),
  component: AnnualPage,
});

type Data = Awaited<ReturnType<typeof getAnnualReturns>>;
type Form = "ust" | "euer" | "est";
type Issue = Data["ust"]["issues"][number];
const FORM_LABEL = { ust: "Umsatzsteuererklärung", euer: "Anlage EÜR", est: "Einkommensteuererklärung" } as const;
const LINK_LABEL = {
  "/einstellungen": "Zu den Einstellungen",
  "/anlagen": "Zu den Anlagen",
  "/umsatzsteuer": "Zur Umsatzsteuer",
  "/bank": "Zur Bank",
  "/pauschalen": "Zu den Pauschalen",
} as const;

function AnnualPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const selectId = useId();

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jahreserklärung</div>
          <h1>Steuerjahr {data.year}</h1>
        </div>
        <label className="field" htmlFor={selectId}>
          Jahr
          <select id={selectId} value={data.year} onChange={(e) => navigate({ to: "/jahreserklaerung/$jahr", params: { jahr: e.target.value } })}>
            {(data.years.includes(data.year) ? data.years : [data.year, ...data.years]).map((y) => (
              <option key={y} value={y}>
                {y}
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

      <p className="muted" style={{ marginTop: 0, maxWidth: 760 }}>
        Haben berechnet Umsatzsteuererklärung und Anlage EÜR aus den Buchungen des Jahres und übermittelt sie wie die Voranmeldung über
        ERiC. Für die Einkommensteuererklärung kommt der Gewinn aus der EÜR; Arbeitslohn, Vorsorge, Sonderausgaben, Kinder und Kapitalerträge trägst
        du unten ein.
      </p>

      <div className="stack" style={{ gap: 24 }}>
        <UstSection data={data} />
        <EuerSection data={data} />
        <EstSection key={data.year} data={data} />
        <VastBelege key={`vast-${data.year}`} data={data} />
        <History data={data} />
      </div>
    </>
  );
}

function Issues({ issues }: { issues: Issue[] }) {
  return (
    <>
      {issues.map((issue) => (
        <div key={issue.text} className={`banner ${issue.tone === "hinweis" ? "banner-info" : ""}`} role="status">
          <Icon name={issue.tone === "hinweis" ? "info" : "alert"} />
          <span>
            {issue.text} {issue.link && <Link to={issue.link}>{LINK_LABEL[issue.link]}</Link>}
          </span>
        </div>
      ))}
    </>
  );
}

/**
 * Zeile einer Betragstabelle; kz = Feldkennung, extra = Zusatzspalte (Bemessungsgrundlage),
 * text = Wert ist Text statt Betrag. Die data-label beschriften die Werte, wenn die Tabelle auf dem Handy gestapelt ist.
 */
function Row({ label, kz, value, extra, total, text }: { label: string; kz?: string; value: string; extra?: string; total?: boolean; text?: boolean }) {
  return (
    <tr style={total ? { fontWeight: 600 } : undefined}>
      <th scope="row" style={total ? { fontWeight: 600 } : undefined}>
        {label}
        {kz && <span className="small muted mono"> {kz}</span>}
      </th>
      {extra !== undefined && (
        <td className="num" data-label="Bemessung">
          {extra}
        </td>
      )}
      <td className={text ? undefined : "num"} style={text ? { textAlign: "right" } : undefined} data-label={extra !== undefined ? "Steuer" : text ? undefined : "Betrag"}>
        {value}
      </td>
    </tr>
  );
}

function SentPill({ sent }: { sent: Data["ust"]["sent"] }) {
  return sent ? (
    <span className="pill pill-ok">Übermittelt {formatDate(sent.createdAt)}</span>
  ) : (
    <span className="pill">Noch nicht übermittelt</span>
  );
}

function UstSection({ data }: { data: Data }) {
  const { ust } = data;
  const f = ust.figures;
  return (
    <section className="grid-main" aria-labelledby="ust-heading">
      <div className="card" style={{ gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 id="ust-heading" style={{ margin: 0 }}>
            Umsatzsteuererklärung
          </h2>
          <SentPill sent={ust.sent} />
        </div>
        <Issues issues={ust.issues} />
        <table className="report-table stack-table">
          <thead>
            <tr>
              <th scope="col">Zeile</th>
              <th scope="col" className="num">Bemessungsgrundlage</th>
              <th scope="col" className="num">Steuer</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Umsätze zu 19 %" extra={formatEuro(f.base19)} value={formatEuro(f.tax19)} />
            <Row label="Umsätze zu 7 %" extra={formatEuro(f.base7)} value={formatEuro(f.tax7)} />
            {ust.kz21 !== 0 && <Row label="Leistungen im EU-Ausland (Reverse Charge)" extra={formatEuro(ust.kz21)} value="–" />}
            {ust.kz45 !== 0 && <Row label="Nicht steuerbare Umsätze (Drittland)" extra={formatEuro(ust.kz45)} value="–" />}
            {ust.kz48 !== 0 && <Row label="Steuerfreie Umsätze ohne Vorsteuerabzug" extra={formatEuro(ust.kz48)} value="–" />}
            {ust.reverseChargeTax !== 0 && <Row label="Steuer als Leistungsempfänger (§ 13b)" extra="" value={formatEuro(ust.reverseChargeTax)} />}
            <Row label="Abziehbare Vorsteuer" extra="" value={`−${formatEuro(f.vorsteuer)}`} />
            <Row label={ust.steuer >= 0 ? "Umsatzsteuer" : "Überschuss"} extra="" value={formatEuro(ust.steuer)} total />
            <Row label="Vorauszahlungssoll (gesendete Voranmeldungen)" extra="" value={`−${formatEuro(f.vorauszahlungen)}`} />
            <Row label={ust.abschluss >= 0 ? "Abschlusszahlung" : "Erstattung"} extra="" value={formatEuro(Math.abs(ust.abschluss))} total />
          </tbody>
        </table>
        <p className="small muted" style={{ margin: 0 }}>
          Bemessungsgrundlagen in vollen Euro, die Steuer daraus wie in der Voranmeldung. {data.versteuerung === "ist" ? "Ist-Versteuerung" : "Soll-Versteuerung"}.
          Die private Kfz-Nutzung ist in den Umsätzen zu 19 % enthalten.
        </p>
      </div>
      <SubmitPanel form="ust" data={data} blocked={ust.issues.some((i) => i.tone === "fehler")} sent={Boolean(ust.sent)} />
    </section>
  );
}

function EuerSection({ data }: { data: Data }) {
  const { euer, euerRows } = data;
  return (
    <section className="grid-main" aria-labelledby="euer-heading">
      <div className="card" style={{ gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h2 id="euer-heading" style={{ margin: 0 }}>
            Anlage EÜR
          </h2>
          <SentPill sent={euer.sent} />
        </div>
        <Issues issues={euer.issues} />
        <table className="report-table">
          <thead>
            <tr>
              <th scope="col">Zeile und Feldkennung</th>
              <th scope="col" className="num">Betrag</th>
            </tr>
          </thead>
          <tbody>
            {euerRows.einnahmen.map((r) => (
              <Row key={r.key} label={r.label} kz={r.kz} value={formatEuro(r.amount)} />
            ))}
            <Row label="Summe Betriebseinnahmen" value={formatEuro(euer.einnahmen)} total />
            {euerRows.ausgaben.map((r) => (
              <Row key={r.key} label={r.label} kz={r.kz} value={formatEuro(r.amount)} />
            ))}
            <Row label="Summe Betriebsausgaben" value={formatEuro(euer.ausgaben)} total />
            <Row label={euer.gewinn >= 0 ? "Gewinn" : "Verlust"} value={formatEuro(euer.gewinn)} total />
            {euerRows.privat.map((r) => (
              <Row key={r.key} label={r.label} kz={r.kz} value={formatEuro(r.amount)} />
            ))}
          </tbody>
        </table>
        {euer.anlagen.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <div className="section-label">Anlagenverzeichnis (Anlage AVEÜR)</div>
            <div style={{ overflowX: "auto" }}>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Anlage</th>
                    <th className="num">Gruppe</th>
                    <th className="num">Buchwert Beginn</th>
                    <th className="num">AfA</th>
                    <th className="num">Abgang</th>
                    <th className="num">Buchwert Ende</th>
                  </tr>
                </thead>
                <tbody>
                  {euer.anlagen.map((a) => (
                    <tr key={`${a.bezeichnung}-${a.anschaffung}`}>
                      <td>
                        {a.bezeichnung}
                        <div className="small muted">
                          {formatDate(a.anschaffung)} · {formatEuro(a.anschaffungskosten)}
                        </div>
                      </td>
                      <td className="num small muted">{a.gruppe === "kfz" ? "Kfz" : a.gruppe === "buero" ? "Büro" : a.gruppe === "sammelposten" ? "Sammelposten" : "Andere"}</td>
                      <td className="num mono">{formatEuro(a.buchwertBeginn)}</td>
                      <td className="num mono">{formatEuro(a.afa)}</td>
                      <td className="num mono">{a.abgang ? formatEuro(a.abgang) : "–"}</td>
                      <td className="num mono">{formatEuro(a.buchwertEnde)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              Anlagen, die im Jahr angeschafft wurden, stehen mit den Anschaffungskosten im Buchwert zu Beginn. Geringwertige
              Wirtschaftsgüter gehören nicht ins Verzeichnis.
            </p>
          </div>
        )}
      </div>
      <SubmitPanel form="euer" data={data} blocked={euer.issues.some((i) => i.tone === "fehler")} sent={Boolean(euer.sent)} />
    </section>
  );
}

type Angaben = Data["est"]["angaben"];
type Kind = Angaben["kinder"][number];
type KindDraft = Omit<Kind, "kinderbetreuung"> & { key: number; kinderbetreuung: string };

const centsText = (cents: number | undefined) => (cents ? formatDecimal(cents) : "");

/** Ein Betragsfeld; leer heißt 0 */
function Amount({ name, label, value, hint }: { name: string; label: string; value: number | undefined; hint?: string }) {
  return (
    <label className="field">
      {label}
      <input name={name} inputMode="decimal" defaultValue={centsText(value)} placeholder="0,00" />
      {hint && <span className="small muted">{hint}</span>}
    </label>
  );
}

function EstSection({ data }: { data: Data }) {
  const { est } = data;
  const a = est.angaben;
  const router = useRouter();
  const save = useServerFn(saveIncomeTaxInputs);
  const [kinder, setKinder] = useState<KindDraft[]>(() => a.kinder.map((k, key) => ({ ...k, key, kinderbetreuung: centsText(k.kinderbetreuung) })));
  const [anA, setAnA] = useState(() => toArbeitnehmerDraft(a.arbeitnehmer?.a));
  const [anB, setAnB] = useState(() => toArbeitnehmerDraft(a.arbeitnehmer?.b));
  const nameA = est.person.a?.split(" ")[0] ?? "Person A";
  const nameB = est.person.b?.split(" ")[0] ?? "Ehegatte";
  const { busy, notice, setNotice, run } = useAction();
  const blocked = est.issues.some((i) => i.tone === "fehler");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const bad: string[] = [];
    const amount = (name: string, label: string) => {
      const text = String(form.get(name) ?? "").trim();
      if (!text) return undefined;
      const cents = parseEuro(text);
      if (cents === null || cents < 0) {
        bad.push(label);
        return undefined;
      }
      return cents || undefined;
    };
    const kidAmount = (k: KindDraft) => {
      if (!k.kinderbetreuung.trim()) return undefined;
      const cents = parseEuro(k.kinderbetreuung);
      if (cents === null || cents < 0) bad.push(`Kinderbetreuung ${k.vorname}`);
      return cents || undefined;
    };
    const vorsorge = (p: "a" | "b") => ({
      rentenversicherung: amount(`${p}-rv`, "Rentenversicherung"),
      gkv: amount(`${p}-gkv`, "Krankenversicherung"),
      gpv: amount(`${p}-gpv`, "Pflegeversicherung"),
      gkvZusatz: amount(`${p}-gkvZusatz`, "Wahlleistungen"),
      pkv: amount(`${p}-pkv`, "Private Krankenversicherung"),
      ppv: amount(`${p}-ppv`, "Private Pflegeversicherung"),
      pkvErstattung: amount(`${p}-pkvErstattung`, "Erstattungen"),
    });
    const angaben = {
      vorsorge: { a: vorsorge("a"), ...(est.zusammen ? { b: vorsorge("b") } : {}), sonstige: amount("sonstige", "Weitere Vorsorge") },
      sonderausgaben: {
        kirchensteuerGezahlt: amount("kistGezahlt", "Kirchensteuer"),
        kirchensteuerErstattet: amount("kistErstattet", "Kirchensteuer erstattet"),
        spenden: amount("spenden", "Spenden"),
      },
      krankheitskosten: amount("krankheitskosten", "Krankheitskosten"),
      haushaltsnah: {
        minijobs: amount("minijobs", "Minijobs"),
        dienstleistungen: amount("dienstleistungen", "Haushaltsnahe Dienstleistungen"),
        handwerker: amount("handwerker", "Handwerkerleistungen"),
      },
      kinder: kinder.map((k) => ({
        idnr: k.idnr?.trim() || undefined,
        vorname: k.vorname,
        name: k.name?.trim() || undefined,
        geburtsdatum: k.geburtsdatum,
        familienkasse: k.familienkasse?.trim() || undefined,
        kinderbetreuung: kidAmount(k),
      })),
      kap: {
        guenstigerpruefung: form.get("guenstigerpruefung") === "on",
        ertraegeMitSteuerabzug: amount("kapMit", "Kapitalerträge"),
        sparerPauschbetrag: amount("kapSpb", "Sparer-Pauschbetrag"),
        ertraegeOhneSteuerabzugInland: amount("kapOhneInl", "Kapitalerträge ohne Steuerabzug"),
        ertraegeAusland: amount("kapAusl", "Ausländische Kapitalerträge"),
        kapitalertragsteuer: amount("kapESt", "Kapitalertragsteuer"),
        soli: amount("kapSoli", "Solidaritätszuschlag"),
        kirchensteuer: amount("kapKiSt", "Kirchensteuer auf Kapitalerträge"),
      },
      arbeitnehmer: {
        a: parseArbeitnehmer(anA, nameA, bad),
        ...(est.zusammen ? { b: parseArbeitnehmer(anB, nameB, bad) } : {}),
      },
    };
    if (bad.length > 0) {
      setNotice({ tone: "danger", text: `Kein gültiger Betrag: ${bad.join(", ")}.` });
      return;
    }
    await run(async () => {
      await save({ data: { year: data.year, angaben } });
      await router.invalidate();
    }, "Angaben gespeichert.");
  }

  const updateKind = (key: number, patch: Partial<KindDraft>) => setKinder((list) => list.map((k) => (k.key === key ? { ...k, ...patch } : k)));
  const vorsorgeFields = (p: "a" | "b", v: Angaben["vorsorge"]["a"] | undefined) => (
    <div className="form-grid">
      <Amount name={`${p}-rv`} label="Gesetzliche Rentenversicherung" value={v?.rentenversicherung} />
      <Amount name={`${p}-gkv`} label="Gesetzliche Krankenversicherung" value={v?.gkv} hint="ohne Anteil für Krankengeld" />
      <Amount name={`${p}-gpv`} label="Soziale Pflegeversicherung" value={v?.gpv} />
      <Amount name={`${p}-gkvZusatz`} label="Gesetzlich: Krankengeldanteil, Wahlleistungen" value={v?.gkvZusatz} />
      <Amount name={`${p}-pkv`} label="Private Krankenversicherung (Basis)" value={v?.pkv} hint="laut Bescheinigung der Versicherung" />
      <Amount name={`${p}-ppv`} label="Private Pflege-Pflichtversicherung" value={v?.ppv} />
      <Amount name={`${p}-pkvErstattung`} label="Erstattungen der privaten KV/PV" value={v?.pkvErstattung} />
    </div>
  );

  return (
    <section className="grid-main" aria-labelledby="est-heading">
      <form className="card" onSubmit={onSubmit} aria-label="Angaben zur Einkommensteuer">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
          <h2 id="est-heading">Einkommensteuererklärung {data.year}</h2>
          <SentPill sent={est.sent} />
        </div>
        <Issues issues={est.issues} />
        <table className="report-table">
          <tbody>
            <Row label="Steuerpflichtige Person" value={est.person.a ?? "–"} text />
            <Row label="Veranlagung" value={est.zusammen ? `Zusammen mit ${est.person.b ?? "–"}` : "Einzeln"} text />
            <Row label="Gewinn laut EÜR" value={formatEuro(est.gewinn)} />
            {est.prognose.einkuenfteArbeit !== 0 && <Row label="Einkünfte aus Arbeitslohn (geschätzt)" value={formatEuro(est.prognose.einkuenfteArbeit)} />}
            <Row label="Anlagen" value={est.anlagen.join(", ")} text />
            <Row label="Zu versteuerndes Einkommen (geschätzt)" value={formatEuro(est.prognose.zvE)} />
            <Row
              label="Voraussichtliche Steuer"
              value={formatEuro(est.prognose.gesamt)}
              kz={[
                `ESt ${formatEuro(est.prognose.einkommensteuer)}`,
                est.prognose.soli ? `Soli ${formatEuro(est.prognose.soli)}` : "",
                est.prognose.kirchensteuer ? `KiSt ${formatEuro(est.prognose.kirchensteuer)}` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            />
            {est.prognose.steuerabzug > 0 && (
              <>
                <Row label="Bereits einbehalten (Lohnsteuer, Soli, KiSt)" value={formatEuro(est.prognose.steuerabzug)} />
                <Row
                  label={est.prognose.verbleibend >= 0 ? "Voraussichtlich nachzuzahlen" : "Voraussichtliche Erstattung"}
                  value={formatEuro(Math.abs(est.prognose.verbleibend))}
                  total
                />
              </>
            )}
          </tbody>
        </table>

        <AnlageNFields wer={nameA} draft={anA} onChange={setAnA} />
        {est.zusammen && <AnlageNFields wer={nameB} draft={anB} onChange={setAnB} />}

        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
          <legend className="subhead">Vorsorgeaufwand {est.zusammen ? `· ${est.person.a ?? "Person A"}` : ""}</legend>
          {vorsorgeFields("a", a.vorsorge.a)}
        </fieldset>
        {est.zusammen && (
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
            <legend className="subhead">Vorsorgeaufwand · {est.person.b ?? "Ehegatte"}</legend>
            {vorsorgeFields("b", a.vorsorge.b)}
          </fieldset>
        )}
        <div className="form-grid">
          <Amount name="sonstige" label="Weitere Vorsorge (Haftpflicht, Unfall, Risikoleben)" value={a.vorsorge.sonstige} />
        </div>

        <fieldset className="form-grid" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="subhead">Sonderausgaben und Belastungen</legend>
          <Amount name="kistGezahlt" label="Gezahlte Kirchensteuer" value={a.sonderausgaben.kirchensteuerGezahlt} hint="ohne Kirchensteuer auf Kapitalerträge" />
          <Amount name="kistErstattet" label="Erstattete Kirchensteuer" value={a.sonderausgaben.kirchensteuerErstattet} />
          <Amount name="spenden" label="Spenden und Mitgliedsbeiträge" value={a.sonderausgaben.spenden} hint="an steuerbegünstigte Empfänger im Inland" />
          <Amount name="krankheitskosten" label="Krankheitskosten" value={a.krankheitskosten} hint="selbst getragen, nach Erstattungen" />
        </fieldset>

        <fieldset className="form-grid" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="subhead">Haushaltsnahe Aufwendungen (§ 35a EStG)</legend>
          <Amount name="minijobs" label="Minijobs im Haushalt" value={a.haushaltsnah.minijobs} />
          <Amount name="dienstleistungen" label="Haushaltsnahe Dienstleistungen" value={a.haushaltsnah.dienstleistungen} hint="z. B. Reinigung, Gartenpflege" />
          <Amount name="handwerker" label="Handwerkerleistungen" value={a.haushaltsnah.handwerker} hint="nur Arbeits-, Maschinen- und Fahrtkosten" />
        </fieldset>

        <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
          <legend className="subhead">Kinder</legend>
          {kinder.map((k, index) => (
            <div key={k.key} className="form-grid" role="group" aria-label={`Kind ${index + 1}`}>
              <label className="field">
                Vorname
                <input value={k.vorname} onChange={(e) => updateKind(k.key, { vorname: e.target.value })} required />
              </label>
              <label className="field">
                Geburtsdatum
                <input type="date" value={k.geburtsdatum} onChange={(e) => updateKind(k.key, { geburtsdatum: e.target.value })} required />
              </label>
              <label className="field">
                Steuer-ID
                <input inputMode="numeric" value={k.idnr ?? ""} onChange={(e) => updateKind(k.key, { idnr: e.target.value })} />
              </label>
              <label className="field">
                Familienkasse
                <input value={k.familienkasse ?? ""} onChange={(e) => updateKind(k.key, { familienkasse: e.target.value })} />
              </label>
              <label className="field">
                Abweichender Nachname
                <input value={k.name ?? ""} onChange={(e) => updateKind(k.key, { name: e.target.value })} />
              </label>
              <label className="field">
                Kinderbetreuungskosten (€)
                <input inputMode="decimal" value={k.kinderbetreuung} onChange={(e) => updateKind(k.key, { kinderbetreuung: e.target.value })} placeholder="0,00" />
              </label>
              <div className="actions" style={{ gridColumn: "1 / -1" }}>
                <button type="button" className="btn btn-danger" onClick={() => setKinder((list) => list.filter((x) => x.key !== k.key))}>
                  Kind entfernen
                </button>
              </div>
            </div>
          ))}
          <div>
            <button
              type="button"
              className="btn"
              onClick={() => setKinder((list) => [...list, { key: Math.max(-1, ...list.map((x) => x.key)) + 1, vorname: "", geburtsdatum: "", kinderbetreuung: "" }])}
            >
              + Kind hinzufügen
            </button>
          </div>
        </fieldset>

        <fieldset className="form-grid" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="subhead">Kapitalerträge (Anlage KAP)</legend>
          <Amount name="kapMit" label="Erträge mit Steuerabzug" value={a.kap?.ertraegeMitSteuerabzug} hint="laut Steuerbescheinigung der Bank" />
          <Amount name="kapSpb" label="Davon genutzter Sparer-Pauschbetrag" value={a.kap?.sparerPauschbetrag} />
          <Amount name="kapOhneInl" label="Inländische Erträge ohne Steuerabzug" value={a.kap?.ertraegeOhneSteuerabzugInland} />
          <Amount name="kapAusl" label="Ausländische Erträge" value={a.kap?.ertraegeAusland} />
          <Amount name="kapESt" label="Einbehaltene Kapitalertragsteuer" value={a.kap?.kapitalertragsteuer} />
          <Amount name="kapSoli" label="Solidaritätszuschlag" value={a.kap?.soli} />
          <Amount name="kapKiSt" label="Kirchensteuer zur Kapitalertragsteuer" value={a.kap?.kirchensteuer} />
          <label className="checkbox" style={{ alignSelf: "end" }}>
            <input type="checkbox" name="guenstigerpruefung" defaultChecked={a.kap?.guenstigerpruefung ?? false} />
            Günstigerprüfung beantragen
          </label>
        </fieldset>

        <NoticeBanner notice={notice} />
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Angaben speichern
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Beträge in Euro; ELSTER bekommt volle Euro, nur die Steuern auf Kapitalerträge mit Cent. Übermittelt werden die gespeicherten
          Angaben.
        </p>
      </form>
      <SubmitPanel form="est" data={data} blocked={blocked} sent={Boolean(est.sent)} />
    </section>
  );
}

function SubmitPanel({ form, data, blocked, sent }: { form: Form; data: Data; blocked: boolean; sent: boolean }) {
  const router = useRouter();
  const submit = useServerFn(submitAnnualReturn);
  const { busy, notice, setNotice, run } = useAction();

  return (
    <ElsterSubmit
      setup={data}
      title={`${FORM_LABEL[form]} übermitteln`}
      className="card sticky-panel"
      ready={!blocked}
      busy={busy}
      notice={notice}
      lockedHint={sent ? "Schon übermittelt. Eine Berichtigung geht über das ELSTER-Portal." : undefined}
      confirmText={`Die ${FORM_LABEL[form]} ${data.year} geht verbindlich an das Finanzamt. Noch einmal klicken zum Senden.`}
      footer="Erst mit „Nur prüfen“ oder einer Testübermittlung prüft ERiC die Daten gegen die Vorgaben des Jahres. Die PIN wird nicht gespeichert."
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

function History({ data }: { data: Data }) {
  return (
    <section className="card" aria-labelledby="history-heading">
      <h2 id="history-heading">Verlauf {data.year}</h2>
      {data.history.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Noch nichts geprüft oder gesendet.
        </p>
      ) : (
        data.history.map((entry) => (
          <div key={entry.id} className="history-row">
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontWeight: 500 }}>
                {FORM_LABEL[entry.form]} · {ELSTER_KIND_LABEL[entry.kind]}{" "}
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
    </section>
  );
}
