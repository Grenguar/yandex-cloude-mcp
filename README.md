# Yandex Cloud management MCP

A general-purpose MCP server for Yandex Cloud, based on
[vadyusha/yandex-cloude-mcp](https://github.com/vadyusha/yandex-cloude-mcp).
Runs locally in Docker and connects to Codex, Claude Code, or other MCP clients.

The original three S3 tools are retained. This extension adds a generated service
catalog based on the official [Yandex Node.js SDK](https://github.com/yandex-cloud/nodejs-sdk),
request validation, management operations, Postbox, tests and container support.

## Quick start

Prerequisites: Node.js >=22.15, Docker Compose, and an authenticated
[Yandex CLI](https://yandex.cloud/en/docs/cli/quickstart) profile with a folder ID.

```bash
npm ci
npm run build
node scripts/configure-local.mjs --profile YOUR_PROFILE
docker compose up -d --build
npm run smoke
```

The service listens at `http://127.0.0.1:8765/mcp`. `/health` reports process health,
not cloud authentication health. The MCP endpoint requires a bearer token kept in
`.local/http-token`. Nothing is deployed to Yandex Cloud by these commands.

`configure-local.mjs` obtains an IAM token using your explicit profile and writes
ignored, permission-restricted files in `.local/`. IAM tokens expire: rerun the
command to refresh; the server rereads the token file without restarting. Your
profile must itself have valid credentials. The script preserves the HTTP token
and an existing write-mode setting. It does not change your active yc profile.

For Postbox with a different existing service account:

```bash
node scripts/configure-local.mjs --profile YOUR_PROFILE \
  --postbox-service-account-id YOUR_POSTBOX_SERVICE_ACCOUNT_ID
```

This requires permission to impersonate that account. It creates a short-lived
token, not a new service account or static access key. Postbox chooses its folder
from the authenticated service account, **not** `YC_FOLDER_ID`.

For a CLI profile that already contains an authorized service-account key, use
`node scripts/configure-local.mjs --profile YOUR_PROFILE --use-profile-key`. This
copies the existing key into the protected local mount; it creates no new key.
Recreate the container after switching authentication modes.

Alternatively, for unattended token refresh, mount an existing authorized service-account key
file and set `YC_SERVICE_ACCOUNT_KEY_FILE` instead of `YC_IAM_TOKEN_FILE`. The SDK
exchanges the key for renewable IAM tokens. The key JSON uses the standard
`id`, `service_account_id`, `private_key` fields. No implicit metadata or AWS
credential-chain fallback is used.

## Connect Codex and Claude Code

A small stdio bridge connects both clients to the same running local container.
The bridge reads `.local/http-token`; client configs contain no cloud or HTTP
credentials. Run these from the repository after building:

```bash
codex mcp add yandex-cloud -- node "$PWD/dist/proxy.js"
claude mcp add --scope user yandex-cloud -- node "$PWD/dist/proxy.js"
```

Restart the clients / start a new session to discover tools. The container must be
running. For Claude Desktop, add the equivalent entry to its MCP configuration:

```json
{
  "mcpServers": {
    "yandex-cloud": {
      "command": "node",
      "args": ["/absolute/path/yandex-cloude-mcp/dist/proxy.js"]
    }
  }
}
```

Native Streamable HTTP clients can connect directly with
`Authorization: Bearer <contents of .local/http-token>`. The bridge supports
`MCP_SERVER_URL` and `MCP_HTTP_TOKEN_FILE` overrides for another localhost port.
Do not expose this local development deployment publicly.

## Tools and workflow

| Tool                | Purpose                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `yc_services`       | List services/methods and whether writes are enabled; optional service prefix |
| `yc_describe`       | Get the exact request-field schema and method description                     |
| `yc_read`           | Call a read-only cloud method                                                 |
| `yc_write`          | Call a management method; requires server opt-in                              |
| `yc_wait_operation` | Poll an async operation; report completed, failed or pending                  |
| `list_buckets`      | Original S3 bucket listing                                                    |
| `list_objects`      | Original S3 object listing, with pagination                                   |
| `download_object`   | Bounded S3 download into a configured local directory                         |

Example MCP arguments:

```json
{ "service": "compute.instances", "method": "list", "request": {} }
```

`yc_read` injects the configured folder and page size 100 when the method supports
them. Returned `nextPageToken` / `NextToken` is preserved: pass it in the next call.
There is no hidden unbounded pagination. SDK requests use camelCase; Postbox uses
PascalCase. Use `yc_describe` before constructing an unfamiliar request.

To opt into management, set `YC_ALLOW_WRITES=true` in `.local/server.env` and run
`docker compose up -d --force-recreate`. The same cloud IAM permissions still apply.
For example, `yc_write` can start a VM:

```json
{
  "service": "compute.instances",
  "method": "start",
  "request": { "instanceId": "YOUR_INSTANCE_ID" }
}
```

An operation with `done:false` is only submitted. Pass its ID to
`yc_wait_operation`; don't claim success until it completes. The server never
retries mutations automatically. A timeout does not establish that a mutation
failed; inspect the operation before resubmitting. Infrastructure changes made
outside Terraform must be reconciled with its configuration by the operator.

## Service coverage

42 SDK services, plus Postbox (use `yc_services` for the generated method list):

| Area                   | Services                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Resource Manager / IAM | Clouds, folders, service accounts, roles, key metadata/revocation, access bindings                                        |
| Compute                | Instances, instance groups, disks, images, snapshots, zones                                                               |
| ALB                    | Load balancers, backend groups, target groups, HTTP routers, virtual hosts                                                |
| VPC                    | Networks, subnets, security groups, addresses, NAT gateways, route tables                                                 |
| PostgreSQL             | Managed clusters, databases, users, backups                                                                               |
| Storage / Registry     | Bucket management, S3 object reads, registries, repositories, images, lifecycle policies                                  |
| Security               | Lockbox secret/version management; Certificate Manager                                                                    |
| Operations             | Logging groups/entries, quota limits/requests, async operations                                                           |
| Additional             | Cloud DNS zones/records and Monitoring dashboards                                                                         |
| Postbox                | Domain identities/DKIM, configuration sets/delivery settings, suppression lists, event destinations, simple email sending |

The SDK catalog includes unary methods only. Streaming RPCs, Lockbox payload reads,
certificate private-key export, VM serial-console contents, and credential minting
are deliberately not advertised. IAM key _creation_ is omitted because its one-time
secret must not be silently lost through output redaction. Monitoring coverage is
dashboards, not time-series queries. Postbox supports simple text/HTML sends, not
bulk or arbitrary MIME. The public Postbox API is not part of the Node SDK;
its adapter follows [Yandex's SES-compatible API](https://yandex.cloud/en/docs/postbox/aws-compatible-api/api-ref/)
and [IAM-token authentication](https://yandex.cloud/en/docs/postbox/api-ref/authentication).

Service selection is an explicit code allowlist. SDK method names, request shapes
and enum values are compiled from pinned SDK declarations, not arbitrary user
module paths. Unknown properties are rejected at every typed object level. The
cloud API still validates required and cross-field business rules; protobuf
scalar defaults mean TypeScript's required markers cannot be used as those rules.
JSON maps intentionally accept their declared dynamic keys. Numeric SDK fields
cannot exceed JavaScript's safe integer range.

## Configuration and boundaries

| Variable                                                            | Default / use                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `YC_FOLDER_ID`                                                      | Default request folder; convenience, **not** an isolation boundary                         |
| `YC_IAM_TOKEN_FILE`                                                 | Read a replaceable IAM token from a file (highest priority)                                |
| `YC_IAM_TOKEN`                                                      | Explicit IAM token (prefer a file for local Docker)                                        |
| `YC_SERVICE_ACCOUNT_KEY_FILE`                                       | Authorized-key JSON; SDK refreshes IAM tokens                                              |
| `YC_POSTBOX_IAM_TOKEN_FILE` / `YC_POSTBOX_SERVICE_ACCOUNT_KEY_FILE` | Optional separate Postbox identity                                                         |
| `YC_ALLOW_WRITES`                                                   | `false`; only exact `true` enables writes                                                  |
| `YC_TIMEOUT_MS`                                                     | 30000; range 1000–120000                                                                   |
| `YC_MAX_OUTPUT_BYTES`                                               | 256000; oversize output is explicitly omitted, never broken JSON                           |
| `MCP_TRANSPORT`                                                     | `stdio`; Compose sets `http`                                                               |
| `MCP_HOST` / `MCP_PORT`                                             | `127.0.0.1` / `3000`; Compose binds internally on all interfaces, publishes only localhost |
| `MCP_HTTP_TOKEN_FILE` / `MCP_HTTP_TOKEN`                            | HTTP authentication; at least 32 characters                                                |
| `YANDEX_ACCESS_KEY_ID` / `YANDEX_SECRET_ACCESS_KEY`                 | Static S3 credentials for the legacy object tools only                                     |
| `YC_DOWNLOAD_DIR`                                                   | `/downloads`; mount a writable directory for downloads                                     |

Known secret fields, VM metadata/cloud-init and opaque binary responses are
redacted. Error messages omit provider bodies that could echo credentials. This
is not a guarantee that arbitrary application logs or user-generated text are
secret-free; grant logging/object-read permissions accordingly. Response omission
is not pagination: request a smaller page if you hit the configured output limit.

The Docker image contains no credential files. Compose runs as the local UID/GID,
with a read-only filesystem, no capabilities, credentials mounted read-only and a
localhost port. `.env` contains UID/GID only; `.local/` contains local secrets and
must remain ignored. The download tool writes locally even in cloud read-only mode.
It accepts only a filename, refuses overwrites/symlinks and limits downloads to
10 MiB. This replaces the upstream's unrestricted absolute `localPath` behavior.

For direct container stdio (set container paths in the env file):

```bash
docker run --rm -i --read-only --cap-drop ALL --security-opt no-new-privileges \
  --user "$(id -u):$(id -g)" \
  --env-file .local/server.env \
  -v "$PWD/.local:/run/credentials:ro" \
  yandex-cloud-management-mcp:local
```

## Development and validation

```bash
npm ci
npm run build       # generate schemas and compile
npm test            # no cloud credentials or production mutations
npm run typecheck
npm audit
docker compose up -d --build
npm run smoke       # explicitly live, read-only calls; requires credentials
```

Tests include generated codec/schema coverage, read/write enforcement, auth
rotation, operation states, redaction, Postbox HTTP contracts and real MCP
handshakes. `smoke` reports counts and failures, not a full production inventory.
Cloud permissions and service availability vary; passing mock mutation tests does
not mean writes were tested against production. See [validation](docs/VALIDATION.md)
and the [implementation plan](docs/IMPLEMENTATION_PLAN.md).

The upstream repository currently has no license file. This fork preserves its
attribution; agree licensing with the upstream author before a separately licensed
package release. No license is inferred from dependencies.
