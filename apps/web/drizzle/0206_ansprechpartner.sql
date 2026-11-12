CREATE TABLE "contact_persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"telefon" text DEFAULT '' NOT NULL,
	"funktion" text DEFAULT '' NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_persons_name" CHECK (length(btrim("contact_persons"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "contact_person_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "contact_person_id" uuid;--> statement-breakpoint
ALTER TABLE "contact_persons" ADD CONSTRAINT "contact_persons_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_persons_contact" ON "contact_persons" USING btree ("contact_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contact_person_id_contact_persons_id_fk" FOREIGN KEY ("contact_person_id") REFERENCES "public"."contact_persons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_contact_person_id_contact_persons_id_fk" FOREIGN KEY ("contact_person_id") REFERENCES "public"."contact_persons"("id") ON DELETE no action ON UPDATE no action;