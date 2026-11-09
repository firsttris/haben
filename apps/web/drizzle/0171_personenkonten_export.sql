CREATE TABLE "datev_personenkonten" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"rolle" text NOT NULL,
	"nummer" integer NOT NULL,
	"jahr" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "datev_personenkonten_rolle" CHECK ("datev_personenkonten"."rolle" in ('debitor', 'kreditor'))
);
--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "datev_personenkonten_ab" integer;--> statement-breakpoint
ALTER TABLE "datev_personenkonten" ADD CONSTRAINT "datev_personenkonten_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "datev_personenkonten_kontakt" ON "datev_personenkonten" USING btree ("contact_id","rolle");--> statement-breakpoint
CREATE UNIQUE INDEX "datev_personenkonten_nummer" ON "datev_personenkonten" USING btree ("rolle","nummer");