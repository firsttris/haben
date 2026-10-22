CREATE TABLE "write_offs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"invoice_id" uuid,
	"document_id" uuid,
	"date" date NOT NULL,
	"amount" integer NOT NULL,
	"transaction_id" uuid,
	"reverses_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "write_offs_target" CHECK (("write_offs"."kind" = 'skontoErhalten' and "write_offs"."document_id" is not null and "write_offs"."invoice_id" is null) or ("write_offs"."kind" <> 'skontoErhalten' and "write_offs"."invoice_id" is not null and "write_offs"."document_id" is null))
);
--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "write_offs" ADD CONSTRAINT "write_offs_reverses_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."write_offs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "write_offs_invoice" ON "write_offs" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "write_offs_document" ON "write_offs" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "write_offs_transaction" ON "write_offs" USING btree ("transaction_id");