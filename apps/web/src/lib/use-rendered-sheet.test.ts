import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Server-Funktion als steuerbare Attrappe: Jeder Lauf wartet, bis der Test ihn beendet
const runs: { data: { number: string }; finish: (ms: number) => void }[] = [];
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("../server/functions/invoices.ts", () => ({
  renderDocumentPreview: ({ data }: { data: { number: string } }) =>
    new Promise((resolve) => {
      runs.push({ data, finish: (ms) => resolve({ svg: "<svg/>", ms, pages: 1, width: 595, height: 842, text: [] }) });
    }),
}));

const { useRenderedSheet } = await import("./use-rendered-sheet.ts");

type State = ReturnType<typeof useRenderedSheet>;
let state: State;
function Probe({ input }: { input: { number: string } }) {
  state = useRenderedSheet(input as never, null);
  return null;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const document = { activeElement: null, addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { event: undefined, document, HTMLIFrameElement: class {}, addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode = () => Promise.resolve();
    },
  );
});

const container = {
  nodeType: 1,
  nodeName: "DIV",
  tagName: "DIV",
  namespaceURI: "http://www.w3.org/1999/xhtml",
  addEventListener: () => {},
  removeEventListener: () => {},
  ownerDocument: { addEventListener: () => {}, removeEventListener: () => {} },
} as unknown as HTMLElement;

const tick = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

describe("Vorschau nach einem langsamen Lauf", () => {
  it("bleibt nicht stumm veraltet, wenn nach dem Knopf schnell gerendert und dabei weitergetippt wird", async () => {
    const root = createRoot(container);
    await act(async () => root.render(createElement(Probe, { input: { number: "A" } })));
    // Erster Lauf langsam (kalter Render-Prozess): ab jetzt nur noch auf Knopfdruck
    await act(async () => runs[0]!.finish(2500));
    await tick(10);

    await act(async () => root.render(createElement(Probe, { input: { number: "B" } })));
    expect(state.outdated).toBe(true);

    // Knopf „Aktualisieren“; während des Laufs tippt die Person weiter
    await act(async () => void state.refresh());
    expect(runs[1]!.data.number).toBe("B");
    await act(async () => root.render(createElement(Probe, { input: { number: "C" } })));
    // Der Lauf ist diesmal schnell
    await act(async () => runs[1]!.finish(300));
    await tick(1500);

    // Das Formular steht auf C: entweder rendert die Vorschau C von selbst, oder der Knopf bleibt sichtbar
    const lastRendered = runs.at(-1)!.data.number;
    expect({ knopf: state.outdated, letzterLauf: lastRendered }).not.toEqual({ knopf: false, letzterLauf: "B" });
    root.unmount();
  });

  it("Gegenprobe: bleibt der Lauf nach dem Knopf langsam, bleibt der Knopf", async () => {
    runs.length = 0;
    const root = createRoot(container);
    await act(async () => root.render(createElement(Probe, { input: { number: "A" } })));
    await act(async () => runs[0]!.finish(2500));
    await act(async () => root.render(createElement(Probe, { input: { number: "B" } })));
    await act(async () => void state.refresh());
    await act(async () => root.render(createElement(Probe, { input: { number: "C" } })));
    await act(async () => runs[1]!.finish(2500));
    await tick(1500);
    expect(state.outdated).toBe(true);
    root.unmount();
  });
});
