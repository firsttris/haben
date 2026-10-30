ALTER TABLE "allocations" ADD COLUMN "tax_shares" jsonb;--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "tax_shares_invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "write_offs" ADD COLUMN "tax_shares" jsonb;--> statement-breakpoint
ALTER TABLE "write_offs" ADD COLUMN "tax_shares_invoice_id" uuid;