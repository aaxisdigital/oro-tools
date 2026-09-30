<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Controller;

use Aaxis\Bundle\ToolsBundle\Controller\ToolsController;
use Oro\Bundle\ConfigBundle\Config\ConfigManager;
use PHPUnit\Framework\TestCase;
use Symfony\Component\DependencyInjection\Container;

class ToolsControllerTest extends TestCase
{
    public function testQueueMonitorReceivesItsSystemConfigurationAsPageOptions(): void
    {
        $options = $this->controller([
            'aaxis_tools.queue_monitor_allow_multiselect' => true,
            'aaxis_tools.queue_monitor_allow_color_selection' => false,
            'aaxis_tools.queue_monitor_allow_message_preview' => '1',
            'aaxis_tools.queue_monitor_refresh_interval' => 30,
            'aaxis_tools.queue_monitor_preview_max_queues' => 6,
            'aaxis_tools.queue_monitor_max_message_fetch' => 250,
            'aaxis_tools.queue_monitor_history_samples' => 40,
        ])->queueMonitorAction()['options'];

        self::assertSame([
            'allowMultiselect' => true,
            'allowColorSelection' => false,
            'allowMessagePreview' => true,
            'refreshInterval' => 30,
            'previewMaxQueues' => 6,
            'maxMessageFetch' => 250,
            'historySamples' => 40,
        ], $options);
    }

    /**
     * @dataProvider clampProvider
     */
    public function testNumericOptionsAreClampedToSaneRanges(string $setting, string $option, mixed $configured, int $expected): void
    {
        $options = $this->controller(['aaxis_tools.queue_monitor_' . $setting => $configured])->queueMonitorAction()['options'];

        self::assertSame($expected, $options[$option]);
    }

    /**
     * @return iterable<string, array{string, string, mixed, int}>
     */
    public static function clampProvider(): iterable
    {
        yield 'refresh interval below the floor' => ['refresh_interval', 'refreshInterval', 1, 5];
        yield 'refresh interval above the ceiling' => ['refresh_interval', 'refreshInterval', 100000, 3600];
        yield 'refresh interval unset' => ['refresh_interval', 'refreshInterval', null, 5];
        yield 'refresh interval as a string' => ['refresh_interval', 'refreshInterval', '45', 45];
        yield 'preview queues below the floor' => ['preview_max_queues', 'previewMaxQueues', 0, 1];
        yield 'preview queues above the ceiling' => ['preview_max_queues', 'previewMaxQueues', 500, 100];
        yield 'message fetch below the floor' => ['max_message_fetch', 'maxMessageFetch', -3, 1];
        yield 'message fetch above the ceiling' => ['max_message_fetch', 'maxMessageFetch', 5000, 1000];
        yield 'history samples below the floor' => ['history_samples', 'historySamples', 1, 2];
        yield 'history samples above the ceiling' => ['history_samples', 'historySamples', 9000, 500];
    }

    public function testUnsetTogglesAreOff(): void
    {
        $options = $this->controller([])->queueMonitorAction()['options'];

        self::assertFalse($options['allowMultiselect']);
        self::assertFalse($options['allowColorSelection']);
        self::assertFalse($options['allowMessagePreview']);
    }

    public function testTheApiCollectionPageNeedsNoParameters(): void
    {
        self::assertSame([], $this->controller([])->apiCollectionAction());
    }

    public function testDeclaresTheConfigManagerAsASubscribedService(): void
    {
        self::assertContains(ConfigManager::class, ToolsController::getSubscribedServices());
    }

    /**
     * @param array<string, mixed> $settings
     */
    private function controller(array $settings): ToolsController
    {
        $config = $this->createMock(ConfigManager::class);
        $config->method('get')->willReturnCallback(static fn (string $key) => $settings[$key] ?? null);

        $container = new Container();
        $container->set(ConfigManager::class, $config);
        $controller = new ToolsController();
        $controller->setContainer($container);

        return $controller;
    }
}
