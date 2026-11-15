ALTER TABLE "company" ADD COLUMN "founding_year" smallint;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "founded_on" date;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_founding_year" CHECK ("company"."founding_year" between 1000 and 9999);