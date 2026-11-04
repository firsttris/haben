CREATE TABLE "sepa_transfer_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"end_to_end_id" text NOT NULL,
	"amount" integer NOT NULL,
	"skonto" integer DEFAULT 0 NOT NULL,
	"creditor_name" text NOT NULL,
	"creditor_iban" text NOT NULL,
	"remittance" text NOT NULL,
	CONSTRAINT "sepa_transfer_items_end_to_end_id_unique" UNIQUE("end_to_end_id"),
	CONSTRAINT "sepa_transfer_items_amount" CHECK ("sepa_transfer_items"."amount" > 0 and "sepa_transfer_items"."skonto" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sepa_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"execution_date" date NOT NULL,
	"number_of_transactions" integer NOT NULL,
	"control_sum" bigint NOT NULL,
	"xml" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sepa_transfers_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "end_to_end_id" text;--> statement-breakpoint
ALTER TABLE "sepa_transfer_items" ADD CONSTRAINT "sepa_transfer_items_transfer_id_sepa_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."sepa_transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_transfer_items" ADD CONSTRAINT "sepa_transfer_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_transfers" ADD CONSTRAINT "sepa_transfers_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sepa_transfer_items_document" ON "sepa_transfer_items" USING btree ("document_id");