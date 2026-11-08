CREATE TABLE "document_iban_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"kontakt_iban" text NOT NULL,
	"rechnungs_iban" text NOT NULL,
	"wahl" text NOT NULL,
	"decided_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_iban_decisions_wahl" CHECK ("document_iban_decisions"."wahl" in ('kontakt', 'e-rechnung')),
	CONSTRAINT "document_iban_decisions_abweichend" CHECK ("document_iban_decisions"."kontakt_iban" <> "document_iban_decisions"."rechnungs_iban")
);
--> statement-breakpoint
ALTER TABLE "document_iban_decisions" ADD CONSTRAINT "document_iban_decisions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_iban_decisions_document" ON "document_iban_decisions" USING btree ("document_id");