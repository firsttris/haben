CREATE TABLE "bank_neutralizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"counter_transaction_id" uuid NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"reverses_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_neutralizations_two" CHECK ("bank_neutralizations"."transaction_id" <> "bank_neutralizations"."counter_transaction_id"),
	CONSTRAINT "bank_neutralizations_note" CHECK ("bank_neutralizations"."reverses_id" is not null or length(btrim("bank_neutralizations"."note")) > 0)
);
--> statement-breakpoint
ALTER TABLE "bank_neutralizations" ADD CONSTRAINT "bank_neutralizations_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_neutralizations" ADD CONSTRAINT "bank_neutralizations_counter_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("counter_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_neutralizations" ADD CONSTRAINT "bank_neutralizations_reverses_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."bank_neutralizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_neutralizations_transaction" ON "bank_neutralizations" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "bank_neutralizations_counter" ON "bank_neutralizations" USING btree ("counter_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_neutralizations_reverses" ON "bank_neutralizations" USING btree ("reverses_id");