import { BUNDESLAENDER, currentFilingPeriod, type Bundesland } from "@haben/core";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { authClient } from "../../lib/auth-client.ts";
import { errorMessage, formatDate } from "../../lib/format.ts";
import { removeCertificate, uploadCertificate } from "../../server/functions/certificate.ts";
import { getCompany, saveCompany } from "../../server/functions/company.ts";
import { getVatPeriod } from "../../server/functions/vat.ts";

export const Route = createFileRoute("/_app/einstellungen")({
  loader: async () => {
    const [company, vat] = await Promise.all([
      getCompany(),
      getVatPeriod({ data: currentFilingPeriod(new Date()) }),
    ]);
    return { ...company, certificate: vat.certificate, mode: vat.mode };
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
        <CompanyForm />
        <div className="stack">
          <CertificateForm />
          <Passkeys />
        </div>
      </div>
    </>
  );
}

function CompanyForm() {
  const { company, issues } = Route.useLoaderData();
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
          Versteuerung
          <select name="versteuerung" defaultValue={company.versteuerung}>
            <option value="ist">Ist (nach vereinnahmten Entgelten)</option>
            <option value="soll">Soll (nach vereinbarten Entgelten)</option>
          </select>
        </label>
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
            className="btn"
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
              className="btn"
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
