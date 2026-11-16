ALTER TABLE "allocations" ADD COLUMN "tax_details" jsonb;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD COLUMN "tax_details" jsonb;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "tax_details" jsonb;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "tax_details" jsonb;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN "tax_details" jsonb;