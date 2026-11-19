CREATE TABLE "ustid_bestaetigungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"art" text NOT NULL,
	"anfragende_ustid" text NOT NULL,
	"angefragte_ustid" text NOT NULL,
	"firmenname" text,
	"strasse" text,
	"plz" text,
	"ort" text,
	"status" text NOT NULL,
	"anfrage_zeitpunkt" timestamp with time zone NOT NULL,
	"gueltig_ab" text,
	"gueltig_bis" text,
	"erg_firmenname" text,
	"erg_strasse" text,
	"erg_plz" text,
	"erg_ort" text,
	"bzst_id" text,
	"antwort" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ustid_bestaetigungen_art" CHECK ("ustid_bestaetigungen"."art" in ('einfach', 'qualifiziert')),
	CONSTRAINT "ustid_bestaetigungen_status" CHECK ("ustid_bestaetigungen"."status" ~ '^evatr-[0-9]{4}$'),
	CONSTRAINT "ustid_bestaetigungen_vergleich" CHECK (coalesce("ustid_bestaetigungen"."erg_firmenname", 'A') in ('A', 'B', 'C', 'D') and coalesce("ustid_bestaetigungen"."erg_strasse", 'A') in ('A', 'B', 'C', 'D') and coalesce("ustid_bestaetigungen"."erg_plz", 'A') in ('A', 'B', 'C', 'D') and coalesce("ustid_bestaetigungen"."erg_ort", 'A') in ('A', 'B', 'C', 'D')),
	CONSTRAINT "ustid_bestaetigungen_qualifiziert" CHECK ("ustid_bestaetigungen"."art" = 'einfach' or ("ustid_bestaetigungen"."firmenname" is not null and "ustid_bestaetigungen"."ort" is not null))
);
--> statement-breakpoint
ALTER TABLE "ustid_bestaetigungen" ADD CONSTRAINT "ustid_bestaetigungen_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ustid_bestaetigungen_contact" ON "ustid_bestaetigungen" USING btree ("contact_id","created_at");