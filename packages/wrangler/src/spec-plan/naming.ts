/** Spec 文件名参数 */
export interface SpecFileNameParams {
  name: string;
  version: number;
  timestamp: string;
}

/** Spec 文件名解析结果 */
export interface ParsedSpecFileName {
  timestamp: string;
  name: string;
  version: number;
}

/** Plan 文件名参数 */
export interface PlanFileNameParams {
  name: string;
  specVersion: number;
  version: number;
  timestamp: string;
}

/** Plan 文件名解析结果 */
export interface ParsedPlanFileName {
  timestamp: string;
  name: string;
  specVersion: number;
  version: number;
}

// {timestamp}-{name}-spec-v{version}.md
const SPEC_FILE_RE = /^(\d{8}-\d{6})-(.+)-spec-v(\d+)\.md$/;

// {timestamp}-{name}-v{specVersion}-plan-v{version}.md
const PLAN_FILE_RE = /^(\d{8}-\d{6})-(.+)-v(\d+)-plan-v(\d+)\.md$/;

/** 格式化 spec 文件名 */
export function formatSpecFileName(params: SpecFileNameParams): string {
  return `${params.timestamp}-${params.name}-spec-v${params.version}.md`;
}

/** 解析 spec 文件名，无效返回 null */
export function parseSpecFileName(filename: string): ParsedSpecFileName | null {
  const match = SPEC_FILE_RE.exec(filename);
  if (!match) return null;
  return {
    timestamp: match[1],
    name: match[2],
    version: parseInt(match[3], 10),
  };
}

/** 格式化 plan 文件名 */
export function formatPlanFileName(params: PlanFileNameParams): string {
  return `${params.timestamp}-${params.name}-v${params.specVersion}-plan-v${params.version}.md`;
}

/** 解析 plan 文件名，无效返回 null */
export function parsePlanFileName(filename: string): ParsedPlanFileName | null {
  const match = PLAN_FILE_RE.exec(filename);
  if (!match) return null;
  return {
    timestamp: match[1],
    name: match[2],
    specVersion: parseInt(match[3], 10),
    version: parseInt(match[4], 10),
  };
}
