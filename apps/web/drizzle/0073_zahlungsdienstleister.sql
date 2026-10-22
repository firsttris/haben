ALTER TABLE "bank_accounts" DROP CONSTRAINT "bank_accounts_purpose";--> statement-breakpoint
ALTER TABLE "bank_accounts" ALTER COLUMN "iban" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "ledger_index" smallint;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_ledger_index_unique" UNIQUE("ledger_index");--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_provider" CHECK (("bank_accounts"."purpose" = 'zahlungsdienstleister' and "bank_accounts"."provider" is not null and "bank_accounts"."ledger_index" between 1 and 9 and "bank_accounts"."iban" is null)
      or ("bank_accounts"."purpose" <> 'zahlungsdienstleister' and "bank_accounts"."provider" is null and "bank_accounts"."ledger_index" is null and "bank_accounts"."iban" is not null));--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_purpose" CHECK ("bank_accounts"."purpose" in ('geschaeft', 'steuer', 'ruecklage', 'privat', 'zahlungsdienstleister'));