import {
  BUNDESLAENDER,
  RECHTSFORM_KEYS,
  RECHTSFORMEN,
  currentFilingPeriod,
  formatDecimal,
  formatRateMonth,
  isKapitalgesellschaft,
  parseEuro,
  type Bundesland,
  type Rechtsform,
} from "@haben/core";
import { redirect, Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { BackupCard } from "../../components/BackupCard.tsx";
import { BaseRateLookup } from "../../components/BaseRateLookup.tsx";
import { DatevCard } from "../../components/DatevCard.tsx";
import { EnableBankingCard } from "../../components/EnableBankingCard.tsx";
import { StoreReportsCard } from "../../components/StoreReportsCard.tsx";
import { ExchangeRatesCard } from "../../components/ExchangeRatesCard.tsx";
import { FilePicker } from "../../components/FilePicker.tsx";
import { ExportCard } from "../../components/ExportCard.tsx";
import { InboxCard } from "../../components/InboxCard.tsx";
import { IntegrityCard } from "../../components/IntegrityCard.tsx";
import { DatabaseAccessCard } from "../../components/DatabaseAccessCard.tsx";
import { AccentColorCard } from "../../components/AccentColorCard.tsx";
import { LetterheadBackgroundCard, LetterheadOptionsCard } from "../../components/GestaltungCards.tsx";
import { LayoutsCard } from "../../components/LayoutsCard.tsx";
import { getLayouts } from "../../server/functions/layouts.ts";
import { FooterCard } from "../../components/FooterCard.tsx";
import { CustomerNumberCard } from "../../components/CustomerNumberCard.tsx";
import { NumberFormatCard } from "../../components/NumberFormatCard.tsx";
import { NumberingCard } from "../../components/NumberingCard.tsx";
import { PlanTemplatesCard } from "../../components/PlanTemplatesCard.tsx";
import { InvoiceAttachments } from "../../components/InvoiceAttachments.tsx";
import { getQuoteDefaultAttachments } from "../../server/functions/invoice-attachments.ts";
import { MailCard } from "../../components/MailCard.tsx";
import { EigeneSeitenCard } from "../../components/EigeneSeitenCard.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { McpCard } from "../../components/McpCard.tsx";
import { ExtractionCard } from "../../components/ExtractionCard.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { PasskeysCard } from "../../components/PasskeysCard.tsx";
import { PasswordCard } from "../../components/PasswordCard.tsx";
import { SsoZugaengeCard } from "../../components/SsoZugaengeCard.tsx";
import { ZugaengeCard } from "../../components/ZugaengeCard.tsx";
import { parseSkontoRows, SkontoFields, toSkontoRows } from "../../components/SkontoFields.tsx";
import { formatDate } from "../../lib/format.ts";
import { FORMAT_LABEL, FORMATS } from "../../lib/invoice.ts";
import { useAction } from "../../lib/use-action.ts";
import { getBackupStatus } from "../../server/functions/backup.ts";
import { getEnableBankingSettings } from "../../server/functions/bank.ts";
import { getStoreConnections } from "../../server/functions/stores.ts";
import { removeCertificate, uploadCertificate } from "../../server/functions/certificate.ts";
import { RELIGIONEN } from "../../lib/religion.ts";
import { SETTINGS_AREAS, settingsAreas, type SettingsArea } from "../../lib/settings-areas.ts";
import type { TaxpayerPerson } from "../../server/db/schema.ts";
import { getCompany, getExchangeRates, saveCompany, saveTaxpayerData } from "../../server/functions/company.ts";
import reportStyles from "../../styles/auswertungen.css?url";
import { getDatevNumbers } from "../../server/functions/datev-export.ts";
import { checkElsterFormats, confirmElsterPrivacy, getEricStatus, installEricLibrary } from "../../server/functions/eric.ts";
import { getCustomPages } from "../../server/functions/eigene-seiten.ts";
import { getExportYears } from "../../server/functions/export.ts";
import { getNumbering } from "../../server/functions/invoices.ts";
import { getInbox } from "../../server/functions/inbox.ts";
import { getChainHead, getDatabaseAccessInfo } from "../../server/functions/integrity.ts";
import { getBackground, getLetterheadDesign, getLogo } from "../../server/functions/logo.ts";
import { getMailSettings } from "../../server/functions/mail.ts";
import { getMcpSettings } from "../../server/functions/mcp.ts";
import { getZugaenge } from "../../server/functions/zugang.ts";
import { getExtractionSettings } from "../../server/functions/documents.ts";
import { getVatPeriod } from "../../server/functions/vat.ts";
import { Icon } from "../../components/Icon.tsx";
import { StichjahrCard } from "../../components/StichjahrCard.tsx";
import { NavMarkCard } from "../../components/NavMarkCard.tsx";
import { getStichjahr } from "../../server/functions/stichjahr.ts";
import { FormattedTextarea } from "../../components/FormattedTextarea.tsx";
import { Field } from "../../components/Field.tsx";
import { Status } from "../../components/Status.tsx";

export const Route = createFileRoute("/_app/einstellungen")({
  beforeLoad: ({ context, search }) => {
    if (context.oidc.only && search.bereich === "sicherheit") throw redirect({ to: "/einstellungen", search: { bereich: "zugaenge" }, replace: true });
    if (!context.oidc.only && search.bereich === "zugaenge") throw redirect({ to: "/einstellungen", search: { bereich: "sicherheit" }, replace: true });
  },
  loader: async () => {
    const [
      company,
      vat,
      numbering,
      eric,
      mail,
      logo,
      background,
      design,
      overview,
      inbox,
      exportYears,
      datev,
      chainHead,
      databaseAccess,
      backup,
      mcp,
      rates,
      enableBanking,
      stores,
      customPages,
      zugaenge,
      extraction,
      quoteDefaultAttachments,
      stichjahr,
    ] = await Promise.all([
      getCompany(),
      getVatPeriod({ data: currentFilingPeriod(new Date()) }),
      getNumbering(),
      getEricStatus(),
      getMailSettings(),
      getLogo(),
      getBackground(),
      getLetterheadDesign(),
      getLayouts(),
      getInbox(),
      getExportYears(),
      getDatevNumbers(),
      getChainHead(),
      getDatabaseAccessInfo(),
      getBackupStatus(),
      getMcpSettings(),
      getExchangeRates(),
      getEnableBankingSettings(),
      getStoreConnections(),
      getCustomPages(),
      getZugaenge(),
      getExtractionSettings(),
      getQuoteDefaultAttachments(),
      getStichjahr(),
    ]);
    return {
      ...company,
      certificate: vat.certificate,
      mode: vat.mode,
      numbering,
      eric,
      mail,
      logo,
      background,
      design,
      layouts: overview.layouts,
      layoutHints: overview.hints,
      inbox,
      exportYears,
      datev,
      chainHead,
      databaseAccess,
      backup,
      mcp,
      rates,
      enableBanking,
      stores,
      customPages,
      zugaenge,
      extraction,
      quoteDefaultAttachments,
      stichjahr,
    };
  },
  head: () => ({ meta: [{ title: "Einstellungen · Haben" }], links: [{ rel: "stylesheet", href: reportStyles }] }),
  validateSearch: (search: Record<string, unknown>): { bereich?: SettingsArea } =>
    search.bereich === "zugaenge" || SETTINGS_AREAS.some((a) => a.id === search.bereich) ? { bereich: search.bereich as SettingsArea } : {},
  component: SettingsPage,
});

function SettingsPage() {
  const { oidc } = Route.useRouteContext();
  const {
    company,
    numbering,
    logo,
    background,
    design,
    layouts,
    layoutHints,
    mail,
    inbox,
    exportYears,
    datev,
    chainHead,
    databaseAccess,
    backup,
    mcp,
    rates,
    enableBanking,
    stores,
    customPages,
    zugaenge,
    extraction,
    quoteDefaultAttachments,
    stichjahr,
  } = Route.useLoaderData();
  const { bereich = "firma" } = Route.useSearch();
  const areas = settingsAreas(oidc.only);
  const area = areas.find((a) => a.id === bereich)!;
  // Eine GmbH oder UG zahlt keine Einkommensteuer; die persönlichen Angaben braucht ELSTER dort für Nachrichten und Postfach
  const hint = (a: ReturnType<typeof settingsAreas>[number]) =>
    a.id === "persoenlich" && isKapitalgesellschaft(company.rechtsform) ? "Für Nachrichten an das Finanzamt" : a.hint;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Haben</div>
          <h1>Einstellungen</h1>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Bereiche der Einstellungen">
          {areas.map((a) => (
            <Link key={a.id} to="/einstellungen" search={{ bereich: a.id }} className="settings-nav-link" aria-current={a.id === bereich ? "page" : undefined}>
              <span>{a.label}</span>
              <span className="settings-nav-hint">{hint(a)}</span>
            </Link>
          ))}
        </nav>
        <div className="stack settings-content" aria-label={area.label}>
          {bereich === "firma" && (
            <>
              <CompanyForm />
              <StichjahrCard stand={stichjahr} />
              <NavMarkCard color={company.navColor} logo={company.navLogo} logoSha256={logo?.sha256 ?? null} />
            </>
          )}
          {bereich === "persoenlich" && <TaxpayerForm />}
          {bereich === "rechnungen" && (
            <>
              <NumberingCard numbering={numbering.invoice} />
              <NumberingCard numbering={numbering.quote} />
              <NumberFormatCard
                invoice={company.invoiceNumberFormat}
                quote={company.quoteNumberFormat}
                invoiceRunning={company.invoiceCounterRunning}
                quoteRunning={company.quoteCounterRunning}
                date={numbering.invoice.date}
              />
              <PlanTemplatesCard templates={company.paymentPlanTemplates} />
              <InvoiceAttachments kind="standard" attachments={quoteDefaultAttachments} editable />
              <CustomerNumberCard format={company.customerNumberFormat} next={company.customerNumberNext} date={numbering.invoice.date} />
            </>
          )}
          {bereich === "gestaltung" && (
            <>
              <LetterheadOptionsCard design={design} logo={logo?.sha256 ?? null} hints={layoutHints} />
              <LetterheadBackgroundCard design={design} background={background?.sha256 ?? null} hints={layoutHints} />
              <AccentColorCard color={design.accent} hint={layoutHints.accent} />
              <FooterCard columns={design.footerColumns} seller={company} hidden={design.footerHidden && background !== null} />
              <LayoutsCard design={design} layouts={layouts} />
            </>
          )}
          {bereich === "elster" && (
            <>
              <CertificateForm />
              <EricCard />
            </>
          )}
          {bereich === "email" && (
            <>
              <MailCard data={mail} />
              <InboxCard data={inbox} />
            </>
          )}
          {bereich === "bank" && (
            <>
              <EnableBankingCard data={enableBanking} />
              <StoreReportsCard connections={stores.connections} contacts={stores.contacts} />
            </>
          )}
          {bereich === "zugaenge" && zugaenge.mode === "sso" && <SsoZugaengeCard accounts={zugaenge.ssoAccounts} providerName={oidc.name} />}
          {bereich === "sicherheit" && zugaenge.mode === "lokal" && (
            <>
              <PasskeysCard />
              <PasswordCard />
              <ZugaengeCard data={zugaenge} />
            </>
          )}
          {bereich === "ki" && (
            <>
              <McpCard data={mcp} />
              <ExtractionCard settings={extraction} />
            </>
          )}
          {bereich === "seiten" && <EigeneSeitenCard pages={customPages} />}
          {bereich === "waehrung" && <ExchangeRatesCard data={rates} />}
          {bereich === "export" && (
            <>
              <ExportCard years={exportYears} />
              <DatevCard years={exportYears} numbers={datev} />
              <IntegrityCard head={chainHead} />
              <DatabaseAccessCard access={databaseAccess} />
              <BackupCard status={backup} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

function CompanyForm() {
  const { company, issues, letterIssues, locks } = Route.useLoaderData();
  const router = useRouter();
  const save = useServerFn(saveCompany);
  const { busy, notice, run } = useAction();
  // Steuert, was nur ein Einzelunternehmen hat: Einkunftsart der EÜR und Privatanteile
  const [rechtsform, setRechtsform] = useState<Rechtsform>(company.rechtsform);
  const gesellschaft = isKapitalgesellschaft(rechtsform);
  const [skontoRows, setSkontoRows] = useState(() => toSkontoRows(company.skonto));
  const [baseRate, setBaseRate] = useState(company.dunning.baseRate === null ? "" : formatDecimal(company.dunning.baseRate));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    const skonto = parseSkontoRows(skontoRows);
    void run(async () => {
      if (!skonto.valid) throw new Error("Skonto: je Stufe einen Satz (z. B. 2) und eine Frist in Tagen angeben.");
      await save({
        data: {
          name: text("name"),
          rechtsform,
          // Ohne Kapitalgesellschaft stehen die Felder nicht im Formular; gespeicherte Angaben bleiben
          sitz: gesellschaft ? text("sitz") : company.sitz,
          registergericht: gesellschaft ? text("registergericht") : company.registergericht,
          registernummer: gesellschaft ? text("registernummer") : company.registernummer,
          geschaeftsfuehrer: gesellschaft ? text("geschaeftsfuehrer") : company.geschaeftsfuehrer,
          aufsichtsratVorsitz: gesellschaft ? text("aufsichtsratVorsitz") : company.aufsichtsratVorsitz,
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
          kontoinhaber: text("kontoinhaber"),
          glaeubigerId: text("glaeubigerId"),
          kontenrahmen: text("kontenrahmen") === "SKR04" ? "SKR04" : "SKR03",
          paymentTermDays: Number(text("paymentTermDays") || 14),
          skonto: skonto.stufen,
          defaultFormat: (text("defaultFormat") || "zugferd") as "zugferd" | "xrechnung-cii" | "xrechnung-ubl",
          invoiceIntro: text("invoiceIntro"),
          quoteIntro: text("quoteIntro"),
          kleinunternehmer: form.get("kleinunternehmer") === "on",
          ohneVorsteuerabzug: form.get("ohneVorsteuerabzug") === "on",
          tageskurs: form.get("tageskurs") === "on",
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
            autoBaseRate: form.get("dunning-autoBaseRate") === "on",
          },
          privateShares: Object.fromEntries(
            (["telefon", "internet"] as const)
              .map((key) => [key, Number(text(`privateShare-${key}`) || 0)] as const)
              .filter(([, value]) => Number.isInteger(value) && value > 0 && value <= 100),
          ),
        },
      });
      await router.invalidate();
    }, "Firmendaten gespeichert.");
  }

  const fee = (level: "1" | "2" | "3") => (company.dunning.fees[level] ? formatDecimal(company.dunning.fees[level]) : "");

  return (
    <form className="card form-card" onSubmit={onSubmit} aria-labelledby="company-heading">
      <div className="form-card-head">
        <h2 id="company-heading">Firmendaten</h2>
        {issues.length > 0 && <div className="banner">Für ELSTER fehlt noch: {issues.join(", ")}.</div>}
      </div>

      <section className="form-section" aria-labelledby="company-basics">
        <h3 id="company-basics">Unternehmen</h3>
        <div className="form-row cols-2">
          <Field label="Name">{(control) => <input {...control} name="name" defaultValue={company.name} autoComplete="organization" />}</Field>
          <Field label="Art des Betriebs (Anlage EÜR) bzw. Gegenstand des Unternehmens">
            {(control) => <input {...control} name="taetigkeit" defaultValue={company.taetigkeit} placeholder="z. B. Softwareentwicklung" maxLength={100} />}
          </Field>
        </div>
        <div className="form-row cols-2">
          <Field label="E-Mail">{(control) => <input {...control} name="email" type="email" defaultValue={company.email} autoComplete="email" />}</Field>
          <Field label="Telefon (Pflicht für XRechnung)">
            {(control) => <input {...control} name="telefon" type="tel" defaultValue={company.telefon} autoComplete="tel" />}
          </Field>
        </div>
      </section>

      <section className="form-section" aria-labelledby="company-address">
        <h3 id="company-address">Anschrift</h3>
        <Field label="Straße und Hausnummer">
          {(control) => <input {...control} name="strasse" defaultValue={company.strasse} autoComplete="street-address" />}
        </Field>
        <div className="form-row cols-place">
          <Field label="PLZ">{(control) => <input {...control} name="plz" defaultValue={company.plz} inputMode="numeric" autoComplete="postal-code" />}</Field>
          <Field label="Ort">{(control) => <input {...control} name="ort" defaultValue={company.ort} autoComplete="address-level2" />}</Field>
          <Field label="Bundesland">
            {(control) => (
              <select {...control} name="bundesland" defaultValue={company.bundesland ?? ""}>
                <option value="">Bitte wählen</option>
                {Object.entries(BUNDESLAENDER).map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </section>

      {gesellschaft && (
        <section className="form-section" aria-labelledby="company-register">
          <h3 id="company-register">Handelsregister und Geschäftsführung</h3>
          <p className="field-hint" style={{ marginTop: 0 }}>
            Gehören in den Jahresabschluss (§ 264 Abs. 1a HGB), etwa auf die Bilanz zur Hinterlegung beim Unternehmensregister, und auf jeden Geschäftsbrief (§
            35a GmbHG): Haben druckt sie in den Fuß von Rechnung, Angebot, Mahnung und Lieferschein und hängt sie an E-Mails an. Sie stehen im Registerauszug.
          </p>
          {letterIssues.length > 0 && (
            <div className="banner" id="letter-issues">
              Für Rechnungen und Geschäftsbriefe fehlt noch (§ 35a GmbHG): {letterIssues.join(", ")}.
            </div>
          )}
          <div className="form-row cols-2">
            <Field label="Sitz" hint="Laut Gesellschaftsvertrag; leer = Ort der Anschrift.">
              {(control) => <input {...control} name="sitz" defaultValue={company.sitz} maxLength={100} placeholder={company.ort} />}
            </Field>
            <Field label="Registergericht">
              {(control) => (
                <input {...control} name="registergericht" defaultValue={company.registergericht} maxLength={100} placeholder="z. B. Amtsgericht Bremen" />
              )}
            </Field>
            <Field label="Registernummer">
              {(control) => (
                <input
                  {...control}
                  name="registernummer"
                  defaultValue={company.registernummer}
                  maxLength={40}
                  placeholder="z. B. HRB 12345 HB"
                  className="mono"
                />
              )}
            </Field>
          </div>
          <div className="form-row cols-2">
            <Field label="Geschäftsführer" hint="Alle, einer je Zeile, mit ausgeschriebenem Vornamen.">
              {(control) => (
                <textarea
                  {...control}
                  name="geschaeftsfuehrer"
                  defaultValue={company.geschaeftsfuehrer}
                  maxLength={1000}
                  rows={2}
                  placeholder="z. B. Erika Mustermann"
                />
              )}
            </Field>
            <Field label="Vorsitz des Aufsichtsrats" hint="Nur, wenn die Gesellschaft einen Aufsichtsrat mit Vorsitz hat.">
              {(control) => <input {...control} name="aufsichtsratVorsitz" defaultValue={company.aufsichtsratVorsitz} maxLength={200} />}
            </Field>
          </div>
        </section>
      )}

      <section className="form-section" aria-labelledby="company-tax">
        <h3 id="company-tax">Steuern</h3>
        <div className="form-row cols-2">
          <Field label="Steuernummer (wie auf dem Bescheid)">
            {(control) => <input {...control} name="steuernummer" defaultValue={company.steuernummer} placeholder="z. B. 21/815/08150" className="mono" />}
          </Field>
          <Field label="Finanzamt">{(control) => <input {...control} name="finanzamt" defaultValue={company.finanzamt} />}</Field>
        </div>
        <div className="form-row cols-2">
          <Field label="USt-IdNr.">
            {(control) => <input {...control} name="ustId" defaultValue={company.ustId} placeholder="DE123456789" className="mono" />}
          </Field>
          <Field
            label="Rechtsform"
            hint={
              locks.rechtsform ??
              (gesellschaft
                ? "Ohne EÜR, Einkommensteuer, Pauschalen und Privatanteile; Geld vom und an den Gesellschafter geht auf das Verrechnungskonto."
                : "Mit Privatkonten, Anlage EÜR und Einkommensteuer.")
            }
          >
            {(control) => (
              <select {...control} value={rechtsform} onChange={(e) => setRechtsform(e.target.value as Rechtsform)} disabled={Boolean(locks.rechtsform)}>
                {RECHTSFORM_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {RECHTSFORMEN[key]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {!gesellschaft && (
          <div className="form-row cols-2">
            <Field label="Einkunftsart (für die Anlage EÜR)">
              {(control) => (
                <select {...control} name="einkunftsart" defaultValue={company.einkunftsart ?? ""}>
                  <option value="">Bitte wählen</option>
                  <option value="selbstaendig">Selbständige Arbeit (freier Beruf, z. B. Entwickler, Berater)</option>
                  <option value="gewerbe">Gewerbebetrieb</option>
                </select>
              )}
            </Field>
          </div>
        )}
        <div className="form-row cols-2">
          <Field label="Versteuerung" hint={locks.versteuerung}>
            {(control) => (
              <>
                {locks.versteuerung && <input type="hidden" name="versteuerung" value={company.versteuerung} />}
                <select
                  {...control}
                  name={locks.versteuerung ? undefined : "versteuerung"}
                  defaultValue={company.versteuerung}
                  disabled={Boolean(locks.versteuerung)}
                >
                  <option value="ist">Ist (nach vereinnahmten Entgelten)</option>
                  <option value="soll">Soll (nach vereinbarten Entgelten)</option>
                </select>
              </>
            )}
          </Field>
          <Field label="Kontenrahmen (wie in Lexoffice)" hint={locks.kontenrahmen}>
            {(control) => (
              <>
                {/* Gesperrte Felder werden nicht mitgeschickt; der Wert kommt dann aus dem versteckten Feld */}
                {locks.kontenrahmen && <input type="hidden" name="kontenrahmen" value={company.kontenrahmen} />}
                <select
                  {...control}
                  name={locks.kontenrahmen ? undefined : "kontenrahmen"}
                  defaultValue={company.kontenrahmen}
                  disabled={Boolean(locks.kontenrahmen)}
                >
                  <option value="SKR03">SKR03</option>
                  <option value="SKR04">SKR04</option>
                </select>
              </>
            )}
          </Field>
        </div>
        <div className="checkbox-hinted">
          <label className="checkbox">
            {/* Einschalten mitten im Jahr gesperrt; Ausschalten geht immer (Umsatzgrenze überschritten) */}
            <input
              type="checkbox"
              name="kleinunternehmer"
              defaultChecked={company.kleinunternehmer}
              disabled={Boolean(locks.kleinunternehmer) && !company.kleinunternehmer}
              aria-describedby="kleinunternehmer-hint"
            />
            <span>Kleinunternehmer nach § 19 UStG</span>
          </label>
          <span id="kleinunternehmer-hint" className="field-hint">
            Rechnungen ohne Umsatzsteuer, keine Voranmeldung, Belege ohne Vorsteuerabzug.{" "}
            {locks.kleinunternehmer && !company.kleinunternehmer
              ? locks.kleinunternehmer
              : company.kleinunternehmer
                ? "Ausschalten, sobald die Umsatzgrenze überschritten ist; ab dann gilt die Regelbesteuerung."
                : ""}
          </span>
        </div>
        <div className="checkbox-hinted">
          <label className="checkbox">
            <input type="checkbox" name="ohneVorsteuerabzug" defaultChecked={company.ohneVorsteuerabzug} aria-describedby="ohne-vorsteuerabzug-hint" />
            <span>Ohne Vorsteuerabzug (steuerfreie Umsätze nach § 4 UStG)</span>
          </label>
          <span id="ohne-vorsteuerabzug-hint" className="field-hint">
            Etwa bei Heilbehandlung oder Unterricht (§ 4 Nr. 14 und 21 UStG): Belege werden ohne Vorsteuer gebucht, die Steuer wird Teil der Ausgabe (§ 15 Abs.
            2 UStG). Am einzelnen Beleg änderbar; Rechnungen bleiben, wie sie sind.
          </span>
        </div>
      </section>

      <section className="form-section" aria-labelledby="company-currency">
        <h3 id="company-currency">Fremdwährung</h3>
        <div className="checkbox-hinted">
          <label className="checkbox">
            <input type="checkbox" name="tageskurs" defaultChecked={company.tageskurs} aria-describedby="tageskurs-hint" />
            <span>Tageskurs statt USt-Umrechnungskurs (vom Finanzamt gestattet)</span>
          </label>
          <span id="tageskurs-hint" className="field-hint">
            Ohne Gestattung rechnet Haben Fremdwährung mit den monatlichen Umsatzsteuer-Umrechnungskursen des BMF um (§ 16 Abs. 6 UStG). Hat das Finanzamt den
            Tageskurs gestattet, trägst du an Beleg und Rechnung den Kurs mit Kursdatum ein, etwa aus der Bankabrechnung.
          </span>
        </div>
      </section>

      <section className="form-section" aria-labelledby="company-bank">
        <h3 id="company-bank">Bankverbindung</h3>
        <Field label="IBAN">
          {(control) => <input {...control} name="iban" defaultValue={company.iban} placeholder="DE00 0000 0000 0000 0000 00" className="mono" />}
        </Field>
        <Field
          label="Kontoinhaber"
          hint={
            <>
              Nur nötig, wenn das Konto nicht auf den Firmennamen läuft, z. B. auf dich als Person. Steht im GiroCode und in der E-Rechnung; die Bank des Kunden
              vergleicht ihn beim Überweisen mit dem Inhaber des Kontos.
            </>
          }
        >
          {(control) => <input {...control} name="kontoinhaber" defaultValue={company.kontoinhaber} maxLength={70} placeholder={company.name} />}
        </Field>
        <div className="form-row cols-2">
          <Field label="Bank">{(control) => <input {...control} name="bank" defaultValue={company.bank} />}</Field>
          <Field label="BIC">{(control) => <input {...control} name="bic" defaultValue={company.bic} className="mono" />}</Field>
        </div>
        <Field
          label="Gläubiger-ID"
          hint={
            <>
              Nur für SEPA-Lastschriften nötig. Die Bundesbank vergibt sie auf Antrag; sie steht auf jedem Mandat und auf der Rechnung, die per Lastschrift
              eingezogen wird.
            </>
          }
        >
          {(control) => <input {...control} name="glaeubigerId" defaultValue={company.glaeubigerId} placeholder="DE98ZZZ09999999999" className="mono" />}
        </Field>
      </section>

      <section className="form-section" aria-labelledby="company-invoices">
        <h3 id="company-invoices">Rechnungen und Angebote</h3>
        <div className="form-row cols-2">
          <Field label="Standard-Zahlungsziel in Tagen">
            {(control) => <input {...control} name="paymentTermDays" inputMode="numeric" defaultValue={company.paymentTermDays} />}
          </Field>
          <Field label="Standardformat für Rechnungen">
            {(control) => (
              <select {...control} name="defaultFormat" defaultValue={company.defaultFormat}>
                {FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABEL[f]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <SkontoFields
          id="company-skonto"
          rows={skontoRows}
          onChange={setSkontoRows}
          hint="Vorgabe für neue Rechnungen, z. B. 2 % bei Zahlung innerhalb von 10 Tagen; am Kunden und in der Rechnung änderbar. Die Frist zählt ab dem Rechnungsdatum und endet spätestens mit dem Zahlungsziel."
        />
        <div className="form-row cols-2">
          <Field label="Standard-Einleitung für Rechnungen" describedBy="intro-hint">
            {(control) => <FormattedTextarea {...control} name="invoiceIntro" rows={3} maxLength={2000} defaultValue={company.invoiceIntro} />}
          </Field>
          <Field label="Standard-Einleitung für Angebote" describedBy="intro-hint">
            {(control) => <FormattedTextarea {...control} name="quoteIntro" rows={3} maxLength={2000} defaultValue={company.quoteIntro} />}
          </Field>
        </div>
        <p id="intro-hint" className="field-hint">
          Steht in neuen Rechnungen und Angeboten als Einleitung über den Positionen und lässt sich dort anpassen. Rechnungen und Angebote, die es schon gibt,
          ändern sich nicht. Leer = keine Einleitung.
        </p>
      </section>

      {!gesellschaft && (
        <section className="form-section" aria-labelledby="company-private">
          <h3 id="company-private">Privatanteile</h3>
          <div className="form-row cols-2">
            <Field label="Privatanteil Telefon in %" describedBy="private-share-hint">
              {(control) => (
                <input {...control} name="privateShare-telefon" inputMode="numeric" defaultValue={company.privateShares.telefon ?? ""} placeholder="0" />
              )}
            </Field>
            <Field label="Privatanteil Internet in %" describedBy="private-share-hint">
              {(control) => (
                <input {...control} name="privateShare-internet" inputMode="numeric" defaultValue={company.privateShares.internet ?? ""} placeholder="0" />
              )}
            </Field>
          </div>
          <p id="private-share-hint" className="field-hint">
            Vorgabe für neue Belege dieser Kategorien: Nur der betriebliche Teil wird Ausgabe und Vorsteuer, der private Teil ist eine Entnahme. Am einzelnen
            Beleg lässt sich der Anteil ändern.
          </p>
        </section>
      )}

      <section className="form-section" aria-labelledby="company-dunning">
        <h3 id="company-dunning">Mahnwesen</h3>
        <div className="form-row cols-2">
          <Field label="Basiszinssatz in %" describedBy="base-rate-hint">
            {(control) => (
              <input
                {...control}
                name="dunning-baseRate"
                inputMode="decimal"
                value={baseRate}
                onChange={(event) => setBaseRate(event.target.value)}
                placeholder="z. B. 1,27"
              />
            )}
          </Field>
          <Field label="Zahlungsfrist in Mahnungen (Tage)">
            {(control) => <input {...control} name="dunning-deadlineDays" inputMode="numeric" defaultValue={company.dunning.deadlineDays} />}
          </Field>
        </div>
        <p id="base-rate-hint" className="field-hint">
          Der Basiszinssatz ändert sich zum 1. Januar und 1. Juli, veröffentlicht von der Deutschen Bundesbank. Der Knopf fragt den aktuellen Satz dort ab und
          trägt ihn ein. Leer = keine Verzugszinsen.
        </p>
        <BaseRateLookup onFound={setBaseRate} />
        <div className="checkbox-hinted">
          <label className="checkbox">
            <input type="checkbox" name="dunning-autoBaseRate" defaultChecked={company.dunning.autoBaseRate === true} aria-describedby="auto-base-rate-hint" />
            <span>Basiszinssatz automatisch abrufen</span>
          </label>
          <span id="auto-base-rate-hint" className="field-hint">
            Haben fragt die Bundesbank nur nach dem 1. Januar und 1. Juli, einmal am Tag, bis der neue Satz veröffentlicht ist, und trägt ihn dann ein.
            Dazwischen ändert sich der Satz nicht und Haben fragt nicht.
            {company.dunning.baseRateSince ? ` Zuletzt bestätigt für das Halbjahr ab ${formatRateMonth(company.dunning.baseRateSince)}.` : ""}
          </span>
        </div>
        <div className="form-row cols-3">
          <Field label="Gebühr Zahlungserinnerung (€)">
            {(control) => <input {...control} name="dunning-fee-1" inputMode="decimal" defaultValue={fee("1")} placeholder="0,00" />}
          </Field>
          <Field label="Gebühr 1. Mahnung (€)">
            {(control) => <input {...control} name="dunning-fee-2" inputMode="decimal" defaultValue={fee("2")} placeholder="0,00" />}
          </Field>
          <Field label="Gebühr letzte Mahnung (€)">
            {(control) => <input {...control} name="dunning-fee-3" inputMode="decimal" defaultValue={fee("3")} placeholder="0,00" />}
          </Field>
        </div>
      </section>

      <NoticeBanner notice={notice} />
      <div className="actions form-footer">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Speichern
        </button>
      </div>
    </form>
  );
}

type PersonKey = "a" | "b";

function PersonFields({ prefix, person }: { prefix: PersonKey; person: TaxpayerPerson | undefined }) {
  const id = (name: string) => `${prefix}-${name}`;
  return (
    <>
      <div className="form-row cols-2">
        <Field label="Anrede">
          {(control) => (
            <select {...control} name={id("anrede")} defaultValue={person?.anrede ?? "Herrn"}>
              <option value="Herrn">Herr</option>
              <option value="Frau">Frau</option>
            </select>
          )}
        </Field>
        <Field label="Steuer-ID">
          {(control) => (
            <input
              {...control}
              name={id("idnr")}
              inputMode="numeric"
              defaultValue={person?.idnr ?? ""}
              placeholder="11 Ziffern"
              autoComplete="off"
              className="mono"
            />
          )}
        </Field>
      </div>
      <div className="form-row cols-2">
        <Field label="Vorname">{(control) => <input {...control} name={id("vorname")} defaultValue={person?.vorname ?? ""} />}</Field>
        <Field label="Nachname">{(control) => <input {...control} name={id("name")} defaultValue={person?.name ?? ""} />}</Field>
      </div>
      <div className="form-row cols-2">
        <Field label="Geburtsdatum">
          {(control) => <input {...control} name={id("geburtsdatum")} type="date" defaultValue={person?.geburtsdatum ?? ""} />}
        </Field>
        <Field label="Religion">
          {(control) => (
            <select {...control} name={id("religion")} defaultValue={person?.religion ?? "11"}>
              {RELIGIONEN.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label="Ausgeübter Beruf">
        {(control) => <input {...control} name={id("beruf")} defaultValue={person?.beruf ?? ""} placeholder="z. B. IT-Berater" />}
      </Field>
    </>
  );
}

/**
 * Persönliche Angaben für ELSTER: Nachrichten, Postfach, Bankverbindung ändern, im Einzelunternehmen auch die
 * Einkommensteuererklärung. Veranlagung und Ehegatte gibt es nur dort; bei GmbH und UG bleiben gespeicherte Werte, wie sie sind.
 */
function TaxpayerForm() {
  const { company } = Route.useLoaderData();
  const taxpayer = company.taxpayer;
  const istPerson = !isKapitalgesellschaft(company.rechtsform);
  const router = useRouter();
  const save = useServerFn(saveTaxpayerData);
  const [veranlagung, setVeranlagung] = useState(taxpayer.veranlagung ?? "einzel");
  const { busy, notice, run } = useAction();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
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
    void run(async () => {
      const zusammen = veranlagung === "zusammen";
      await save({
        data: istPerson
          ? {
              a: person("a"),
              b: zusammen ? person("b") : undefined,
              veranlagung,
              verheiratetSeit: zusammen && text("verheiratetSeit") ? text("verheiratetSeit") : undefined,
            }
          : { ...taxpayer, a: person("a") },
      });
      await router.invalidate();
    }, "Persönliche Angaben gespeichert.");
  }

  return (
    <form className="card form-card" onSubmit={onSubmit} aria-labelledby="taxpayer-heading">
      <div className="form-card-head">
        <h2 id="taxpayer-heading">Persönliche Angaben</h2>
        <p className="small muted">
          {istPerson
            ? "Für die Änderung der Bankverbindung und die Einkommensteuererklärung über ELSTER."
            : "Für Nachrichten an das Finanzamt, das Postfach und die Änderung der Bankverbindung über ELSTER."}
        </p>
      </div>
      <section className="form-section" aria-labelledby="taxpayer-a">
        <h3 id="taxpayer-a">Steuerpflichtige Person</h3>
        <PersonFields prefix="a" person={taxpayer.a} />
      </section>
      {istPerson && (
        <>
          <fieldset className="form-section">
            <legend>Veranlagung</legend>
            <div className="form-row cols-2">
              <Field label="Art">
                {(control) => (
                  <select {...control} value={veranlagung} onChange={(e) => setVeranlagung(e.target.value === "zusammen" ? "zusammen" : "einzel")}>
                    <option value="einzel">Einzelveranlagung</option>
                    <option value="zusammen">Zusammenveranlagung mit Ehegatten</option>
                  </select>
                )}
              </Field>
              {veranlagung === "zusammen" && (
                <Field label="Verheiratet seit">
                  {(control) => <input {...control} name="verheiratetSeit" type="date" defaultValue={taxpayer.verheiratetSeit ?? ""} />}
                </Field>
              )}
            </div>
          </fieldset>
          {veranlagung === "zusammen" && (
            <fieldset className="form-section">
              <legend>Ehegatte (Person B)</legend>
              <PersonFields prefix="b" person={taxpayer.b} />
            </fieldset>
          )}
        </>
      )}
      <NoticeBanner notice={notice} />
      <div className="actions form-footer">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Speichern
        </button>
      </div>
    </form>
  );
}

function CertificateForm() {
  const { certificate, mode } = Route.useLoaderData();
  const router = useRouter();
  const upload = useServerFn(uploadCertificate);
  const remove = useServerFn(removeCertificate);
  const { busy, notice, run } = useAction();
  const [removing, setRemoving] = useState(false);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    void run(async () => {
      await upload({ data: new FormData(form) });
      form.reset();
      await router.invalidate();
    }, "Zertifikat verschlüsselt gespeichert.");
  }

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="cert-heading">
      <h2 id="cert-heading">ELSTER-Zertifikat</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Die Zertifikatsdatei (.pfx) aus deinem ELSTER-Konto mit der Anmeldeart Zertifikatsdatei; ELSTER Secure geht nicht. Sie wird verschlüsselt abgelegt. Die
        PIN fragt Haben beim Senden ab; speichern kannst du sie nur für den automatischen Postfach-Abruf. ERiC:{" "}
        {mode === "eric" ? "eingerichtet" : "nicht eingerichtet, Senden simuliert"}.
      </p>
      {certificate && (
        <div className="history-row">
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 500 }}>{certificate.filename}</span>
            <span className="small muted">{certificate.validUntil ? `gültig bis ${formatDate(certificate.validUntil)}` : "Ablaufdatum nicht angegeben"}</span>
          </div>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setRemoving(true)}>
            Entfernen
          </button>
          <ConfirmDialog
            open={removing}
            title={`Zertifikat ${certificate.filename} entfernen?`}
            confirmLabel="Zertifikat entfernen"
            danger
            onConfirm={() =>
              void run(async () => {
                await remove();
                await router.invalidate();
              }, "Zertifikat entfernt.")
            }
            onClose={() => setRemoving(false)}
          >
            <p>Ohne Zertifikat sendet Haben nichts an ELSTER und ruft das Postfach nicht ab. Zum Wiederherstellen brauchst du die .pfx-Datei und ihre PIN.</p>
          </ConfirmDialog>
        </div>
      )}
      <Field label={certificate ? "Neue Zertifikatsdatei" : "Zertifikatsdatei"}>
        {(control) => <FilePicker {...control} name="file" accept=".pfx" required />}
      </Field>
      <Field label="Gültig bis (für die Erinnerung 30 Tage vorher)">{(control) => <input {...control} name="validUntil" type="date" />}</Field>
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
  const loaded = Route.useLoaderData().eric;
  const router = useRouter();
  const install = useServerFn(installEricLibrary);
  const getStatus = useServerFn(getEricStatus);
  // Stand während des Downloads; danach gilt wieder der Loader
  const [polled, setPolled] = useState<typeof loaded | null>(null);
  const eric = polled ?? loaded;
  const [version, setVersion] = useState(eric.version ?? eric.defaultVersion);
  const [accepted, setAccepted] = useState(false);
  const { busy, notice, run } = useAction();
  const running = eric.install?.status === "laeuft";

  // Während des Downloads alle zwei Sekunden nur den ERiC-Stand holen; am Ende einmal die ganze Seite
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      getStatus().then(
        (next) => {
          if (next.install?.status === "laeuft") return setPolled(next);
          setPolled(null);
          void router.invalidate();
        },
        // Netzfehler: der nächste Takt fragt erneut
        () => {},
      );
    }, 2000);
    return () => clearInterval(timer);
  }, [running, getStatus, router]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await install({ data: { version: version.trim(), acceptLicense: accepted as true } });
      await router.invalidate();
    });
  }

  const progress = eric.install?.status === "laeuft" ? eric.install.progress : null;
  const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

  return (
    <form className="card" onSubmit={onSubmit} aria-labelledby="eric-heading">
      <h2 id="eric-heading">ERiC</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Die Bibliothek der Finanzverwaltung für die Übermittlung an ELSTER. Haben darf sie nicht mitliefern, lädt sie aber hier direkt von download.elster.de
        auf deinen Server (rund 300 MB, nur Linux x86_64).
      </p>
      <div className="history-row">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 500 }}>
            {eric.mode === "eric" ? `Eingerichtet${eric.version ? `: Version ${eric.version}` : ""}` : "Nicht eingerichtet, Senden wird simuliert"}
          </span>
          {eric.home && (
            <span className="small muted mono">
              {eric.home}
              {eric.source === "env" ? " (ERIC_HOME)" : ""}
            </span>
          )}
        </div>
        {eric.mode === "eric" ? (
          <Status tone="ok" inline>
            ERiC
          </Status>
        ) : (
          <Status tone="warn" emphasis="notice" inline>
            Simuliert
          </Status>
        )}
      </div>
      {eric.source === "env" ? (
        <p className="small muted" style={{ margin: 0 }}>
          ERiC ist über ERIC_HOME eingebunden. Zum Aktualisieren das Paket dort austauschen oder ERIC_HOME entfernen und hier herunterladen.
        </p>
      ) : !eric.platformSupported ? (
        <p className="small muted" style={{ margin: 0 }}>
          Dieser Server ist kein Linux x86_64; dafür gibt es kein ERiC. Prüfen und Senden bleiben simuliert, außer ERIC_WORKER_COMMAND startet den Worker
          emuliert als x86_64 (siehe Installation).
        </p>
      ) : (
        <>
          <Field
            label="Version"
            hint={
              <>
                Die aktuelle Version steht auf der{" "}
                <a href={ERIC_INFO_URL} target="_blank" rel="noreferrer">
                  ERiC-Infoseite von ELSTER
                </a>
                . Neue Vordrucke (etwa für das nächste Steuerjahr) brauchen meist eine neue Version.
              </>
            }
          >
            {(control) => (
              <input {...control} value={version} onChange={(e) => setVersion(e.target.value)} placeholder={eric.defaultVersion} disabled={running} />
            )}
          </Field>
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
      <DatenschutzBestaetigung bestaetigt={eric.datenschutzBestaetigt} />
      <FormatCheck simuliert={eric.mode !== "eric"} />
    </form>
  );
}

/** ERiC-Lizenz § 5: Datenschutzhinweise der Finanzverwaltung einmal vor der ersten Nutzung bestätigen */
function DatenschutzBestaetigung({ bestaetigt }: { bestaetigt: string | null }) {
  const router = useRouter();
  const confirm = useServerFn(confirmElsterPrivacy);
  const [gelesen, setGelesen] = useState(false);
  const { busy, notice, run } = useAction();
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="section-label">Datenschutzhinweise der Finanzverwaltung</div>
      <p className="small muted" style={{ margin: 0 }}>
        Bevor Haben über ERiC prüft oder sendet, nimmst du einmal die{" "}
        <a href="/elster-datenschutz.html" target="_blank" rel="noreferrer">
          Datenschutzhinweise der Finanzverwaltung
        </a>{" "}
        zur Kenntnis; so verlangt es der Lizenzvertrag zu ERiC.
      </p>
      {bestaetigt ? (
        <span className="small">Bestätigt am {formatDate(bestaetigt)}.</span>
      ) : (
        <>
          <label className="checkbox">
            <input type="checkbox" checked={gelesen} onChange={(e) => setGelesen(e.target.checked)} />
            Ich habe die Datenschutzhinweise der Finanzverwaltung zur Kenntnis genommen.
          </label>
          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={busy || !gelesen}
              onClick={() =>
                void run(async () => {
                  await confirm();
                  await router.invalidate();
                }, "Bestätigt.")
              }
            >
              Bestätigen
            </button>
          </div>
        </>
      )}
      <NoticeBanner notice={notice} />
    </div>
  );
}

/** ERiC prüft Belegabruf, Berechtigung und Postfach gegen seine Schemas, ohne zu senden */
function FormatCheck({ simuliert }: { simuliert: boolean }) {
  const check = useServerFn(checkElsterFormats);
  const { busy, notice, run } = useAction();
  const [result, setResult] = useState<Awaited<ReturnType<typeof checkElsterFormats>> | null>(null);

  const failed = result?.results.filter((r) => !r.ok).length ?? 0;
  return (
    <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }} aria-label="Formate prüfen" role="group">
      <p className="small muted" style={{ margin: 0 }}>
        Belegabruf, Berechtigung und Postfach baut Haben nach freien Vorlagen, nicht nach der amtlichen Jahresdokumentation. Hier prüft ERiC diese Nachrichten
        gegen seine Schemas; gesendet wird nichts.
        {simuliert ? " Ohne ERiC ist die Prüfung nur simuliert." : ""}
      </p>
      <div className="actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void run(async () => setResult(await check()))}>
          {busy ? "Prüft …" : "Formate mit ERiC prüfen"}
        </button>
      </div>
      <NoticeBanner notice={notice} />
      {result && (
        <>
          <div className={`banner ${failed === 0 ? "banner-ok" : "banner-danger"}`} role="status">
            {failed === 0
              ? `Alle ${result.results.length} Nachrichten sind gültig${result.mode === "simuliert" ? " (simuliert, ohne ERiC)" : ""}.`
              : `${failed} von ${result.results.length} Nachrichten bemängelt ERiC. Bitte die Meldungen als Issue melden.`}
          </div>
          <ul className="small stack" style={{ gap: 4, margin: 0, padding: 0, listStyle: "none" }}>
            {result.results.map((r) => (
              <li key={r.name}>
                <Icon name={r.ok ? "check" : "close"} size={14} />
                <span className="visually-hidden">{r.ok ? "gültig" : "bemängelt"}</span> {r.name} <span className="muted mono">{r.datenartVersion}</span>
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
