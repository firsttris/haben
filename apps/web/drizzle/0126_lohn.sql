CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"personalnummer" integer NOT NULL,
	"vorname" text NOT NULL,
	"nachname" text NOT NULL,
	"strasse" text DEFAULT '' NOT NULL,
	"plz" text DEFAULT '' NOT NULL,
	"ort" text DEFAULT '' NOT NULL,
	"geburtsdatum" date NOT NULL,
	"steuer_id" text DEFAULT '' NOT NULL,
	"steuerklasse" smallint DEFAULT 1 NOT NULL,
	"faktor" integer DEFAULT 1000 NOT NULL,
	"kinderfreibetraege" integer DEFAULT 0 NOT NULL,
	"konfession" text,
	"art" text NOT NULL,
	"monatsgehalt" integer NOT NULL,
	"krankenversicherung" text DEFAULT 'gesetzlich' NOT NULL,
	"krankenkasse" text DEFAULT '' NOT NULL,
	"krankenkasse_betriebsnummer" text DEFAULT '' NOT NULL,
	"zusatzbeitrag" integer DEFAULT 0 NOT NULL,
	"pkv_basisbeitrag" integer DEFAULT 0 NOT NULL,
	"pkv_zuschuss" integer DEFAULT 0 NOT NULL,
	"kinderlosenzuschlag" boolean DEFAULT false NOT NULL,
	"kinder_unter_25" smallint DEFAULT 0 NOT NULL,
	"u1_satz" integer,
	"u2_satz" integer DEFAULT 0 NOT NULL,
	"rv_befreit" boolean DEFAULT false NOT NULL,
	"pauschsteuer" boolean DEFAULT true NOT NULL,
	"personengruppe" text DEFAULT '' NOT NULL,
	"beitragsgruppen" text DEFAULT '' NOT NULL,
	"taetigkeitsschluessel" text DEFAULT '' NOT NULL,
	"sv_nummer" text DEFAULT '' NOT NULL,
	"statusfeststellung" text DEFAULT '' NOT NULL,
	"eintritt" date NOT NULL,
	"austritt" date,
	"iban" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_personalnummer_unique" UNIQUE("personalnummer"),
	CONSTRAINT "employees_steuerklasse" CHECK ("employees"."steuerklasse" between 1 and 6),
	CONSTRAINT "employees_austritt" CHECK ("employees"."austritt" is null or "employees"."austritt" >= "employees"."eintritt")
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"month" smallint NOT NULL,
	"zahltag" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_month_range" CHECK ("payroll_runs"."month" between 1 and 12)
);
--> statement-breakpoint
CREATE TABLE "payslip_cancellations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payslip_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslip_cancellations_payslip_id_unique" UNIQUE("payslip_id")
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" smallint NOT NULL,
	"zahltag" date NOT NULL,
	"mitarbeiter" jsonb NOT NULL,
	"bestandteile" jsonb NOT NULL,
	"brutto" integer NOT NULL,
	"steuer_brutto" integer NOT NULL,
	"sv_brutto" integer NOT NULL,
	"pauschal_brutto" integer NOT NULL,
	"lohnsteuer" integer NOT NULL,
	"soli" integer NOT NULL,
	"kirchensteuer" integer NOT NULL,
	"sv_arbeitnehmer" integer NOT NULL,
	"sv_arbeitgeber" integer NOT NULL,
	"pauschsteuer" integer NOT NULL,
	"sv" jsonb NOT NULL,
	"netto" integer NOT NULL,
	"auszahlung" integer NOT NULL,
	"steuertage" smallint NOT NULL,
	"sv_tage" smallint NOT NULL,
	"stufe" text NOT NULL,
	"gegenpruefen" boolean NOT NULL,
	"gegengeprueft" boolean DEFAULT false NOT NULL,
	"hinweise" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"replaces_id" uuid,
	"pdf" "bytea",
	"sha256" text,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslips_final_has_pdf" CHECK ("payslips"."locked_at" is null or ("payslips"."pdf" is not null and "payslips"."sha256" is not null)),
	CONSTRAINT "payslips_month_range" CHECK ("payslips"."month" between 1 and 12),
	CONSTRAINT "payslips_gegengeprueft" CHECK ("payslips"."locked_at" is null or not "payslips"."gegenpruefen" or "payslips"."gegengeprueft")
);
--> statement-breakpoint
ALTER TABLE "payslip_cancellations" ADD CONSTRAINT "payslip_cancellations_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_replaces_id_payslips_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."payslips"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_month" ON "payroll_runs" USING btree ("year","month");--> statement-breakpoint
CREATE INDEX "payslips_employee_month" ON "payslips" USING btree ("employee_id","year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_replaces" ON "payslips" USING btree ("replaces_id");