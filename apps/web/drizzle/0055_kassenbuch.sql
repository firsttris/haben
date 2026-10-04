CREATE TABLE "cash_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer NOT NULL,
	"date" date NOT NULL,
	"amount" integer NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"document_id" uuid,
	"reverses_id" uuid,
	"journal_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_entries_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_entries_document" ON "cash_entries" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cash_entries_reverses" ON "cash_entries" USING btree ("reverses_id");