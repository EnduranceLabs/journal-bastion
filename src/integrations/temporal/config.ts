export const TEMPORAL_ENV_NAMES = [
  "TEMPORAL_API_KEY",
  "TEMPORAL_TLS_CERT_DATA",
  "TEMPORAL_TLS_KEY_DATA",
  "TEMPORAL_ADDRESS",
  "TEMPORAL_NAMESPACE",
] as const;

interface TemporalTargetConfig {
  address: string;
  namespace: string;
}

export type TemporalConfig = TemporalTargetConfig &
  (
    | {
        authMode: "api-key";
        apiKey: string;
      }
    | {
        authMode: "mtls";
        tlsCertData: string;
        tlsKeyData: string;
      }
  );

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
  const missingTarget = (["TEMPORAL_ADDRESS", "TEMPORAL_NAMESPACE"] as const)
    .filter((name) => !values[name]);

  if (missingTarget.length > 0) {
    throw new Error(
      `Incomplete Temporal integration: missing ${missingTarget.join(", ")}`
    );
  }

  const apiKey = values.TEMPORAL_API_KEY;
  const tlsCertData = values.TEMPORAL_TLS_CERT_DATA;
  const tlsKeyData = values.TEMPORAL_TLS_KEY_DATA;
  const hasMtlsValue = tlsCertData !== undefined || tlsKeyData !== undefined;

  if (apiKey && hasMtlsValue) {
    throw new Error(
      "Temporal authentication is ambiguous: set TEMPORAL_API_KEY or TEMPORAL_TLS_CERT_DATA with TEMPORAL_TLS_KEY_DATA, not both"
    );
  }

  if (!apiKey && !hasMtlsValue) {
    throw new Error(
      "Temporal integration requires TEMPORAL_API_KEY or both TEMPORAL_TLS_CERT_DATA and TEMPORAL_TLS_KEY_DATA"
    );
  }

  if (hasMtlsValue && (!tlsCertData || !tlsKeyData)) {
    const missingCredential = tlsCertData
      ? "TEMPORAL_TLS_KEY_DATA"
      : "TEMPORAL_TLS_CERT_DATA";
    throw new Error(
      `Incomplete Temporal mTLS integration: missing ${missingCredential}`
    );
  }

  if (
    tlsCertData &&
    !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----$/.test(
      tlsCertData
    )
  ) {
    throw new Error(
      "TEMPORAL_TLS_CERT_DATA must contain a PEM-encoded certificate"
    );
  }

  if (
    tlsKeyData &&
    !/^-----BEGIN ((?:RSA |EC )?PRIVATE KEY)-----[\s\S]+-----END \1-----$/.test(
      tlsKeyData
    )
  ) {
    throw new Error(
      "TEMPORAL_TLS_KEY_DATA must contain a PEM-encoded private key"
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

  const target = {
    address,
    namespace,
  };

  if (apiKey) {
    return { ...target, authMode: "api-key", apiKey };
  }

  return {
    ...target,
    authMode: "mtls",
    tlsCertData: tlsCertData as string,
    tlsKeyData: tlsKeyData as string,
  };
}
