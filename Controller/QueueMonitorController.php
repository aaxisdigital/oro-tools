<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Controller;

use Aaxis\Bundle\ToolsBundle\Queue\RabbitMqManagementClient;
use Oro\Bundle\ConfigBundle\Config\ConfigManager;
use Oro\Bundle\SecurityBundle\Attribute\CsrfProtection;
use Psr\Log\LoggerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

/**
 * JSON endpoints backing the Queue Monitor page.
 *
 * All operations are read-only: listing queues, reading a queue's counters and recent
 * length history, and previewing messages (fetched and immediately requeued).
 */
class QueueMonitorController extends AbstractController
{
    #[Route(path: '/queue-monitor/queues', name: 'aaxis_tools_queue_monitor_queues', methods: ['GET'])]
    public function queuesAction(): JsonResponse
    {
        try {
            return new JsonResponse([
                'queues' => $this->container->get(RabbitMqManagementClient::class)->listQueues(),
            ]);
        } catch (\Throwable $e) {
            return $this->errorResponse('list queues', $e);
        }
    }

    #[Route(
        path: '/queue-monitor/queue/{name}',
        name: 'aaxis_tools_queue_monitor_queue',
        requirements: ['name' => '[^/]+'],
        methods: ['GET']
    )]
    public function queueAction(string $name): JsonResponse
    {
        try {
            $config = $this->container->get(ConfigManager::class);
            $samples = max(2, min((int) $config->get('aaxis_tools.queue_monitor_history_samples'), 500));
            $interval = max(5, min((int) $config->get('aaxis_tools.queue_monitor_history_interval'), 3600));
            // RabbitMQ returns one sample per "incr" seconds over the "age" window.
            $age = $samples * $interval;

            return new JsonResponse([
                'queue' => $this->container->get(RabbitMqManagementClient::class)->getQueue($name, $age, $interval),
            ]);
        } catch (\Throwable $e) {
            return $this->errorResponse('read the queue', $e);
        }
    }

    #[Route(
        path: '/queue-monitor/queue/{name}/messages',
        name: 'aaxis_tools_queue_monitor_messages',
        requirements: ['name' => '[^/]+'],
        methods: ['POST']
    )]
    #[CsrfProtection]
    public function messagesAction(Request $request, string $name): JsonResponse
    {
        if (!$this->container->get(ConfigManager::class)->get('aaxis_tools.queue_monitor_allow_message_preview')) {
            return new JsonResponse(['success' => false, 'message' => 'Message preview is disabled.'], 403);
        }

        $payload = json_decode($request->getContent(), true);
        $count = \is_array($payload) ? (int) ($payload['count'] ?? 10) : 10;
        $maxFetch = max(1, min((int) $this->container->get(ConfigManager::class)->get('aaxis_tools.queue_monitor_max_message_fetch'), 1000));

        try {
            return new JsonResponse([
                'messages' => $this->container->get(RabbitMqManagementClient::class)->getMessages($name, $count, $maxFetch),
            ]);
        } catch (\Throwable $e) {
            return $this->errorResponse('preview messages', $e);
        }
    }

    private function errorResponse(string $action, \Throwable $e): JsonResponse
    {
        $this->container->get(LoggerInterface::class)
            ->warning(sprintf('Aaxis Tools queue monitor: unable to %s.', $action), ['exception' => $e]);

        return new JsonResponse(['success' => false, 'message' => $e->getMessage()], 502);
    }

    #[\Override]
    public static function getSubscribedServices(): array
    {
        return array_merge(parent::getSubscribedServices(), [
            RabbitMqManagementClient::class,
            ConfigManager::class,
            LoggerInterface::class,
        ]);
    }
}
