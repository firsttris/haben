import { amountError, formatDecimal, formatEuro, isKapitalgesellschaft, parseEuro, startwertFuerBuchungsart } from "@haben/core";
import { getRouteApi, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { DauerbelegVorschlaege } from "../../components/DauerbelegVorschlaege.tsx";
import { LastschriftVorschlag } from "../../components/LastschriftVorschlag.tsx";
import { StorePayoutBox } from "../../components/StorePayoutBox.tsx";
import { PrivatKennzeichnen, PrivatUmsatz } from "../../components/BankPrivat.tsx";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { BEZUGSJAHR_FEHLER, SteuerFelder, steuerangabe, steuerWahlFuer, type SteuerOptionen, type SteuerWahl } from "../../components/SteuerFelder.tsx";
import { DarlehenFelder, darlehenWahlFuer, type DarlehenOptionen, type DarlehenWahl } from "../../components/DarlehenFelder.tsx";
import { DirektKategorieFelder, kategorieWahlFuer, type KategorieOptionen, type KategorieWahl } from "../../components/KategorieFelder.tsx";
import { useAction } from "../../lib/use-action.ts";
import { useSubmitCheck } from "../../lib/use-submit-check.ts";
import { isDialogOpen } from "../../components/ConfirmDialog.tsx";
import { type AufzuhebendeZuordnung, ZuordnungAufheben } from "../../components/ZuordnungAufheben.tsx";
import { VerrechnenFormular, VerrechnungAnzeige } from "../../components/Verrechnung.tsx";
import { KlaerungHinweis } from "../../components/ImportKonflikt.tsx";
import { Field } from "../../components/Field.tsx";
import { Kuerzel } from "../../components/Kuerzel.tsx";
import {
  DIRECT_HINT,
  type Data,
  type Detail,
  type RestArt,
  restAngebot,
  type DirectChoice,
  direktKategorie,
  itemTarget,
  zuAufhebendeZuordnung,
} from "./-bank-daten.ts";
import { SplitForm } from "./-bank-aufteilen.tsx";
import { RestAktionen } from "./-bank-zuordnung-rest.tsx";
import { useZuordnungsAufrufe } from "./-bank-zuordnung-aufrufe.ts";
import { BuchungsartWahl, KandidatWahl } from "./-bank-zuordnung-wahl.tsx";
import { BesterTreffer, DirektVorschlagKarte, UmsatzKopf, ZuordnungenListe } from "./-bank-zuordnung-teile.tsx";

const bankRoute = getRouteApi("/_app/bank");

export function AllocationPanel({
  detail,
  directKinds,
  steuerOptionen,
  darlehenOptionen,
  kategorieOptionen,
  nextOpenId,
}: {
  detail: Detail;
  directKinds: Data["directKinds"];
  steuerOptionen: SteuerOptionen;
  darlehenOptionen: DarlehenOptionen;
  kategorieOptionen: KategorieOptionen;
  nextOpenId: string | undefined;
}) {
  const router = useRouter();
  const navigate = useNavigate({ from: "/bank" });
  const {
    allocateFn,
    markPrivatFn,
    unmarkPrivatFn,
    splitFn,
    restFn,
    feesFn,
    reverseFn,
    transferFn,
    dauerbelegFn,
    neutralizeFn,
    reverseNeutralizationFn,
    batchFn,
    returnFn,
  } = useZuordnungsAufrufe();
  const { transaction: tx, suggestions, candidates, splitCandidates, allocations, direct, dauerbelege, neutralization, lastschrift, sammelrechnung } = detail;
  // Eine GmbH oder UG hat kein Privat; dieselbe Zuordnung geht dort auf das Gesellschafter-Verrechnungskonto
  const gesellschaft = isKapitalgesellschaft(bankRoute.useRouteContext().rechtsform);
  // Monate mit abgegebener Voranmeldung: sie entscheiden über die Vorbelegung des Aufhebungstags (#782)
  const gemeldeteMonate = bankRoute.useLoaderData().gemeldeteMonate;
  const best = suggestions[0];
  // Ein Treffer mit Rechnung geht vor; sonst der Vorschlag aus dem Zweck der Konten (Geldtransit, Umsatzsteuer, Privat)
  const [mode, setMode] = useState<"best" | "other" | "direct" | "split">(best ? "best" : direct ? "direct" : candidates.length ? "other" : "direct");
  const [candidate, setCandidate] = useState(best ? `${best.item.type}:${best.item.id}` : "");
  // Startwert aus dem Angebot des Kontos (#873): Auf einem privaten Konto fehlen die gesperrten Arten, ein fester
  // Startwert würde dort vom Server abgelehnt. Eine gelernte Kategorie steht nicht im Angebot und bleibt stehen (#295)
  const angeboteneArten = directKinds.map((k) => k.value);
  const [directKind, setDirectKind] = useState<DirectChoice>(() => startwertFuerBuchungsart(direct?.kind, angeboteneArten) as DirectChoice);
  const [steuer, setSteuer] = useState<SteuerWahl>(() => steuerWahlFuer(steuerOptionen, tx.bookingDate));
  const [darlehen, setDarlehen] = useState<DarlehenWahl>(() => darlehenWahlFuer(darlehenOptionen, tx.amount));
  // Aus früheren Direktbuchungen derselben Gegenpartei gelernt (#295), sonst nach Richtung
  const [kategorie, setKategorie] = useState<KategorieWahl>(() => direct?.kategorie ?? kategorieWahlFuer(kategorieOptionen, tx.amount));
  const [amount, setAmount] = useState(formatDecimal(Math.abs(best?.amount ?? tx.open)));
  const action = useAction();
  const { busy, notice } = action;
  const [reversing, setReversing] = useState<AufzuhebendeZuordnung | null>(null);
  const primaryButton = useRef<HTMLButtonElement>(null);

  const parsedAmount = parseEuro(amount);
  const signedAmount = parsedAmount === null ? null : Math.sign(tx.amount) * Math.abs(parsedAmount);

  const run = (work: () => Promise<unknown>) =>
    action.run(async () => {
      await work();
      await router.invalidate();
    });

  // Ist der Umsatz danach ganz zugeordnet, weiter zum nächsten offenen, wie bei den Belegen
  const runAndAdvance = (work: () => Promise<unknown>, completes: boolean) =>
    action.run(async () => {
      await work();
      if (completes && nextOpenId) await navigate({ search: (prev) => ({ ...prev, umsatz: nextOpenId }), replace: true });
      else await router.invalidate();
    });

  const selectedCandidate = candidates.find((c) => `${c.type}:${c.id}` === candidate);
  const {
    form: panel,
    error,
    check,
  } = useSubmitCheck({
    amount: parsedAmount === null ? amountError("den Betrag", 12_050) : parsedAmount === 0 ? "Der Betrag darf nicht 0 sein." : null,
    candidate:
      mode !== "other" || selectedCandidate
        ? null
        : candidates.length > 0
          ? "Wähle eine Rechnung, einen Beleg oder eine Voranmeldung."
          : "Hier gibt es nichts zuzuordnen; buche den Umsatz direkt oder teile ihn auf.",
    jahr: mode === "direct" && directKind === "steuer" && !steuerangabe(steuer) ? BEZUGSJAHR_FEHLER : null,
  });

  // Zahlung in der Skontofrist um genau das Skonto gekürzt: zuordnen und den Rest gleich als gewährtes Skonto ausbuchen
  const skontoRest = mode === "best" && best?.skonto && best.item.type === "invoice" && signedAmount === tx.open ? best.skonto : 0;

  function submitAllocation() {
    if (!check() || signedAmount === null) return;
    const completes = signedAmount === tx.open;
    if (skontoRest !== 0 && best) {
      return runAndAdvance(() => restFn({ data: { transactionId: tx.id, target: { kind: "invoice", invoiceId: best.item.id }, rest: "skonto" } }), true);
    }
    if (mode === "direct") {
      if (directKind === "darlehen") {
        if (!darlehen.loanId) return;
        return runAndAdvance(() => allocateFn({ data: { kind: "darlehen", transactionId: tx.id, amount: signedAmount, darlehen } }), completes);
      }
      if (directKind === "kategorie" || directKind === "aufladung") {
        return runAndAdvance(() => allocateFn({ data: direktKategorie(directKind, tx.id, signedAmount, kategorie) }), completes);
      }
      if (directKind !== "steuer") {
        return runAndAdvance(() => allocateFn({ data: { kind: directKind, transactionId: tx.id, amount: signedAmount } }), completes);
      }
      const angabe = steuerangabe(steuer);
      if (!angabe) return;
      return runAndAdvance(() => allocateFn({ data: { kind: "steuer", transactionId: tx.id, amount: signedAmount, steuer: angabe } }), completes);
    }
    const choice = mode === "best" && best ? `${best.item.type}:${best.item.id}` : candidate;
    const [type, id] = choice.split(":");
    if (!id) return;
    return runAndAdvance(() => allocateFn({ data: { ...itemTarget(type, id, signedAmount), transactionId: tx.id } }), completes);
  }

  // Enter ordnet zu, solange der Fokus nicht in einem Eingabefeld liegt
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Enter" || tx.open === 0 || isDialogOpen()) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, select, textarea, button, a")) return;
      event.preventDefault();
      primaryButton.current?.click();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tx.open]);

  // Posten, der gerade zugeordnet würde; ist er höher als der Umsatz, bietet sich „Rest als Gebühr“ an
  const target = mode === "best" && best ? best.item : mode === "other" ? selectedCandidate : undefined;
  const { feeRest, rest, restKinds, exchangeDifference } = restAngebot(target, tx);
  // Beim Wechsel zu „Aufteilen“ festgehalten: dort ist der Modus „split“ und target wäre leer
  const [splitInitial, setSplitInitial] = useState<typeof target>(undefined);

  function bookRest(kind: RestArt | "kursdifferenz") {
    if (!target) return;
    const t = target.type === "invoice" ? { kind: "invoice" as const, invoiceId: target.id } : { kind: "document" as const, documentId: target.id };
    return run(() => restFn({ data: { transactionId: tx.id, target: t, rest: kind } }));
  }

  function bookRestAsFee() {
    if (!target || feeRest === 0) return;
    const first = itemTarget(target.type, target.id, target.open);
    return run(() => splitFn({ data: { transactionId: tx.id, parts: [first, { kind: "gebuehren", amount: feeRest }] } }));
  }

  // Auf einem privaten Konto ohne Buchungsart bleibt nur die Kennzeichnung: „Zuordnen", „Direkt buchen" und „Aufteilen"
  // wären beim selben Umsatz eine zweite Aussage zum selben Vorgang — sie gelten erst, wenn die Kennzeichnung aufgehoben
  // ist (#1088)
  if (detail.privat)
    return (
      <aside ref={panel} className="card" aria-label="Umsatz" style={{ gap: 16 }}>
        <PrivatUmsatz tx={tx} busy={busy} notice={notice} onAufheben={() => void run(() => unmarkPrivatFn({ data: { transactionId: tx.id } }))} />
      </aside>
    );

  return (
    <aside ref={panel} className="card" aria-label="Zuordnung" style={{ gap: 16 }}>
      <UmsatzKopf tx={tx} />

      <ZuordnungenListe
        allocations={allocations}
        gesellschaft={gesellschaft}
        busy={busy}
        onAufheben={(a) => setReversing(zuAufhebendeZuordnung(a, allocations, gesellschaft, tx.bookingDate, gemeldeteMonate))}
      />

      {detail.storePayout && tx.open === tx.amount && (
        <StorePayoutBox key={tx.id} view={detail.storePayout} amount={tx.amount} transactionId={tx.id} busy={busy} run={(work) => void run(work)} />
      )}

      {detail.privatKonto && tx.open !== 0 && (
        <PrivatKennzeichnen busy={busy} onKennzeichnen={() => void run(() => markPrivatFn({ data: { transactionId: tx.id } }))} />
      )}

      <VerrechnungAnzeige daten={neutralization} busy={busy} onReverse={(id) => void run(() => reverseNeutralizationFn({ data: id }))} />
      <KlaerungHinweis klaerung={detail.klaerung} />

      <NoticeBanner notice={notice} />
      <ZuordnungAufheben ziel={reversing} onConfirm={(id, date) => void run(() => reverseFn({ data: { id, date } }))} onClose={() => setReversing(null)} />

      {tx.open !== 0 && mode === "split" && (
        <SplitForm
          key={tx.id}
          tx={tx}
          initial={splitInitial}
          splitCandidates={splitCandidates}
          directKinds={directKinds}
          steuerOptionen={steuerOptionen}
          darlehenOptionen={darlehenOptionen}
          kategorieOptionen={kategorieOptionen}
          busy={busy}
          onCancel={() => setMode(best ? "best" : candidates.length ? "other" : "direct")}
          onSubmit={(parts) => run(() => splitFn({ data: { transactionId: tx.id, parts } }))}
        />
      )}

      {tx.open !== 0 && mode !== "split" && (
        <LastschriftVorschlag
          match={lastschrift}
          busy={busy}
          onAllocate={() => runAndAdvance(() => (lastschrift?.kind === "sammler" ? batchFn : returnFn)({ data: { transactionId: tx.id } }), true)}
        />
      )}

      {tx.open !== 0 && mode !== "split" && (
        <DauerbelegVorschlaege
          suggestions={dauerbelege}
          busy={busy}
          onBook={(documentId) =>
            runAndAdvance(
              () => dauerbelegFn({ data: { documentId, transactionId: tx.id } }),
              dauerbelege.find((d) => d.item.id === documentId)?.amount === tx.open,
            )
          }
        />
      )}

      {tx.open !== 0 && mode !== "split" && (
        <>
          {mode === "best" && best && <BesterTreffer best={best} />}

          {mode === "other" && (
            <KandidatWahl
              candidates={candidates}
              value={candidate}
              error={error("candidate")}
              onChange={(value, c) => {
                setCandidate(value);
                if (c) setAmount(formatDecimal(Math.min(Math.abs(c.open), Math.abs(tx.open))));
              }}
            />
          )}

          {mode === "direct" && direct && (
            <DirektVorschlagKarte
              direct={direct}
              directKinds={directKinds}
              busy={busy}
              onTransit={(counterpart) =>
                void run(() => transferFn({ data: { transactionId: tx.id, counterpartId: counterpart.id, payoutIds: counterpart.payoutIds } }))
              }
            />
          )}

          {mode === "direct" && (
            <BuchungsartWahl directKinds={directKinds} gesellschaft={gesellschaft} ausgabe={tx.amount < 0} value={directKind} onChange={setDirectKind} />
          )}

          {mode === "direct" && directKind === "steuer" && (
            <SteuerFelder options={steuerOptionen} value={steuer} onChange={setSteuer} jahrFehler={error("jahr")} />
          )}
          {mode === "direct" && directKind === "darlehen" && <DarlehenFelder options={darlehenOptionen} value={darlehen} onChange={setDarlehen} />}
          {mode === "direct" && (directKind === "kategorie" || directKind === "aufladung") && (
            <DirektKategorieFelder kind={directKind} options={kategorieOptionen} value={kategorie} amount={signedAmount} onChange={setKategorie} />
          )}

          <Field label="Betrag" error={error("amount")}>
            {(control) => (
              <input
                {...control}
                className="mono"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={{ textAlign: "right" }}
              />
            )}
          </Field>

          <div className="actions">
            {mode !== "other" && (
              <button type="button" className="btn" onClick={() => setMode("other")} disabled={busy}>
                Andere Rechnung
              </button>
            )}
            {mode === "other" && best && (
              <button type="button" className="btn" onClick={() => setMode("best")} disabled={busy}>
                Vorschlag
              </button>
            )}
            <button
              ref={primaryButton}
              type="button"
              className="btn btn-primary"
              style={{ flexGrow: 1 }}
              // Ohne Darlehen steht „Noch kein Darlehen angelegt“ mit Link darüber (DESIGN.md, Gesperrte Knöpfe)
              disabled={busy || (mode === "direct" && directKind === "darlehen" && !darlehen.loanId)}
              onClick={() => void submitAllocation()}
            >
              {mode === "direct" ? "Buchen" : skontoRest !== 0 ? `Zuordnen, Rest ${formatEuro(Math.abs(skontoRest))} als Skonto` : "Zuordnen"}
            </button>
          </div>
          <RestAktionen
            target={target}
            tx={tx}
            sammelrechnung={sammelrechnung}
            mitSammel={mode === "other" || target?.id === sammelrechnung?.documentId}
            angebot={{ feeRest, rest, restKinds, exchangeDifference }}
            busy={busy}
            onFeeRest={() => void bookRestAsFee()}
            onSammel={(documentId) => void run(() => feesFn({ data: { transactionId: tx.id, documentId } }))}
            onRest={(kind) => void bookRest(kind)}
          />
          {mode !== "direct" && (
            <button type="button" className="btn" onClick={() => setMode("direct")} disabled={busy} title={DIRECT_HINT}>
              Direkt buchen
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => {
              setSplitInitial(target);
              setMode("split");
            }}
            disabled={busy}
          >
            Aufteilen
          </button>
          <VerrechnenFormular
            candidates={neutralization.candidates}
            busy={busy}
            // Bleibt beim Umsatz: Er zeigt danach die Verrechnung; der nächste offene könnte gerade der Gegenumsatz sein
            onSubmit={(input) => void run(() => neutralizeFn({ data: { transactionId: tx.id, ...input } }))}
          />
          <div className="small muted pointer-fine">
            Tastatur: <Kuerzel tasten={["Enter"]} /> ordnet zu, <Kuerzel tasten={["J"]} /> und <Kuerzel tasten={["K"]} /> wechseln den Umsatz.
          </div>
        </>
      )}
    </aside>
  );
}
