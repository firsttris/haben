import {
  BUNDESLAENDER,
  RECHTSFORM_KEYS,
  RECHTSFORMEN,
  baseRateError,
  currentFilingPeriod,
  dunningFeeError,
  formatDecimal,
  formatHundredths,
  formatRateMonth,
  isKapitalgesellschaft,
  parseBaseRate,
  parseEuro,
  type Bundesland,
  type Rechtsform,
} from "@haben/core";
import { redirect, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { BackupCard } from "../../components/BackupCard.tsx";
import { BereicheCard } from "../../components/BereicheCard.tsx";
import { BaseRateLookup } from "../../components/BaseRateLookup.tsx";
import { PrivatanteilVorgaben, privatanteilFehler, privatanteilTexte, privatanteilWerte } from "../../components/PrivatanteilVorgaben.tsx";
import { ArchiveSearchCard } from "../../components/ArchiveSearchCard.tsx";
import { ArchiveTargetCard } from "../../components/ArchiveTargetCard.tsx";
import { DatevCard } from "../../components/DatevCard.tsx";
import { EtsyPaymentsCard } from "../../components/EtsyPaymentsCard.tsx";
import { KontoabrufKarten } from "../../components/FintsCard.tsx";
import { StoreReportsCard } from "../../components/StoreReportsCard.tsx";
import { ExchangeRatesCard } from "../../components/ExchangeRatesCard.tsx";
import { ExportCard } from "../../components/ExportCard.tsx";
import { SettingsExportCard } from "../../components/SettingsExportCard.tsx";
import { SettingsImportCard } from "../../components/SettingsImportCard.tsx";
import { InboxCard } from "../../components/InboxCard.tsx";
import { IntegrityCard } from "../../components/IntegrityCard.tsx";
import { DatabaseAccessCard } from "../../components/DatabaseAccessCard.tsx";
import { LatestVersionCard } from "../../components/LatestVersionCard.tsx";
import { VersionsCard } from "../../components/VersionsCard.tsx";
import { ProcedureDocCard } from "../../components/ProcedureDocCard.tsx";
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
import { OwnAccountsCard } from "../../components/OwnAccountsCard.tsx";
import { McpCard } from "../../components/McpCard.tsx";
import { ExtractionCard } from "../../components/ExtractionCard.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { PasskeysCard } from "../../components/PasskeysCard.tsx";
import { PasswordCard } from "../../components/PasswordCard.tsx";
import { SsoZugaengeCard } from "../../components/SsoZugaengeCard.tsx";
import { ZugaengeCard } from "../../components/ZugaengeCard.tsx";
import { parseSkontoRows, SkontoFields, toSkontoRows } from "../../components/SkontoFields.tsx";
import { FORMAT_LABEL, FORMATS } from "../../lib/invoice.ts";
import { useAction } from "../../lib/use-action.ts";
import { emailFehler, useSubmitCheck } from "../../lib/use-submit-check.ts";
import { getBackupStatus } from "../../server/functions/backup.ts";
import { getEnableBankingSettings } from "../../server/functions/bank.ts";
import { getStoreConnections } from "../../server/functions/stores.ts";
import { getEtsySettings } from "../../server/functions/etsy.ts";
import { SETTINGS_AREAS, settingsAreas, type SettingsArea } from "../../lib/settings-areas.ts";
import { getCompany, getExchangeRates, saveCompany } from "../../server/functions/company.ts";
import reportStyles from "../../styles/auswertungen.css?url";
import { getEricStatus } from "../../server/functions/eric.ts";
import { getCustomPages } from "../../server/functions/eigene-seiten.ts";
import { getExportArea } from "../../server/functions/export.ts";
import { getNumbering } from "../../server/functions/invoices.ts";
import { getInbox } from "../../server/functions/inbox.ts";
import { getAppVersions, getChainHead, getDatabaseAccessInfo } from "../../server/functions/integrity.ts";
import { getBackground, getLetterheadDesign, getLogo } from "../../server/functions/logo.ts";
import { getMailSettings } from "../../server/functions/mail.ts";
import { getMcpSettings } from "../../server/functions/mcp.ts";
import { getZugaenge } from "../../server/functions/zugang.ts";
import { getExtractionSettings } from "../../server/functions/documents.ts";
import { getVatPeriod } from "../../server/functions/vat.ts";
import { NavMarkCard } from "../../components/NavMarkCard.tsx";
import { getOwnAccounts } from "../../server/functions/eigene-konten.ts";
import { SettingsHead, SettingsNav } from "../../components/SettingsNav.tsx";
import { FormattedTextarea } from "../../components/FormattedTextarea.tsx";
import { Field } from "../../components/Field.tsx";
import { UnitsCard } from "../../components/UnitsCard.tsx";
import { getUnits } from "../../server/functions/units.ts";
import { TaxpayerForm } from "./-einstellungen-steuerpflichtige.tsx";
import { CertificateForm, EricCard } from "./-einstellungen-elster.tsx";

/** Anbindungen unter Bank: Kontoabruf über Enable Banking, Finanzberichte der Stores und Etsy Payments */
async function loadBankConnections() {
  const [enableBanking, stores, etsy] = await Promise.all([getEnableBankingSettings(), getStoreConnections(), getEtsySettings()]);
  return { enableBanking, stores, etsy };
}

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
      exportArea,
      chainHead,
      appVersions,
      databaseAccess,
      backup,
      mcp,
      rates,
      bankConnections,
      customPages,
      zugaenge,
      extraction,
      quoteDefaultAttachments,
      ownAccounts,
      units,
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
      getExportArea(),
      getChainHead(),
      getAppVersions(),
      getDatabaseAccessInfo(),
      getBackupStatus(),
      getMcpSettings(),
      getExchangeRates(),
      loadBankConnections(),
      getCustomPages(),
      getZugaenge(),
      getExtractionSettings(),
      getQuoteDefaultAttachments(),
      getOwnAccounts(),
      getUnits(),
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
      ...exportArea,
      chainHead,
      appVersions,
      databaseAccess,
      backup,
      mcp,
      rates,
      ...bankConnections,
      customPages,
      zugaenge,
      extraction,
      quoteDefaultAttachments,
      ownAccounts,
      units,
    };
  },
  head: () => ({ meta: [{ title: "Einstellungen · Haben" }], links: [{ rel: "stylesheet", href: reportStyles }] }),
  validateSearch: (search: Record<string, unknown>): { bereich?: SettingsArea } =>
    search.bereich === "zugaenge" || SETTINGS_AREAS.some((a) => a.id === search.bereich) ? { bereich: search.bereich as SettingsArea } : {},
  component: SettingsPage,
});

function SettingsPage() {
  const { oidc, ausgeblendet } = Route.useRouteContext();
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
    appVersions,
    databaseAccess,
    backup,
    mcp,
    rates,
    enableBanking,
    stores,
    etsy,
    customPages,
    zugaenge,
    extraction,
    quoteDefaultAttachments,
    ownAccounts,
    units,
    ablage,
    neueInstanz,
  } = Route.useLoaderData();
  const search = Route.useSearch();
  const bereich = search.bereich ?? "firma";
  // Ohne ?bereich zeigt das Handy nur die Liste der Bereiche, der Desktop daneben die Firma
  const uebersicht = search.bereich === undefined;
  // Eine GmbH oder UG zahlt keine Einkommensteuer; die persönlichen Angaben braucht ELSTER dort für Nachrichten und Postfach
  const areas = settingsAreas(oidc.only).map((a) =>
    a.id === "persoenlich" && isKapitalgesellschaft(company.rechtsform) ? { ...a, hint: "Für Nachrichten an das Finanzamt" } : a,
  );
  const area = areas.find((a) => a.id === bereich)!;
  return (
    <>
      <SettingsHead area={area} uebersicht={uebersicht} />
      <div className="settings-layout" data-uebersicht={uebersicht || undefined}>
        <SettingsNav areas={areas} current={bereich} uebersicht={uebersicht} />
        <div className="stack settings-content" aria-label={area.label}>
          {bereich === "firma" && (
            <>
              <CompanyForm />
              <NavMarkCard color={company.navColor} logo={company.navLogo} logoSha256={logo?.sha256 ?? null} />
            </>
          )}
          {bereich === "persoenlich" && <TaxpayerForm />}
          {bereich === "bereiche" && <BereicheCard ausgeblendet={ausgeblendet} />}
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
              <UnitsCard units={units} />
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
              <KontoabrufKarten data={enableBanking} />
              <StoreReportsCard connections={stores.connections} contacts={stores.contacts} />
              <EtsyPaymentsCard data={etsy} />
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
          {bereich === "konten" && <OwnAccountsCard overview={ownAccounts} />}
          {bereich === "seiten" && <EigeneSeitenCard pages={customPages} />}
          {bereich === "waehrung" && <ExchangeRatesCard data={rates} />}
          {bereich === "export" && (
            <>
              <SettingsImportCard neueInstanz={neueInstanz} />
              <ExportCard years={exportYears} />
              <SettingsExportCard />
              <DatevCard years={exportYears} numbers={datev} />
              <ArchiveTargetCard data={ablage} />
              <IntegrityCard head={chainHead} />
              <LatestVersionCard />
              <VersionsCard versions={appVersions} />
              <DatabaseAccessCard access={databaseAccess} />
              <BackupCard status={backup} />
              <ProcedureDocCard />
              <ArchiveSearchCard enabled={company.archiveSearch} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** Fehler der Felder im Abschnitt Mahnwesen, für useSubmitCheck */
const dunningErrors = (baseRate: string, fees: Record<"1" | "2" | "3", string>) => ({
  "dunning-baseRate": baseRateError(baseRate),
  "dunning-fee-1": dunningFeeError(fees["1"]),
  "dunning-fee-2": dunningFeeError(fees["2"]),
  "dunning-fee-3": dunningFeeError(fees["3"]),
});

/**
 * Klartext unter den Feldern Versteuerung und Kontenrahmen; ist das Feld gesperrt, folgt der genaue Grund aus settings-guard.ts.
 * Quelle: Ist-Versteuerung gestattet das Finanzamt auf Antrag (§ 20 UStG, docs/einrichtung.md: Versteuerung).
 */
const VERSTEUERUNG_HINT = "Ist: Die Umsatzsteuer zählt, wenn der Kunde zahlt. Soll: schon mit der Rechnung. Ist gestattet das Finanzamt auf Antrag.";
const KONTENRAHMEN_HINT =
  "Legt fest, auf welche Kontonummern Haben bucht (SKR03 oder SKR04). Nimm denselben wie bisher in Lexoffice oder bei deiner Steuerberatung.";

function CompanyForm() {
  const { company, issues, letterIssues, locks } = Route.useLoaderData();
  const router = useRouter();
  const save = useServerFn(saveCompany);
  const { busy, notice, run } = useAction();
  // Steuert, was nur ein Einzelunternehmen hat: Einkunftsart der EÜR und Privatanteile
  const [rechtsform, setRechtsform] = useState<Rechtsform>(company.rechtsform);
  const gesellschaft = isKapitalgesellschaft(rechtsform);
  const [skontoRows, setSkontoRows] = useState(() => toSkontoRows(company.skonto));
  const [baseRate, setBaseRate] = useState(company.dunning.baseRate === null ? "" : formatHundredths(company.dunning.baseRate));
  const fee = (level: "1" | "2" | "3") => (company.dunning.fees[level] ? formatDecimal(company.dunning.fees[level]) : "");
  const [fees, setFees] = useState({ "1": fee("1"), "2": fee("2"), "3": fee("3") });
  const [email, setEmail] = useState(company.email);
  const [privatanteile, setPrivatanteile] = useState(() => privatanteilTexte(company.privateShares));
  const {
    form: checkScope,
    error,
    check,
  } = useSubmitCheck({
    email: emailFehler(email),
    ...dunningErrors(baseRate, fees),
    ...privatanteilFehler(privatanteile, gesellschaft),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!check()) return;
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
          foundedOn: text("foundedOn") || null,
          ohneVorsteuerabzug: form.get("ohneVorsteuerabzug") === "on",
          tageskurs: form.get("tageskurs") === "on",
          einkunftsart: text("einkunftsart") === "gewerbe" ? "gewerbe" : text("einkunftsart") === "selbstaendig" ? "selbstaendig" : null,
          taetigkeit: text("taetigkeit"),
          dunning: {
            // Geprüft mit baseRateError; leer heißt keine Verzugszinsen
            baseRate: text("dunning-baseRate").trim() ? parseBaseRate(text("dunning-baseRate")) : null,
            fees: {
              "1": parseEuro(fees["1"] || "0") ?? 0,
              "2": parseEuro(fees["2"] || "0") ?? 0,
              "3": parseEuro(fees["3"] || "0") ?? 0,
            },
            deadlineDays: Number(text("dunning-deadlineDays") || 10),
            autoBaseRate: form.get("dunning-autoBaseRate") === "on",
          },
          privateShares: privatanteilWerte(privatanteile, gesellschaft),
        },
      });
      await router.invalidate();
    }, "Firmendaten gespeichert.");
  }

  return (
    <form ref={checkScope} className="card form-card" onSubmit={onSubmit} aria-labelledby="company-heading" noValidate>
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
          <Field label="E-Mail" error={error("email")}>
            {(control) => <input {...control} name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}
          </Field>
          <Field label="Telefon (Pflicht für XRechnung)">
            {(control) => <input {...control} name="telefon" type="tel" defaultValue={company.telefon} autoComplete="tel" />}
          </Field>
        </div>
        <Field label="Gründungsdatum" hint="Datum, an dem du deine unternehmerische Tätigkeit aufgenommen hast.">
          {(control) => <input {...control} name="foundedOn" type="date" min="0001-01-01" defaultValue={company.foundedOn ?? ""} />}
        </Field>
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
          <Field label="Versteuerung" hint={locks.versteuerung ? `${VERSTEUERUNG_HINT} ${locks.versteuerung}` : VERSTEUERUNG_HINT}>
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
          <Field label="Kontenrahmen" hint={locks.kontenrahmen ? `${KONTENRAHMEN_HINT} ${locks.kontenrahmen}` : KONTENRAHMEN_HINT}>
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

      {!gesellschaft && <PrivatanteilVorgaben texte={privatanteile} onChange={setPrivatanteile} error={error} />}

      <section className="form-section" aria-labelledby="company-dunning">
        <h3 id="company-dunning">Mahnwesen</h3>
        <div className="form-row cols-2">
          <Field label="Basiszinssatz in %" describedBy="base-rate-hint" error={error("dunning-baseRate")}>
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
          <Field label="Gebühr Zahlungserinnerung (€)" error={error("dunning-fee-1")}>
            {(control) => (
              <input
                {...control}
                name="dunning-fee-1"
                inputMode="decimal"
                value={fees["1"]}
                onChange={(e) => setFees((current) => ({ ...current, "1": e.target.value }))}
                placeholder="0,00"
              />
            )}
          </Field>
          <Field label="Gebühr 1. Mahnung (€)" error={error("dunning-fee-2")}>
            {(control) => (
              <input
                {...control}
                name="dunning-fee-2"
                inputMode="decimal"
                value={fees["2"]}
                onChange={(e) => setFees((current) => ({ ...current, "2": e.target.value }))}
                placeholder="0,00"
              />
            )}
          </Field>
          <Field label="Gebühr letzte Mahnung (€)" error={error("dunning-fee-3")}>
            {(control) => (
              <input
                {...control}
                name="dunning-fee-3"
                inputMode="decimal"
                value={fees["3"]}
                onChange={(e) => setFees((current) => ({ ...current, "3": e.target.value }))}
                placeholder="0,00"
              />
            )}
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
