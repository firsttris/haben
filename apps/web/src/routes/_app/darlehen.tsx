import { formatEuro, parseEuro, type DarlehenLaufzeit, type DarlehenZweck, type Darlehensgeber } from "@haben/core";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { NoticeBanner } from "../../components/NoticeBanner.tsx";
import { ScrollTable } from "../../components/ScrollTable.tsx";
import { formatDate } from "../../lib/format.ts";
import { useAction } from "../../lib/use-action.ts";
import { createLoanFn, getLoans } from "../../server/functions/darlehen.ts";
import styles from "../../styles/auswertungen.css?url";
import { Field } from "../../components/Field.tsx";

export const Route = createFileRoute("/_app/darlehen")({
  loader: () => getLoans(),
  head: () => ({ meta: [{ title: "Darlehen · Haben" }], links: [{ rel: "stylesheet", href: styles }] }),
  component: DarlehenPage,
});

type Data = Awaited<ReturnType<typeof getLoans>>;

function DarlehenPage() {
  const data = Route.useLoaderData();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Geld</div>
          <h1>Darlehen</h1>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0, maxWidth: 760 }}>
        Aufgenommene Darlehen mit Restschuld. Auszahlung, Tilgung, Zinsen und Gebühren ordnest du im <Link to="/bank">Bankabgleich</Link> zu; eine Rate teilst
        du dort mit „Aufteilen“ in Tilgung, Zinsen und Gebühr. Tilgung und Auszahlung ändern den Gewinn nicht, Zinsen und Gebühren sind Schuldzinsen.
      </p>
      <div className="stack" style={{ gap: 16 }}>
        <Liste loans={data.loans} />
        <NeuesDarlehen data={data} />
      </div>
    </>
  );
}

function Liste({ loans }: { loans: Data["loans"] }) {
  return (
    <section className="card" aria-labelledby="darlehen-heading">
      <h2 id="darlehen-heading" style={{ margin: 0, fontSize: 16 }}>
        Bestand
      </h2>
      {loans.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          Noch kein Darlehen angelegt.
        </p>
      ) : (
        <ScrollTable className="report-table">
          <caption className="visually-hidden">Darlehen mit Bestand</caption>
          <thead>
            <tr>
              <th scope="col">Darlehen</th>
              <th scope="col">Konto</th>
              <th scope="col" className="num">
                Restschuld beim Anlegen
              </th>
              <th scope="col" className="num">
                Bestand
              </th>
            </tr>
          </thead>
          <tbody>
            {loans.map((l) => (
              <tr key={l.id}>
                <th scope="row">{l.name}</th>
                <td className="mono">
                  <Link to="/konten/$konto" params={{ konto: l.account }}>
                    {l.account}
                  </Link>
                </td>
                <td className="num">
                  {formatEuro(l.openingBalance)}
                  {l.openingDate ? ` am ${formatDate(l.openingDate)}` : ""}
                </td>
                <td className="num">{formatEuro(l.balance)}</td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
    </section>
  );
}

function NeuesDarlehen({ data }: { data: Data }) {
  const router = useRouter();
  const create = useServerFn(createLoanFn);
  const action = useAction();
  const [restschuld, setRestschuld] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const openingBalance = restschuld.trim() === "" ? 0 : parseEuro(restschuld);
    if (openingBalance === null) return;
    void action.run(async () => {
      await create({
        data: {
          name: String(values.get("name") ?? ""),
          lender: values.get("lender") as Darlehensgeber,
          term: values.get("term") as DarlehenLaufzeit,
          purpose: values.get("purpose") as DarlehenZweck,
          openingBalance,
          openingDate: openingBalance > 0 ? String(values.get("openingDate") ?? "") || null : null,
        },
      });
      form.reset();
      setRestschuld("");
      await router.invalidate();
    }, "Darlehen angelegt.");
  }

  return (
    <section className="card" aria-labelledby="neu-heading">
      <h2 id="neu-heading" style={{ margin: 0, fontSize: 16 }}>
        Darlehen anlegen
      </h2>
      <form className="stack" style={{ gap: 12 }} onSubmit={submit} aria-labelledby="neu-heading">
        <Field label="Name">{(control) => <input {...control} name="name" required maxLength={100} placeholder="z. B. Hausbank Investitionskredit" />}</Field>
        <div className="form-row cols-3">
          <Field label="Darlehensgeber">
            {(control) => (
              <select {...control} name="lender" defaultValue="bank">
                {data.lenders.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Restlaufzeit">
            {(control) => (
              <select {...control} name="term" defaultValue="ohne">
                {data.terms.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Verwendung">
            {(control) => (
              <select {...control} name="purpose" defaultValue="betrieb">
                {data.purposes.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div className="form-row cols-2">
          <Field label="Restschuld bei Übernahme (€, leer bei einem neuen Darlehen)">
            {(control) => (
              <input
                {...control}
                className="mono"
                inputMode="decimal"
                value={restschuld}
                onChange={(e) => setRestschuld(e.target.value)}
                aria-invalid={restschuld.trim() !== "" && parseEuro(restschuld) === null}
              />
            )}
          </Field>
          <Field label="Stichtag der Restschuld">
            {(control) => <input {...control} name="openingDate" type="date" disabled={restschuld.trim() === ""} />}
          </Field>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Geber und Restlaufzeit bestimmen das Konto (Verbindlichkeiten gegenüber Kreditinstituten bzw. Darlehen), die Verwendung das Zinskonto und die Zeile
          der Anlage EÜR. Ohne Angabe der Restlaufzeit bestätigt eine GmbH sie im Jahresabschluss. Nach der ersten Zuordnung sind die Angaben fest.
        </p>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={action.busy}>
            Darlehen anlegen
          </button>
        </div>
        <NoticeBanner notice={action.notice} />
      </form>
    </section>
  );
}
