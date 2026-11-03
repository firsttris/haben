ALTER TABLE "articles" ADD COLUMN "detail" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD COLUMN "detail" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Artikel mit mehrzeiligem Text: erste Zeile wird die Bezeichnung, der Rest der Text darunter, so wie ihn Rechnungen
-- bisher beim Einfügen geteilt haben. Angebotspositionen bleiben, wie sie sind (ab der Festschreibung gesperrt).
SELECT set_config('haben.actor', 'system:migration', true);
--> statement-breakpoint
UPDATE "articles"
   SET "description" = btrim(split_part("description", E'\n', 1), E' \t\r'),
       "detail" = btrim(substr("description", strpos("description", E'\n') + 1), E' \t\r\n')
 WHERE strpos("description", E'\n') > 0 AND btrim(split_part("description", E'\n', 1), E' \t\r') <> '';
--> statement-breakpoint
SELECT set_config('haben.actor', '', true);
