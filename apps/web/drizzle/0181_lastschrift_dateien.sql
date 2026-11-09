CREATE TABLE "sepa_direct_debit_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"direct_debit_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"mandate_id" uuid NOT NULL,
	"payment_info_id" text NOT NULL,
	"end_to_end_id" text NOT NULL,
	"scheme" text NOT NULL,
	"sequence" text NOT NULL,
	"collection_date" date NOT NULL,
	"amount" integer NOT NULL,
	"debtor_name" text NOT NULL,
	"debtor_iban" text NOT NULL,
	"remittance" text NOT NULL,
	CONSTRAINT "sepa_direct_debit_items_end_to_end_id_unique" UNIQUE("end_to_end_id"),
	CONSTRAINT "sepa_direct_debit_items_amount" CHECK ("sepa_direct_debit_items"."amount" > 0),
	CONSTRAINT "sepa_direct_debit_items_scheme" CHECK ("sepa_direct_debit_items"."scheme" in ('CORE', 'B2B')),
	CONSTRAINT "sepa_direct_debit_items_sequence" CHECK ("sepa_direct_debit_items"."sequence" in ('FRST', 'RCUR'))
);
--> statement-breakpoint
CREATE TABLE "sepa_direct_debits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"number_of_transactions" integer NOT NULL,
	"control_sum" bigint NOT NULL,
	"xml" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sepa_direct_debits_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "sepa_direct_debit_items" ADD CONSTRAINT "sepa_direct_debit_items_direct_debit_id_sepa_direct_debits_id_fk" FOREIGN KEY ("direct_debit_id") REFERENCES "public"."sepa_direct_debits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_direct_debit_items" ADD CONSTRAINT "sepa_direct_debit_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_direct_debit_items" ADD CONSTRAINT "sepa_direct_debit_items_mandate_id_sepa_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."sepa_mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_direct_debits" ADD CONSTRAINT "sepa_direct_debits_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sepa_direct_debit_items_invoice" ON "sepa_direct_debit_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "sepa_direct_debit_items_mandate" ON "sepa_direct_debit_items" USING btree ("mandate_id");--> statement-breakpoint
CREATE INDEX "sepa_direct_debit_items_payment_info" ON "sepa_direct_debit_items" USING btree ("payment_info_id");