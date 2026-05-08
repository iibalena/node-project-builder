import * as fs from 'fs';
import * as path from 'path';
import { BuildLogger } from './build-logger';

function parseVersionParts(version: string) {
  return version
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(left: string, right: string) {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  const max = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < max; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) {
      return rightValue - leftValue;
    }
  }

  return 0;
}

function resolveNodeVersionDir(requestedVersion: string) {
  const nvmHome = String(process.env.NVM_HOME ?? '').trim();
  if (!nvmHome) {
    throw new Error('NVM_HOME is not configured.');
  }

  const availableDirs = fs
    .readdirSync(nvmHome, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^v/i.test(entry.name))
    .map((entry) => entry.name);

  const normalizedRequested = requestedVersion.replace(/^v/i, '');
  const exact = availableDirs.find(
    (dirName) => dirName.replace(/^v/i, '') === normalizedRequested,
  );
  if (exact) {
    return path.join(nvmHome, exact);
  }

  const compatible = availableDirs
    .map((dirName) => dirName.replace(/^v/i, ''))
    .filter(
      (version) =>
        version === normalizedRequested ||
        version.startsWith(`${normalizedRequested}.`),
    )
    .sort(compareVersions);

  if (compatible.length === 0) {
    throw new Error(
      `Node ${requestedVersion} is not installed in NVM_HOME (${nvmHome}).`,
    );
  }

  return path.join(nvmHome, `v${compatible[0]}`);
}

export async function ensureNodeVersion(
  rawNodeVersion: string | null | undefined,
  baseEnv: NodeJS.ProcessEnv,
  logger: BuildLogger,
) {
  const nodeVersion = String(rawNodeVersion ?? '').trim().replace(/^v/i, '');
  if (!nodeVersion) {
    return baseEnv;
  }

  if (process.platform !== 'win32') {
    throw new Error(
      `Automatic Node version switching is only implemented for Windows runners. Requested Node ${nodeVersion}.`,
    );
  }

  const nodeDir = resolveNodeVersionDir(nodeVersion);
  const nextEnv = {
    ...baseEnv,
    PATH: `${nodeDir};${baseEnv.PATH ?? process.env.PATH ?? ''}`,
  };

  await logger.log(`Selecting Node ${nodeVersion} from ${nodeDir}.`);
  return nextEnv;
}
