import { BUNDESLAENDER, currentFilingPeriod, formatDecimal, parseEuro, type Bundesland } from "@haben/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { DatevCard } from "../../components/DatevCard.tsx";
import { ExportCard } from "../../components/ExportCard.tsx";
import { InboxCard } from "../../components/InboxCard.tsx";
import { LogoCard } from "../../components/LogoCard.tsx";
import { MailCard } from "../../components/MailCard.tsx";
import { authClient } from "../../lib/auth-client.ts";
import { errorMessage, formatDate } from "../../lib/format.ts";
import { removeCertificate, uploadCertificate } from "../../server/functions/certificate.ts";
import { RELIGIONEN } from "../../lib/religion.ts";
import type { TaxpayerPerson } from "../../server/db/schema.ts";
import { getCompany, saveCompany, saveTaxpayerData } from "../../server/functions/company.ts";
import { checkElsterFormats, getEricStatus, installEricLibrary } from "../../server/functions/eric.ts";
import { getNumbering, saveNextNumber } from "../../server/functions/invoices.ts";
import { getInbox } from "../../server/functions/inbox.ts";
import { getLogo } from "../../server/functions/logo.ts";
import { getMailSettings } from "../../server/functions/mail.ts";
import { getVatPeriod } from "../../server/functions/vat.ts";

export const Route = createFileRoute("/_app/einstellungen")({
  loader: async () => {
    const [company, vat, numbering, eric, mail, logo, inbox] = await Promise.all([
      getCompany(),
      getVatPeriod({ data: currentFilingPeriod(new Date()) }),
      getNumbering(),
      getEricStatus(),
      getMailSettings(),
      getLogo(),
      getInbox(),
    ]);
    return { ...company, certificate: vat.certificate, mode: vat.mode, numbering, eric, mail, logo, inbox };
  },
  head: () => ({ meta: [{ title: "Einstellungen · Haben" }] }),
  component: SettingsPage,
});

type Notice = { tone: "ok" | "danger"; text: string } | null;

function NoticeBanner({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <div className={`banner banner-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"}>
      {notice.text}
    </div>
  );
}

function SettingsPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Haben</div>
          <h1>Einstellungen</h1>
        </div>
      </div>
      <div className="grid-main">
        <div className="stack">
          <CompanyForm />
          <TaxpayerForm />
        </div>
        <div className="stack">
          <NumberingForm />
          <LogoCard info={Route.useLoaderData().logo} />
          <CertificateForm />
          <EricCard />
          <MailCard data={Route.useLoaderData().mail} />
          <InboxCard data={Route.useLoaderData().inbox} />
          <Passkeys />
          <ExportCard />
          <DatevCard />
        </div>
      </div>
    </>
  );
}

function CompanyForm() {
  const { company, issues, locks } = Route.useLoaderData();
  const router = useRouter();
  const save = useServerFn(saveCompany);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    setBusy(true);
    setNotice(null);
    try {
      await save({
        data: {
          name: text("name"),
          strasse: text("strasse"),
          plz: text("plz"),
          ort: text("ort"),
          email: text("email"),
          steuernummer: text("steuernummer"),
          ustId: text("ustId").toUpperCase().replace(/\s/g, ""),
          finanzamt: text("finanzamt"),
          bundesland: (text("bundesland") || null) as Bundesland | null,
          versteuerung: text("versteuerung") === "soll" ? "soll" : "ist",
          telefon: text("telefon"),
          bank: text("bank"),
          iban: text("iban").toUpperCase().replace(/\s/g, ""),
          bic: text("bic").toUpperCase().replace(/\s/g, ""),
          kontenrahmen: text("kontenrahmen") === "SKR04" ? "SKR04" : "SKR03",
          paymentTermDays: Number(text("paymentTermDays") || 14),
          defaultFormat: (text("defaultFormat") || "zugferd") as "zugferd" | "xrechnung-cii" | "xrechnung-ubl",
          kleinunternehmer: form.get("kleinunternehmer") === "on",
          einkunftsart: text("einkunftsart") === "gewerbe" ? "gewerbe" : text("einkunftsart") === "selbstaendig" ? "selbstaendig" : null,
          taetigkeit: text("taetigkeit"),
          dunning: {
            // Prozent mit zwei Nachkommastellen wie ein Eurobetrag lesen: "1,27" → 127 Basispunkte
            baseRate: text("dunning-baseRate").trim() ? parseEuro(text("dunning-baseRate")) : null,
            fees: {
              "1": parseEuro(text("dunning-fee-1") || "0") ?? 0,
              "2": parseEuro(text("dunning-fee-2") || "0") ?? 0,
              "3": parseEuro(text("dunning-fee-3") || "0") ?? 0,
            },
            deadlineDays: Number(text("dunning-deadlineDays") || 10),
          },
          privateShares: Object.fromEntries(
            (["telefon", "internet"] as const)
              .map((key) => [key, Number(text(`privateShare-${key}`) || 0)] as const)
              .filter(([, value]) => Number.isInteger(value) && value > 0 && value <= 100),
          ),
        },
      });
      await router.invalidate();
      setNotice({ tone: "ok", text: "Firmendaten gespeichert." });
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="company-heading">
      <h2 id="company-heading">Firmendaten</h2>
      {issues.length > 0 && <div className="banner">Für ELSTER fehlt noch: {issues.join(", ")}.</div>}
      <div className="form-grid">
        <label className="field">
          Name
          <input name="name" defaultValue={company.name} autoComplete="organization" />
        </label>
        <label className="field">
          E-Mail
          <input name="email" type="email" defaultValue={company.email} autoComplete="email" />
        </label>
        <label className="field">
          Straße und Hausnummer
          <input name="strasse" defaultValue={company.strasse} autoComplete="street-address" />
        </label>
        <label className="field">
          PLZ
          <input name="plz" defaultValue={company.plz} inputMode="numeric" autoComplete="postal-code" />
        </label>
        <label className="field">
          Ort
          <input name="ort" defaultValue={company.ort} autoComplete="address-level2" />
        </label>
        <label className="field">
          Bundesland
          <select name="bundesland" defaultValue={company.bundesland ?? ""}>
            <option value="">Bitte wählen</option>
            {Object.entries(BUNDESLAENDER).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Steuernummer (wie auf dem Bescheid)
          <input name="steuernummer" defaultValue={company.steuernummer} placeholder="z. B. 21/815/08150" />
        </label>
        <label className="field">
          USt-IdNr.
          <input name="ustId" defaultValue={company.ustId} placeholder="DE123456789" />
        </label>
        <label className="field">
          Finanzamt
          <input name="finanzamt" defaultValue={company.finanzamt} />
        </label>
        <label className="field">
          Einkunftsart (für die Anlage EÜR)
          <select name="einkunftsart" defaultValue={company.einkunftsart ?? ""}>
            <option value="">Bitte wählen</option>
            <option value="selbstaendig">Selbständige Arbeit (freier Beruf, z. B. Entwickler, Berater)</option>
            <option value="gewerbe">Gewerbebetrieb</option>
          </select>
        </label>
        <label className="field">
          Art des Betriebs (für die Anlage EÜR)
          <input name="taetigkeit" defaultValue={company.taetigkeit} placeholder="z. B. Softwareentwicklung" maxLength={100} />
        </label>
        <label className="field">
          Telefon (Pflicht für XRechnung)
          <input name="telefon" type="tel" defaultValue={company.telefon} autoComplete="tel" />
        </label>
        <label className="field">
          Bank
          <input name="bank" defaultValue={company.bank} />
        </label>
        <label className="field">
          IBAN
          <input name="iban" defaultValue={company.iban} />
        </label>
        <label className="field">
          BIC
          <input name="bic" defaultValue={company.bic} />
        </label>
        <label className="field">
          Kontenrahmen (wie in Lexoffice)
          {/* Gesperrte Felder werden nicht mitgeschickt; der Wert kommt dann aus dem versteckten Feld */}
          {locks.kontenrahmen && <input type="hidden" name="kontenrahmen" value={company.kontenrahmen} />}
          <select
            name={locks.kontenrahmen ? undefined : "kontenrahmen"}
            defaultValue={company.kontenrahmen}
            disabled={Boolean(locks.kontenrahmen)}
            aria-describedby={locks.kontenrahmen ? "lock-kontenrahmen" : undefined}
          >
            <option value="SKR03">SKR03</option>
            <option value="SKR04">SKR04</option>
          </select>
          {locks.kontenrahmen && (
            <span id="lock-kontenrahmen" className="small">
              {locks.kontenrahmen}
            </span>
          )}
        </label>
        <label className="field">
          Standard-Zahlungsziel in Tagen
          <input name="paymentTermDays" inputMode="numeric" defaultValue={company.paymentTermDays} />
        </label>
        <label className="field">
          Standardformat für Rechnungen
          <select name="defaultFormat" defaultValue={company.defaultFormat}>
            <option value="zugferd">ZUGFeRD (PDF mit XML)</option>
            <option value="xrechnung-cii">XRechnung (CII)</option>
            <option value="xrechnung-ubl">XRechnung (UBL)</option>
          </select>
        </label>
        <label className="field">
          Versteuerung
          {locks.versteuerung && <input type="hidden" name="versteuerung" value={company.versteuerung} />}
          <select
            name={locks.versteuerung ? undefined : "versteuerung"}
            defaultValue={company.versteuerung}
            disabled={Boolean(locks.versteuerung)}
            aria-describedby={locks.versteuerung ? "lock-versteuerung" : undefined}
          >
            <option value="ist">Ist (nach vereinnahmten Entgelten)</option>
            <option value="soll">Soll (nach vereinbarten Entgelten)</option>
          </select>
          {locks.versteuerung && (
            <span id="lock-versteuerung" className="small">
              {locks.versteuerung}
            </span>
          )}
        </label>
        <label className="checkbox" style={{ gridColumn: "1 / -1", alignItems: "flex-start" }}>
          {/* Einschalten mitten im Jahr gesperrt; Ausschalten geht immer (Umsatzgrenze überschritten) */}
          <input
            type="checkbox"
            name="kleinunternehmer"
            defaultChecked={company.kleinunternehmer}
            disabled={Boolean(locks.kleinunternehmer) && !company.kleinunternehmer}
            aria-describedby="kleinunternehmer-hint"
          />
          <span>
            Kleinunternehmer nach § 19 UStG
            <span id="kleinunternehmer-hint" className="small muted" style={{ display: "block" }}>
              Rechnungen ohne Umsatzsteuer, keine Voranmeldung, Belege ohne Vorsteuerabzug.{" "}
              {locks.kleinunternehmer && !company.kleinunternehmer
                ? locks.kleinunternehmer
                : company.kleinunternehmer
                  ? "Ausschalten, sobald die Umsatzgrenze überschritten ist; ab dann gilt die Regelbesteuerung."
                  : ""}
            </span>
          </span>
        </label>
        <label className="field">
          Privatanteil Telefon in %
          <input
            name="privateShare-telefon"
            inputMode="numeric"
            defaultValue={company.privateShares.telefon ?? ""}
            placeholder="0"
            aria-describedby="private-share-hint"
          />
        </label>
        <label className="field">
          Privatanteil Internet in %
          <input name="privateShare-internet" inputMode="numeric" defaultValue={company.privateShares.internet ?? ""} placeholder="0" aria-describedby="private-share-hint" />
        </label>
        <p id="private-share-hint" className="small muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
          Vorgabe für neue Belege dieser Kategorien: Nur der betriebliche Teil wird Ausgabe und Vorsteuer, der private Teil ist eine
          Entnahme. Am einzelnen Beleg lässt sich der Anteil ändern.
        </p>
        <fieldset className="form-grid" style={{ gridColumn: "1 / -1", border: 0, padding: 0, margin: 0 }}>
          <legend className="subhead">Mahnwesen</legend>
          <label className="field">
            Basiszinssatz in %
            <input
              name="dunning-baseRate"
              inputMode="decimal"
              defaultValue={company.dunning.baseRate === null ? "" : formatDecimal(company.dunning.baseRate)}
              placeholder="z. B. 1,27"
              aria-describedby="base-rate-hint"
            />
            <span id="base-rate-hint" className="small">
              Ändert sich zum 1. Januar und 1. Juli, veröffentlicht von der Deutschen Bundesbank. Leer = keine Verzugszinsen.
            </span>
          </label>
          <label className="field">
            Zahlungsfrist in Mahnungen (Tage)
            <input name="dunning-deadlineDays" inputMode="numeric" defaultValue={company.dunning.deadlineDays} />
          </label>
          <label className="field">
            Gebühr Zahlungserinnerung (€)
            <input name="dunning-fee-1" inputMode="decimal" defaultValue={company.dunning.fees["1"] ? formatDecimal(company.dunning.fees["1"]) : ""} placeholder="0,00" />
          </label>
          <label className="field">
            Gebühr 1. Mahnung (€)
            <input name="dunning-fee-2" inputMode="decimal" defaultValue={company.dunning.fees["2"] ? formatDecimal(company.dunning.fees["2"]) : ""} placeholder="0,00" />
          </label>
          <label className="field">
            Gebühr letzte Mahnung (€)
            <input name="dunning-fee-3" inputMode="decimal" defaultValue={company.dunning.fees["3"] ? formatDecimal(company.dunning.fees["3"]) : ""} placeholder="0,00" />
          </label>
        </fieldset>
      </div>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Speichern
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}

type PersonKey = "a" | "b";

function PersonFields({ prefix, person }: { prefix: PersonKey; person: TaxpayerPerson | undefined }) {
  const id = (name: string) => `${prefix}-${name}`;
  return (
    <div className="form-grid">
      <label className="field">
        Anrede
        <select name={id("anrede")} defaultValue={person?.anrede ?? "Herrn"}>
          <option value="Herrn">Herr</option>
          <option value="Frau">Frau</option>
        </select>
      </label>
      <label className="field">
        Steuer-ID
        <input name={id("idnr")} inputMode="numeric" defaultValue={person?.idnr ?? ""} placeholder="11 Ziffern" autoComplete="off" />
      </label>
      <label className="field">
        Vorname
        <input name={id("vorname")} defaultValue={person?.vorname ?? ""} />
      </label>
      <label className="field">
        Nachname
        <input name={id("name")} defaultValue={person?.name ?? ""} />
      </label>
      <label className="field">
        Geburtsdatum
        <input name={id("geburtsdatum")} type="date" defaultValue={person?.geburtsdatum ?? ""} />
      </label>
      <label className="field">
        Religion
        <select name={id("religion")} defaultValue={person?.religion ?? "11"}>
          {RELIGIONEN.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field" style={{ gridColumn: "1 / -1" }}>
        Ausgeübter Beruf
        <input name={id("beruf")} defaultValue={person?.beruf ?? ""} placeholder="z. B. IT-Berater" />
      </label>
    </div>
  );
}

/** Persönliche Angaben für ELSTER: Bankverbindung ändern, Einkommensteuererklärung */
function TaxpayerForm() {
  const { company } = Route.useLoaderData();
  const taxpayer = company.taxpayer;
  const router = useRouter();
  const save = useServerFn(saveTaxpayerData);
  const [veranlagung, setVeranlagung] = useState(taxpayer.veranlagung ?? "einzel");
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const person = (key: PersonKey) => {
      if (!text(`${key}-idnr`) && !text(`${key}-vorname`) && !text(`${key}-name`)) return undefined;
      return {
        anrede: text(`${key}-anrede`) === "Frau" ? ("Frau" as const) : ("Herrn" as const),
        idnr: text(`${key}-idnr`),
        vorname: text(`${key}-vorname`),
        name: text(`${key}-name`),
        geburtsdatum: text(`${key}-geburtsdatum`),
        religion: text(`${key}-religion`) || "11",
        beruf: text(`${key}-beruf`),
      };
    };
    setBusy(true);
    setNotice(null);
    try {
      const zusammen = veranlagung === "zusammen";
      await save({
        data: {
          a: person("a"),
          b: zusammen ? person("b") : undefined,
          veranlagung,
          verheiratetSeit: zusammen && text("verheiratetSeit") ? text("verheiratetSeit") : undefined,
        },
      });
      await router.invalidate();
      setNotice({ tone: "ok", text: "Persönliche Angaben gespeichert." });
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="taxpayer-heading">
      <h2 id="taxpayer-heading">Persönliche Angaben</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Für die Änderung der Bankverbindung und die Einkommensteuererklärung über ELSTER.
      </p>
      <PersonFields prefix="a" person={taxpayer.a} />
      <fieldset className="form-grid" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 500, marginBottom: 8 }}>
          Veranlagung
        </legend>
        <label className="field">
          Art
          <select value={veranlagung} onChange={(e) => setVeranlagung(e.target.value === "zusammen" ? "zusammen" : "einzel")}>
            <option value="einzel">Einzelveranlagung</option>
            <option value="zusammen">Zusammenveranlagung mit Ehegatten</option>
          </select>
        </label>
        {veranlagung === "zusammen" && (
          <label className="field">
            Verheiratet seit
            <input name="verheiratetSeit" type="date" defaultValue={taxpayer.verheiratetSeit ?? ""} />
          </label>
        )}
      </fieldset>
      {veranlagung === "zusammen" && (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 500, marginBottom: 8 }}>
            Ehegatte (Person B)
          </legend>
          <PersonFields prefix="b" person={taxpayer.b} />
        </fieldset>
      )}
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Speichern
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}

function CertificateForm() {
  const { certificate, mode } = Route.useLoaderData();
  const router = useRouter();
  const upload = useServerFn(uploadCertificate);
  const remove = useServerFn(removeCertificate);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      await work();
      await router.invalidate();
      setNotice({ tone: "ok", text: success });
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    void run(async () => {
      await upload({ data: new FormData(form) });
      form.reset();
    }, "Zertifikat verschlüsselt gespeichert.");
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="cert-heading">
      <h2 id="cert-heading">ELSTER-Zertifikat</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Die Zertifikatsdatei (.pfx) aus Mein ELSTER. Sie wird verschlüsselt abgelegt; die PIN fragt Haben erst beim
        Senden ab und speichert sie nie. ERiC: {mode === "eric" ? "eingerichtet" : "nicht eingerichtet, Senden simuliert"}.
      </p>
      {certificate && (
        <div className="history-row">
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 500 }}>{certificate.filename}</span>
            <span className="small muted">
              {certificate.validUntil ? `gültig bis ${formatDate(certificate.validUntil)}` : "Ablaufdatum nicht angegeben"}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={() => run(() => remove(), "Zertifikat entfernt.")}
          >
            Entfernen
          </button>
        </div>
      )}
      <label className="field">
        {certificate ? "Neue Zertifikatsdatei" : "Zertifikatsdatei"}
        <input name="file" type="file" accept=".pfx" required />
      </label>
      <label className="field">
        Gültig bis (für die Erinnerung 30 Tage vorher)
        <input name="validUntil" type="date" />
      </label>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Hochladen
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}

const ERIC_INFO_URL = "https://www.elster.de/elsterweb/entwickler/infoseite/eric";

/** ERiC von download.elster.de laden, mit Fortschritt; läuft im Hintergrund weiter */
function EricCard() {
  const { eric } = Route.useLoaderData();
  const router = useRouter();
  const install = useServerFn(installEricLibrary);
  const [version, setVersion] = useState(eric.version ?? eric.defaultVersion);
  const [accepted, setAccepted] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const running = eric.install?.status === "laeuft";

  // Während des Downloads alle zwei Sekunden den Stand holen
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void router.invalidate(), 2000);
    return () => clearInterval(timer);
  }, [running, router]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await install({ data: { version: version.trim(), acceptLicense: accepted as true } });
      await router.invalidate();
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  const progress = eric.install?.status === "laeuft" ? eric.install.progress : null;
  const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="eric-heading">
      <h2 id="eric-heading">ERiC</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Die Bibliothek der Finanzverwaltung für die Übermittlung an ELSTER. Haben darf sie nicht mitliefern, lädt sie aber hier direkt
        von download.elster.de auf deinen Server (rund 300 MB, nur Linux x86_64).
      </p>
      <div className="history-row">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 500 }}>
            {eric.mode === "eric" ? `Eingerichtet${eric.version ? `: Version ${eric.version}` : ""}` : "Nicht eingerichtet, Senden wird simuliert"}
          </span>
          {eric.home && <span className="small muted mono">{eric.home}{eric.source === "env" ? " (ERIC_HOME)" : ""}</span>}
        </div>
        <span className={`pill ${eric.mode === "eric" ? "pill-ok" : ""}`}>{eric.mode === "eric" ? "ERiC" : "Simuliert"}</span>
      </div>
      {eric.source === "env" ? (
        <p className="small muted" style={{ margin: 0 }}>
          ERiC ist über ERIC_HOME eingebunden. Zum Aktualisieren das Paket dort austauschen oder ERIC_HOME entfernen und hier herunterladen.
        </p>
      ) : !eric.platformSupported ? (
        <p className="small muted" style={{ margin: 0 }}>
          Dieser Server ist kein Linux x86_64; dafür gibt es kein ERiC. Prüfen und Senden bleiben simuliert.
        </p>
      ) : (
        <>
          <label className="field">
            Version
            <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder={eric.defaultVersion} disabled={running} />
            <span className="small">
              Die aktuelle Version steht auf der{" "}
              <a href={ERIC_INFO_URL} target="_blank" rel="noreferrer">
                ERiC-Infoseite von ELSTER
              </a>
              . Neue Vordrucke (etwa für das nächste Steuerjahr) brauchen meist eine neue Version.
            </span>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} disabled={running} />
            Ich stimme den Nutzungsbedingungen von ERiC zu (siehe Infoseite).
          </label>
          {running && (
            <div className="banner banner-info" role="status">
              {progress?.phase === "entpacken"
                ? `Entpacke … ${megabytes(progress.bytes)}`
                : progress
                  ? `Lade ERiC ${eric.install!.version} … ${megabytes(progress.bytes)}${progress.total ? ` von ${megabytes(progress.total)}` : ""}`
                  : `Lade ERiC ${eric.install!.version} …`}
            </div>
          )}
          {eric.install?.status === "fertig" && (
            <div className="banner banner-ok" role="status">
              ERiC {eric.install.version} ist eingerichtet. Prüfen und Senden laufen jetzt über ERiC.
            </div>
          )}
          {eric.install?.status === "fehler" && (
            <div className="banner banner-danger" role="alert">
              Download fehlgeschlagen: {eric.install.message}
            </div>
          )}
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy || running || !accepted || !version.trim()}>
              {running ? "Läuft …" : eric.source === "download" ? "Neu herunterladen" : "Herunterladen und einrichten"}
            </button>
          </div>
        </>
      )}
      <NoticeBanner notice={notice} />
      <FormatCheck simuliert={eric.mode !== "eric"} />
    </form>
  );
}

/** ERiC prüft Belegabruf, Berechtigung und Postfach gegen seine Schemas, ohne zu senden */
function FormatCheck({ simuliert }: { simuliert: boolean }) {
  const check = useServerFn(checkElsterFormats);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof checkElsterFormats>> | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await check());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const failed = result?.results.filter((r) => !r.ok).length ?? 0;
  return (
    <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }} aria-label="Formate prüfen" role="group">
      <p className="small muted" style={{ margin: 0 }}>
        Belegabruf, Berechtigung und Postfach baut Haben nach freien Vorlagen, nicht nach der amtlichen Jahresdokumentation. Hier prüft
        ERiC diese Nachrichten gegen seine Schemas; gesendet wird nichts.
        {simuliert ? " Ohne ERiC ist die Prüfung nur simuliert." : ""}
      </p>
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void run()}>
          {busy ? "Prüft …" : "Formate mit ERiC prüfen"}
        </button>
      </div>
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      {result && (
        <>
          <div className={`banner ${failed === 0 ? "banner-ok" : "banner-danger"}`} role="status">
            {failed === 0
              ? `Alle ${result.results.length} Nachrichten sind gültig${result.mode === "simuliert" ? " (simuliert, ohne ERiC)" : ""}.`
              : `${failed} von ${result.results.length} Nachrichten bemängelt ERiC. Bitte die Meldungen als Issue melden.`}
          </div>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {result.results.map((r) => (
              <li key={r.name}>
                {r.ok ? "✓" : "✗"} {r.name} <span className="muted mono">{r.datenartVersion}</span>
                {!r.ok && (
                  <div style={{ overflowWrap: "anywhere" }}>
                    {r.code}: {r.message}
                    {r.meldungen.map((m) => (
                      <div key={m} className="muted">
                        {m}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Passkeys() {
  // aktualisiert sich nach Hinzufügen und Entfernen selbst
  const passkeys = authClient.useListPasskeys().data ?? [];
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<{ error?: { message?: string } | null } | undefined>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await work();
      if (result?.error) throw new Error(result.error.message ?? "Fehlgeschlagen");
      setNotice({ tone: "ok", text: success });
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="passkey-heading">
      <h2 id="passkey-heading">Passkeys</h2>
      {passkeys.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          Noch kein Passkey. Mit einem Passkey meldest du dich ohne Passwort an.
        </p>
      ) : (
        passkeys.map((passkey) => (
          <div key={passkey.id} className="history-row">
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontWeight: 500 }}>{passkey.name || "Passkey"}</span>
              {passkey.createdAt && <span className="small muted">angelegt {formatDate(passkey.createdAt)}</span>}
            </div>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => run(() => authClient.passkey.deletePasskey({ id: passkey.id }), "Passkey entfernt.")}
            >
              Entfernen
            </button>
          </div>
        ))
      )}
      <div className="actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => run(() => authClient.passkey.addPasskey({ name: "Haben" }), "Passkey hinzugefügt.")}
        >
          Passkey hinzufügen
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </section>
  );
}

function NumberingForm() {
  const { numbering } = Route.useLoaderData();
  const router = useRouter();
  const save = useServerFn(saveNextNumber);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = Number(new FormData(event.currentTarget).get("next"));
    setBusy(true);
    setNotice(null);
    try {
      await save({ data: { next } });
      await router.invalidate();
      setNotice({ tone: "ok", text: "Nummernkreis gespeichert." });
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="numbering-heading">
      <h2 id="numbering-heading">Rechnungsnummern {numbering.year}</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Nächste Nummer: <span className="mono">{numbering.next}</span>. Nummern werden erst beim Festschreiben vergeben und
        laufen lückenlos. Um nach Lexoffice weiterzuzählen, die nächste laufende Nummer eintragen; zurücksetzen geht nicht.
      </p>
      <label className="field">
        Nächste laufende Nummer
        <input name="next" type="number" min={numbering.last + 1} defaultValue={numbering.last + 1} required />
      </label>
      <div className="actions">
        <button type="submit" className="btn" disabled={busy}>
          Übernehmen
        </button>
      </div>
      <NoticeBanner notice={notice} />
    </form>
  );
}
