/** Felder eines JSON Schemas als flache Liste: Pfad, Typ und ob es immer da ist; für den eingefrorenen Stand und die Doku */
export interface FieldInfo {
  path: string;
  type: string;
  required: boolean;
  description: string;
}

interface JsonSchema {
  type?: string | string[];
  anyOf?: JsonSchema[];
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
}

function typeOf(schema: JsonSchema): string {
  if (schema.anyOf) return schema.anyOf.map(typeOf).sort().join(" | ");
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  const type = Array.isArray(schema.type) ? schema.type.join(" | ") : (schema.type ?? "unbekannt");
  if (type !== "array" || !schema.items) return type;
  // Klammern, sonst sähe eine nullbare Liste aus wie eine Liste mit nullbaren Einträgen
  const items = typeOf(schema.items);
  return items.includes(" | ") ? `(${items})[]` : `${items}[]`;
}

/** Der eigentliche Inhalt hinter „x | null“, damit auch Felder unter einem nullbaren Objekt erscheinen */
function inner(schema: JsonSchema): JsonSchema {
  const options = schema.anyOf?.filter((option) => option.type !== "null") ?? [];
  return options.length === 1 ? inner(options[0]!) : schema;
}

export function flattenSchema(schema: JsonSchema, prefix = "", required = true): FieldInfo[] {
  const target = inner(schema);
  const fields: FieldInfo[] = [];
  if (target.properties) {
    for (const [key, child] of Object.entries(target.properties)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const isRequired = (target.required ?? []).includes(key);
      fields.push({ path, type: typeOf(child), required: isRequired, description: child.description ?? inner(child).description ?? "" });
      fields.push(...flattenSchema(child, path, isRequired));
    }
  } else if (target.type === "array" && target.items) {
    fields.push(...flattenSchema(target.items, `${prefix}[]`, required));
  }
  return fields;
}

export type FrozenField = Omit<FieldInfo, "description">;

/** Was ein altes Layout brechen würde: Feld fehlt, anderer Typ, nicht mehr immer da. Neue Felder sind erlaubt */
export function contractBreaks(frozen: readonly FrozenField[], current: readonly FrozenField[]): string[] {
  const now = new Map(current.map((field) => [field.path, field]));
  return frozen.flatMap((old) => {
    const next = now.get(old.path);
    if (!next) return [`${old.path} fehlt`];
    if (next.type !== old.type) return [`${old.path}: ${old.type} → ${next.type}`];
    if (old.required && !next.required) return [`${old.path} ist nicht mehr immer da`];
    return [];
  });
}
