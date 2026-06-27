/** Spec 文件名参数 */
export interface SpecFileNameParams {
  name: string;
  version: number;
}

/** Spec 文件名解析结果 */
export interface ParsedSpecFileName {
  name: string;
  version: number;
}

/** Plan 文件名参数 */
export interface PlanFileNameParams {
  name: string;
  specVersion: number;
  version: number;
}

/** Plan 文件名解析结果 */
export interface ParsedPlanFileName {
  name: string;
  specVersion: number;
  version: number;
}

// {name}-spec-v{version}.md
const SPEC_FILE_RE = /^(.+)-spec-v(\d+)\.md$/;

// {name}-v{specVersion}-plan-v{version}.md
const PLAN_FILE_RE = /^(.+)-v(\d+)-plan-v(\d+)\.md$/;

/** 格式化 spec 文件名 */
export function formatSpecFileName(params: SpecFileNameParams): string {
  return `${params.name}-spec-v${params.version}.md`;
}

/** 解析 spec 文件名，无效返回 null */
export function parseSpecFileName(filename: string): ParsedSpecFileName | null {
  const match = SPEC_FILE_RE.exec(filename);
  if (!match) return null;
  const version = parseInt(match[2], 10);
  if (isNaN(version)) return null;
  return {
    name: match[1],
    version,
  };
}

/** 格式化 plan 文件名 */
export function formatPlanFileName(params: PlanFileNameParams): string {
  return `${params.name}-v${params.specVersion}-plan-v${params.version}.md`;
}

/** 解析 plan 文件名，无效返回 null */
export function parsePlanFileName(filename: string): ParsedPlanFileName | null {
  const match = PLAN_FILE_RE.exec(filename);
  if (!match) return null;
  const specVersion = parseInt(match[2], 10);
  const version = parseInt(match[3], 10);
  if (isNaN(specVersion) || isNaN(version)) return null;
  return {
    name: match[1],
    specVersion,
    version,
  };
}
