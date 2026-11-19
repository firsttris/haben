import { formatDecimal } from "@haben/core";
import { GebuehrWahl, zuordnenText } from "../../components/BankGebuehr.tsx";
import { DarlehenFelder } from "../../components/DarlehenFelder.tsx";
import { DauerbelegVorschlaege } from "../../components/DauerbelegVorschlaege.tsx";
import { Field } from "../../components/Field.tsx";
import { KlaerungHinweis } from "../../components/ImportKonflikt.tsx";
import { DirektKategorieFelder } from "../../components/KategorieFelder.tsx";
import { Kuerzel } from "../../components/Kuerzel.tsx";
import { LastschriftVorschlag } from "../../components/LastschriftVorschlag.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { PrivatKennzeichnen, PrivatUmsatz } from "../../components/BankPrivat.tsx";
import { SteuerFelder } from "../../components/SteuerFelder.tsx";
import { StorePayoutBox } from "../../components/StorePayoutBox.tsx";
import { VerrechnenFormular, VerrechnungAnzeige } from "../../components/Verrechnung.tsx";
import { ZuordnungAufheben } from "../../components/ZuordnungAufheben.tsx";
import { DIRECT_HINT, type Detail, zuAufhebendeZuordnung } from "./-bank-daten.ts";
import { SplitForm } from "./-bank-aufteilen.tsx";
import { RestAktionen } from "./-bank-zuordnung-rest.tsx";
import { BuchungsartWahl, KandidatWahl } from "./-bank-zuordnung-wahl.tsx";
import { BesterTreffer, DirektVorschlagKarte, UmsatzKopf, ZuordnungenListe } from "./-bank-zuordnung-teile.tsx";
import { type Gebuehr, type Optionen, useZuordnung, type Zuordnung } from "./-bank-zuordnung-zustand.ts";

export function AllocationPanel({ detail, nextOpenId, gebuehr, ...optionen }: Optionen & { detail: Detail; nextOpenId: string | undefined; gebuehr: Gebuehr }) {
  const z = useZuordnung(detail, optionen, nextOpenId, gebuehr);
  const { tx, busy, notice, run, aufrufe } = z;
  // Auf einem privaten Konto ohne Buchungsart bleibt nur die Kennzeichnung: „Zuordnen", „Direkt buchen" und „Aufteilen"
  // wären beim selben Umsatz eine zweite Aussage zum selben Vorgang — sie gelten erst, wenn die Kennzeichnung aufgehoben
  // ist (#1088)
  if (detail.privat)
    return (
      <aside ref={z.panel} className="card" aria-label="Umsatz" style={{ gap: 16 }}>
        <PrivatUmsatz tx={tx} busy={busy} notice={notice} onAufheben={() => void run(() => aufrufe.unmarkPrivatFn({ data: { transactionId: tx.id } }))} />
      </aside>
    );

  return (
    <aside ref={z.panel} className="card" aria-label="Zuordnung" style={{ gap: 16 }}>
      <UmsatzKopf tx={tx} />
      <Stand z={z} />
      {tx.open !== 0 && z.wahl.mode === "split" && <Aufteilen z={z} />}
      {tx.open !== 0 && z.wahl.mode !== "split" && (
        <>
          <Vorschlaege z={z} />
          <Auswahl z={z} />
          <Knoepfe z={z} />
          <WeitereWege z={z} />
        </>
      )}
    </aside>
  );
}

/** Was zum Umsatz schon gilt: Zuordnungen, Auszahlung des Shops, Privat, Verrechnung, Klärung und Meldungen */
function Stand({ z }: { z: Zuordnung }) {
  const { detail, tx, busy, run, aufrufe, gesellschaft } = z;
  const { allocations } = detail;
  return (
    <>
      <ZuordnungenListe
        allocations={allocations}
        gesellschaft={gesellschaft}
        busy={busy}
        onAufheben={(a) => z.setReversing(zuAufhebendeZuordnung(a, allocations, gesellschaft, tx.bookingDate, z.gemeldeteMonate))}
      />
      {detail.storePayout && tx.open === tx.amount && (
        <StorePayoutBox key={tx.id} view={detail.storePayout} amount={tx.amount} transactionId={tx.id} busy={busy} run={(work) => void run(work)} />
      )}
      {detail.privatKonto && tx.open !== 0 && (
        <PrivatKennzeichnen busy={busy} onKennzeichnen={() => void run(() => aufrufe.markPrivatFn({ data: { transactionId: tx.id } }))} />
      )}
      <VerrechnungAnzeige daten={detail.neutralization} busy={busy} onReverse={(id) => void run(() => aufrufe.reverseNeutralizationFn({ data: id }))} />
      <KlaerungHinweis klaerung={detail.klaerung} />
      <NoticeBanner notice={z.notice} />
      <ZuordnungAufheben
        ziel={z.reversing}
        onConfirm={(id, date) => void run(() => aufrufe.reverseFn({ data: { id, date } }))}
        onClose={() => z.setReversing(null)}
      />
    </>
  );
}

function Aufteilen({ z }: { z: Zuordnung }) {
  const { tx, wahl } = z;
  return (
    <SplitForm
      key={tx.id}
      tx={tx}
      initial={z.splitInitial}
      splitCandidates={z.detail.splitCandidates}
      {...z.optionen}
      busy={z.busy}
      onCancel={() => wahl.setMode(wahl.best ? "best" : z.detail.candidates.length ? "other" : "direct")}
      onSubmit={(parts) => z.run(() => z.aufrufe.splitFn({ data: { transactionId: tx.id, parts } }))}
    />
  );
}

/** Lastschrift, Dauerbelege und der beste Treffer oder der Vorschlag ohne Rechnung */
function Vorschlaege({ z }: { z: Zuordnung }) {
  const { tx, busy, aufrufe, runAndAdvance, wahl } = z;
  const { lastschrift, dauerbelege, direct } = z.detail;
  return (
    <>
      <LastschriftVorschlag
        match={lastschrift}
        busy={busy}
        onAllocate={() => runAndAdvance(() => (lastschrift?.kind === "sammler" ? aufrufe.batchFn : aufrufe.returnFn)({ data: { transactionId: tx.id } }), true)}
      />
      <DauerbelegVorschlaege
        suggestions={dauerbelege}
        busy={busy}
        onBook={(documentId) =>
          runAndAdvance(
            () => aufrufe.dauerbelegFn({ data: { documentId, transactionId: tx.id } }),
            dauerbelege.find((d) => d.item.id === documentId)?.amount === tx.open,
          )
        }
      />
      {wahl.mode === "best" && wahl.best && <BesterTreffer best={wahl.best} />}
      {wahl.mode === "direct" && direct && (
        <DirektVorschlagKarte
          direct={direct}
          directKinds={z.optionen.directKinds}
          busy={busy}
          onTransit={(counterpart) =>
            void z.run(() => aufrufe.transferFn({ data: { transactionId: tx.id, counterpartId: counterpart.id, payoutIds: counterpart.payoutIds } }))
          }
        />
      )}
    </>
  );
}

/** Andere Rechnung oder Buchungsart mit ihren Angaben */
function Auswahl({ z }: { z: Zuordnung }) {
  const { tx, wahl, error, optionen } = z;
  const { mode, directKind } = wahl;
  return (
    <>
      {mode === "other" && (
        <KandidatWahl
          candidates={z.detail.candidates}
          value={wahl.candidate}
          error={error("candidate")}
          onChange={(value, c) => {
            wahl.setCandidate(value);
            if (c) wahl.setAmount(formatDecimal(Math.min(Math.abs(c.open), Math.abs(tx.open))));
          }}
        />
      )}
      {mode === "direct" && (
        <BuchungsartWahl
          directKinds={optionen.directKinds}
          gesellschaft={z.gesellschaft}
          ausgabe={tx.amount < 0}
          value={directKind}
          onChange={wahl.setDirectKind}
        />
      )}
      {mode === "direct" && directKind === "steuer" && (
        <SteuerFelder options={optionen.steuerOptionen} value={wahl.steuer} onChange={wahl.setSteuer} jahrFehler={error("jahr")} />
      )}
      {mode === "direct" && directKind === "darlehen" && (
        <DarlehenFelder options={optionen.darlehenOptionen} value={wahl.darlehen} onChange={wahl.setDarlehen} />
      )}
      {mode === "direct" && (directKind === "kategorie" || directKind === "aufladung") && (
        <DirektKategorieFelder
          kind={directKind}
          options={optionen.kategorieOptionen}
          value={wahl.kategorie}
          amount={wahl.signedAmount}
          onChange={wahl.setKategorie}
        />
      )}
    </>
  );
}

/** Betrag und die Knöpfe zum Zuordnen oder Buchen */
function Knoepfe({ z }: { z: Zuordnung }) {
  const { wahl, busy, skontoRest } = z;
  const { mode } = wahl;
  return (
    <>
      <Field label="Betrag" error={z.error("amount")}>
        {(control) => (
          <input
            {...control}
            className="mono"
            inputMode="decimal"
            value={wahl.amount}
            onChange={(e) => wahl.setAmount(e.target.value)}
            style={{ textAlign: "right" }}
          />
        )}
      </Field>
      {z.gebuehr && z.gebuehrWahl.moeglich && <GebuehrWahl gebuehr={z.gebuehr} wahl={z.gebuehrWahl} belege={z.detail.splitCandidates} busy={busy} />}
      <div className="actions">
        {mode !== "other" && (
          <button type="button" className="btn" onClick={() => wahl.setMode("other")} disabled={busy}>
            Andere Rechnung
          </button>
        )}
        {mode === "other" && wahl.best && (
          <button type="button" className="btn" onClick={() => wahl.setMode("best")} disabled={busy}>
            Vorschlag
          </button>
        )}
        <button
          ref={z.primaryButton}
          type="button"
          className="btn btn-primary"
          style={{ flexGrow: 1 }}
          // Ohne Darlehen steht „Noch kein Darlehen angelegt“ mit Link darüber (DESIGN.md, Gesperrte Knöpfe)
          disabled={busy || (mode === "direct" && wahl.directKind === "darlehen" && !wahl.darlehen.loanId)}
          onClick={() => void z.submitAllocation()}
        >
          {zuordnenText({ direkt: mode === "direct", skontoRest, gebuehrMitbuchen: z.gebuehrWahl.mitbuchen })}
        </button>
      </div>
    </>
  );
}

/** Rest ausbuchen, direkt buchen, aufteilen oder verrechnen */
function WeitereWege({ z }: { z: Zuordnung }) {
  const { tx, busy, run, aufrufe, wahl, rest } = z;
  const { sammelrechnung } = z.detail;
  return (
    <>
      <RestAktionen
        target={rest.target}
        tx={tx}
        sammelrechnung={sammelrechnung}
        mitSammel={wahl.mode === "other" || rest.target?.id === sammelrechnung?.documentId}
        angebot={rest.angebot}
        busy={busy}
        onFeeRest={() => void rest.bookRestAsFee()}
        onSammel={(documentId) => void run(() => aufrufe.feesFn({ data: { transactionId: tx.id, documentId } }))}
        onRest={(kind) => void rest.bookRest(kind)}
      />
      {wahl.mode !== "direct" && (
        <button type="button" className="btn" onClick={() => wahl.setMode("direct")} disabled={busy} title={DIRECT_HINT}>
          Direkt buchen
        </button>
      )}
      <button
        type="button"
        className="btn"
        onClick={() => {
          z.setSplitInitial(rest.target);
          wahl.setMode("split");
        }}
        disabled={busy}
      >
        Aufteilen
      </button>
      <VerrechnenFormular
        candidates={z.detail.neutralization.candidates}
        busy={busy}
        // Bleibt beim Umsatz: Er zeigt danach die Verrechnung; der nächste offene könnte gerade der Gegenumsatz sein
        onSubmit={(input) => void run(() => aufrufe.neutralizeFn({ data: { transactionId: tx.id, ...input } }))}
      />
      <div className="small muted pointer-fine">
        Tastatur: <Kuerzel tasten={["Enter"]} /> ordnet zu, <Kuerzel tasten={["J"]} /> und <Kuerzel tasten={["K"]} /> wechseln den Umsatz.
      </div>
    </>
  );
}
