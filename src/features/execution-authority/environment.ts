const INHERITABLE_PROCESS_VARIABLES = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "TMPDIR",
  "TMP",
  "TEMP",
]);

const PROHIBITED_EXPLICIT_VARIABLES = new Set([
  "BASH_ENV",
  "CDPATH",
  "ENV",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_SYSTEM",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PERL5OPT",
  "PYTHONPATH",
  "RUBYOPT",
]);

export interface SecretMinimizedEnvironmentOptions {
  readonly host?: Readonly<NodeJS.ProcessEnv>;
  readonly inherit?: readonly string[];
  readonly explicit?: Readonly<Record<string, string>>;
  /** Trusted adapter-owned controls, never model or repository input. */
  readonly fixed?: Readonly<Record<string, string>>;
  readonly neutralHome?: string;
}

/**
 * Builds a fresh environment instead of cloning process.env. Repository or
 * model values may supply explicit data variables, but cannot set loader,
 * interpreter, home, or adapter-control variables.
 */
export function secretMinimizedEnvironment(options: SecretMinimizedEnvironmentOptions = {}): Readonly<Record<string, string>> {
  const host = options.host ?? process.env;
  const environment: Record<string, string> = {};
  for (const requestedName of options.inherit ?? []) {
    const name = normalizeName(requestedName);
    if (!INHERITABLE_PROCESS_VARIABLES.has(name)) throw new Error(`execution-environment-inheritance-prohibited:${requestedName}`);
    const value = environmentValue(host, requestedName);
    if (value !== undefined) environment[requestedName] = value;
  }
  for (const [name, value] of Object.entries(options.explicit ?? {})) {
    validateVariable(name, value);
    const normalized = normalizeName(name);
    if (PROHIBITED_EXPLICIT_VARIABLES.has(normalized) || normalized === "HOME" || normalized === "USERPROFILE" || normalized === "XDG_CONFIG_HOME" || normalized.startsWith("DYLD_")) {
      throw new Error(`execution-environment-variable-prohibited:${name}`);
    }
    environment[name] = value;
  }
  if (options.neutralHome !== undefined) {
    validateValue(options.neutralHome, "neutral-home");
    environment.HOME = options.neutralHome;
    environment.USERPROFILE = options.neutralHome;
    environment.XDG_CONFIG_HOME = options.neutralHome;
  }
  for (const [name, value] of Object.entries(options.fixed ?? {})) {
    validateVariable(name, value);
    environment[name] = value;
  }
  return Object.freeze(environment);
}

export function sanitizedEnvironment(environment: Readonly<NodeJS.ProcessEnv>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(environment).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => [
    name,
    /secret|token|password|authorization|credential|api[-_]?key/i.test(name) ? "[redacted]" : value ?? "",
  ]));
}

function normalizeName(name: string): string {
  return name.toUpperCase();
}

function environmentValue(environment: Readonly<NodeJS.ProcessEnv>, requestedName: string): string | undefined {
  if (process.platform !== "win32") return environment[requestedName];
  const match = Object.keys(environment).find((name) => normalizeName(name) === normalizeName(requestedName));
  return match === undefined ? undefined : environment[match];
}

function validateVariable(name: string, value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`execution-environment-name-invalid:${name}`);
  validateValue(value, name);
}

function validateValue(value: string, name: string): void {
  if (typeof value !== "string" || value.includes("\0")) throw new Error(`execution-environment-value-invalid:${name}`);
}
