-- Gestaltung der Belege (#113). Die bisherige Akzentfarbe zieht ins Standardprofil um; alles andere bleibt bei den Vorgaben
-- aus packages/core. Ohne Firmenzeile entsteht das Profil beim ersten Speichern. Die Spalte company.accent_color fällt in der
-- nächsten Migration weg.
INSERT INTO letterhead_profiles (name, is_default, settings)
SELECT 'Standard', true, jsonb_build_object('accent', accent_color)
FROM company;
--> statement-breakpoint
CREATE TRIGGER letterhead_profiles_audit AFTER INSERT OR UPDATE OR DELETE ON letterhead_profiles
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
