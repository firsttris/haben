import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Icon } from "../../components/Icon.tsx";
import { EricHinweis } from "../../components/EricHinweis.tsx";
import { getFinanzamt } from "../../server/functions/finanzamt.ts";
import { today } from "../../server/today.ts";
import styles from "../../styles/auswertungen.css?url";
import { type Topic, vorauszahlungHinweis } from "./-finanzamt-daten.ts";
import { History, Postfach } from "./-finanzamt-postfach.tsx";
import { BankChangeForm, MessageForm } from "./-finanzamt-nachrichten.tsx";
import { PrepaymentForm } from "./-finanzamt-vorauszahlung.tsx";

export const Route = createFileRoute("/_app/finanzamt")({
  // Datum in Deutschland, nicht UTC; kommt beim ersten Aufruf mit den Loader-Daten vom Server
  loader: async () => ({ ...(await getFinanzamt()), today: today() }),
  head: () => ({ meta: [{ title: "Finanzamt · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: FinanzamtPage,
});

type Tab = Topic | "bankverbindung";
const TAB_LABEL = { vorauszahlung: "Vorauszahlungen herabsetzen", nachricht: "Freie Nachricht", bankverbindung: "Bankverbindung ändern" } as const;
function FinanzamtPage() {
  const data = Route.useLoaderData();
  const basis = data.basis;
  const tabs = basis ? (["vorauszahlung", "nachricht", "bankverbindung"] as const) : (["nachricht", "bankverbindung"] as const);
  const [tab, setTab] = useState<Tab>(tabs[0]);
  const hinweis = vorauszahlungHinweis(data.keineVorauszahlungen);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Über ELSTER</div>
          <h1>Finanzamt</h1>
        </div>
      </div>

      {data.mode === "simuliert" && <EricHinweis />}
      {data.issues.length > 0 && (
        <div className="banner" role="status">
          <Icon name="alert" />
          <span>
            Firmendaten unvollständig: {data.issues.join(", ")}.{" "}
            <Link to="/einstellungen" search={{ bereich: "firma" }}>
              In den Einstellungen ergänzen
            </Link>
          </span>
        </div>
      )}

      <Postfach data={data} />

      <h2 style={{ margin: "24px 0 12px" }}>An das Finanzamt schreiben</h2>
      <div role="group" aria-label="Art der Nachricht" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {tabs.map((t) => (
          <button key={t} type="button" className={`chip${tab === t ? " active" : ""}`} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>

      {tab === "vorauszahlung" && basis && (
        <>
          {hinweis && (
            <div className="banner" role="status">
              <Icon name="alert" />
              <span>{hinweis}</span>
            </div>
          )}
          <PrepaymentForm key="v" data={data} basis={basis} />
        </>
      )}
      {tab === "nachricht" && <MessageForm key="n" data={data} topic="nachricht" initial={{ betreff: "", text: "" }} />}
      {tab === "bankverbindung" && <BankChangeForm data={data} />}

      <History data={data} />
    </>
  );
}
