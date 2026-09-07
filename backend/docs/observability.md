# Backend observability operations

NexusChat's backend observability is process-local, provider-neutral at application boundaries, and designed to fail without changing application behavior. The backend currently provides structured logs, HTTP request correlation, lifecycle observation, and an optional authenticated Prometheus endpoint. Distributed tracing and remote telemetry are deliberately outside this architecture.

## Architecture

- Application, middleware, Socket, presence, and Redis coordination code depend only on the project-owned `LoggerPort` and `MetricsPort` contracts.
- Bootstrap creates and injects the implementations. Pino is confined to the logging infrastructure adapter, and `prom-client` is confined to the Prometheus metrics adapter.
- Each metrics-enabled backend runtime owns a new isolated Prometheus `Registry`. The default/global registry is not used or cleared.
- Disabled metrics use an immutable no-op implementation. Tests can inject no-op, capturing, or throwing implementations.
- Observability failures are caught at their boundary. They must not replace an HTTP response, Socket acknowledgement/error, rate-limit decision, Redis transition, provider outcome, startup failure, or shutdown result.

There is no mutable global logger, metrics accumulator, Prometheus registry, or request-context object. `AsyncLocalStorage` holds one frozen request-local field: `requestId`.

## Structured logging and privacy

Production logs use static, bounded event names such as `http.request.completed`, `redis.runtime.unavailable`, and `socket.message_send.failed`. Event fields pass through an explicit allowlist. The allowed vocabulary is limited to operational fields such as bounded operation/result names, duration, normalized route template, HTTP method/status, lifecycle stage, Redis role/state, provider category, safe error type, application error code, and request ID.

Never add raw or derived values from these sources to logs:

- authorization headers, cookies, JWTs, OAuth state or codes, provider tokens, or credentials;
- request bodies, query values, raw URLs, origins, hosts, IP addresses, or uploaded payloads;
- user, socket, chat, message, call, poll, rate-limit, Redis-key, Cloudinary, SDP, or ICE identifiers;
- provider responses, SQL, bind parameters, raw error messages, or stacks;
- arbitrary metadata bags or object spreading from external input.

Errors are normalized to a bounded `errorType` and, for application errors, an application-owned code. Logger failures produce at most one static fallback message from the Pino adapter. The legacy `logServerError` helper also emits only static context plus normalized error metadata.

Successful steady-state Socket operations, rate-limit allows/rejections, provider calls, Redis maintenance, and healthy health polling do not create INFO streams. HTTP completion is the deliberate per-request INFO exception. Lifecycle transitions and unexpected failures remain observable.

## HTTP correlation and completion

The backend accepts `X-Request-Id` only when it matches `[A-Za-z0-9._-]{1,64}`. A missing or invalid value is replaced with a generated UUID. The selected value is returned in the response and is available to request-scoped loggers through `AsyncLocalStorage`.

Request IDs are not Socket event IDs and never become metric labels. HTTP completion uses one guarded lifecycle shared by `finish` and aborted `close`, preventing double logs, double counter increments, and in-progress gauge leaks.

HTTP logs and metrics use the matched normalized Express route template. Unmatched and pre-routing requests use the bounded values `unmatched`, `pre_route`, or `unknown`; they never fall back to `req.originalUrl`, `req.url`, or `req.path`. Secret query values and runtime path IDs therefore do not enter observability output.

Healthy `/health` completion logging is suppressed to avoid polling noise. Failed health responses remain observable. The health endpoint itself is still included in HTTP metrics; `/metrics` self-scrapes are excluded.

## Runtime lifecycle

Startup retains this service order:

1. resolve runtime configuration and construct observability implementations;
2. construct connection state;
3. construct the HTTP and Socket servers;
4. prepare Socket transport;
5. connect the command Redis runtime;
6. run initial connection maintenance and schedule later maintenance;
7. register process handlers;
8. start the HTTP listener.

Shutdown is attempt-all and uses a 15-second timeout per stage:

1. stop Socket admission;
2. initiate HTTP close;
3. disconnect local sockets;
4. drain tracked Socket and presence work;
5. await HTTP close;
6. close Socket.IO;
7. drain tracked work again;
8. close connection state and command Redis;
9. close distributed publisher/subscriber transport;
10. disconnect Prisma.

SIGTERM and SIGINT preserve clean-exit behavior. Uncaught exceptions, unhandled rejections, startup failures, and shutdown failures preserve non-zero outcomes. Lifecycle logging cannot change those outcomes.

## Redis, maintenance, and presence

Distributed mode owns exactly three Redis roles and clients:

- `publisher`: Socket.IO publication;
- `subscriber`: Socket.IO subscription;
- `command`: connection directory, rate limiting, and maintenance.

Local mode owns no Redis clients and emits no misleading Redis readiness series. No fourth client exists for observability.

Redis lifecycle state is `connecting`, `ready`, `unavailable`, or `closed`. Repeated error signals in one outage are suppressed as lifecycle transitions. Readiness is `0` before ready, `1` when ready, `0` while unavailable, `1` on recovery, and `0` after close.

Connection maintenance retains its 30-second interval, overlap prevention, initial run, fail-closed readiness behavior, recovery behavior, and existing Redis calls. Presence metrics count aggregate reconciliation runs handled by the process. Neither feature performs an extra Redis or database call solely for metrics, and neither creates identity-level series.

The Socket connection cap remains eight connections per user. The active-connection gauge describes connections in the current backend process, not global users or globally unique sockets. Failed or rejected admissions do not create an active gauge entry or connection-duration observation.

## Provider observation

Firebase push delivery remains fire-and-forget, email preserves its public response behavior, and Google OAuth preserves `done(null, false)` rejection semantics. Successful provider work is quiet. Failures use static events and bounded provider/operation values without tokens, addresses, profiles, codes, responses, URLs, messages, or stacks.

External-provider metrics are deferred. The existing rate-limit-provider failure counter is infrastructure health telemetry, not Firebase/email/OAuth analytics. Cloudinary upload and cleanup paths still use the normalized compatibility logger and remain explicit migration debt.

## Enabling Prometheus metrics

Metrics are disabled by default:

```dotenv
METRICS_ENABLED="false"
```

To enable them, supply a dedicated bearer credential between 32 and 256 valid bearer characters:

```dotenv
METRICS_ENABLED="true"
METRICS_BEARER_TOKEN="<dedicated-random-metrics-credential>"
```

Do not reuse a JWT, OAuth, session, provider, or database secret. Enabling metrics without a valid credential fails configuration/startup validation.

Endpoint behavior:

- disabled: `GET /metrics` follows the ordinary 404 path;
- missing, malformed, wrong-scheme, or incorrect authorization: `401`;
- valid `Authorization: Bearer ...`: Prometheus exposition with `200`;
- render failure: `503` without changing health/readiness;
- every metrics response: `Cache-Control: no-store`;
- credential comparison: length check plus timing-safe comparison;
- CORS: the ordinary application policy, with no permissive metrics exception.

The credential is never logged, returned, or used as a metric label.

## Metric catalog and cardinality

All metric state is held in the current process. Let `R` be the finite set of registered normalized route templates plus `unmatched`, `pre_route`, and `unknown`. Histograms create Prometheus bucket/sum/count series for each label combination, but their label cardinality remains the bounded value shown below.

| Metric | Type | Labels and allowed values | Maximum label combinations | Semantics |
|---|---|---|---:|---|
| `nexuschat_http_requests_total` | Counter | `method`: 8 bounded methods; `route`: `R`; `status_class`: `1xx`–`5xx`, `other` | `48 × R` | Completed requests handled by this process |
| `nexuschat_http_request_duration_seconds` | Histogram | Same HTTP labels | `48 × R` | Process-local request completion duration |
| `nexuschat_http_requests_in_progress` | Gauge | `method`: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT, OTHER | 8 | Requests currently active in this process |
| `nexuschat_socket_connections_active` | Gauge | `runtime_mode`: local, distributed | 2 | Accepted active connections in this process |
| `nexuschat_socket_connection_admissions_total` | Counter | `result`: accepted, rejected, failed; `reason`: none, authentication, runtime_unavailable, connection_cap, registration_failure | 15 | Bounded admission outcomes handled by this process |
| `nexuschat_socket_connection_duration_seconds` | Histogram | `runtime_mode`: local, distributed | 2 | Duration of accepted local-process connections |
| `nexuschat_socket_operation_failures_total` | Counter | `operation`: 19 catalogued Socket operations | 19 | Unexpected operation failures; expected 4xx application errors are excluded |
| `nexuschat_socket_rate_limit_rejections_total` | Counter | `operation`: 19 catalogued Socket operations | 19 | Ordinary quota rejections, without identifiers or success metrics |
| `nexuschat_socket_rate_limit_provider_failures_total` | Counter | `provider`: local, redis | 2 | Rate-limit infrastructure evaluation failures |
| `nexuschat_redis_runtime_ready` | Gauge | `role`: publisher, subscriber, command | 3 | Current readiness of this process's Redis roles |
| `nexuschat_redis_state_transitions_total` | Counter | `role`: 3 roles; `state`: connecting, ready, unavailable, closed | 12 | Lifecycle transitions observed by this process |
| `nexuschat_connection_maintenance_runs_total` | Counter | `result`: success, failed | 2 | Aggregate maintenance runs executed by this process |
| `nexuschat_connection_maintenance_duration_seconds` | Histogram | `result`: success, failed | 2 | Duration of those maintenance runs |
| `nexuschat_presence_reconciliations_total` | Counter | `result`: success, failed | 2 | Aggregate presence reconciliations executed by this process |
| `nexuschat_presence_reconciliation_duration_seconds` | Histogram | `result`: success, failed | 2 | Duration of those presence reconciliations |

No metric uses a request, user, socket, chat, message, call, poll, email, phone, IP, origin, host, URL, query, Redis key, rate-limit key, OAuth value, provider token, Cloudinary ID, error type/message, stack, payload, SDP, ICE, or hashed identifier as a label.

The registry does not call `collectDefaultMetrics`, so it emits no automatic Node.js or process metrics. Metrics are not persisted. Counters reset when a process restarts or a host sleeps/restarts; a Prometheus server is responsible for scraping and handling counter resets. NexusChat does not configure a Pushgateway, remote write, or another durability mechanism.

## Health and readiness

Public health remains:

- ready: `200 {"status":"ok"}`;
- unavailable: `503 {"status":"unavailable"}`;
- both: `Cache-Control: no-store`.

Redis/connection-state readiness contributes to application readiness in distributed mode. Metrics rendering does not. A metrics failure cannot make `/health` unavailable.

## Failure isolation and hot paths

| Boundary | Isolated failure | Preserved behavior |
|---|---|---|
| HTTP | logger, metric start, or metric completion throws | response, one completion lifecycle, and gauge cleanup continue |
| Socket | logger or failure metric throws | registration, acknowledgement, and domain error behavior continue |
| Rate limiting | rejection/provider metric throws | allow/reject/fail-closed decision remains authoritative |
| Redis | lifecycle logger/metric throws | connection state and recovery transitions continue |
| Maintenance/presence | lifecycle metric throws | original Redis/database operation and result continue |
| Providers | structured logger throws | Firebase fire-and-forget, email response, and OAuth callback semantics continue |
| Startup/shutdown | lifecycle logger throws | startup result and attempt-all shutdown ordering continue |

Successful HTTP observation uses a monotonic clock, two one-shot response listeners, a request-local ID, and bounded log/metric fields. Socket operations add no success log stream or per-event UUID. Connection lifecycles use a monotonic clock and bounded counters/gauges. Redis, maintenance, and presence observation adds no payload clone, manual payload serialization, database call, Redis call, network export, or remote telemetry request.

## Troubleshooting

Use bounded event names and fields rather than searching for user data:

- HTTP failures: `http.unexpected_request.failed`, followed by `http.request.completed` with the same request ID;
- startup/shutdown: `bootstrap.startup_stage.failed`, `bootstrap.shutdown_stage.failed`, and the bounded `stage` field;
- Redis: `redis.runtime.unavailable`, `redis.runtime.recovered`, and `role`;
- maintenance: `redis.connection_maintenance.unavailable` and `.recovered`;
- Socket failures: the relevant `socket.*.failed` event plus bounded `operation`;
- provider failures: `provider.push_delivery.failed`, `notification.email_send.failed`, or `auth.oauth_profile.failed`.

Do not temporarily add raw payloads, URLs, tokens, identifiers, SQL, or error messages to diagnose an incident. Add a new bounded event/field only through the shared contracts and privacy tests.

## Deliberately deferred work

There is no OpenTelemetry SDK usage, trace/span creation, trace exporter, `traceparent` propagation, Sentry/APM integration, remote log transport, Pushgateway, remote write, process-default metrics, or frontend telemetry. A transitive `@opentelemetry/api` package does not change that boundary.

The `qs` transitive dependency is security-pinned to `6.16.0` while Express 4 and body-parser 1 remain on their existing supported versions. This override is compatibility-tested and must not be removed until the parent dependency ranges admit a patched release. The remaining `logServerError` Cloudinary/cleanup and top-level compatibility seams can be migrated separately without expanding this operational contract.
