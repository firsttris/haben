ALTER TABLE "invoice_lines" ADD COLUMN "item_number" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_lines" ADD COLUMN "item_number" text DEFAULT '' NOT NULL;