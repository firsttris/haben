-- Ausschüttungen und Übermittlungen der Kapitalertragsteuer-Anmeldung sind wie die gebuchten Vorgänge nur anhängbar;
-- ein Storno ist eine Gegenbuchung im Journal. Beide stehen im Audit-Log (haben_audit lässt das Protokoll-PDF weg).

CREATE TRIGGER dividends_append_only BEFORE UPDATE OR DELETE ON dividends
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER dividends_audit AFTER INSERT ON dividends
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
--> statement-breakpoint
CREATE TRIGGER kapest_submissions_append_only BEFORE UPDATE OR DELETE ON kapest_submissions
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER kapest_submissions_audit AFTER INSERT ON kapest_submissions
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
