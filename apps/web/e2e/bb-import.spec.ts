import { expect, test } from "@playwright/test";
import { zipSync } from "fflate";
import { bestaetigen, durchlaufSeite, einrichten, gehe } from "./einrichtung.ts";

/** Umzug aus BuchhaltungsButler mit Testlauf, Import und PDF im Archiv, in eigener, leerer Datenbank (Projekt „bb-import“, e2e/durchlaeufe.ts) */
const BB_HEADERS = [
  "Datum",
  "Buchungstext",
  "Betrag",
  "Währung",
  "Sollkonto",
  "Habenkonto",
  "Steuerschlüssel",
  "Buchungsnummer",
  "Rechnungsnummern",
  "Gegenpartei",
  "Umsatzsteuer",
  "Zugewiesene Beträge",
  "Beleglinks",
  "Festschreibung",
  "Kommentar",
  "Leistungsdatum",
];
const DATEV_HEADERS = [
  "Umsatz (ohne Soll/Haben-Kz)",
  "Soll/Haben-Kennzeichen",
  "WKZ Umsatz",
  "Konto",
  "Gegenkonto (ohne BU-Schlüssel)",
  "BU-Schlüssel",
  "Belegdatum",
  "Belegfeld 1",
  "Buchungstext",
  ...Array.from({ length: 16 }, (_, i) => `Beleginfo - ${i % 2 === 0 ? "Art" : "Inhalt"} ${Math.floor(i / 2) + 1}`),
];

function csv(rows: string[][]): Buffer {
  return Buffer.from(rows.map((row) => row.map((field) => `"${field}"`).join(";")).join("\r\n"));
}

function exportFiles() {
  const meta = Array.from({ length: 30 }, () => "");
  Object.assign(meta, {
    0: "EXTF",
    1: "700",
    2: "21",
    3: "Buchungsstapel",
    4: "12",
    12: "20230101",
    13: "4",
    14: "20230101",
    15: "20231231",
    21: "EUR",
    26: "03",
  });
  const info = [
    "Buchungsnummer",
    "127",
    "URL",
    "https://bb.example/202300327.pdf",
    "Gegenpartei",
    "Muster GmbH",
    "Rechnungsnummer",
    "202300327",
    "Betrag",
    "67,79",
    "Umsatzsteuer",
    "19",
    "Rechnungsdatum",
    "02.01.2023",
  ];
  return [
    {
      name: "EXTF_Buchungsstapel.csv",
      mimeType: "text/csv",
      buffer: csv([meta, DATEV_HEADERS, ["67,79", "H", "EUR", "1203", "4964", "9", "0401", "202300327", "Muster GmbH", ...info]]),
    },
    {
      name: "BB_Buchungsstapel.csv",
      mimeType: "text/csv",
      buffer: csv([
        BB_HEADERS,
        [
          "04.01.2023",
          "Muster GmbH",
          "67,79",
          "EUR",
          "4964",
          "1203",
          "9",
          "127",
          "202300327",
          "Muster GmbH",
          "19",
          "67,79",
          "https://bb.example/202300327.pdf",
          "1",
          "",
          "02.01.2023",
        ],
      ]),
    },
    {
      name: "Belege.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(zipSync({ "Belege/127.pdf": Buffer.from("%PDF-1.4\n%%EOF") })),
    },
  ];
}

test("BuchhaltungsButler: Testlauf, Import und PDF im Archiv", async ({ browser }) => {
  const { page, pageErrors } = await durchlaufSeite(browser);
  await einrichten(page);
  await gehe(page, "/archiv");
  await page.getByRole("button", { name: "Umzug aus BuchhaltungsButler", exact: true }).click();
  const card = page.getByRole("region", { name: "BuchhaltungsButler-Exporte prüfen und importieren" });
  await card.getByLabel("BuchhaltungsButler-Exporte").setInputFiles(exportFiles());
  await card.getByRole("button", { name: "Testlauf starten" }).click();
  await expect(card.getByText(/Testlauf ohne Fehler/)).toBeVisible({ timeout: 30_000 });
  await expect(card.locator(".progress-facts")).toContainText("2023");
  await card.getByRole("button", { name: "Diese Daten importieren" }).click();
  await bestaetigen(page, "Import starten");
  await expect(card.getByText(/Import abgeschlossen: 1 Belege und 1 PDFs aus 1 Buchungen/)).toBeVisible({ timeout: 60_000 });

  await page.getByRole("navigation", { name: "Bereich wählen" }).getByRole("link", { name: "Belege", exact: true }).click();
  await page.getByRole("link", { name: /202300327/ }).click();
  await expect(page.getByRole("heading", { name: "202300327" })).toBeVisible();
  await expect(page.getByTitle("Datei 127.pdf")).toBeVisible();
  expect(pageErrors).toEqual([]);
});
