import { createFileRoute } from "@tanstack/react-router";
import { ContactForm } from "../../../components/ContactForm.tsx";
import { getCustomerNumbering } from "../../../server/functions/company.ts";

export const Route = createFileRoute("/_app/kontakte/neu")({
  loader: () => getCustomerNumbering(),
  head: () => ({ meta: [{ title: "Neuer Kontakt · Haben" }] }),
  component: NewContactPage,
});

function NewContactPage() {
  const { preview } = Route.useLoaderData();
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Kontakte</div>
          <h1>Neuer Kontakt</h1>
        </div>
      </div>
      <ContactForm contact={null} nextNumber={preview} />
    </>
  );
}
