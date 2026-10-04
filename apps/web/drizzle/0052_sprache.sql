ALTER TABLE "contacts" ADD COLUMN "language" text DEFAULT 'de' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "language" text DEFAULT 'de' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "language" text DEFAULT 'de' NOT NULL;