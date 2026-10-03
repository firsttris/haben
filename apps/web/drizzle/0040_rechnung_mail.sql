ALTER TABLE "mail_log" ADD COLUMN "bcc" text;--> statement-breakpoint
ALTER TABLE "mail_log" ADD COLUMN "invoice_id" uuid;--> statement-breakpoint
ALTER TABLE "mail_log" ADD COLUMN "dunning_id" uuid;--> statement-breakpoint
ALTER TABLE "mail_log" ADD COLUMN "attachments" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD COLUMN "invoice_subject" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD COLUMN "invoice_body" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD COLUMN "dunning_subject" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_settings" ADD COLUMN "dunning_body" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "recurring_invoices" ADD COLUMN "send_by_mail" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mail_log" ADD CONSTRAINT "mail_log_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_log" ADD CONSTRAINT "mail_log_dunning_id_dunnings_id_fk" FOREIGN KEY ("dunning_id") REFERENCES "public"."dunnings"("id") ON DELETE no action ON UPDATE no action;