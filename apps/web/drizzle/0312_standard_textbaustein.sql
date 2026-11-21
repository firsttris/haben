-- Standard-Textbaustein je Belegart (#1494): ein Baustein füllt neue Belege vor
ALTER TABLE "text_blocks" ADD COLUMN "standard_fuer" text;--> statement-breakpoint
ALTER TABLE "text_blocks" ADD CONSTRAINT "text_blocks_standard_fuer" CHECK ("text_blocks"."standard_fuer" is null or "text_blocks"."standard_fuer" in ('rechnung', 'angebot', 'auftragsbestaetigung', 'lieferschein', 'mahnung'));--> statement-breakpoint
ALTER TABLE "text_blocks" ADD CONSTRAINT "text_blocks_standard_passt" CHECK ("text_blocks"."standard_fuer" is null or ("text_blocks"."contact_id" is null and not ("text_blocks"."standard_fuer" = 'lieferschein' and "text_blocks"."kind" = 'kopf')));--> statement-breakpoint
CREATE UNIQUE INDEX "text_blocks_standard" ON "text_blocks" USING btree ("standard_fuer","kind") WHERE "text_blocks"."standard_fuer" is not null and "text_blocks"."archived_at" is null;--> statement-breakpoint
-- Die Standard-Einleitungen aus den Firmendaten werden zu Kopftext-Bausteinen mit Standard, dann entfallen die Felder
SELECT set_config('haben.actor', 'system:migration', true);--> statement-breakpoint
INSERT INTO "text_blocks" ("name", "kind", "text", "standard_fuer")
  SELECT 'Standard-Einleitung für Rechnungen', 'kopf', "invoice_intro", 'rechnung' FROM "company" WHERE btrim("invoice_intro") <> '';--> statement-breakpoint
INSERT INTO "text_blocks" ("name", "kind", "text", "standard_fuer")
  SELECT 'Standard-Einleitung für Angebote', 'kopf', "quote_intro", 'angebot' FROM "company" WHERE btrim("quote_intro") <> '';--> statement-breakpoint
SELECT set_config('haben.actor', '', true);--> statement-breakpoint
ALTER TABLE "company" DROP COLUMN "invoice_intro";--> statement-breakpoint
ALTER TABLE "company" DROP COLUMN "quote_intro";
