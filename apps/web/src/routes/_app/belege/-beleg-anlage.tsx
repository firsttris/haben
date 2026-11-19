import { ASSET_KINDS, ASSET_METHODS, type AssetKind, type AssetMethod, usesUsefulLife, elektroAvailable } from "@haben/core";
import { Link } from "@tanstack/react-router";
import { Field } from "../../../components/Field.tsx";
import type { DocumentFormState } from "./-beleg-zustand.ts";
import type { Detail } from "./-beleg-vorschau.tsx";

/** Angaben zur Anlage bei Kategorie „anlage“; Vorschläge laut AfA-Tabelle */
export function AnlageFelder({ f, data }: { f: DocumentFormState; data: Detail }) {
  const { assetName, setAssetName, assetKind, setAssetKind, assetMethod, setAssetMethod, assetYears, setAssetYears, touch } = f;
  return (
    <>
      <Field label="Bezeichnung der Anlage" style={{ gridColumn: "1 / -1" }}>
        {(control) => (
          <input
            {...control}
            value={assetName}
            onChange={(e) => touch(setAssetName)(e.target.value)}
            placeholder="z. B. VW Passat, MacBook Pro"
            maxLength={200}
          />
        )}
      </Field>
      <Field label="Art">
        {(control) => (
          <select
            {...control}
            value={assetKind}
            onChange={(e) => {
              const kind = e.target.value as AssetKind;
              touch(setAssetKind)(kind);
              setAssetMethod(ASSET_KINDS[kind].method);
              const years = ASSET_KINDS[kind].usefulLifeYears;
              // Ohne Vorschlag (sonstige Ausstattung, sonstige Transportmittel) bleibt keine Nutzungsdauer der vorigen Art
              // stehen, etwa die sechs Jahre für Pkw, wie im Formular der Anlage (#312)
              if (ASSET_KINDS[kind].method === "linear") setAssetYears(years ? String(years) : "");
            }}
          >
            {Object.entries(ASSET_KINDS).map(([value, k]) => (
              <option key={value} value={value}>
                {k.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Abschreibung">
        {(control) => (
          <select {...control} value={assetMethod} onChange={(e) => touch(setAssetMethod)(e.target.value as AssetMethod)}>
            {Object.entries(ASSET_METHODS)
              .filter(([value]) => value !== "elektro" || (assetKind === "kfz" && elektroAvailable(data.rechtsform)) || value === assetMethod)
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </select>
        )}
      </Field>
      {usesUsefulLife(assetMethod) && (
        <Field label="Nutzungsdauer in Jahren">
          {(control) => <input {...control} inputMode="decimal" value={assetYears} onChange={(e) => touch(setAssetYears)(e.target.value)} />}
        </Field>
      )}
      <p className="small muted" style={{ gridColumn: "1 / -1", margin: 0 }}>
        Beim Buchen entsteht die Anlage im <Link to="/anlagen">Anlagenverzeichnis</Link>; abgeschrieben wird ab dem Belegdatum. Degressiv mit dem Höchstsatz;
        Satz und Erinnerungswert änderst du bis zur ersten AfA an der Anlage.
      </p>
    </>
  );
}
