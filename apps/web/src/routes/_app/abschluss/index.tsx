import { currentYear } from "@haben/core";
import { createFileRoute, redirect } from "@tanstack/react-router";

/** Ohne Jahr: das Vorjahr, dessen Abschluss jetzt ansteht */
export const Route = createFileRoute("/_app/abschluss/")({
  beforeLoad: () => {
    throw redirect({ to: "/abschluss/$jahr", params: { jahr: String(currentYear() - 1) } });
  },
});
