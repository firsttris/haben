CREATE TABLE "pauschalen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"art" text NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"details" jsonb NOT NULL,
	"amount" integer NOT NULL,
	"reverses_id" uuid,
	"journal_entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pauschalen" ADD CONSTRAINT "pauschalen_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;