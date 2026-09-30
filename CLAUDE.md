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
- `Http/LocalHostRewriter` — config-gated (`aaxis_tools.api_collection_local_rewrite`, default off)
  hairpin work-around: an HTTPS request whose host equals the current request's `HTTP_HOST` is
  re-targeted to `SERVER_ADDR` (the "Connection arrived on local interface / IP" value from
  DevTools' Connection Info), original host preserved via a `Host` header override in the executor
  (user-supplied `Host` headers stay blocked). Applied in `ApiCollectionController::executeAction`;
  run history keeps the original URL.
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
`Configuration.php` + `system_configuration.yml` (the bundle owns the `aaxis_tools` "Tools"
level-2 menu group under CommonBundle's `aaxis` tab; each tool is its own level-3 PAGE whose
fields sit in a `<page>_section` fieldset — fields must land at nesting level 5; deep links use
`activeGroup: 'aaxis'`, `activeSubGroup: '<the tool's page group>'`) → `navigation.yml` (under `aaxis_tools_group`) →
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

## Tests

- **PHP** — `Tests/Unit`, PHPUnit **9.6** (the version the Oro 7.0 platform pins; write `@dataProvider` docblocks, no `withConsecutive`).
  From an Oro application that has this bundle installed:
  `php vendor/phpunit/phpunit/phpunit -c vendor/aaxisdigital/oro-tools/phpunit.xml.dist` (add `--coverage-text` with pcov/xdebug loaded).
  `Tests/bootstrap.php` finds the app's autoloader (override with `AAXIS_AUTOLOAD`) and pins this bundle's namespace to the working copy, so it never tests a stale `vendor/` copy.
  CommonBundle is taken from the sibling `oro-common` checkout (`AAXIS_COMMON_DIR` overrides).
  `Tests/Unit/DependencyInjection/ServiceWiringTest` loads the real `services.yml` and fails if a service names a missing class or passes the wrong number of constructor arguments — keep it green when refactoring constructors.
- **TypeScript** — `Tests/js/**/*.test.ts` (kept outside `Resources/js-src`, so `tsc` never emits them), Vitest + jsdom: `npm install && npm test` (`npm run test:coverage`).
  `vitest.config.ts` aliases Oro's AMD modules (`orotranslation/js/translator`, `routing`, `oroui/js/messenger`, `oroui/js/modal`, …) to the stand-ins in `Tests/js/stubs/`; jQuery is the real one. Extend a stub additively when a test needs more of it.
- **Sonar coverage scope**: everything counts except `Migrations/**`, `*Bundle.php`, `Resources/js-src/types/**` (they need a live DB/container or are pure declarations). Do not add `@codeCoverageIgnore`/`v8 ignore` to reach a number.
- Several Sonar findings are **triaged on purpose** (FALSE-POSITIVE/WONTFIX with a written rationale in the SonarQube UI): the `/* @theme: admin.oro; */` directive at the top of each SCSS file is Oro's theme marker, not commented-out code — do not remove it.
