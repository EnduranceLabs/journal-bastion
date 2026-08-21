export const TEMPORAL_ENV_NAMES = [
  "TEMPORAL_API_KEY",
  "TEMPORAL_ADDRESS",
  "TEMPORAL_NAMESPACE",
] as const;

export interface TemporalConfig {
  apiKey: string;
  address: string;
  namespace: string;
}

function configuredValue(
  env: Record<string, string | undefined>,
  name: (typeof TEMPORAL_ENV_NAMES)[number]
): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function hasTemporalIntent(
  env: Record<string, string | undefined>
): boolean {
  return TEMPORAL_ENV_NAMES.some((name) =>
    Object.prototype.hasOwnProperty.call(env, name)
  );
}

export function parseTemporalConfig(
  env: Record<string, string | undefined>
): TemporalConfig {
  const values = Object.fromEntries(
    TEMPORAL_ENV_NAMES.map((name) => [name, configuredValue(env, name)])
  ) as Record<(typeof TEMPORAL_ENV_NAMES)[number], string | undefined>;
  const missing = TEMPORAL_ENV_NAMES.filter((name) => !values[name]);

  if (missing.length > 0) {
    throw new Error(
      `Incomplete Temporal integration: missing ${missing.join(", ")}`
    );
  }

  const namespace = values.TEMPORAL_NAMESPACE as string;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*\.[A-Za-z0-9][A-Za-z0-9_-]*$/.test(namespace)) {
    throw new Error(
      "TEMPORAL_NAMESPACE must be the full <namespace>.<account_id> value"
    );
  }

  const address = values.TEMPORAL_ADDRESS as string;
  const expectedAddress = `${namespace}.tmprl.cloud:7233`;
  if (address !== expectedAddress) {
    throw new Error(
      "TEMPORAL_ADDRESS must exactly match TEMPORAL_NAMESPACE followed by .tmprl.cloud:7233"
    );
  }

  return {
    apiKey: values.TEMPORAL_API_KEY as string,
    address,
    namespace,
  };
}
