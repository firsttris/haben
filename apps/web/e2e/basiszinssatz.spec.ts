import { createHash } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { SESSION } from "./daten.ts";

/*
 * Einstellungen → Mahnwesen: Knopf „Bei der Bundesbank abrufen“ (docs/einrichtung.md). Die echte Bundesbank fragt hier
 * niemand ab: Der Aufruf der Server-Funktion wird im Browser abgefangen und mit einem festen Ergebnis beantwortet, im Format,
 * das TanStack Start selbst schickt (seroval-JSON, Kopfzeile x-tss-serialized). Abruf und CSV prüfen die Vitest-Tests.
 */

test.use({ storageState: SESSION });

/** Ergebnis von fetchBaseRateFn, wie der Server es serialisiert */
const serverFnResult = (month: string, basisPoints: number, current: boolean) =>
  JSON.stringify({
    t: 10,
    i: 0,
    p: {
      k: ["result"],
      v: [
        {
          t: 10,
          i: 1,
          p: {
            k: ["month", "basisPoints", "current"],
            v: [
              { t: 1, s: month },
              { t: 0, s: basisPoints },
              { t: 2, s: current ? 2 : 3 },
            ],
          },
          o: 0,
        },
      ],
    },
    o: 0,
  });

/** Laufender Monat in Europe/Berlin, JJJJ-MM: gehört immer zum laufenden Halbjahr */
const thisMonth = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit" }).format(new Date());

/** Name, unter dem TanStack Start die Server-Funktion fetchBaseRateFn (src/server/functions/dunning.ts) übersetzt */
const BASE_RATE_FN = { file: "src/server/functions/dunning.ts", export: "fetchBaseRateFn_createServerFn_handler" };

/**
 * Ist dieser Aufruf fetchBaseRateFn? Im gebauten Server ist die ID sha256(„<Datei>--<Export>“), im Entwicklungsserver
 * Base64url-JSON mit Datei und Export (start-plugin-core, start-compiler/compiler.js).
 */
function isBaseRateFn(url: string): boolean {
  const id = new URL(url).pathname.split("/").pop() ?? "";
  if (id === createHash("sha256").update(`${BASE_RATE_FN.file}--${BASE_RATE_FN.export}`).digest("hex")) return true;
  try {
    const fn = JSON.parse(Buffer.from(id, "base64url").toString("utf8")) as { file?: string; export?: string };
    return fn.export === BASE_RATE_FN.export && (fn.file ?? "").includes(BASE_RATE_FN.file);
  } catch {
    return false;
  }
}

/** Knopf drücken; nur der Aufruf von fetchBaseRateFn geht an die Attrappe, alles andere an den Server */
async function lookUp(page: Page, body: string) {
  let calls = 0;
  await page.route("**/_serverFn/**", (route) => {
    const request = route.request();
    if (request.method() !== "POST" || !isBaseRateFn(request.url())) return route.continue();
    calls += 1;
    return route.fulfill({ status: 200, headers: { "content-type": "application/json", "x-tss-serialized": "true" }, body });
  });
  await page.getByRole("button", { name: "Bei der Bundesbank abrufen" }).click();
  // Ruft der Knopf eine andere Server-Funktion auf, bleibt calls bei 0 und der Test schlägt hier fehl
  await expect.poll(() => calls).toBe(1);
  await page.unroute("**/_serverFn/**");
}

async function openDunning(page: Page) {
  await page.goto("/einstellungen");
  await page.waitForLoadState("networkidle");
  const field = page.getByLabel("Basiszinssatz in %");
  await expect(field).toBeVisible();
  return field;
}

test("trägt den Satz des laufenden Halbjahrs ins Feld ein, gespeichert wird erst mit dem Formular", async ({ page }) => {
  const field = await openDunning(page);
  const before = await field.inputValue();
  const month = thisMonth();

  await lookUp(page, serverFnResult(month, 987, true));
  await expect(field).toHaveValue("9,87");
  await expect(
    page.getByText(`Basiszinssatz 9,87 % eingetragen (Bundesbank, Stand ${month.slice(5)}/${month.slice(0, 4)}). Gilt nach dem Speichern.`),
  ).toBeVisible();

  // Ohne Speichern bleibt der alte Wert
  await openDunning(page);
  await expect(field).toHaveValue(before);
});

test("lässt das Feld unverändert, solange die Bundesbank nur den Satz des vorigen Halbjahrs meldet", async ({ page }) => {
  const field = await openDunning(page);
  const before = await field.inputValue();
  const lastYear = `${Number(thisMonth().slice(0, 4)) - 1}-12`;

  await lookUp(page, serverFnResult(lastYear, 987, false));
  await expect(page.getByText(/^Die Bundesbank meldet 9,87 % mit Stand 12\/\d{4}, der Satz für das neue Halbjahr steht noch nicht/)).toBeVisible();
  await expect(field).toHaveValue(before);
});
