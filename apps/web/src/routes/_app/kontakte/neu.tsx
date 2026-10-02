import { createFileRoute } from "@tanstack/react-router";
import { ContactForm } from "../../../components/ContactForm.tsx";

export const Route = createFileRoute("/_app/kontakte/neu")({
  head: () => ({ meta: [{ title: "Neuer Kontakt · Haben" }] }),
  component: () => (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Kontakte</div>
          <h1>Neuer Kontakt</h1>
        </div>
      </div>
      <ContactForm contact={null} />
    </>
  ),
});
