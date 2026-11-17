ALTER TABLE "bank_accounts" ADD COLUMN "csv_mapping" jsonb;--> statement-breakpoint
ALTER TABLE "bank_imports" ADD COLUMN "csv_mapping" jsonb;