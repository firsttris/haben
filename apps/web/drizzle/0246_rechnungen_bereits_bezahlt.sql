ALTER TABLE "invoices" DROP CONSTRAINT "invoices_payment_method";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paid_via" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "paid_on" date;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paid_payment" CHECK (case when "invoices"."payment_method" = 'bereits_bezahlt'
        then "invoices"."kind" = 'rechnung' and "invoices"."paid_on" is not null and "invoices"."paid_via" is not null and length(btrim("invoices"."paid_via")) between 1 and 120
        else "invoices"."paid_on" is null and "invoices"."paid_via" is null end);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_method" CHECK ("invoices"."payment_method" in ('ueberweisung', 'lastschrift', 'bereits_bezahlt'));