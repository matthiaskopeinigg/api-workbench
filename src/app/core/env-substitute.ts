import { EnvironmentsService } from './environments.service';

export interface BuildWorkspaceVarOptions {
  /**
   * When set, use this environment’s variables for `{{name}}` substitution.
   * When omitted, use the active workspace environment, or the sole env if
   * none is active.
   */
  environmentId?: string | null;
}

/**
 * Map for `{{name}}` substitution: active environment, or the only env when
 * none is active (same policy as test suite and contract validation).
 */
export function buildWorkspaceVariableMap(
  environments: EnvironmentsService,
  options: BuildWorkspaceVarOptions = {},
): Map<string, string> {
  const m = new Map<string, string>();
  let context =
    options.environmentId != null && options.environmentId !== ''
      ? environments.getEnvironmentById(options.environmentId)
      : null;
  if (!context) {
    context = environments.getActiveContext();
  }
  if (!context) {
    const all = environments.getEnvironments();
    if (all.length === 1) {
      context = all[0];
    }
  }
  if (context?.variables) {
    for (const v of context.variables) {
      if (v.key) m.set(v.key, v.value ?? '');
    }
  }
  return m;
}

export function substituteVariables(input: string, vars: Map<string, string>): string {
  if (!input) return input;
  return input.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (full, name) => {
    const v = lookupVar(vars, name);
    return v == null ? full : v;
  });
}

function lookupVar(vars: Map<string, string>, name: string): string | undefined {
  if (vars.has(name)) return vars.get(name);
  const lower = name.toLowerCase();
  for (const [k, v] of vars) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}
