ALTER TABLE "documents" ADD COLUMN "reverse_charge" text;--> statement-breakpoint
ALTER TABLE "vat_returns" ADD COLUMN "kz46" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vat_returns" ADD COLUMN "kz47" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vat_returns" ADD COLUMN "kz84" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vat_returns" ADD COLUMN "kz85" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "vat_returns" ADD COLUMN "kz67" integer DEFAULT 0 NOT NULL;