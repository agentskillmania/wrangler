// packages/wrangler-devtool/src/utils/validators.ts
// 输入校验工具

/**
 * 校验名称是否合法
 *
 * 合法名称：1-64 字符，仅包含字母、数字、连字符、下划线
 */
export function isValidName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name) && name.length > 0 && name.length <= 64;
}

/**
 * 校验名称，不合法则抛出错误
 */
export function validateName(name: string): void {
  if (!isValidName(name)) {
    throw new Error(
      `Invalid name: ${name}. Must be 1-64 characters, alphanumeric with hyphens/underscores.`
    );
  }
}
