<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Controller;

use Oro\Bundle\ConfigBundle\Config\ConfigManager;
use Symfony\Bridge\Twig\Attribute\Template;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Provides the back-office pages for the "Aaxis Tools" section.
 *
 * Each tool page receives its System Configuration options so the front-end
 * components can adapt (hide/show features) accordingly.
 */
class ToolsController extends AbstractController
{
    #[Route(path: '/queue-monitor', name: 'aaxis_tools_queue_monitor')]
    #[Template('@AaxisTools/Tools/queueMonitor.html.twig')]
    public function queueMonitorAction(): array
    {
        $config = $this->config();

        return [
            'options' => [
                'allowMultiselect' => (bool) $config->get('aaxis_tools.queue_monitor_allow_multiselect'),
                'allowColorSelection' => (bool) $config->get('aaxis_tools.queue_monitor_allow_color_selection'),
                'allowMessagePreview' => (bool) $config->get('aaxis_tools.queue_monitor_allow_message_preview'),
                'refreshInterval' => $this->refreshInterval(),
                'previewMaxQueues' => max(1, min((int) $config->get('aaxis_tools.queue_monitor_preview_max_queues'), 100)),
                'maxMessageFetch' => max(1, min((int) $config->get('aaxis_tools.queue_monitor_max_message_fetch'), 1000)),
                'historySamples' => max(2, min((int) $config->get('aaxis_tools.queue_monitor_history_samples'), 500)),
            ],
        ];
    }

    #[Route(path: '/api-collection', name: 'aaxis_tools_api_collection')]
    #[Template('@AaxisTools/Tools/apiCollection.html.twig')]
    public function apiCollectionAction(): array
    {
        return [];
    }

    private function config(): ConfigManager
    {
        return $this->container->get(ConfigManager::class);
    }

    /**
     * Auto-refresh interval (seconds) for the Queue Monitor. Single source of truth for both the
     * front-end timer and the displayed label; clamped to a sane range so a misconfiguration
     * can't hammer the management API (low) or effectively disable refreshing (high).
     */
    private function refreshInterval(): int
    {
        return max(5, min((int) $this->config()->get('aaxis_tools.queue_monitor_refresh_interval'), 3600));
    }

    #[\Override]
    public static function getSubscribedServices(): array
    {
        return array_merge(parent::getSubscribedServices(), [
            ConfigManager::class,
        ]);
    }
}
