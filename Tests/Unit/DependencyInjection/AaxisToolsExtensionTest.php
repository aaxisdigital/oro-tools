<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\DependencyInjection;

use Aaxis\Bundle\CommonBundle\Build\TypeScriptCompiler;
use Aaxis\Bundle\CommonBundle\Command\CompileTypeScriptCommand;
use Aaxis\Bundle\ToolsBundle\Command\CleanupHistoryCommand;
use Aaxis\Bundle\ToolsBundle\Connection\QueueConnectionTester;
use Aaxis\Bundle\ToolsBundle\Controller\ApiCollectionController;
use Aaxis\Bundle\ToolsBundle\Controller\Base64Controller;
use Aaxis\Bundle\ToolsBundle\Controller\QueueMonitorController;
use Aaxis\Bundle\ToolsBundle\Controller\ToolsController;
use Aaxis\Bundle\ToolsBundle\DependencyInjection\AaxisToolsExtension;
use Aaxis\Bundle\ToolsBundle\Http\ApiRequestExecutor;
use Aaxis\Bundle\ToolsBundle\Http\LocalHostRewriter;
use Aaxis\Bundle\ToolsBundle\Manager\ApiCollectionManager;
use Aaxis\Bundle\ToolsBundle\Queue\RabbitMqManagementClient;
use PHPUnit\Framework\TestCase;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Reference;

class AaxisToolsExtensionTest extends TestCase
{
    private ContainerBuilder $container;

    protected function setUp(): void
    {
        $this->container = new ContainerBuilder();
        (new AaxisToolsExtension())->load([], $this->container);
    }

    public function testAliasMatchesTheSettingKeyPrefix(): void
    {
        self::assertSame('aaxis_tools', (new AaxisToolsExtension())->getAlias());
    }

    public function testPrependsTheSettingsSoTheyReachTheSystemConfiguration(): void
    {
        $prepended = $this->container->getExtensionConfig('aaxis_tools');

        self::assertCount(1, $prepended);
        self::assertSame(15, $prepended[0]['settings']['queue_monitor_refresh_interval']['value']);
        self::assertFalse($prepended[0]['settings']['api_collection_local_rewrite']['value']);
    }

    public function testConfiguredValuesWinOverTheDefaultsInThePrependedSettings(): void
    {
        $container = new ContainerBuilder();

        (new AaxisToolsExtension())->load(
            [['settings' => ['api_collection_history_retention_days' => ['value' => 90]]]],
            $container
        );

        self::assertSame(90, $container->getExtensionConfig('aaxis_tools')[0]['settings']['api_collection_history_retention_days']['value']);
    }

    public function testExposesTheBundleDirectoryForTheTypeScriptBuild(): void
    {
        $dir = $this->container->getParameter('aaxis_tools.bundle_dir');

        self::assertIsString($dir);
        self::assertFileExists($dir . '/Resources/js-src/tsconfig.json');
        self::assertSame(\dirname(__DIR__, 3), $dir);
    }

    /**
     * @dataProvider serviceProvider
     */
    public function testRegistersTheBundleServices(string $id, ?string $explicitClass): void
    {
        self::assertTrue($this->container->hasDefinition($id), $id);
        // Services keyed by their class name carry no explicit class; the others must point at the right one.
        self::assertSame($explicitClass, $this->container->getDefinition($id)->getClass());
    }

    /**
     * @return iterable<string, array{string, class-string|null}>
     */
    public static function serviceProvider(): iterable
    {
        yield 'rabbitmq client' => [RabbitMqManagementClient::class, null];
        yield 'api collection manager' => [ApiCollectionManager::class, null];
        yield 'api request executor' => [ApiRequestExecutor::class, null];
        yield 'local host rewriter' => [LocalHostRewriter::class, null];
        yield 'queue connection tester' => [QueueConnectionTester::class, null];
        yield 'cleanup command' => [CleanupHistoryCommand::class, null];
        yield 'typescript compiler' => ['aaxis_tools.typescript_compiler', TypeScriptCompiler::class];
        yield 'typescript command' => ['aaxis_tools.typescript_compile_command', CompileTypeScriptCommand::class];
    }

    /**
     * @dataProvider aliasProvider
     */
    public function testPublicAliasesAreExposedForOtherBundles(string $alias, string $target): void
    {
        self::assertSame($target, (string) $this->container->getAlias($alias));
        self::assertTrue($this->container->getAlias($alias)->isPublic(), $alias);
    }

    /**
     * @return iterable<string, array{string, class-string}>
     */
    public static function aliasProvider(): iterable
    {
        yield 'rabbitmq client' => ['aaxis_tools.rabbitmq_management_client', RabbitMqManagementClient::class];
        yield 'api collection manager' => ['aaxis_tools.api_collection_manager', ApiCollectionManager::class];
        yield 'api request executor' => ['aaxis_tools.api_request_executor', ApiRequestExecutor::class];
        yield 'local host rewriter' => ['aaxis_tools.local_host_rewriter', LocalHostRewriter::class];
    }

    public function testTheRabbitMqClientIsBuiltFromTheEnvironment(): void
    {
        $arguments = $this->container->getDefinition(RabbitMqManagementClient::class)->getArguments();

        self::assertSame(['%env(ORO_MQ_DSN)%', '%env(default::ORO_MQ_MANAGEMENT_URL)%'], $arguments);
    }

    public function testTheQueueTesterIsRegisteredWithTheSharedConnectionTestRegistry(): void
    {
        $definition = $this->container->getDefinition(QueueConnectionTester::class);

        self::assertSame(
            [['tool' => 'queue_monitor']],
            $definition->getTag('aaxis_common.connection_tester')
        );
        self::assertEquals([new Reference('aaxis_tools.rabbitmq_management_client')], $definition->getArguments());
    }

    public function testTheCleanupCommandIsTaggedAndUsesTheSharedPurger(): void
    {
        $definition = $this->container->getDefinition(CleanupHistoryCommand::class);

        self::assertArrayHasKey('console.command', $definition->getTags());
        self::assertEquals(
            [new Reference('aaxis_common.history_retention_purger'), new Reference('oro_config.global')],
            $definition->getArguments()
        );
    }

    /**
     * @dataProvider controllerProvider
     */
    public function testControllersAreRegisteredAsPublicServiceSubscribers(string $controller): void
    {
        $definition = $this->container->getDefinition($controller);

        self::assertTrue($definition->isPublic());
        self::assertArrayHasKey('container.service_subscriber', $definition->getTags());
        self::assertSame('setContainer', $definition->getMethodCalls()[0][0]);
    }

    /**
     * @return iterable<string, array{class-string}>
     */
    public static function controllerProvider(): iterable
    {
        yield 'tools' => [ToolsController::class];
        yield 'api collection' => [ApiCollectionController::class];
        yield 'base64' => [Base64Controller::class];
        yield 'queue monitor' => [QueueMonitorController::class];
    }

    public function testControllersReceiveTheirCollaboratorsThroughServiceSubscribers(): void
    {
        $tags = $this->container->getDefinition(ApiCollectionController::class)->getTag('container.service_subscriber');
        $byKey = array_column($tags, 'id', 'key');

        self::assertSame('aaxis_tools.api_collection_manager', $byKey[ApiCollectionManager::class]);
        self::assertSame('aaxis_tools.api_request_executor', $byKey[ApiRequestExecutor::class]);
        self::assertSame('aaxis_tools.local_host_rewriter', $byKey[LocalHostRewriter::class]);
    }
}
