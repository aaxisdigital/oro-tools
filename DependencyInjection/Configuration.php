<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\DependencyInjection;

use Oro\Bundle\ConfigBundle\DependencyInjection\SettingsBuilder;
use Symfony\Component\Config\Definition\Builder\TreeBuilder;
use Symfony\Component\Config\Definition\ConfigurationInterface;

/**
 * Defines the configuration tree for the bundle ("aaxis_tools"),
 * including the System Configuration settings for each sub-tool.
 */
class Configuration implements ConfigurationInterface
{
    #[\Override]
    public function getConfigTreeBuilder(): TreeBuilder
    {
        $treeBuilder = new TreeBuilder('aaxis_tools');
        $rootNode = $treeBuilder->getRootNode();

        SettingsBuilder::append($rootNode, [
            // Queue Monitor
            'queue_monitor_enabled' => ['type' => 'boolean', 'value' => true],
            'queue_monitor_test' => ['type' => 'string', 'value' => ''],
            'queue_monitor_allow_multiselect' => ['type' => 'boolean', 'value' => true],
            'queue_monitor_allow_color_selection' => ['type' => 'boolean', 'value' => true],
            'queue_monitor_allow_message_preview' => ['type' => 'boolean', 'value' => true],
            'queue_monitor_preview_max_queues' => ['type' => 'integer', 'value' => 4],
            'queue_monitor_max_message_fetch' => ['type' => 'integer', 'value' => 100],
            'queue_monitor_history_samples' => ['type' => 'integer', 'value' => 15],
            'queue_monitor_history_interval' => ['type' => 'integer', 'value' => 60],

            // API Collection
            'api_collection_enabled' => ['type' => 'boolean', 'value' => true],
            'api_collection_history_retention_days' => ['type' => 'integer', 'value' => 30],

            // Base64
            'base64_enabled' => ['type' => 'boolean', 'value' => true],
        ]);

        return $treeBuilder;
    }
}
