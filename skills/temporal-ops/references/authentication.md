# Temporal Cloud authentication evidence

The integration receives `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, and exactly one authentication method from the bastion environment: `TEMPORAL_API_KEY`, or the PEM-encoded values `TEMPORAL_TLS_CERT_DATA` and `TEMPORAL_TLS_KEY_DATA`. It accepts only a full Namespace ID and the exact matching `tmprl.cloud:7233` endpoint. The model cannot choose a target, profile, config file, credential, TLS setting, API key, certificate, or private key. In mTLS mode, the adapter passes the PEM values to the Temporal CLI only through its environment; it does not write them to disk or include them in process arguments.

In API-key mode, the same key is presented to the Temporal data-plane CLI and the Temporal Cloud control-plane CLI. These surfaces can have different permission outcomes. A successful data-plane inspection with a denied Cloud control-plane inspection means the key can inspect the Namespace runtime but lacks that account-level read permission; it does not indicate a gRPC connectivity failure.

In mTLS mode, the client certificate and private key authenticate only to the fixed Namespace data-plane endpoint. Cloud control-plane operations are removed from the advertised operation enum because `tcld` requires API-key authentication. A successful `workflow.list` or `cluster.health` proves the certificate/key pair, TLS endpoint, and Namespace data-plane access.

Treat authentication errors as evidence. Report which operation failed, the fixed Namespace reported by the tool, and the sanitized CLI error. Never ask the tool to reveal its environment or credential.
