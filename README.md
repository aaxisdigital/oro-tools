# Aaxis Tools Bundle

A back-office (admin) toolbox for OroCommerce that bundles a few lightweight tools under the
**"Tools"** application-menu sub-group. Every tool can be enabled/disabled and configured from
**System Configuration → General Setup → Aaxis Tools**.

- Namespace: `Aaxis\Bundle\ToolsBundle`
- Bundle class: `AaxisToolsBundle` (auto-registered)
- Back-office route prefix: `/admin/aaxis/tools`
- Config alias: `aaxis_tools`

> **Related Aaxis bundles**
> - **`AaxisCommonBundle`** — shared base bundle (TypeScript build pipeline, the top-level "Aaxis"
>   menu group and its icon, the shared grid widgets, and the shared **connection-test** registry /
>   endpoint / JS used by the tools' "Test it" buttons). Required by this bundle.
> - **`AaxisDevToolsBundle`** — the operational/developer toolbox (Runtime Config, Filesystem &
>   Bucket browsers, Database / Elastic / Redis / MongoDB viewers, Network Tools). It was split out
>   of this bundle and is independent of it (both require CommonBundle).
> - **`AaxisOntologyBundle`** — the Ontology feature. Independent of this bundle.
> - All Aaxis feature bundles render under the same top-level **"Aaxis"** application-menu group
>   (`aaxis_tab`, provided by CommonBundle).

---

## Tools

| Tool | Route | Summary |
|------|-------|---------|
| Queue Monitor | `aaxis_tools_queue_monitor` | RabbitMQ queue monitoring |
| API Collection | `aaxis_tools_api_collection` | Insomnia-style REST client (server-side execution) |
| Base64 | `aaxis_tools_base64` | Client-side Base64 encode/decode |

### Queue Monitor
Live view of **RabbitMQ** queues via the management HTTP API: outstanding messages and consumers,
per-queue colour selection, multi-queue selection, a maximizable multi-series length-history chart,
and a non-destructive message preview (messages are fetched and immediately requeued). The
**"Test it"** button on its System Configuration page runs a live connectivity check via the shared
CommonBundle connection-test endpoint (`Connection/QueueConnectionTester`).

### API Collection
A lightweight, Insomnia-style REST client for building, organising and running HTTP requests.
Requests are executed **server-side** (proxied via Symfony HttpClient), so the browser is not subject
to CORS. The collection tree and run history are persisted server-side
(`aaxis_apicollection_request`, `aaxis_apicollection_run_history`); requests can be private or public.

### Base64
Encode text or files to Base64 and decode back, entirely client-side — nothing is uploaded.

---

## Persistence (migrations)

| Table | Purpose |
|-------|---------|
| `aaxis_apicollection_request` | API Collection tree (folders + requests; `params`/`headers` are `jsonb`) |
| `aaxis_apicollection_run_history` | API Collection run log (request name, status, datetime, response size) |

### History retention & nightly cleanup
The **API Collection** section exposes a **"Keep history data for (days)"** setting (default **30**).
The cron command `aaxis:tools:history:cleanup` runs once a day at midnight and deletes
`aaxis_apicollection_run_history` records older than the configured retention (0 keeps records
indefinitely). It uses the shared `Aaxis\Bundle\CommonBundle\Command\HistoryRetentionPurger`.

---

## Feature toggles & security

Each tool's *Enabled* flag is wired to an Oro **feature toggle** (`Resources/config/oro/features.yml`);
disabling a tool hides its menu item and 404s its routes. Access to every tool page and AJAX endpoint
is gated by a single **"Access Aaxis Tools"** action ACL (`aaxis_tools`,
`Resources/config/oro/acls.yml`), granted to the Administrator role by
`Migrations/Data/ORM/LoadAaxisToolsAdminPermissions`.

- **API Collection** executes requests server-side (proxy), so it can reach internal hosts and cloud
  metadata endpoints (SSRF surface). Consider an allow/deny list before exposing it widely.
- **Queue Monitor** can display message payloads.

---

## External dependencies & environment

### RabbitMQ management plugin (required by Queue Monitor)
The Queue Monitor needs the RabbitMQ **management HTTP API**. Connection details are derived from
`ORO_MQ_DSN`; the management base URL defaults to `http://<host>:15672` and can be overridden with the
optional `ORO_MQ_MANAGEMENT_URL` env var.

---

## Installation

Add both repositories and require the package — Composer pulls in `aaxisdigital/oro-common`
automatically (the project already has the Oro Composer registry, so `oro/platform` resolves):

```jsonc
// composer.json
"repositories": {
    "aaxis-common": { "type": "vcs", "url": "https://github.com/aaxisdigital/oro-common.git" },
    "aaxis-tools":  { "type": "vcs", "url": "https://github.com/aaxisdigital/oro-tools.git" }
}
```

```bash
composer require aaxisdigital/oro-tools:7.0.*
```

The bundle is auto-registered via `Resources/config/oro/bundles.yml` (the Oro kernel scans `vendor/`
and `src/` — no `AppKernel` edit needed). It requires `AaxisCommonBundle`. After install/update run
(prefix each with your PHP runner, e.g. `docker exec <php-container> ...`, when running in Docker):

```bash
php bin/console cache:clear --no-interaction
php bin/console oro:migration:load --force                 # creates the API Collection tables (+ admin ACL)
php bin/console aaxis:tools:typescript:compile             # compile this bundle's TypeScript
php bin/console oro:assets:build --no-interaction
php bin/console oro:translation:load --no-interaction
php bin/console oro:translation:rebuild-cache --no-interaction
php bin/console oro:cron:definitions:load                  # registers aaxis:tools:history:cleanup
```

---

## Front-end / build

TypeScript components live in `Resources/js-src` and are compiled to `Resources/public/js` by
`php bin/console aaxis:tools:typescript:compile` (also triggered automatically on `oro:assets:build`
via `CompileTypeScriptOnAssetsBuildListener`). Re-run the compile, then `oro:assets:build`, after
changing any `.ts` source.
