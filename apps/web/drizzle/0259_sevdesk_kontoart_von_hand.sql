CREATE TABLE "sevdesk_accounting_type_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voucher_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"decided_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sevdesk_accounting_type_decisions_kind" CHECK ("sevdesk_accounting_type_decisions"."kind" in ('erloes', 'aufwand'))
);
--> statement-breakpoint
ALTER TABLE "sevdesk_accounting_type_decisions" ADD CONSTRAINT "sevdesk_accounting_type_decisions_voucher_id_lexoffice_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."lexoffice_vouchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sevdesk_accounting_type_decisions_voucher" ON "sevdesk_accounting_type_decisions" USING btree ("voucher_id");