import { ASSET_KINDS, ASSET_METHODS, formatDecimal, formatDegressiveRate, elektroAvailable, isKapitalgesellschaft } from "@haben/core";
import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { AssetForm } from "../../../components/AssetForm.tsx";
import { formatDate } from "../../../lib/format.ts";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { useAction } from "../../../lib/use-action.ts";
import { deleteAssetFn, getAssetDetail, updateAssetFn } from "../../../server/functions/assets.ts";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";

export const Route = createFileRoute("/_app/anlagen/$id")({
  loader: ({ params }) => getAssetDetail({ data: params.id }),
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.asset.name ?? "Anlage"} · Haben` }] }),
  component: AssetPage,
});

function AssetPage() {
  const { asset, schedule, bookedYears } = Route.useLoaderData();
  const { rechtsform } = Route.useRouteContext();
  const router = useRouter();
  const navigate = useNavigate();
  const update = useServerFn(updateAssetFn);
  const remove = useServerFn(deleteAssetFn);
  const { busy, notice, run } = useAction();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const booked = bookedYears.length > 0 || asset.openingEntryId !== null;
  const fromDocument = asset.documentId !== null;
  const deletable = !booked && !fromDocument;
  const lastBooked = bookedYears.at(-1) ?? null;
  // § 7 Abs. 3 EStG: Wechsel zur linearen AfA, solange er noch nicht gebucht ist
  const switchEditable = asset.method === "degressiv" && (lastBooked === null || asset.linearFromYear === null || asset.linearFromYear > lastBooked);

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
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => setConfirmingDelete(true)}>
              Löschen
            </button>
            <ConfirmDialog
              open={confirmingDelete}
              title={`${asset.name} löschen?`}
              confirmLabel="Anlage löschen"
              danger
              onConfirm={() =>
                run(async () => {
                  await remove({ data: asset.id });
                  await navigate({ to: "/anlagen" });
                })
              }
              onClose={() => setConfirmingDelete(false)}
            >
              <p>Die Anlage wird endgültig entfernt. Das lässt sich nicht rückgängig machen.</p>
            </ConfirmDialog>
          </div>
        )}
      </div>
      <NoticeBanner notice={notice} />

      <div className="grid-main">
        <section className="card stack" aria-labelledby="plan-heading">
          <h2 id="plan-heading">Abschreibungsplan</h2>
          <p className="small muted" style={{ margin: 0 }}>
            {ASSET_METHODS[asset.method]}
            {asset.usefulLifeMonths ? `, ${asset.usefulLifeMonths / 12} Jahre` : ""}
            {asset.degressiveRate ? `, ${formatDegressiveRate(asset.degressiveRate)}` : ""}
            {asset.linearFromYear ? `, linear ab ${asset.linearFromYear}` : ""}
            {asset.memoValue ? ", Erinnerungswert 1 €" : ""} · Konto {asset.account} ·{" "}
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
                ? "Es ist schon gebucht; änderbar sind nur Bezeichnung, Notiz, ein Abgang und bei degressiver AfA der Wechsel zur linearen, beide in einem noch nicht gebuchten Jahr."
                : "Art, Datum und Kosten kommen aus dem gebuchten Beleg; bis zur ersten AfA lassen sich Abschreibung und Nutzungsdauer ändern."}
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
              degressiveRate: asset.degressiveRate,
              linearFromYear: asset.linearFromYear,
              memoValue: asset.memoValue,
              openingDate: asset.openingDate ?? "",
              openingBookValue: asset.openingBookValue ?? 0,
              disposalDate: asset.disposalDate,
              privateUse: asset.privateUse,
              note: asset.note,
            }}
            locked={booked || fromDocument}
            privateUseAvailable={!isKapitalgesellschaft(rechtsform)}
            elektroOffered={elektroAvailable(rechtsform)}
            privateUseLocked={booked}
            lifeEditable={!booked}
            switchEditable={switchEditable}
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
