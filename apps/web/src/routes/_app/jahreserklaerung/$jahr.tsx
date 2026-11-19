import { RECHTSFORMEN, formatDecimal, formatEuro, isKapitalgesellschaft, parseEuro } from "@haben/core";
import { Link, createFileRoute, notFound, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { AnlageNFields, parseArbeitnehmer, toArbeitnehmerDraft } from "../../../components/AnlageN.tsx";
import { GewstSection, KapgAngaben, KapgGemeinsameHinweise, KstSection } from "../../../components/KapgErklaerungen.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { VastBelege } from "../../../components/VastBelege.tsx";
import { KIRCHENSTEUER_HINWEIS } from "../../../lib/kirchensteuer.ts";
import { useAction } from "../../../lib/use-action.ts";
import { getAnnualReturns, saveIncomeTaxInputs } from "../../../server/functions/annual.ts";
import styles from "../../../styles/auswertungen.css?url";
import { ScrollTable } from "../../../components/ScrollTable.tsx";
import { Field } from "../../../components/Field.tsx";
import { Block } from "../../../components/jahreserklaerung/Block.tsx";
import { ErklaerteZeilen } from "../../../components/jahreserklaerung/ErklaerteZeilen.tsx";
import { Reihenfolge, SentPill } from "../../../components/jahreserklaerung/Reihenfolge.tsx";
import { Row } from "../../../components/jahreserklaerung/Row.tsx";
import type { Data } from "../../../components/jahreserklaerung/typen.ts";
import { SubmitPanel } from "./-jahr-senden.tsx";
import { EuerSection, History, Issues, UstSection } from "./-jahr-teile.tsx";

export const Route = createFileRoute("/_app/jahreserklaerung/$jahr")({
  loader: ({ params }) => {
    const year = Number(params.jahr);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw notFound();
    return getAnnualReturns({ data: year });
  },
  head: ({ loaderData }) => ({ meta: [{ title: `Jahreserklärung ${loaderData?.year ?? ""} · Haben` }], links: [{ rel: "stylesheet", href: styles }] }),
  component: AnnualPage,
});

function AnnualPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  // GmbH und UG: Körperschaftsteuer statt Einkommensteuer, Bilanz statt EÜR; hier bleibt die Umsatzsteuer
  const gesellschaft = isKapitalgesellschaft(data.rechtsform);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Jahreserklärung</div>
          <h1>Steuerjahr {data.year}</h1>
        </div>
        <Field label="Jahr">
          {(control) => (
            <select {...control} value={data.year} onChange={(e) => navigate({ to: "/jahreserklaerung/$jahr", params: { jahr: e.target.value } })}>
              {(data.years.includes(data.year) ? data.years : [data.year, ...data.years]).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      {data.mode === "simuliert" && (
        <div className="banner banner-info" role="status">
          <Icon name="info" />
          <span>ERiC ist nicht eingerichtet. Prüfen und Senden laufen simuliert, nichts geht an das Finanzamt.</span>
        </div>
      )}

      {gesellschaft && (
        <>
          <p className="muted small" style={{ margin: 0, maxWidth: 760 }}>
            Umsatzsteuer-, Körperschaftsteuer- und Gewerbesteuererklärung rechnet Haben aus den Buchungen und dem <Link to="/abschluss">Jahresabschluss</Link>.
            Anlage EÜR und Einkommensteuer gibt es für {RECHTSFORMEN[data.rechtsform]} nicht.
          </p>
          <nav className="jump-nav" aria-label="Abschnitte der Jahreserklärung">
            <a href="#ust">Umsatzsteuer</a>
            <a href="#kst">Körperschaftsteuer</a>
            <a href="#gewst">Gewerbesteuer</a>
            <a href="#kapg-angaben">Angaben</a>
            <a href="#verlauf">Verlauf</a>
          </nav>
        </>
      )}

      <div className="stack" style={{ gap: 24 }}>
        {!gesellschaft && <Reihenfolge data={data} />}
        <UstSection data={data} />
        {!gesellschaft && <EuerSection data={data} />}
        {!gesellschaft && <EstSection key={data.year} data={data} />}
        {data.kapg && <KapgGemeinsameHinweise data={data} />}
        {data.kapg && <KstSection data={data} />}
        {data.kapg && <GewstSection data={data} />}
        {data.kapg && <KapgAngaben key={`kapg-${data.year}`} data={data} />}
        {/* Die vorausgefüllte Steuererklärung gibt es nur für die Einkommensteuer einer Person */}
        {!gesellschaft && (
          <div id="vast" className="jump-target">
            <VastBelege key={`vast-${data.year}`} data={data} />
          </div>
        )}
        <History data={data} />
      </div>
    </>
  );
}

type Angaben = Data["est"]["angaben"];
type Kind = Angaben["kinder"][number];
/** Die sechs Arten, die der Vordruck für Einkommensersatzleistungen kennt (§ 32b EStG) */
const ERST_ARTEN = ["Arbeitslosengeld", "Elterngeld", "Insolvenzgeld", "Krankengeld", "Mutterschaftsgeld", "Verdienstausfallentschädigung"] as const;

type KindDraft = Omit<Kind, "kinderbetreuung"> & { key: number; kinderbetreuung: string };

const centsText = (cents: number | undefined) => (cents ? formatDecimal(cents) : "");

/** Ein Betragsfeld; leer heißt 0 */
function Amount({ name, label, value, hint }: { name: string; label: string; value: number | undefined; hint?: string }) {
  return (
    <Field label={label} hint={hint && hint}>
      {(control) => <input {...control} name={name} inputMode="decimal" defaultValue={centsText(value)} placeholder="0,00" />}
    </Field>
  );
}

/**
 * Klappt die Blöcke um ein ungültiges Feld auf. Sonst kann der Browser ein leeres Pflichtfeld in einem zugeklappten
 * Block nicht zeigen, und das Absenden bleibt ohne Rückmeldung stehen. `invalid` steigt nicht auf, deshalb in der
 * Capture-Phase am Formular.
 */
function aufklappenBisZumFeld(event: FormEvent<HTMLFormElement>) {
  for (let block = (event.target as HTMLElement).closest("details"); block; block = block.parentElement?.closest("details") ?? null) block.open = true;
}

const sumOf = (...values: (number | undefined)[]) => values.reduce<number>((s, v) => s + (v ?? 0), 0);
const sumText = (cents: number) => (cents === 0 ? "nichts eingetragen" : formatEuro(cents));

function EstSection({ data }: { data: Data }) {
  const { est } = data;
  const a = est.angaben;
  const router = useRouter();
  const save = useServerFn(saveIncomeTaxInputs);
  const [kinder, setKinder] = useState<KindDraft[]>(() => a.kinder.map((k, key) => ({ ...k, key, kinderbetreuung: centsText(k.kinderbetreuung) })));
  // Nach dem Vermerk ist die Erklärung von außen abgegeben; die Maske wird gelesen, bis jemand sie ausdrücklich öffnet (#1083)
  const [bearbeiten, setBearbeiten] = useState(false);
  const gesperrt = est.submitted !== null && !bearbeiten;
  const [anA, setAnA] = useState(() => toArbeitnehmerDraft(a.arbeitnehmer?.a));
  const [anB, setAnB] = useState(() => toArbeitnehmerDraft(a.arbeitnehmer?.b));
  const nameA = est.person.a?.split(" ")[0] ?? "Person A";
  const nameB = est.person.b?.split(" ")[0] ?? "Ehegatte";
  const { busy, notice, setNotice, run } = useAction();
  const blocked = est.issues.some((i) => i.tone === "fehler");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Gesperrt speichert nichts: landet ein Fehlklick beim Umschalten der Fußzeile auf dem Absende-Knopf, darf er die
    // nur zum Lesen geöffnete Maske nicht überschreiben (#1141)
    if (gesperrt) return;
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
      basisrente: amount(`${p}-basisrente`, "Basisrente"),
      pkvWahlleistungen: amount(`${p}-pkvWahlleistungen`, "Wahlleistungen der privaten KV"),
      agZuschussGkv: amount(`${p}-agZuschussGkv`, "Arbeitgeberzuschuss zur gesetzlichen KV"),
      agZuschussKv: amount(`${p}-agZuschussKv`, "Arbeitgeberzuschuss zur privaten KV"),
      agZuschussPv: amount(`${p}-agZuschussPv`, "Arbeitgeberzuschuss zur Pflegeversicherung"),
    });
    const ersatz = (p: "a" | "b") =>
      ERST_ARTEN.map((art) => ({ art, betrag: amount(`erst-${p}-${art}`, `Einkommensersatz ${art}`) ?? 0 })).filter((z) => z.betrag > 0);
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
        familienkasse: k.familienkasse?.trim() ?? "",
        kinderbetreuung: kidAmount(k),
      })),
      ersatzleistungen: {
        a: ersatz("a"),
        ...(est.zusammen ? { b: ersatz("b") } : {}),
      },
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
    // Nach dem Speichern wieder sperren: die Maske ist ohne „Angaben bearbeiten" nur zum Lesen da, und ein
    // zweiter Klick auf „Angaben speichern" darf die Eingabe nicht offen lassen (#1098)
    const gespeichert = await run(async () => {
      await save({ data: { year: data.year, angaben } });
      await router.invalidate();
    }, "Angaben gespeichert.");
    if (gespeichert) setBearbeiten(false);
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
      <Amount name={`${p}-basisrente`} label="Zertifizierte Basisrente (Rürup)" value={v?.basisrente} hint="neben der gesetzlichen Rentenversicherung" />
      <Amount name={`${p}-pkvWahlleistungen`} label="Private KV: Wahlleistungen" value={v?.pkvWahlleistungen} hint="über der Basisabsicherung" />
      <Amount name={`${p}-agZuschussGkv`} label="Arbeitgeberzuschuss zur gesetzlichen KV" value={v?.agZuschussGkv} hint="steuerfrei, Bescheinigung Nr. 24 a" />
      <Amount name={`${p}-agZuschussKv`} label="Arbeitgeberzuschuss zur privaten KV" value={v?.agZuschussKv} hint="steuerfrei, Bescheinigung Nr. 24 b" />
      <Amount name={`${p}-agZuschussPv`} label="Arbeitgeberzuschuss zur Pflegeversicherung" value={v?.agZuschussPv} hint="steuerfrei, Bescheinigung Nr. 24 c" />
    </div>
  );

  return (
    <section className="grid-main jump-target" id="est" aria-labelledby="est-heading">
      <form className="card" onSubmit={onSubmit} onInvalidCapture={aufklappenBisZumFeld} aria-label="Angaben zur Einkommensteuer">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
          <h2 id="est-heading">Einkommensteuererklärung {data.year}</h2>
          <SentPill teil={est} />
        </div>
        <Issues issues={est.issues} />
        <ScrollTable className="report-table">
          <tbody>
            <Row label="Steuerpflichtige Person" value={est.person.a ?? "–"} text />
            <Row label="Veranlagung" value={est.zusammen ? `Zusammen mit ${est.person.b ?? "–"}` : "Einzeln"} text />
            {/* Ohne Buchungen im Jahr steht hier 0,00 — das ist keine Aussage über den Gewinn,
                  sondern über Habens Datenlage (#869) */}
            {est.gewinn !== 0 && <Row label="Gewinn laut EÜR" value={formatEuro(est.gewinn)} />}
            <Row label="Anlagen" value={est.anlagen.join(", ")} text />
          </tbody>
        </ScrollTable>
        <ScrollTable className="report-table">
          <tbody>
            {est.prognose.einkuenfteArbeit !== 0 && <Row label="Einkünfte aus Arbeitslohn (geschätzt)" value={formatEuro(est.prognose.einkuenfteArbeit)} />}
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
        </ScrollTable>

        {/* Ohne Vermerk hängt keine Zeile, dann zeigt der Baustein nichts. Mit Vermerk muss die Eingabe auch ohne
            gespeicherte Zeile erreichbar sein, sonst ließen sich die Anlagen nie erfassen (#1149) */}
        <ErklaerteZeilen form="est" year={data.year} zeilen={est.erklaert} vermerkt={est.submitted !== null} />

        <fieldset disabled={gesperrt} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <AnlageNFields wer={nameA} draft={anA} onChange={setAnA} />
          {est.zusammen && <AnlageNFields wer={nameB} draft={anB} onChange={setAnB} />}

          {(() => {
            const v = (p: "a" | "b") => {
              const x = a.vorsorge[p];
              return sumOf(x?.rentenversicherung, x?.gkv, x?.gpv, x?.gkvZusatz, x?.pkv, x?.ppv, x?.basisrente, x?.pkvWahlleistungen);
            };
            const total = v("a") + (est.zusammen ? v("b") : 0) + (a.vorsorge.sonstige ?? 0);
            return (
              <Block title="Vorsorgeaufwand" summary={sumText(total)} open={false}>
                <h4 className="est-sub">{est.zusammen ? (est.person.a ?? "Person A") : "Beiträge"}</h4>
                {vorsorgeFields("a", a.vorsorge.a)}
                {est.zusammen && (
                  <>
                    <h4 className="est-sub">{est.person.b ?? "Ehegatte"}</h4>
                    {vorsorgeFields("b", a.vorsorge.b)}
                  </>
                )}
                <div className="form-grid">
                  <Amount name="sonstige" label="Weitere Vorsorge (Haftpflicht, Unfall, Risikoleben)" value={a.vorsorge.sonstige} />
                </div>
              </Block>
            );
          })()}

          <Block
            title="Sonderausgaben und Belastungen"
            summary={sumText(sumOf(a.sonderausgaben.kirchensteuerGezahlt, a.sonderausgaben.spenden, a.krankheitskosten))}
            open={false}
          >
            <div className="form-grid">
              <Amount name="kistGezahlt" label="Gezahlte Kirchensteuer" value={a.sonderausgaben.kirchensteuerGezahlt} hint={KIRCHENSTEUER_HINWEIS} />
              <Amount name="kistErstattet" label="Erstattete Kirchensteuer" value={a.sonderausgaben.kirchensteuerErstattet} />
              <Amount name="spenden" label="Spenden und Mitgliedsbeiträge" value={a.sonderausgaben.spenden} hint="an steuerbegünstigte Empfänger im Inland" />
              <Amount name="krankheitskosten" label="Krankheitskosten" value={a.krankheitskosten} hint="selbst getragen, nach Erstattungen" />
            </div>
          </Block>

          <Block
            title="Haushaltsnahe Aufwendungen (§ 35a EStG)"
            summary={sumText(sumOf(a.haushaltsnah.minijobs, a.haushaltsnah.dienstleistungen, a.haushaltsnah.handwerker))}
            open={false}
          >
            <div className="form-grid">
              <Amount name="minijobs" label="Minijobs im Haushalt" value={a.haushaltsnah.minijobs} />
              <Amount
                name="dienstleistungen"
                label="Haushaltsnahe Dienstleistungen"
                value={a.haushaltsnah.dienstleistungen}
                hint="z. B. Reinigung, Gartenpflege"
              />
              <Amount name="handwerker" label="Handwerkerleistungen" value={a.haushaltsnah.handwerker} hint="nur Arbeits-, Maschinen- und Fahrtkosten" />
            </div>
          </Block>

          <Block title="Kinder" summary={kinder.length === 0 ? "keine" : `${kinder.length} ${kinder.length === 1 ? "Kind" : "Kinder"}`} open={false}>
            {kinder.map((k, index) => (
              <div key={k.key} className="form-grid" role="group" aria-label={`Kind ${index + 1}`}>
                <Field label="Vorname">
                  {(control) => <input {...control} value={k.vorname} onChange={(e) => updateKind(k.key, { vorname: e.target.value })} required />}
                </Field>
                <Field label="Geburtsdatum">
                  {(control) => (
                    <input {...control} type="date" value={k.geburtsdatum} onChange={(e) => updateKind(k.key, { geburtsdatum: e.target.value })} required />
                  )}
                </Field>
                <Field label="Steuer-ID">
                  {(control) => <input {...control} inputMode="numeric" value={k.idnr ?? ""} onChange={(e) => updateKind(k.key, { idnr: e.target.value })} />}
                </Field>
                <Field label="Familienkasse">
                  {(control) => (
                    <input {...control} required value={k.familienkasse ?? ""} onChange={(e) => updateKind(k.key, { familienkasse: e.target.value })} />
                  )}
                </Field>
                <Field label="Abweichender Nachname">
                  {(control) => <input {...control} value={k.name ?? ""} onChange={(e) => updateKind(k.key, { name: e.target.value })} />}
                </Field>
                <Field label="Kinderbetreuungskosten (€)">
                  {(control) => (
                    <input
                      {...control}
                      inputMode="decimal"
                      value={k.kinderbetreuung}
                      onChange={(e) => updateKind(k.key, { kinderbetreuung: e.target.value })}
                      placeholder="0,00"
                    />
                  )}
                </Field>
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
                onClick={() =>
                  setKinder((list) => [...list, { key: Math.max(-1, ...list.map((x) => x.key)) + 1, vorname: "", geburtsdatum: "", kinderbetreuung: "" }])
                }
              >
                + Kind hinzufügen
              </button>
            </div>
          </Block>

          <Block
            title="Kapitalerträge (Anlage KAP)"
            summary={sumText(sumOf(a.kap?.ertraegeMitSteuerabzug, a.kap?.ertraegeOhneSteuerabzugInland, a.kap?.ertraegeAusland))}
            open={false}
          >
            <div className="form-grid">
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
            </div>
          </Block>

          {(() => {
            const liste = (p: "a" | "b") => a.ersatzleistungen?.[p] ?? [];
            const summe = (p: "a" | "b") => sumOf(...liste(p).map((z) => z.betrag));
            const total = summe("a") + (est.zusammen ? summe("b") : 0);
            const felder = (p: "a" | "b") => (
              <div className="form-grid">
                {ERST_ARTEN.map((art) => (
                  <Amount
                    key={art}
                    name={`erst-${p}-${art}`}
                    label={art}
                    value={liste(p).find((z) => z.art === art)?.betrag}
                    hint="steuerfrei, erhöht den Steuersatz"
                  />
                ))}
              </div>
            );
            return (
              <Block title="Einkommensersatzleistungen (Progressionsvorbehalt)" summary={sumText(total)} open={false}>
                <h4 className="est-sub">{est.zusammen ? (est.person.a ?? "Person A") : "Leistungen"}</h4>
                {felder("a")}
                {est.zusammen && (
                  <>
                    <h4 className="est-sub">{est.person.b ?? "Ehegatte"}</h4>
                    {felder("b")}
                  </>
                )}
              </Block>
            );
          })()}
        </fieldset>
        <p className="small muted" style={{ margin: 0 }}>
          Beträge in Euro; ELSTER bekommt volle Euro, mit Cent nur die Steuern auf Kapitalerträge und Nr. 3 bis 7 der Lohnsteuerbescheinigungen, die Summe des
          Bruttoarbeitslohns ohne Cent. Übermittelt werden die gespeicherten Angaben.
        </p>
        {/* Speichern bleibt unten sichtbar; der Hinweis steht davor, weil der Footer mit negativem Rand darüber liegt.
            Beide Knöpfe stehen an verschiedener Stelle: „Angaben speichern“ links, „Angaben bearbeiten“ rechts. Teilen
            sie sich denselben Platz, tauscht der Klick den Knopf unter dem aufgelegten Zeiger aus, und das Loslassen
            speichert die gerade erst geöffnete, leere Maske (#1141). */}
        <div className="form-sticky-footer">
          <NoticeBanner notice={notice} />
          <div className="actions" style={{ alignItems: "center" }}>
            {!gesperrt && (
              <button type="submit" className="btn btn-primary" disabled={busy}>
                Angaben speichern
              </button>
            )}
            <span className="small muted">
              {gesperrt
                ? `Außerhalb von Haben abgegeben; Haben rechnet ${formatEuro(est.prognose.gesamt)}.`
                : `Voraussichtliche Steuer ${formatEuro(est.prognose.gesamt)}`}
            </span>
            {gesperrt && (
              <button
                type="button"
                className="btn"
                style={{ marginLeft: "auto" }}
                onClick={() => {
                  setNotice(null);
                  setBearbeiten(true);
                }}
              >
                Angaben bearbeiten
              </button>
            )}
          </div>
        </div>
      </form>
      <SubmitPanel form="est" data={data} blocked={blocked} sent={Boolean(est.sent)} submitted={est.submitted} />
    </section>
  );
}
