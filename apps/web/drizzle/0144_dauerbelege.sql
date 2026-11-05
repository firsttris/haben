CREATE TABLE "recurring_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'aktiv' NOT NULL,
	"supplier_name" text NOT NULL,
	"supplier_ust_id" text DEFAULT '' NOT NULL,
	"supplier_contact_id" uuid,
	"reference" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"payment" text DEFAULT 'bank' NOT NULL,
	"private_share" smallint DEFAULT 0 NOT NULL,
	"amounts" jsonb NOT NULL,
	"tax_shown" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"interval_months" smallint NOT NULL,
	"anchor_day" smallint NOT NULL,
	"start_date" date NOT NULL,
	"next_date" date NOT NULL,
	"end_date" date,
	"due_days" smallint DEFAULT 0 NOT NULL,
	"sha256" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_documents_interval" CHECK ("recurring_documents"."interval_months" in (1, 3, 6, 12)),
	CONSTRAINT "recurring_documents_anchor_day" CHECK ("recurring_documents"."anchor_day" between 1 and 31),
	CONSTRAINT "recurring_documents_private_share" CHECK ("recurring_documents"."private_share" between 0 and 100),
	CONSTRAINT "recurring_documents_due_days" CHECK ("recurring_documents"."due_days" between 0 and 120)
);
--> statement-breakpoint
DROP INDEX "documents_sha256";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "recurring_document_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "recurring_period" date;--> statement-breakpoint
ALTER TABLE "recurring_documents" ADD CONSTRAINT "recurring_documents_supplier_contact_id_contacts_id_fk" FOREIGN KEY ("supplier_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recurring_documents_sha256" ON "recurring_documents" USING btree ("sha256");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_recurring_document_id_recurring_documents_id_fk" FOREIGN KEY ("recurring_document_id") REFERENCES "public"."recurring_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_recurring_period" ON "documents" USING btree ("recurring_document_id","recurring_period");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_sha256" ON "documents" USING btree ("sha256") WHERE "documents"."replaces_document_id" is null and "documents"."recurring_document_id" is null;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_recurring_pair" CHECK (("documents"."recurring_document_id" is null) = ("documents"."recurring_period" is null));