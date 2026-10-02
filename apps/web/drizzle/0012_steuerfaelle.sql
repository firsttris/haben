ALTER TABLE "company" ADD COLUMN "kleinunternehmer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "vorsteuer_abzug" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_treatment" text DEFAULT 'regulaer' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "exemption_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "vat_returns" ADD COLUMN "kz21" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vat_returns" ADD COLUMN "kz45" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vat_returns" ADD COLUMN "kz48" integer DEFAULT 0 NOT NULL;