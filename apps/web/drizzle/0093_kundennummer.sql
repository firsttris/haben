ALTER TABLE "company" ADD COLUMN "customer_number_format" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "customer_number_next" integer DEFAULT 1 NOT NULL;