import { ASSET_KINDS, ASSET_METHODS, formatDecimal } from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AssetForm } from "../../../components/AssetForm.tsx";
import { errorMessage, formatDate } from "../../../lib/format.ts";
import { deleteAssetFn, getAssetDetail, updateAssetFn } from "../../../server/functions/assets.ts";

export const Route = createFileRoute("/_app/anlagen/$id")({
  loader: ({ params }) => getAssetDetail({ data: params.id }),
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.asset.name ?? "Anlage"} · Haben` }] }),
  component: AssetPage,
});

function AssetPage() {
  const { asset, schedule, bookedYears } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  const update = useServerFn(updateAssetFn);
  const remove = useServerFn(deleteAssetFn);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  const booked = bookedYears.length > 0 || asset.openingEntryId !== null;
  const fromDocument = asset.documentId !== null;
  const deletable = !booked && !fromDocument;

  function run(work: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setNotice(null);
    work()
      .then(() => success && setNotice({ tone: "ok", text: success }))
      .catch((error: unknown) => setNotice({ tone: "danger", text: errorMessage(error) }))
      .finally(() => setBusy(false));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/anlagen">Anlagen</Link> › {ASSET_KINDS[asset.kind].label}
          </div>
          <h1>{asset.name}</h1>
        </div>
        {deletable && (
          <div className="actions">
            <button
              type="button"
              className="btn btn-dashed"
              disabled={busy}
              onClick={() => {
                if (!confirmingDelete) return setConfirmingDelete(true);
                run(async () => {
                  await remove({ data: asset.id });
                  await navigate({ to: "/anlagen" });
                });
              }}
            >
              {confirmingDelete ? "Endgültig löschen" : "Löschen"}
            </button>
          </div>
        )}
      </div>
      {notice && (
        <div className={`banner banner-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"}>
          {notice.text}
        </div>
      )}

      <div className="grid-main">
        <section className="card stack" aria-labelledby="plan-heading">
          <h2 id="plan-heading">Abschreibungsplan</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {ASSET_METHODS[asset.method]}
            {asset.usefulLifeMonths ? `, ${asset.usefulLifeMonths / 12} Jahre` : ""} · Konto {asset.account} ·{" "}
            {fromDocument ? (
              <Link to="/belege/$id" params={{ id: asset.documentId! }}>
                Anschaffungsbeleg
              </Link>
            ) : (
              `übernommen zum ${formatDate(asset.openingDate!)}`
            )}
          </p>
          <div className="table">
            <div className="table-row head plan-cols">
              <div>Jahr (€)</div>
              <div className="num">Buchwert Anfang</div>
              <div className="num">Zugang</div>
              <div className="num">AfA</div>
              <div className="num">Abgang</div>
              <div className="num">Buchwert Ende</div>
              <div />
            </div>
            {schedule.map((row) => (
              <div key={row.year} className="table-row plan-cols">
                <div className="mono">{row.year}</div>
                <div className="num">{formatDecimal(row.opening)}</div>
                <div className="num">{formatDecimal(row.addition)}</div>
                <div className="num">{formatDecimal(row.depreciation)}</div>
                <div className="num">{formatDecimal(row.disposal)}</div>
                <div className="num">{formatDecimal(row.closing)}</div>
                <div>{bookedYears.includes(row.year) ? <span className="pill">gebucht</span> : null}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card stack" aria-labelledby="edit-heading">
          <h2 id="edit-heading">Angaben</h2>
          {(booked || fromDocument) && (
            <p className="small muted" style={{ margin: 0 }}>
              {booked
                ? "Es ist schon gebucht; änderbar sind nur Bezeichnung, Notiz und ein Abgang in einem noch nicht gebuchten Jahr."
                : "Art, Abschreibung, Datum und Kosten kommen aus dem gebuchten Beleg; bis zur ersten AfA lässt sich die Nutzungsdauer ändern."}
            </p>
          )}
          <AssetForm
            key={String(asset.updatedAt)}
            initial={{
              name: asset.name,
              kind: asset.kind,
              method: asset.method,
              acquisitionDate: asset.acquisitionDate,
              cost: asset.cost,
              usefulLifeMonths: asset.usefulLifeMonths,
              openingDate: asset.openingDate ?? "",
              openingBookValue: asset.openingBookValue ?? 0,
              disposalDate: asset.disposalDate,
              note: asset.note,
            }}
            locked={booked || fromDocument}
            lifeEditable={!booked}
            showOpening={!fromDocument}
            submitLabel="Speichern"
            busy={busy}
            onSubmit={(values) =>
              run(async () => {
                const { openingDate, openingBookValue, ...rest } = values;
                await update({
                  data: { id: asset.id, asset: fromDocument ? rest : { ...rest, openingDate, openingBookValue } },
                });
                await router.invalidate();
              }, "Gespeichert.")
            }
          />
        </section>
      </div>
    </>
  );
}
