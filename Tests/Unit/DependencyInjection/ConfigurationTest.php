<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\DependencyInjection;

use Aaxis\Bundle\ToolsBundle\DependencyInjection\Configuration;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Config\Definition\Exception\InvalidConfigurationException;
use Symfony\Component\Config\Definition\Processor;

class ConfigurationTest extends TestCase
{
    public function testTheRootNodeIsTheBundleAlias(): void
    {
        self::assertSame('aaxis_tools', (new Configuration())->getConfigTreeBuilder()->buildTree()->getName());
    }

    /**
     * @dataProvider settingDefaultsProvider
     */
    public function testSettingDefaults(string $setting, bool|int|string $default): void
    {
        $config = $this->process([]);

        self::assertSame($default, $config['settings'][$setting]['value'], $setting);
        self::assertSame('app', $config['settings'][$setting]['scope'], $setting);
    }

    /**
     * @return iterable<string, array{string, bool|int|string}>
     */
    public static function settingDefaultsProvider(): iterable
    {
        yield 'queue monitor enabled' => ['queue_monitor_enabled', true];
        yield 'queue monitor connection test' => ['queue_monitor_test', ''];
        yield 'multiselect' => ['queue_monitor_allow_multiselect', true];
        yield 'colour selection' => ['queue_monitor_allow_color_selection', true];
        yield 'message preview' => ['queue_monitor_allow_message_preview', true];
        yield 'refresh interval' => ['queue_monitor_refresh_interval', 15];
        yield 'preview max queues' => ['queue_monitor_preview_max_queues', 4];
        yield 'max message fetch' => ['queue_monitor_max_message_fetch', 100];
        yield 'history samples' => ['queue_monitor_history_samples', 15];
        yield 'history interval' => ['queue_monitor_history_interval', 60];
        yield 'api collection enabled' => ['api_collection_enabled', true];
        yield 'api collection retention' => ['api_collection_history_retention_days', 30];
        yield 'local rewrite is opt-in' => ['api_collection_local_rewrite', false];
        yield 'base64 enabled' => ['base64_enabled', true];
    }

    public function testAdministratorsCanOverrideASetting(): void
    {
        $config = $this->process([
            'settings' => [
                'queue_monitor_refresh_interval' => ['value' => 45, 'scope' => 'user'],
                'api_collection_local_rewrite' => ['value' => true],
            ],
        ]);

        self::assertSame(45, $config['settings']['queue_monitor_refresh_interval']['value']);
        self::assertSame('user', $config['settings']['queue_monitor_refresh_interval']['scope']);
        self::assertTrue($config['settings']['api_collection_local_rewrite']['value']);
        // Untouched settings keep their defaults.
        self::assertSame(15, $config['settings']['queue_monitor_history_samples']['value']);
    }

    public function testUnknownSettingsAreRejected(): void
    {
        $this->expectException(InvalidConfigurationException::class);

        $this->process(['settings' => ['not_a_tools_setting' => ['value' => 1]]]);
    }

    /**
     * @param array<string, mixed> $config
     *
     * @return array<string, mixed>
     */
    private function process(array $config): array
    {
        return (new Processor())->processConfiguration(new Configuration(), [$config]);
    }
}
