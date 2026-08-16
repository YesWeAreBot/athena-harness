export interface JsonSchema {
  readonly type?: string;
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly items?: JsonSchema;
  readonly enum?: readonly unknown[];
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
}

export function validateJsonSchema(value: unknown, schema: JsonSchema | undefined): string[] {
  if (!schema) return [];
  return validateValue(value, schema, "$");
}

function validateValue(value: unknown, schema: JsonSchema, path: string): string[] {
  const errors: string[] = [];
  if (schema.enum && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${path} must be one of ${JSON.stringify(schema.enum)}`);
  }

  switch (schema.type) {
    case "object":
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        errors.push(`${path} must be an object`);
        return errors;
      }
      {
        const record = value as Record<string, unknown>;
        for (const key of schema.required ?? []) {
          if (!(key in record)) errors.push(`${path}.${key} is required`);
        }
        for (const [key, sub] of Object.entries(schema.properties ?? {})) {
          if (key in record) errors.push(...validateValue(record[key], sub, `${path}.${key}`));
        }
        if (schema.additionalProperties === false) {
          for (const key of Object.keys(record)) {
            if (!(schema.properties && key in schema.properties)) errors.push(`${path}.${key} is not allowed`);
          }
        }
      }
      return errors;
    case "array":
      if (!Array.isArray(value)) {
        errors.push(`${path} must be an array`);
        return errors;
      }
      value.forEach((item, index) => {
        if (schema.items) errors.push(...validateValue(item, schema.items, `${path}[${index}]`));
      });
      return errors;
    case "string":
      if (typeof value !== "string") errors.push(`${path} must be a string`);
      else {
        if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} is shorter than ${schema.minLength}`);
        if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is longer than ${schema.maxLength}`);
      }
      return errors;
    case "number":
      if (typeof value !== "number") errors.push(`${path} must be a number`);
      else {
        if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
        if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
      }
      return errors;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) errors.push(`${path} must be an integer`);
      return errors;
    case "boolean":
      if (typeof value !== "boolean") errors.push(`${path} must be a boolean`);
      return errors;
    case "null":
      if (value !== null) errors.push(`${path} must be null`);
      return errors;
    default:
      return errors;
  }
}

export function satisfiesVersion(version: string, range: string | undefined): boolean {
  if (!range || range.trim() === "*" || range.trim() === "latest") return true;
  const current = parseVersion(version);
  const target = range.trim();
  const match = /^(>=|<=|>|<|=)?\s*v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(target);
  if (match) {
    const op = match[1] ?? "=";
    const wanted = parseVersion(`${match[2]}.${match[3]}.${match[4]}`);
    return compare(current, wanted, op);
  }
  if (target.startsWith("^")) {
    const wanted = parseVersion(target.slice(1));
    const [wantedMajor, wantedMinor, wantedPatch] = wanted;
    const [currentMajor, currentMinor, currentPatch] = current;
    return compare(current, wanted, ">=") && (wantedMajor > 0 ? currentMajor === wantedMajor : wantedMinor > 0 ? currentMinor === wantedMinor : currentPatch === wantedPatch);
  }
  if (target.startsWith("~")) {
    const wanted = parseVersion(target.slice(1));
    const [wantedMajor, wantedMinor] = wanted;
    const [currentMajor, currentMinor] = current;
    return compare(current, wanted, ">=") && currentMajor === wantedMajor && currentMinor === wantedMinor;
  }
  return false;
}

function parseVersion(value: string): [number, number, number] {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) throw new Error(`Invalid version: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compare(current: readonly [number, number, number], wanted: readonly [number, number, number], op: string): boolean {
  const [currentMajor, currentMinor, currentPatch] = current;
  const [wantedMajor, wantedMinor, wantedPatch] = wanted;
  const delta = currentMajor - wantedMajor || currentMinor - wantedMinor || currentPatch - wantedPatch;
  switch (op) {
    case ">":
      return delta > 0;
    case ">=":
      return delta >= 0;
    case "<":
      return delta < 0;
    case "<=":
      return delta <= 0;
    default:
      return delta === 0;
  }
}
