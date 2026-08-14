/**
 * Custom-variable helpers. Import-free on purpose so the self-test can load
 * them without pulling in the Google client chain.
 */
export type CustomVariable = {
  name: string;
  value: string;
};

/** Custom variables as a plain lookup, ready to merge under the sheet columns. */
export function variableMap(variables: CustomVariable[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const variable of variables ?? []) {
    const name = variable.name.trim();
    if (name) map[name] = variable.value;
  }
  return map;
}
