ALTER TABLE "document_amounts" ADD COLUMN "original_net" bigint;--> statement-breakpoint
ALTER TABLE "document_amounts" ADD COLUMN "original_tax" bigint;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "exchange_rate" numeric(12, 6);