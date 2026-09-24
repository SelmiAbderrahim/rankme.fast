/**
 * Compose-stack helpers shared by the Playwright suites.
 *
 * Central choke point for locating docker-compose.yml and running commands
 * inside the composed stack. Keeping every psql/redis mutation behind
 * `runComposePsql` prevents future specs from string-concatenating SQL for
 * fixture setup and keeps helper code out of the production bundle.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

let cachedComposeRoot: string | null = null;

export type ComposeRuntimeService = 'api' | 'worker';

const TARGET_OVERRIDE_ENV_VARS = [
  'COMPOSE_FILE',
  'COMPOSE_ENV_FILES',
  'COMPOSE_PATH_SEPARATOR',
  'COMPOSE_PROFILES',
  'DOCKER_CONTEXT',
  'DOCKER_CONFIG',
  'DOCKER_DEFAULT_PLATFORM',
  'DOCKER_HOST',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
] as const;

export function resolveComposeRoot(): string {
  if (cachedComposeRoot !== null) return cachedComposeRoot;
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(path.join(dir, 'docker-compose.yml'))) {
      cachedComposeRoot = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`E2E helper cannot find docker-compose.yml above process.cwd()=${process.cwd()}`);
}

function safeComposeProjectName(environment: NodeJS.ProcessEnv): string {
  const project = environment.COMPOSE_PROJECT_NAME;
  const safe =
    project === 'rankme-e2e' ||
    (project !== undefined && /^rankme-community-cold-[a-z0-9][a-z0-9-]*$/u.test(project));
  if (!safe) {
    throw new Error(
      'E2E Compose helper refuses projects outside rankme-e2e or rankme-community-cold-*',
    );
  }
  return project;
}

/**
 * Refuse ambient knobs that can silently redirect Docker/Compose away from
 * the declared isolated gate. Every invocation below also supplies the
 * canonical project, project directory, and compose file explicitly.
 */
export function assertCanonicalComposeEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  safeComposeProjectName(environment);
  const overrides = TARGET_OVERRIDE_ENV_VARS.filter(
    (name) => (environment[name] ?? '') !== '',
  );
  if (overrides.length > 0) {
    throw new Error(`E2E Compose helper refuses ambient overrides: ${overrides.join(', ')}`);
  }
}

interface ComposeCommandOptions {
  environment?: NodeJS.ProcessEnv;
  input?: string;
}

/** Run Docker Compose against the one canonical file and isolated project. */
export function runComposeCommand(
  command: readonly string[],
  options: ComposeCommandOptions = {},
): string {
  const environment = options.environment ?? process.env;
  assertCanonicalComposeEnvironment(environment);
  const repoRoot = resolveComposeRoot();
  const composeFile = path.join(repoRoot, 'docker-compose.yml');
  return execFileSync(
    'docker',
    [
      '--context',
      'default',
      'compose',
      '--project-directory',
      repoRoot,
      '--file',
      composeFile,
      '--project-name',
      safeComposeProjectName(environment),
      ...command,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(options.input === undefined ? {} : { input: options.input }),
    },
  );
}

/** Recreate only explicitly named runtime services with bounded env overrides. */
export function recreateComposeServices(
  services: readonly ComposeRuntimeService[],
  overrides: Record<string, string>,
): void {
  if (services.length === 0) throw new Error('At least one Compose service is required');
  for (const name of Object.keys(overrides)) {
    if (!/^[A-Z_][A-Z0-9_]*$/u.test(name)) {
      throw new Error(`Invalid Compose environment override name: ${name}`);
    }
  }
  runComposeCommand(
    [
      'up',
      '-d',
      '--wait',
      '--wait-timeout',
      '90',
      '--force-recreate',
      '--no-deps',
      ...services,
    ],
    { environment: { ...process.env, ...overrides } },
  );
}

/** Capture the inherited gate values that a mutating test must restore. */
export function captureInheritedComposeEnvironment(
  names: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    names.map((name) => {
      if (!/^[A-Z_][A-Z0-9_]*$/u.test(name)) {
        throw new Error(`Invalid inherited Compose environment name: ${name}`);
      }
      const value = process.env[name];
      if (value === undefined) {
        throw new Error(`E2E gate must explicitly export ${name}`);
      }
      return [name, value];
    }),
  );
}

/** Read a bounded allowlist of environment values from a running service. */
export function readComposeServiceEnvironment(
  service: ComposeRuntimeService,
  names: readonly string[],
): Record<string, string | null> {
  for (const name of names) {
    if (!/^[A-Z_][A-Z0-9_]*$/u.test(name)) {
      throw new Error(`Invalid Compose environment variable name: ${name}`);
    }
  }
  const script = `const names=${JSON.stringify(names)};process.stdout.write(JSON.stringify(Object.fromEntries(names.map((name)=>[name,process.env[name]??null]))));`;
  const output = runComposeCommand(['exec', '-T', service, 'node', '--eval', script]);
  const parsed = JSON.parse(output) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid ${service} Compose environment response`);
  }
  const values = parsed as Record<string, unknown>;
  for (const name of names) {
    if (typeof values[name] !== 'string' && values[name] !== null) {
      throw new Error(`Invalid ${service} Compose environment value for ${name}`);
    }
  }
  return values as Record<string, string | null>;
}

/** Assert api/worker runtime parity against the captured inherited state. */
export function assertComposeRuntimeParity(
  expected: Record<string, string>,
  services: readonly ComposeRuntimeService[] = ['api', 'worker'],
): void {
  const names = Object.keys(expected);
  for (const service of services) {
    const actual = readComposeServiceEnvironment(service, names);
    for (const name of names) {
      if (actual[name] !== expected[name]) {
        throw new Error(
          `${service} runtime ${name}=${JSON.stringify(actual[name])}; expected ${JSON.stringify(expected[name])}`,
        );
      }
    }
  }
}

export interface PsqlRunOptions {
  /** Named psql variables, injected via `-v key=value` and referenced as `:'key'`. */
  variables?: Record<string, string>;
}

/**
 * Execute a psql statement against the compose `postgres` service.
 *
 * The statement MUST reference parameters as `:'name'` (identifier-quoted) and
 * pass raw values via `variables`. String-concatenating user-controlled data
 * into `sql` is forbidden — the type accepts a fixed template string and
 * parameters, never a computed statement.
 */
export function runComposePsql(sql: string, options: PsqlRunOptions = {}): void {
  runComposePsqlOutput(sql, options);
}

/** Execute a read-only/scalar fixture query and return trimmed psql output. */
export function runComposePsqlOutput(sql: string, options: PsqlRunOptions = {}): string {
  const variables = options.variables ?? {};
  for (const key of Object.keys(variables)) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(key)) {
      throw new Error(`Invalid psql variable name: ${key}`);
    }
  }
  const variableArgs = Object.entries(variables).flatMap(([key, value]) => [
    '-v',
    `${key}=${value}`,
  ]);
  // The statement is fed via STDIN, not `-c`: psql performs `:'name'`
  // variable interpolation only in script input — `-c` strings go to the
  // server verbatim and would fail on the placeholder syntax.
  return runComposeCommand(
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'rankme',
      '-d',
      'rankme',
      '-v',
      'ON_ERROR_STOP=1',
      '-t',
      '-A',
      '-q',
      ...variableArgs,
    ],
    { input: sql },
  )
    .trim();
}

/**
 * Execute a fixed E2E fixture script inside the composed API image.
 *
 * Values are passed as environment variables (never interpolated into source)
 * and names are identifier-validated. This gives composed-stack specs a
 * bounded way to seed Mongo/BullMQ contracts through the exact production
 * dependencies already installed in the API image.
 */
export function runComposeApiScript(
  script: string,
  variables: Record<string, string> = {},
): void {
  runComposeApiScriptOutput(script, variables);
}

/** Execute a fixed API-container script and return its trimmed stdout. */
export function runComposeApiScriptOutput(
  script: string,
  variables: Record<string, string> = {},
): string {
  const variableArgs = Object.entries(variables).flatMap(([key, value]) => {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      throw new Error(`Invalid API script variable name: ${key}`);
    }
    return ['-e', `${key}=${value}`];
  });
  return runComposeCommand(
    [
      'exec',
      '-T',
      ...variableArgs,
      'api',
      'node',
      '--input-type=module',
      '--eval',
      script,
    ],
  ).trim();
}

const E2E_EMAIL_OUTBOX_PATH = '/tmp/rankme-e2e-email-outbox.jsonl';

export interface CapturedE2eEmail {
  capturedAt: string;
  to: string;
  subject: string;
  text: string;
  html: string | null;
}

/** Clear the private fake-email mailbox before a credential-bearing journey. */
export function clearCapturedE2eEmails(): void {
  runComposeApiScript(
    `import { writeFile } from 'node:fs/promises';
await writeFile(${JSON.stringify(E2E_EMAIL_OUTBOX_PATH)}, '', { encoding: 'utf8', mode: 0o600 });`,
  );
}

/** Read the bounded container-local mailbox without exposing an HTTP test API. */
export function readCapturedE2eEmails(): CapturedE2eEmail[] {
  const output = runComposeApiScriptOutput(
    `import { readFile } from 'node:fs/promises';
const raw = await readFile(${JSON.stringify(E2E_EMAIL_OUTBOX_PATH)}, 'utf8').catch(() => '');
const records = raw.split('\\n').filter(Boolean).map((line) => JSON.parse(line));
process.stdout.write(JSON.stringify(records));`,
  );
  const parsed = JSON.parse(output || '[]') as unknown;
  if (!Array.isArray(parsed)) throw new Error('Invalid E2E email capture response');
  for (const record of parsed) {
    if (
      typeof record !== 'object' ||
      record === null ||
      typeof (record as CapturedE2eEmail).capturedAt !== 'string' ||
      typeof (record as CapturedE2eEmail).to !== 'string' ||
      typeof (record as CapturedE2eEmail).subject !== 'string' ||
      typeof (record as CapturedE2eEmail).text !== 'string' ||
      (typeof (record as CapturedE2eEmail).html !== 'string' &&
        (record as CapturedE2eEmail).html !== null)
    ) {
      throw new Error('Invalid E2E email capture record');
    }
  }
  return parsed as CapturedE2eEmail[];
}
