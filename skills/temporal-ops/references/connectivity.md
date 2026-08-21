# Connectivity diagnostic ladder

Work from the bottom upward:

1. `cluster.health` checks that the configured gRPC endpoint is reachable and serving Temporal.
2. `workflow.list` with a limit of one checks TLS, API-key authentication, Namespace authorization, and Visibility access together. Zero returned executions is a successful result.
3. `namespace.get` checks Cloud control-plane visibility. It is useful context but is not required for data-plane health.
4. If only a query-filtered list fails, retry the read with no query and distinguish Search Attribute syntax from connectivity.

Classify evidence precisely: DNS or TCP connection errors, TLS hostname or certificate errors, unauthenticated responses, permission denials, unknown Namespace responses, and successful empty results imply different layers. Do not collapse them into a generic outage.
