import { createRouter } from "@tanstack/react-router";
import { NichtGefunden, SeitenFehler } from "./components/Fehlerseiten.tsx";
import { routeTree } from "./routeTree.gen.ts";

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultNotFoundComponent: NichtGefunden,
    defaultErrorComponent: SeitenFehler,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
