const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function extractVariables(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(TOKEN)) found.add(match[1]);
  return [...found];
}

/**
 * Replaces {{Column Name}} tokens. Lookup is exact first, then
 * case/whitespace-insensitive, so "{{first name}}" still finds "First Name".
 */
export function render(template: string, vars: Record<string, string>): string {
  const loose = new Map<string, string>();
  for (const [key, value] of Object.entries(vars)) {
    loose.set(key.toLowerCase().replace(/\s+/g, " ").trim(), value);
  }
  return template.replace(TOKEN, (_match, name: string) => {
    if (name in vars) return vars[name] ?? "";
    return loose.get(name.toLowerCase().replace(/\s+/g, " ").trim()) ?? "";
  });
}

/** Variables used in a template that the leads sheet cannot supply. */
export function unknownVariables(template: string, known: string[]): string[] {
  const normalized = new Set(known.map((k) => k.toLowerCase().replace(/\s+/g, " ").trim()));
  return extractVariables(template).filter(
    (name) => !normalized.has(name.toLowerCase().replace(/\s+/g, " ").trim()),
  );
}

/** Plain-text body -> minimal HTML, preserving paragraph breaks. */
export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}
