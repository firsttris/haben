CREATE TABLE "external_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload_hash" text NOT NULL,
	"invoice_id" uuid,
	"quote_id" uuid,
	"entry_id" uuid,
	"settled_amount" integer DEFAULT 0 NOT NULL,
	"payment_uncertain" boolean DEFAULT false NOT NULL,
	"cash_flows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_imports_kind" CHECK ("external_imports"."kind" in ('quote', 'invoice', 'journal')),
	CONSTRAINT "external_imports_target" CHECK (case "external_imports"."kind"
    when 'quote' then "external_imports"."quote_id" is not null and "external_imports"."invoice_id" is null and "external_imports"."entry_id" is null
    when 'invoice' then "external_imports"."invoice_id" is not null and "external_imports"."quote_id" is null and "external_imports"."entry_id" is null
    when 'journal' then "external_imports"."entry_id" is not null and "external_imports"."invoice_id" is null and "external_imports"."quote_id" is null end)
);
--> statement-breakpoint
ALTER TABLE "quotes" DROP CONSTRAINT "quotes_number_unique";--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "external_source" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "external_imports" ADD CONSTRAINT "external_imports_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_imports" ADD CONSTRAINT "external_imports_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_imports" ADD CONSTRAINT "external_imports_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_imports_identity" ON "external_imports" USING btree ("source","kind","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_imports_invoice" ON "external_imports" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_imports_quote" ON "external_imports" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_imports_entry" ON "external_imports" USING btree ("entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_external_ref" ON "quotes" USING btree ("external_source","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_number_local" ON "quotes" USING btree ("number") WHERE "quotes"."external_source" is null;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_external_ref_pair" CHECK (("quotes"."external_source" is null) = ("quotes"."external_id" is null));