import { ASSET_KINDS, ASSET_METHODS, formatEuro } from "@haben/core";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { z } from "zod";
import { Icon } from "../../../components/Icon.tsx";
import { errorMessage, formatDate } from "../../../lib/format.ts";
import { bookDepreciationFn, getAssets } from "../../../server/functions/assets.ts";

export const Route = createFileRoute("/_app/anlagen/")({
  validateSearch: z.object({ jahr: z.number().int().min(2000).max(2100).optional() }),
  loaderDeps: ({ search }) => ({ year: search.jahr ?? new Date().getFullYear() }),
  loader: ({ deps }) => getAssets({ data: deps.year }),
  head: () => ({ meta: [{ title: "Anlagen · Haben" }] }),
  component: AssetsPage,
});

function AssetsPage() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const book = useServerFn(bookDepreciationFn);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const { year, assets } = data;

  // Jahre, in denen es Anlagen gibt, und das aktuelle
  const years = [
    ...new Set([new Date().getFullYear(), year, ...assets.flatMap((a) => a.schedule.map((r) => r.year)).filter((y) => y <= new Date().getFullYear() + 1)]),
  ].sort((a, b) => b - a);
  const shown = assets.filter((a) => a.year !== null || (a.closing !== null && a.closing > 0));
  const total = (pick: (a: (typeof assets)[number]) => number) => shown.reduce((s, a) => s + pick(a), 0);

  const onBook = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setNotice(null);
    book({ data: year })
      .then(async (result) => {
        setConfirming(false);
        await router.invalidate();
        setNotice({ tone: "ok", text: `AfA ${year} für ${result.booked} ${result.booked === 1 ? "Anlage" : "Anlagen"} gebucht.` });
      })
      .catch((error: unknown) => setNotice({ tone: "danger", text: errorMessage(error) }))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Anlagenverzeichnis</div>
          <h1>Anlagen {year}</h1>
        </div>
        <div className="actions">
          <Link to="/anlagen/neu" className="btn">
            Anlage übernehmen
          </Link>
          <button type="button" className="btn btn-primary" onClick={onBook} disabled={busy || !data.canBook || data.pending === 0}>
            {confirming ? "Jetzt buchen" : `AfA ${year} buchen`}
          </button>
        </div>
      </div>

      <nav className="filter-row" aria-label="Jahr wählen">
        {years.map((y) => (
          <Link key={y} to="/anlagen" activeProps={{}} search={{ jahr: y }} className={y === year ? "chip active" : "chip"} aria-current={y === year ? "page" : undefined}>
            {y}
          </Link>
        ))}
      </nav>

      {confirming && (
        <div className="banner" role="alert">
          <Icon name="alert" />
          <span>
            Die Abschreibungen und die private Kfz-Nutzung für {year} werden für {data.pending} {data.pending === 1 ? "Anlage" : "Anlagen"} gebucht und festgeschrieben;
            danach lassen sich Anschaffungskosten, Nutzungsdauer und Abgang in {year} nicht mehr ändern. Noch einmal klicken zum Buchen.
          </span>
        </div>
      )}
      {!data.canBook && data.pending > 0 && (
        <div className="banner banner-info" role="status">
          <Icon name="info" />
          <span>Die AfA für {year} lässt sich ab dem 1. Dezember buchen. In der EÜR ist sie schon enthalten.</span>
        </div>
      )}
      {notice && (
        <div className={`banner banner-${notice.tone}`} role={notice.tone === "danger" ? "alert" : "status"}>
          {notice.text}
        </div>
      )}

      <section className="card" aria-label="Anlagen">
        {shown.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Keine Anlagen in {year}. Neue Anschaffungen entstehen beim Buchen eines Belegs mit der Kategorie „Anlagegut“; Anlagen aus der
            bisherigen Buchhaltung übernimmst du mit <Link to="/anlagen/neu">Anlage übernehmen</Link>.
          </p>
        ) : (
          <div className="table">
            <div className="table-row head asset-cols">
              <div>Anlage</div>
              <div>Anschaffung</div>
              <div className="num">Buchwert 1.1.</div>
              <div className="num">Zugang</div>
              <div className="num">AfA</div>
              <div className="num">Abgang</div>
              <div className="num">Buchwert 31.12.</div>
            </div>
            {shown.map((asset) => (
              <Link key={asset.id} to="/anlagen/$id" params={{ id: asset.id }} className="table-row asset-cols">
                <div>
                  {asset.name}{" "}
                  {asset.bookedYears.includes(year) ? (
                    <span className="pill">gebucht</span>
                  ) : asset.year && (asset.year.depreciation || asset.year.disposal) ? (
                    <span className="pill">offen</span>
                  ) : null}
                  <div className="small muted">
                    {ASSET_KINDS[asset.kind].label} · {ASSET_METHODS[asset.method]}
                    {asset.privateUseYear && asset.privateUseYear.months.length > 0
                      ? ` · Privatnutzung ${formatEuro(asset.privateUseYear.withdrawal)}`
                      : ""}
                  </div>
                </div>
                <div className="small">
                  {formatDate(asset.acquisitionDate)}
                  <div className="muted">{formatEuro(asset.cost)}</div>
                </div>
                <div className="num">{formatEuro(asset.year?.opening ?? asset.closing ?? 0)}</div>
                <div className="num">{formatEuro(asset.year?.addition ?? 0)}</div>
                <div className="num">{formatEuro(asset.year?.depreciation ?? 0)}</div>
                <div className="num">{formatEuro(asset.year?.disposal ?? 0)}</div>
                <div className="num">{formatEuro(asset.year?.closing ?? asset.closing ?? 0)}</div>
              </Link>
            ))}
            <div className="table-row asset-cols" style={{ fontWeight: 600 }}>
              <div>Summe</div>
              <div />
              <div className="num">{formatEuro(total((a) => a.year?.opening ?? a.closing ?? 0))}</div>
              <div className="num">{formatEuro(total((a) => a.year?.addition ?? 0))}</div>
              <div className="num">{formatEuro(total((a) => a.year?.depreciation ?? 0))}</div>
              <div className="num">{formatEuro(total((a) => a.year?.disposal ?? 0))}</div>
              <div className="num">{formatEuro(total((a) => a.year?.closing ?? a.closing ?? 0))}</div>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
