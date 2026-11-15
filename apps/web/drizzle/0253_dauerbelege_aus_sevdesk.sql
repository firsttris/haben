ALTER TABLE "recurring_documents" ALTER COLUMN "sha256" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_documents" ALTER COLUMN "filename" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_documents" ALTER COLUMN "mime_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_documents" ALTER COLUMN "size" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_documents" ADD COLUMN "sevdesk_id" text;--> statement-breakpoint
ALTER TABLE "recurring_documents" ADD COLUMN "sevdesk_raw" jsonb;--> statement-breakpoint
ALTER TABLE "recurring_documents" ADD CONSTRAINT "recurring_documents_sevdesk_id_unique" UNIQUE("sevdesk_id");--> statement-breakpoint
ALTER TABLE "recurring_documents" ADD CONSTRAINT "recurring_documents_file" CHECK (("recurring_documents"."sha256" is null) = ("recurring_documents"."filename" is null) and ("recurring_documents"."sha256" is null) = ("recurring_documents"."mime_type" is null) and ("recurring_documents"."sha256" is null) = ("recurring_documents"."size" is null));--> statement-breakpoint
ALTER TABLE "recurring_documents" ADD CONSTRAINT "recurring_documents_active_file" CHECK ("recurring_documents"."status" <> 'aktiv' or "recurring_documents"."sha256" is not null);