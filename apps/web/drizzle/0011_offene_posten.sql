ALTER TABLE "documents" ADD COLUMN "lexoffice_voucher_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "lexoffice_voucher_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_lexoffice_voucher_id_unique" UNIQUE("lexoffice_voucher_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_lexoffice_voucher_id_unique" UNIQUE("lexoffice_voucher_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_lexoffice_voucher_fk" FOREIGN KEY ("lexoffice_voucher_id") REFERENCES "lexoffice_vouchers"("id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_lexoffice_voucher_fk" FOREIGN KEY ("lexoffice_voucher_id") REFERENCES "lexoffice_vouchers"("id");
