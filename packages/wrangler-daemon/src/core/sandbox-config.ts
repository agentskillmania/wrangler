import type { SandboxConfig } from '@agentskillmania/wrangler';

/**
 * Merge sandbox config sources field-by-field (lower → higher precedence):
 * daemon config.yaml `sandbox` defaults ← request-body `sandbox` (boolean
 * legacy form only overrides `enabled`). The sandbox package's own
 * config.yaml/env are NOT part of this chain — the wrangler layer drives the
 * sandbox purely via constructor params.
 */
export function mergeSandboxConfig(
  base: SandboxConfig | undefined,
  override: SandboxConfig | boolean | undefined
): SandboxConfig {
  const fromOverride = typeof override === 'object' && override !== null ? override : {};
  const enabled =
    typeof override === 'boolean' ? override : (fromOverride.enabled ?? base?.enabled ?? true);
  return {
    enabled,
    timeout: fromOverride.timeout ?? base?.timeout,
    allowNetwork: fromOverride.allowNetwork ?? base?.allowNetwork,
    commandPolicy: fromOverride.commandPolicy ?? base?.commandPolicy,
    networkPolicy: fromOverride.networkPolicy ?? base?.networkPolicy,
    instance: fromOverride.instance ?? base?.instance,
  };
}
