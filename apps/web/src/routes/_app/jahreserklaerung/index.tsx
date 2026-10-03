import { createFileRoute, redirect } from "@tanstack/react-router";

/** Ohne Jahr: das Vorjahr, für das die Erklärungen jetzt fällig sind */
export const Route = createFileRoute("/_app/jahreserklaerung/")({
  beforeLoad: () => {
    throw redirect({ to: "/jahreserklaerung/$jahr", params: { jahr: String(new Date().getFullYear() - 1) } });
  },
});
