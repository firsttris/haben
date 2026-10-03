import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { RecurringForm } from "../../../../components/RecurringForm.tsx";
import { errorMessage } from "../../../../lib/format.ts";
import { getRecurringForm, saveRecurring } from "../../../../server/functions/recurring.ts";

export const Route = createFileRoute("/_app/rechnungen/wiederkehrend/neu")({
  loader: () => getRecurringForm(),
  head: () => ({ meta: [{ title: "Neue wiederkehrende Rechnung · Haben" }] }),
  component: NewRecurringPage,
});

/** Erster Tag des nächsten Monats als Vorschlag */
function nextMonthStart(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

function NewRecurringPage() {
  const { contacts, defaults, today } = Route.useLoaderData();
  const navigate = useNavigate();
  const save = useServerFn(saveRecurring);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/rechnungen/wiederkehrend">Wiederkehrende Rechnungen</Link> › Neu
          </div>
          <h1>Neue Vorlage</h1>
        </div>
      </div>
      {error && (
        <div className="banner banner-danger" role="alert">
          {error}
        </div>
      )}
      <RecurringForm
        initial={{
          name: "",
          active: true,
          contactId: "",
          format: defaults.format,
          paymentTermDays: defaults.paymentTermDays,
          note: "",
          taxTreatment: defaults.kleinunternehmer ? "kleinunternehmer" : "regulaer",
          exemptionReason: "",
          lines: [{ description: "", quantity: 1000, unit: "Psch.", unitPrice: 0, taxRate: defaults.kleinunternehmer ? 0 : 1900 }],
          intervalMonths: 1,
          nextDate: nextMonthStart(today),
          endDate: null,
          servicePeriod: "laufend",
          mode: "entwurf",
          sendByMail: false,
        }}
        contacts={contacts}
        kleinunternehmer={defaults.kleinunternehmer}
        busy={busy}
        submitLabel="Vorlage anlegen"
        onSubmit={(values) => {
          setBusy(true);
          setError(null);
          save({ data: { id: null, recurring: values } })
            .then((result) => navigate({ to: "/rechnungen/wiederkehrend/$id", params: { id: result.id } }))
            .catch((e: unknown) => setError(errorMessage(e)))
            .finally(() => setBusy(false));
        }}
      />
    </>
  );
}
