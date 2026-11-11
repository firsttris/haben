CREATE TABLE "external_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload_hash" text NOT NULL,
	"voucher_id" uuid,
	"order_document_id" uuid,
	"entry_id" uuid,
	"payload" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_imports_target" CHECK (("external_imports"."kind" = 'invoice' and "external_imports"."voucher_id" is not null and "external_imports"."order_document_id" is null and "external_imports"."entry_id" is null)
      or ("external_imports"."kind" = 'quote' and "external_imports"."order_document_id" is not null and "external_imports"."voucher_id" is null and "external_imports"."entry_id" is null)
      or ("external_imports"."kind" = 'journal' and "external_imports"."entry_id" is not null and "external_imports"."voucher_id" is null and "external_imports"."order_document_id" is null))
);
--> statement-breakpoint
ALTER TABLE "legacy_order_documents" ADD COLUMN "source" text DEFAULT 'sevdesk' NOT NULL;--> statement-breakpoint
ALTER TABLE "external_imports" ADD CONSTRAINT "external_imports_voucher_id_lexoffice_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."lexoffice_vouchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_imports" ADD CONSTRAINT "external_imports_order_document_id_legacy_order_documents_id_fk" FOREIGN KEY ("order_document_id") REFERENCES "public"."legacy_order_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_imports" ADD CONSTRAINT "external_imports_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_imports_identity" ON "external_imports" USING btree ("source","kind","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_imports_voucher" ON "external_imports" USING btree ("voucher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_imports_order" ON "external_imports" USING btree ("order_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_imports_entry" ON "external_imports" USING btree ("entry_id");