CREATE TABLE "document_cancellations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_cancellations_document_id_unique" UNIQUE("document_id"),
	CONSTRAINT "document_cancellations_journal_entry_id_unique" UNIQUE("journal_entry_id")
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_sha256_unique";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "replaces_document_id" uuid;--> statement-breakpoint
ALTER TABLE "document_cancellations" ADD CONSTRAINT "document_cancellations_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_cancellations" ADD CONSTRAINT "document_cancellations_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_replaces_fk" FOREIGN KEY ("replaces_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_sha256" ON "documents" USING btree ("sha256") WHERE "documents"."replaces_document_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_replaces" ON "documents" USING btree ("replaces_document_id");