import { ASSET_KIND_KEYS, ASSET_KINDS, type AssetKind, formatEuro } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useState } from "react";
import { errorMessage, formatDate } from "../../lib/format.ts";
import { getSevdeskAssets, takeOverSevdeskAssetList } from "../../server/functions/sevdesk-anlagen.ts";
import { Field } from "../Field.tsx";
import { ScrollBox } from "../ScrollTable.tsx";
import { Status, type StatusProps } from "../Status.tsx";

type Preview = Awaited<ReturnType<typeof getSevdeskAssets>>;
type Row = Preview["rows"][number];

const LOOK: Record<Row["status"], { text: string } & Pick<StatusProps, "tone" | "emphasis">> = {
  neu: { text: "Vorschlag", tone: "info", emphasis: "notice" },
  vorhanden: { text: "Übernommen", tone: "ok" },
  erledigt: { text: "Nicht nötig", tone: "neutral" },
  ausgeschlossen: { text: "Von Hand", tone: "warn", emphasis: "notice" },
};

/**
 * Anlagenverzeichnis aus sevDesk (docs/sevdesk.md): Vorschlag zum 01.01. mit Restbuchwert, den Haben linear nachrechnet,
 * weil sevDesk keine bisherige AfA liefert. Übernommen wird nur, was angehakt ist; ohne Art aus sevDesk wählt man sie hier.
 */
export function SevdeskAssets({ bookingDate }: { bookingDate: string }) {
  const load = useServerFn(getSevdeskAssets);
  const takeOver = useServerFn(takeOverSevdeskAssetList);
  const [stichtag, setStichtag] = useState(`${bookingDate.slice(0, 4)}-01-01`);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<Map<string, AssetKind | null>>(new Map());
  const [busy, setBusy] = useState<"abrufen" | "uebernehmen" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  async function fetchPreview(event?: FormEvent) {
    event?.preventDefault();
    setBusy("abrufen");
    setMessage(null);
    try {
      const next = await load({ data: { stichtag } });
      setPreview(next);
      // Vorgewählt ist, was eine Art hat; ohne Art wählt man sie selbst
      setPicked(new Map(next.rows.filter((r) => r.status === "neu" && r.kind).map((r) => [r.sevId, r.kind])));
      return next;
    } catch (e) {
      setMessage({ tone: "danger", text: errorMessage(e) });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    const missing = preview?.rows.find((r) => picked.has(r.sevId) && !picked.get(r.sevId));
    if (missing) {
      setMessage({ tone: "danger", text: `${missing.name} (Nr. ${missing.nummer}): Art wählen.` });
      return;
    }
    setBusy("uebernehmen");
    setMessage(null);
    try {
      const { created } = await takeOver({ data: { stichtag, picks: [...picked].map(([sevId, kind]) => ({ sevId, kind })) } });
      await fetchPreview();
      setMessage({ tone: "ok", text: `${created === 1 ? "Eine Anlage" : `${created} Anlagen`} übernommen.` });
    } catch (e) {
      setMessage({ tone: "danger", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  // Die Restbuchwerte gelten nur für den Stichtag, zu dem sie abgerufen sind: ein anderer verlangt einen neuen Abruf
  function changeStichtag(value: string) {
    setStichtag(value);
    setPreview(null);
    setPicked(new Map());
    setMessage(null);
  }

  const toggle = (row: Row, on: boolean) =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (on) next.set(row.sevId, row.kind);
      else next.delete(row.sevId);
      return next;
    });
  const choose = (row: Row, kind: AssetKind | null) =>
    setPicked((prev) => {
      const next = new Map(prev);
      next.set(row.sevId, kind);
      return next;
    });

  return (
    <section className="card stack" aria-labelledby="assets-heading">
      <div className="step-head">
        <span className="step-num">4</span>
        <h2 id="assets-heading" style={{ margin: 0 }}>
          Anlagen übernehmen
        </h2>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Haben liest das Anlagenverzeichnis aus sevDesk und schlägt jede Anlage mit Restbuchwert zum Stichtag vor. sevDesk liefert keine bisherige AfA; Haben
        rechnet sie linear und monatsgenau aus Anschaffung, Kaufpreis und Nutzungsdauer nach. Vergleiche die Restbuchwerte mit dem Anlagenverzeichnis in
        sevDesk. Gebucht wird erst mit der AfA des Jahres.
      </p>
      <form onSubmit={fetchPreview} style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
        <Field label="Übernahmestichtag" hint="Ein 1. Januar, in der Regel der erste Tag in Haben">
          {(control) => <input {...control} type="date" value={stichtag} onChange={(e) => changeStichtag(e.target.value)} required disabled={busy !== null} />}
        </Field>
        <button type="submit" className="btn" disabled={busy !== null}>
          {busy === "abrufen" ? "Rufe ab …" : "Anlagen abrufen"}
        </button>
      </form>
      {preview?.problem && (
        <p className="banner banner-danger" role="alert" style={{ margin: 0 }}>
          {preview.problem}
        </p>
      )}
      {preview && preview.rows.length === 0 && (
        <p className="small" style={{ margin: 0 }}>
          Keine Anlagen in sevDesk.
        </p>
      )}
      {preview && preview.rows.length > 0 && <AssetTable rows={preview.rows} picked={picked} busy={busy !== null} toggle={toggle} choose={choose} />}
      {message && (
        <p className={`banner banner-${message.tone}`} role={message.tone === "danger" ? "alert" : "status"} style={{ margin: 0 }}>
          {message.text}
          {message.tone === "ok" && (
            <>
              {" "}
              <Link to="/anlagen">Zum Anlagenverzeichnis</Link>
            </>
          )}
        </p>
      )}
      {preview?.rows.some((r) => r.status === "neu") && !preview.problem && (
        <div className="actions">
          <span className="small muted">{picked.size} ausgewählt</span>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy !== null || picked.size === 0}>
            {busy === "uebernehmen" ? "Übernehme …" : picked.size === 1 ? "Eine Anlage übernehmen" : `${picked.size} Anlagen übernehmen`}
          </button>
        </div>
      )}
    </section>
  );
}

function AssetTable({
  rows,
  picked,
  busy,
  toggle,
  choose,
}: {
  rows: Row[];
  picked: ReadonlyMap<string, AssetKind | null>;
  busy: boolean;
  toggle: (row: Row, on: boolean) => void;
  choose: (row: Row, kind: AssetKind | null) => void;
}) {
  return (
    <ScrollBox label="Anlagen aus sevDesk">
      <table className="data-table" aria-label="Anlagen aus sevDesk">
        <thead>
          <tr>
            <th>
              <span className="visually-hidden">Übernehmen</span>
            </th>
            <th>Anlage</th>
            <th>Angeschafft</th>
            <th className="num">Kosten</th>
            <th className="num">Restbuchwert</th>
            <th>Art in Haben</th>
            <th>Stand</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const look = LOOK[row.status];
            const open = row.status === "neu";
            const kind = picked.get(row.sevId) ?? row.kind;
            return (
              <tr key={row.sevId}>
                <td>
                  {open && (
                    <input
                      type="checkbox"
                      aria-label={`${row.name} übernehmen`}
                      checked={picked.has(row.sevId)}
                      onChange={(e) => toggle(row, e.target.checked)}
                      disabled={busy}
                    />
                  )}
                </td>
                <td>
                  {row.name}
                  <div className="small muted">
                    Nr. {row.nummer}
                    {row.kategorie ? `, ${row.kategorie}` : ""}
                    {row.usefulLifeMonths ? `, ${row.usefulLifeMonths / 12} Jahre` : ""}
                  </div>
                  {open &&
                    row.hinweise.map((h) => (
                      <div key={h} className="small muted">
                        {h}
                      </div>
                    ))}
                </td>
                <td>{row.acquisitionDate ? formatDate(row.acquisitionDate) : "–"}</td>
                <td className="num">{formatEuro(row.cost)}</td>
                <td className="num">{row.openingBookValue === null ? "–" : formatEuro(row.openingBookValue)}</td>
                <td>
                  {open ? (
                    <Field label={`Art von ${row.name}`} hideLabel>
                      {(control) => (
                        <select
                          {...control}
                          style={{ width: 200 }}
                          value={kind ?? ""}
                          onChange={(e) => choose(row, (e.target.value || null) as AssetKind | null)}
                          disabled={busy}
                        >
                          <option value="">Art wählen …</option>
                          {ASSET_KIND_KEYS.map((k) => (
                            <option key={k} value={k}>
                              {ASSET_KINDS[k].label}
                            </option>
                          ))}
                        </select>
                      )}
                    </Field>
                  ) : (
                    "–"
                  )}
                </td>
                <td>
                  <Status
                    tone={look.tone}
                    emphasis={look.emphasis}
                    detail={open ? (row.account && kind === row.kind ? `Konto ${row.account}` : null) : row.grund}
                  >
                    {look.text}
                  </Status>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollBox>
  );
}
