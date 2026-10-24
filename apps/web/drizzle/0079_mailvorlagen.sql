ALTER TABLE "mail_settings" ADD COLUMN "templates" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Bisherige Vorlagen (nur deutsch) werden die allgemeinen deutschen Vorlagen für Rechnungen und Mahnungen
SELECT set_config('haben.actor', 'system:migration', true);--> statement-breakpoint
UPDATE "mail_settings" SET "templates" = jsonb_strip_nulls(jsonb_build_object(
  'rechnung:de', CASE WHEN "invoice_subject" <> '' OR "invoice_body" <> '' THEN jsonb_build_object('subject', "invoice_subject", 'body', "invoice_body") END,
  'mahnung:de', CASE WHEN "dunning_subject" <> '' OR "dunning_body" <> '' THEN jsonb_build_object('subject', "dunning_subject", 'body', "dunning_body") END
));--> statement-breakpoint
SELECT set_config('haben.actor', '', true);--> statement-breakpoint
ALTER TABLE "mail_settings" DROP COLUMN "invoice_subject";--> statement-breakpoint
ALTER TABLE "mail_settings" DROP COLUMN "invoice_body";--> statement-breakpoint
ALTER TABLE "mail_settings" DROP COLUMN "dunning_subject";--> statement-breakpoint
ALTER TABLE "mail_settings" DROP COLUMN "dunning_body";