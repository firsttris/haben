import { amountError, formatDecimal, parseEuro, type DirectBooking } from "@haben/core";
import { useState } from "react";
import { BEZUGSJAHR_FEHLER, SteuerFelder, steuerangabe, steuerWahlFuer, type SteuerOptionen, type SteuerWahl } from "../../components/SteuerFelder.tsx";
import { DarlehenFelder, darlehenWahlFuer, type DarlehenOptionen, type DarlehenWahl } from "../../components/DarlehenFelder.tsx";
import { KategorieFelder, kategorieWahlFuer, type KategorieOptionen, type KategorieWahl } from "../../components/KategorieFelder.tsx";
import { useSubmitCheck } from "../../lib/use-submit-check.ts";
import { Field } from "../../components/Field.tsx";
import { DARLEHEN_OPTION, type Data, type Detail, KATEGORIE_OPTION, STEUER_OPTION, itemLabel, itemTarget } from "./-bank-daten.ts";

export type SplitTarget = Detail["splitCandidates"][number];

export type SplitPart =
  | { kind: "invoice"; invoiceId: string; amount: number }
  | { kind: "document"; documentId: string; amount: number }
  | { kind: "ustva"; vatReturnId: string; amount: number }
  | { kind: "steuer"; amount: number; steuer: NonNullable<ReturnType<typeof steuerangabe>> }
  | { kind: "darlehen"; amount: number; darlehen: DarlehenWahl }
  | { kind: "kategorie"; amount: number; kategorie: KategorieWahl }
  | { kind: DirectBooking; amount: number };

export interface SplitRow {
  key: number;
  /** "invoice:<id>", "document:<id>", eine Buchungsart ohne Beleg oder "steuer" */
  target: string;
  amount: string;
  /** Nur bei "steuer": Steuerart, Bezugsjahr und Teil */
  steuer: SteuerWahl;
  /** Nur bei "darlehen": Darlehen und Teil der Rate */
  darlehen: DarlehenWahl;
  /** Nur bei "kategorie": Kategorie und Steuersatz */
  kategorie: KategorieWahl;
}

export let nextSplitKey = 1;

export const signed = (cents: number) => `${cents < 0 ? "-" : ""}${formatDecimal(Math.abs(cents))}`;

/**
 * Startzeilen: der gewählte Posten und der Rest, sonst der ganze offene Betrag und eine leere zweite Zeile. Mit
 * Gegenposten (Korrektur der Rechnung, #1398) geht der Rest an ihn statt an die Bankgebühren.
 */
function startZeilen(
  tx: Detail["transaction"],
  initial: SplitTarget | undefined,
  zweiteZeile: string,
  start: Pick<SplitRow, "steuer" | "darlehen" | "kategorie">,
): SplitRow[] {
  return initial
    ? [
        { key: nextSplitKey++, target: `${initial.type}:${initial.id}`, amount: signed(initial.open), ...start },
        { key: nextSplitKey++, target: zweiteZeile, amount: signed(tx.open - initial.open), ...start },
      ]
    : [
        { key: nextSplitKey++, target: "", amount: signed(tx.open), ...start },
        { key: nextSplitKey++, target: zweiteZeile, amount: "", ...start },
      ];
}

/** Je Teil Ziel, Betrag und Bezugsjahr; was zur Summe fehlt, steht am Betrag des letzten Teils */
function teilFehler(rows: SplitRow[], parsed: (number | null)[], rest: number, open: number): Record<string, string | null> {
  return Object.fromEntries(
    rows.flatMap((r, i) => [
      [
        `ziel-${r.key}`,
        !r.target ? "Wähle, wohin der Teil gebucht wird." : r.target === "darlehen" && !r.darlehen.loanId ? "Noch kein Darlehen angelegt." : null,
      ],
      [
        `betrag-${r.key}`,
        parsed[i] === null
          ? amountError("den Betrag", -12_050)
          : parsed[i] === 0
            ? "Der Betrag darf nicht 0 sein."
            : i === rows.length - 1 && rest !== 0
              ? // rest mit dem Vorzeichen des Umsatzes fehlt noch, mit dem anderen ist zu viel verteilt
                Math.sign(rest) === Math.sign(open)
                ? `Zusammen fehlen noch ${signed(rest)} €.`
                : `Zusammen sind ${formatDecimal(Math.abs(rest))} € zu viel verteilt.`
              : null,
      ],
      [`jahr-${r.key}`, r.target === "steuer" && !steuerangabe(r.steuer) ? BEZUGSJAHR_FEHLER : null],
    ]),
  ) as Record<string, string | null>;
}

function toPart(row: SplitRow, amount: number): SplitPart {
  const [type, id] = row.target.split(":");
  if (id) return itemTarget(type, id, amount);
  const angabe = steuerangabe(row.steuer);
  if (row.target === "steuer" && angabe) return { kind: "steuer", amount, steuer: angabe };
  if (row.target === "darlehen") return { kind: "darlehen", amount, darlehen: row.darlehen };
  if (row.target === "kategorie") return { kind: "kategorie", amount, kategorie: row.kategorie };
  return { kind: row.target as DirectBooking, amount };
}

/** Splitbuchung: den offenen Teil eines Umsatzes auf mehrere Ziele verteilen, Vorzeichen wie auf dem Konto */
export function SplitForm({
  tx,
  initial,
  gegenposten,
  splitCandidates,
  directKinds,
  steuerOptionen,
  darlehenOptionen,
  kategorieOptionen,
  busy,
  onCancel,
  onSubmit,
}: {
  tx: Detail["transaction"];
  initial: SplitTarget | undefined;
  /** Ziel der zweiten Zeile statt der Bankgebühren, etwa die Korrektur der Rechnung */
  gegenposten?: Pick<SplitTarget, "type" | "id">;
  splitCandidates: SplitTarget[];
  directKinds: Data["directKinds"];
  steuerOptionen: SteuerOptionen;
  darlehenOptionen: DarlehenOptionen;
  kategorieOptionen: KategorieOptionen;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (parts: SplitPart[]) => void;
}) {
  const steuerStart = steuerWahlFuer(steuerOptionen, tx.bookingDate);
  const darlehenStart = darlehenWahlFuer(darlehenOptionen, tx.amount);
  const kategorieStart = kategorieWahlFuer(kategorieOptionen, tx.amount);
  const start = { steuer: steuerStart, darlehen: darlehenStart, kategorie: kategorieStart };
  // Fehlen die Bankgebühren im Angebot (privates Konto), startet die zweite Zeile leer (#873)
  const zweiteZeile = gegenposten ? `${gegenposten.type}:${gegenposten.id}` : directKinds.some((k) => k.value === "gebuehren") ? "gebuehren" : "";
  const [rows, setRows] = useState<SplitRow[]>(() => startZeilen(tx, initial, zweiteZeile, start));

  const parsed = rows.map((r) => parseEuro(r.amount));
  const sum = parsed.reduce<number>((s, p) => s + (p ?? 0), 0);
  const rest = tx.open - sum;
  const { form, error, check } = useSubmitCheck(teilFehler(rows, parsed, rest, tx.open));

  function update(key: number, patch: Partial<SplitRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  return (
    <form
      ref={form}
      className="stack"
      style={{ gap: 10 }}
      aria-label="Umsatz aufteilen"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!check()) return;
        onSubmit(rows.map((r, i) => toPart(r, parsed[i]!)));
      }}
    >
      <div className="section-label">Aufteilen</div>
      <p className="small muted" style={{ margin: 0 }}>
        Beträge mit Vorzeichen wie auf dem Konto: Zahlungseingänge positiv, Gebühren und Ausgänge negativ. Zusammen ergeben die Teile den offenen Betrag von{" "}
        {signed(tx.open)} €; jeder Teil wird einzeln gebucht.
      </p>
      {rows.map((row, index) => (
        <div key={row.key} className="split-row">
          <Field label={<>Teil {index + 1}</>} error={error(`ziel-${row.key}`)}>
            {(control) => (
              <select
                {...control}
                value={row.target}
                onChange={(e) => {
                  const value = e.target.value;
                  const item = splitCandidates.find((c) => `${c.type}:${c.id}` === value);
                  update(row.key, item ? { target: value, amount: signed(item.open) } : { target: value });
                }}
              >
                <option value="">Bitte wählen</option>
                <optgroup label="Rechnungen, Belege und Voranmeldungen">
                  {splitCandidates.map((c) => (
                    <option key={`${c.type}:${c.id}`} value={`${c.type}:${c.id}`}>
                      {itemLabel(c)} · {c.partyName} · offen {signed(c.open)} €
                    </option>
                  ))}
                </optgroup>
                {/* Die Aufladung bleibt eine Einzelbuchung und ist kein Teil einer Aufteilung (#1356) */}
                <optgroup label="Direkt buchen">
                  {[...directKinds, KATEGORIE_OPTION, STEUER_OPTION, DARLEHEN_OPTION].map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            )}
          </Field>
          <Field label="Betrag" error={error(`betrag-${row.key}`)}>
            {(control) => (
              <input
                {...control}
                className="mono"
                inputMode="decimal"
                value={row.amount}
                placeholder="-0,00"
                onChange={(e) => update(row.key, { amount: e.target.value })}
                style={{ textAlign: "right" }}
              />
            )}
          </Field>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Teil ${index + 1} entfernen`}
            disabled={rows.length <= 2}
            onClick={() => setRows((prev) => prev.filter((r) => r.key !== row.key))}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          {row.target === "steuer" && (
            <div style={{ gridColumn: "1 / -1" }}>
              <SteuerFelder
                options={steuerOptionen}
                value={row.steuer}
                onChange={(steuer) => update(row.key, { steuer })}
                jahrFehler={error(`jahr-${row.key}`)}
              />
            </div>
          )}
          {row.target === "darlehen" && (
            <div style={{ gridColumn: "1 / -1" }}>
              <DarlehenFelder options={darlehenOptionen} value={row.darlehen} onChange={(darlehen) => update(row.key, { darlehen })} />
            </div>
          )}
          {row.target === "kategorie" && (
            <div style={{ gridColumn: "1 / -1" }}>
              <KategorieFelder
                options={kategorieOptionen}
                value={row.kategorie}
                amount={parsed[index] ?? null}
                onChange={(kategorie) => update(row.key, { kategorie })}
              />
            </div>
          )}
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-dashed"
          disabled={rows.length >= 20}
          onClick={() => setRows((prev) => [...prev, { key: nextSplitKey++, target: "", amount: rest !== 0 ? signed(rest) : "", ...start }])}
        >
          + Teil
        </button>
        <span className="small" aria-live="polite">
          {rest === 0 ? "Teile ergeben den Umsatz." : `Noch zu verteilen: ${signed(rest)} €`}
        </span>
      </div>
      <div className="actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Abbrechen
        </button>
        <button type="submit" className="btn btn-primary" style={{ flexGrow: 1 }} disabled={busy}>
          Aufteilen und buchen
        </button>
      </div>
    </form>
  );
}
