import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { AssetForm } from "../../../components/AssetForm.tsx";
import { createAssetFn } from "../../../server/functions/assets.ts";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { useAction } from "../../../lib/use-action.ts";

export const Route = createFileRoute("/_app/anlagen/neu")({
  head: () => ({ meta: [{ title: "Anlage übernehmen · Haben" }] }),
  component: NewAssetPage,
});

function NewAssetPage() {
  const navigate = useNavigate();
  const create = useServerFn(createAssetFn);
  const { busy, notice, run } = useAction();
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
            onSubmit={(values) =>
              void run(async () => {
                const result = await create({ data: values });
                await navigate({ to: "/anlagen/$id", params: { id: result.id } });
              })
            }
          />
          <NoticeBanner notice={notice} />
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
