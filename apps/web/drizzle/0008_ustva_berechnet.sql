ALTER TABLE "vat_returns" ADD COLUMN "source" text DEFAULT 'manuell' NOT NULL;--> statement-breakpoint
ALTER TABLE "vat_returns" ADD COLUMN "override_reason" text;--> statement-breakpoint
ALTER TABLE "vat_returns" ADD COLUMN "computed" jsonb;