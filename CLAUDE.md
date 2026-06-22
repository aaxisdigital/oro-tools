# CLAUDE.md — AaxisToolsBundle

Guidance for working in this bundle. Read alongside `README.md` (user-facing) and the CommonBundle
`CLAUDE.md` (shared infrastructure).

## What this bundle is

The lighter back-office toolbox: **Queue Monitor, API Collection, Base64**. The heavier
operational/developer tools were split into `AaxisDevToolsBundle`; the connection-test infra and the
history-cleanup helper live in `AaxisCommonBundle`. This bundle depends only on `AaxisCommonBundle`
and is independent of `AaxisDevToolsBundle`.

## Identity / naming conventions

| Thing | Value |
|-------|-------|
| PHP namespace | `Aaxis\Bundle\ToolsBundle` |
| Bundle class | `AaxisToolsBundle` (auto-registered via `Resources/config/oro/bundles.yml`) |
| Config alias | `aaxis_tools` (setting keys `aaxis_tools.*`) |
| Route prefix / names | `/aaxis/tools` · `aaxis_tools_*` |
| Twig namespace | `@AaxisTools/...` |
| Asset namespace | `aaxistools` (`bundles/aaxistools/...`, JS ids `aaxistools/js/...`) |
| Translation root | `aaxis.tools.*` |
| ACL capability | `aaxis_tools` |
| Service id prefix | `aaxis_tools.*` |

The extension alias is derived correctly here (`AaxisToolsExtension` → `aaxis_tools`), so — unlike
`AaxisDevToolsBundle` — no `getAlias()`/`getContainerExtension()` override is needed.

## Layout

- `Controller/ToolsController.php` — **page** actions for Queue Monitor + API Collection.
  `Base64Controller` and the AJAX controllers `QueueMonitorController` / `ApiCollectionController`
  are separate.
- `Queue/RabbitMqManagementClient` — RabbitMQ management HTTP API client (Queue Monitor).
- `Http/ApiRequestExecutor` + `Manager/ApiCollectionManager` + `Entity/ApiCollection*` — API
  Collection (server-side request proxy + persisted tree/run-history).
- `Connection/QueueConnectionTester.php` — the Queue Monitor "Test it" check (see below).
- `Command/CleanupHistoryCommand.php` — `aaxis:tools:history:cleanup` cron (API Collection history).

## Connection-test ("Test it") pattern

Controller/route/JS/registry are in **CommonBundle**. This bundle only contributes
`Connection/QueueConnectionTester` (implements `Aaxis\Bundle\CommonBundle\Connection\ConnectionTesterInterface`),
tagged in `services.yml` with `{ name: aaxis_common.connection_tester, tool: queue_monitor }`. The
`queue_monitor_test` config field points at `aaxiscommon/js/app/components/connection-test-component`
with `{"tool":"queue_monitor"}`.

## History cleanup pattern

`CleanupHistoryCommand` reads `aaxis_tools.api_collection_history_retention_days` and calls the shared
`Aaxis\Bundle\CommonBundle\Command\HistoryRetentionPurger::purge(ApiCollectionRunHistory::class, $days)`.

## Adding a new tool (checklist)

Same shape as `AaxisDevToolsBundle` (see its `CLAUDE.md`), using the `aaxis_tools` / `aaxistools` /
`aaxis.tools.*` / `@AaxisTools` conventions: controller(s) → `services.yml` + `controllers.yml` →
`Configuration.php` + `system_configuration.yml` → `navigation.yml` (under `aaxis_tools_group`) →
`features.yml` toggle → `acls.yml` binding → `assets.yml`/`jsmodules.yml` → templates →
`aaxis.tools.*` translations → migration (consolidated install in `AaxisToolsBundleInstaller`).

> Tip: if a tool is operational/infra-oriented it probably belongs in `AaxisDevToolsBundle` instead.

## Front end / TypeScript

`Resources/js-src/*.ts` → `Resources/public/js/*.js` via `php bin/console aaxis:tools:typescript:compile`
(also on `oro:assets:build`). **Only the `.ts` sources are committed**; the emitted JS is generated at
build time and git-ignored — edit the `.ts`, never the `.js`. The build fails loudly if `tsc` is
missing (no committed JS fallback), and recompiles even under `vendor/aaxisdigital/oro*`.
`tsconfig.json` extends the bundle's own `tsconfig.base.json` (a copy of CommonBundle's, since each
package ships independently); shared widgets come from `aaxiscommon/js/app/widgets/*`.

## Verify after changes

```bash
php bin/console cache:clear --no-interaction
php bin/console debug:router | grep aaxis_tools
php bin/console aaxis:tools:typescript:compile
```
(`lint:container` fails on a pre-existing unrelated Oro alias issue — use `cache:clear`.)
