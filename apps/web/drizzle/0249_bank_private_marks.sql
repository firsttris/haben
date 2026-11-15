CREATE TABLE "bank_private_marks" (
	"transaction_id" uuid PRIMARY KEY NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_private_marks" ADD CONSTRAINT "bank_private_marks_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;
