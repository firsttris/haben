CREATE TABLE "store_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store" text NOT NULL,
	"bank_transaction_id" uuid NOT NULL,
	"payout_transaction_id" uuid NOT NULL,
	"difference_transaction_id" uuid,
	"covered" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_payouts_bank_transaction_id_unique" UNIQUE("bank_transaction_id"),
	CONSTRAINT "store_payouts_payout_transaction_id_unique" UNIQUE("payout_transaction_id")
);
--> statement-breakpoint
ALTER TABLE "store_payouts" ADD CONSTRAINT "store_payouts_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_payouts" ADD CONSTRAINT "store_payouts_payout_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("payout_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_payouts" ADD CONSTRAINT "store_payouts_difference_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("difference_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE no action ON UPDATE no action;