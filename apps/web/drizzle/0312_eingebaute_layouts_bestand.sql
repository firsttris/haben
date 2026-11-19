-- Eingebaute Layouts (#113): Neue Installationen starten mit „Klar“, Schrift und Akzentfarbe aus dem Layout. Bestehende
-- behalten, was sie bisher hatten: das bisherige Layout als Klar in der Fassung „Klassisch“ für jede Belegart ohne eigenes
-- Layout, die bisherige Schrift (Vorgabe war IBM Plex Sans) und ihre eigene Akzentfarbe.
SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
UPDATE "letterhead_profiles"
SET "settings" = "settings"
  || jsonb_build_object('font', COALESCE("settings" -> 'font', '"plex-sans"'::jsonb))
  || jsonb_build_object('accentFromLayout', false)
  || jsonb_build_object('layouts', (
    SELECT jsonb_object_agg(art, CASE
      WHEN "settings" -> 'layouts' -> art ->> 'kind' = 'eigen' THEN "settings" -> 'layouts' -> art
      ELSE '{"kind": "eingebaut", "id": "klar"}'::jsonb
    END)
    FROM unnest(ARRAY['rechnung', 'angebot', 'auftragsbestaetigung', 'lieferschein', 'mahnung']) AS art
  ))
  || jsonb_build_object('layoutOptions', COALESCE("settings" -> 'layoutOptions', '{}'::jsonb) || '{"klar": {"fassung": "klassisch"}}'::jsonb);
--> statement-breakpoint
-- Eingerichtet, aber die Gestaltung nie gespeichert: das Profil mit dem bisherigen Stand anlegen, sonst sähe man ab jetzt Klar
INSERT INTO "letterhead_profiles" ("name", "is_default", "settings")
SELECT 'Standard', true, jsonb_build_object(
  'accent', '#1F6F5C',
  'font', 'plex-sans',
  'accentFromLayout', false,
  'layoutOptions', '{"klar": {"fassung": "klassisch"}}'::jsonb
)
WHERE NOT EXISTS (SELECT 1 FROM "letterhead_profiles" WHERE "is_default")
  AND EXISTS (SELECT 1 FROM "company" WHERE "name" <> '');
