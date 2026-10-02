import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AssetForm } from "../../../components/AssetForm.tsx";
import { errorMessage } from "../../../lib/format.ts";
import { createAssetFn } from "../../../server/functions/assets.ts";

export const Route = createFileRoute("/_app/anlagen/neu")({
  head: () => ({ meta: [{ title: "Anlage übernehmen · Haben" }] }),
  component: NewAssetPage,
});

function NewAssetPage() {
  const navigate = useNavigate();
  const create = useServerFn(createAssetFn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const year = new Date().getFullYear();

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/anlagen">Anlagen</Link> › Übernahme
          </div>
          <h1>Anlage übernehmen</h1>
        </div>
      </div>
      <div className="grid-main">
        <section className="card" aria-label="Anlage">
          <AssetForm
            initial={{
              name: "",
              kind: "kfz",
              method: "linear",
              acquisitionDate: "",
              cost: 0,
              usefulLifeMonths: 72,
              openingDate: `${year}-01-01`,
              openingBookValue: 0,
              disposalDate: null,
              privateUse: null,
              note: "",
            }}
            locked={false}
            privateUseLocked={false}
            lifeEditable
            showOpening
            submitLabel="Anlage übernehmen"
            busy={busy}
            onSubmit={(values) => {
              setBusy(true);
              setError(null);
              create({ data: values })
                .then((result) => navigate({ to: "/anlagen/$id", params: { id: result.id } }))
                .catch((e: unknown) => setError(errorMessage(e)))
                .finally(() => setBusy(false));
            }}
          />
          {error && (
            <div className="banner banner-danger" role="alert">
              {error}
            </div>
          )}
        </section>
        <aside className="card stack" aria-label="Hinweise">
          <h2>Aus Lexoffice übernehmen</h2>
          <p className="small" style={{ margin: 0 }}>
            Die Lexoffice-Schnittstelle liefert kein Anlagenverzeichnis. Öffne in Lexoffice das Anlagenverzeichnis
            und übertrage je Anlage Bezeichnung, Anschaffungsdatum, Anschaffungskosten, Nutzungsdauer und den Buchwert zum 31.12. des
            letzten Jahres, das Lexoffice abgeschlossen hat. Als Stichtag nimmst du den 01.01. des Folgejahres.
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            Neue Anschaffungen legst du nicht hier an: Buche den Beleg mit der Kategorie „Anlagegut“, dann entsteht die Anlage mit dem
            Beleg. Geringwertige Wirtschaftsgüter aus Vorjahren sind schon voll abgeschrieben und müssen nicht übernommen werden.
          </p>
        </aside>
      </div>
    </>
  );
}
