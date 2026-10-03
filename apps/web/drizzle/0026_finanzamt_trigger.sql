-- Nachrichten an das Finanzamt sind wie Übermittlungen unveränderlich.

CREATE TRIGGER elster_messages_append_only BEFORE UPDATE OR DELETE ON elster_messages
  FOR EACH ROW EXECUTE FUNCTION haben_append_only();
--> statement-breakpoint
CREATE TRIGGER elster_messages_audit AFTER INSERT ON elster_messages
  FOR EACH ROW EXECUTE FUNCTION haben_audit();
