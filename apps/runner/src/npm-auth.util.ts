import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type NpmAuthSetupResult = {
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
  enabled: boolean;
  tokenSource: string;
  scopes: string[];
};

function normalizeScope(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function parseScopes(raw: string | null | undefined, fallbackOwner?: string): string[] {
  const scopes = new Set<string>();

  const fromRaw = String(raw ?? '')
    .split(/[\s,;]+/)
    .map((item) => normalizeScope(item))
    .filter((item): item is string => Boolean(item));

  for (const scope of fromRaw) scopes.add(scope.toLowerCase());

  if (scopes.size === 0 && fallbackOwner) {
    const fallback = normalizeScope(fallbackOwner);
    if (fallback) scopes.add(fallback.toLowerCase());
  }

  return Array.from(scopes);
}

export async function setupNpmAuthEnv(args: {
  repoInfo?: any;
}): Promise<NpmAuthSetupResult> {
  const token = String(process.env.GITHUB_TOKEN ?? '').trim();
  const scopes = parseScopes(process.env.NPM_GITHUB_SCOPES, args.repoInfo?.owner);

  const env = { ...process.env };

  if (!token || scopes.length === 0) {
    return {
      env,
      cleanup: async () => {},
      enabled: false,
      tokenSource: 'GITHUB_TOKEN',
      scopes,
    };
  }

  const npmrcPath = path.join(
    os.tmpdir(),
    `builder-npmrc-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.rc`,
  );

  const lines = [
    'registry=https://registry.npmjs.org/',
    'always-auth=true',
    ...scopes.map((scope) => `${scope}:registry=https://npm.pkg.github.com`),
    '//npm.pkg.github.com/:_authToken=' + token,
  ];

  await fs.promises.writeFile(npmrcPath, `${lines.join('\n')}\n`, 'utf8');

  env.NPM_CONFIG_USERCONFIG = npmrcPath;
  env.npm_config_userconfig = npmrcPath;
  env.NODE_AUTH_TOKEN = token;

  return {
    env,
    cleanup: async () => {
      await fs.promises.rm(npmrcPath, { force: true });
    },
    enabled: true,
    tokenSource: 'GITHUB_TOKEN',
    scopes,
  };
}
