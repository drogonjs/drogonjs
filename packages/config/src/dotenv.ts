/** Parses `.env` text: `KEY=value`, `export KEY=value`, quoted and multi-line values, `#` comments. */
export function parseDotenv(source: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*('(?:\\'|[^'])*'|"(?:\\"|[^"])*"|`(?:\\`|[^`])*`|[^\n#]*)?\s*(?:#.*)?$/gm;
  const text = source.replace(/\r\n?/g, '\n');
  for (const match of text.matchAll(pattern)) {
    const key = match[1]!;
    let value = (match[2] ?? '').trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'" || quote === '`') && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"');
    }
    result[key] = value;
  }
  return result;
}

/** Replaces `${NAME}`, `${NAME:-fallback}` and `$NAME` with values from `env`, recursively. */
export function expandVariables(values: Record<string, string>, env: Record<string, string | undefined>) {
  const lookup = (name: string, seen: Set<string>): string => {
    if (seen.has(name)) return '';
    const raw = values[name] ?? env[name];
    if (raw === undefined) return '';
    return expand(raw, new Set([...seen, name]));
  };
  const expand = (value: string, seen: Set<string>): string =>
    value.replace(/(\\)?\$(?:\{([\w.-]+)(?::-([^}]*))?\}|([A-Za-z_]\w*))/g, (whole, escaped, braced, fallback, bare) => {
      if (escaped) return whole.slice(1);
      const name = braced ?? bare;
      const resolved = lookup(name, seen);
      return resolved === '' && fallback !== undefined ? fallback : resolved;
    });

  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, expand(value, new Set([key]))]));
}
