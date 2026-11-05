import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { DauerbelegForm } from "../../../components/DauerbelegForm.tsx";
import { NoticeBanner } from "../../../components/NoticeBanner.tsx";
import { dauerbelegFormData } from "../../../lib/dauerbeleg.ts";
import { useAction } from "../../../lib/use-action.ts";
import { getDauerbelegForm, saveDauerbeleg } from "../../../server/functions/dauerbelege.ts";

export const Route = createFileRoute("/_app/dauerbelege/neu")({
  loader: () => getDauerbelegForm(),
  head: () => ({ meta: [{ title: "Neuer Dauerbeleg · Haben" }] }),
  component: NewDauerbelegPage,
});

/** Erster Tag des nächsten Monats als Vorschlag */
function nextMonthStart(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
}

function NewDauerbelegPage() {
  const { suppliers, categories, kleinunternehmer, today } = Route.useLoaderData();
  const navigate = useNavigate();
  const save = useServerFn(saveDauerbeleg);
  const { busy, notice, run } = useAction();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to="/dauerbelege">Dauerbelege</Link> › Neu
          </div>
          <h1>Neuer Dauerbeleg</h1>
        </div>
      </div>
      <NoticeBanner notice={notice} />
      <DauerbelegForm
        initial={{
          name: "",
          supplierName: "",
          supplierUstId: "",
          supplierContactId: null,
          reference: "",
          category: "",
          payment: "bank",
          privateShare: 0,
          amounts: [{ taxRate: 0, net: 0, tax: 0 }],
          taxShown: false,
          note: "",
          intervalMonths: 1,
          nextDate: nextMonthStart(today),
          endDate: null,
          dueDays: 0,
        }}
        suppliers={suppliers}
        categories={categories}
        kleinunternehmer={kleinunternehmer}
        isNew
        busy={busy}
        submitLabel="Dauerbeleg anlegen"
        onSubmit={(values, file) =>
          void run(async () => {
            const result = await save({ data: dauerbelegFormData(null, values, file) });
            await navigate({ to: "/dauerbelege/$id", params: { id: result.id } });
          })
        }
      />
    </>
  );
}
