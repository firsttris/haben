import { createFileRoute, redirect } from "@tanstack/react-router";
import { getLstaStart } from "../../../server/functions/lsta.ts";

export const Route = createFileRoute("/_app/lohn/anmeldung/")({
  // Der älteste noch offene Anmeldungszeitraum, sonst der laufende
  beforeLoad: async () => {
    throw redirect({ to: "/lohn/anmeldung/$zeitraum", params: { zeitraum: await getLstaStart() } });
  },
});
