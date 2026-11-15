CREATE TABLE "sevdesk_recurring_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sevdesk_id" text NOT NULL,
	"import_id" uuid NOT NULL,
	"recurring_id" uuid,
	"status" text NOT NULL,
	"billing" text NOT NULL,
	"billing_evidence" integer DEFAULT 0 NOT NULL,
	"placeholders" jsonb NOT NULL,
	"hints" jsonb NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sevdesk_recurring_templates_sevdesk_id_unique" UNIQUE("sevdesk_id")
);
--> statement-breakpoint
ALTER TABLE "sevdesk_recurring_templates" ADD CONSTRAINT "sevdesk_recurring_templates_import_id_lexoffice_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."lexoffice_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sevdesk_recurring_templates" ADD CONSTRAINT "sevdesk_recurring_templates_recurring_id_recurring_invoices_id_fk" FOREIGN KEY ("recurring_id") REFERENCES "public"."recurring_invoices"("id") ON DELETE set null ON UPDATE no action;