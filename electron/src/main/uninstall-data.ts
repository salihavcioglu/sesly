import { lstat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  directorySize,
  isValidSeslyRoot,
  modelsAreShared,
  normalized,
  within,
} from './reset-data';

export interface UninstallRoots {
  data: string;
  environment: string;
  runtimeEnvironment?: string | null;
  logs: string | null;
  userEnvironment: string;
  models: string;
}

export interface UninstallTarget {
  key: 'data' | 'env' | 'logs' | 'userenv' | 'models';
  path: string;
  size_bytes: number;
  exists: boolean;
  shared: boolean;
}

export interface UninstallPlan {
  paths: string[];
  refused: string[];
  size_bytes: number;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function uniqueRoots(
  values: Array<{ key: UninstallTarget['key']; path: string; shared: boolean }>,
) {
  const seen = new Set<string>();
  return values.filter(({ path }, index) => {
    const key = normalized(path);
    if (seen.has(key)) return false;
    if (values.some((parent, other) => other < index && within(path, parent.path))) return false;
    seen.add(key);
    return true;
  });
}

export async function scanUninstallTargets(roots: UninstallRoots): Promise<UninstallTarget[]> {
  const modelNested = [roots.data, roots.environment].some((root) => within(roots.models, root));
  const candidates = uniqueRoots([
    { key: 'data', path: roots.data, shared: false },
    { key: 'env', path: roots.environment, shared: false },
    ...(roots.runtimeEnvironment
      ? [{ key: 'env' as const, path: roots.runtimeEnvironment, shared: false }]
      : []),
    ...(roots.logs ? [{ key: 'logs' as const, path: roots.logs, shared: false }] : []),
    { key: 'userenv', path: roots.userEnvironment, shared: false },
    ...(!modelNested
      ? [
          {
            key: 'models' as const,
            path: roots.models,
            shared: modelsAreShared(roots.models, roots.data),
          },
        ]
      : []),
  ]);
  const targets: UninstallTarget[] = [];
  for (const candidate of candidates) {
    const present = await exists(candidate.path);
    targets.push({
      ...candidate,
      exists: present,
      size_bytes: present ? await directorySize(candidate.path) : 0,
    });
  }
  return targets;
}

export async function createUninstallPlan(
  targets: UninstallTarget[],
  includeModels: boolean,
  home: string | null,
): Promise<UninstallPlan> {
  const eligible = targets.filter((target) => target.exists && (includeModels || !target.shared));
  const refused: string[] = [];
  const accepted: UninstallTarget[] = [];
  for (const target of eligible) {
    if (!isAbsolute(target.path) || !(await isValidSeslyRoot(target.path, home))) {
      refused.push(target.path);
    } else {
      accepted.push(target);
    }
  }
  const paths = accepted
    .filter(
      (target, index) =>
        !accepted.some((parent, other) => other !== index && within(target.path, parent.path)),
    )
    .map((target) => target.path);
  return {
    paths,
    refused,
    size_bytes: accepted.reduce((sum, target) => sum + target.size_bytes, 0),
  };
}
