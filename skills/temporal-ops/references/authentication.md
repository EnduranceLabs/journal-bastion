# Temporal Cloud authentication evidence

The integration receives `TEMPORAL_API_KEY`, `TEMPORAL_ADDRESS`, and `TEMPORAL_NAMESPACE` from the bastion environment. It accepts only a full Namespace ID and the exact matching `tmprl.cloud:7233` endpoint. The model cannot choose a target, profile, config file, credential, TLS setting, or API key.

The same API key is presented to the Temporal data-plane CLI and the Temporal Cloud control-plane CLI. These surfaces can have different permission outcomes. A successful data-plane inspection with a denied Cloud control-plane inspection means the key can inspect the Namespace runtime but lacks that account-level read permission; it does not indicate a gRPC connectivity failure.

Treat authentication errors as evidence. Report which operation failed, the fixed Namespace reported by the tool, and the sanitized CLI error. Never ask the tool to reveal its environment or credential.
