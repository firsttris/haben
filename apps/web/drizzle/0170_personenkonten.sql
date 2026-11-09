ALTER TABLE "contacts" ADD COLUMN "debitor_nr" integer;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "kreditor_nr" integer;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_debitor_nr_unique" UNIQUE("debitor_nr");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_kreditor_nr_unique" UNIQUE("kreditor_nr");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_debitor_nr_bereich" CHECK ("contacts"."debitor_nr" between 10000 and 69999);--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_kreditor_nr_bereich" CHECK ("contacts"."kreditor_nr" between 70000 and 99999);