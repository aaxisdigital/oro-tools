<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Connection;

use Aaxis\Bundle\CommonBundle\Connection\ConnectionTesterInterface;
use Aaxis\Bundle\ToolsBundle\Queue\RabbitMqManagementClient;

/**
 * "Test connection" check for the Queue Monitor (RabbitMQ management HTTP API).
 *
 * @phpstan-import-type TestResult from ConnectionTesterInterface
 */
class QueueConnectionTester implements ConnectionTesterInterface
{
    public function __construct(private readonly RabbitMqManagementClient $rabbitMqClient)
    {
    }

    #[\Override]
    public function getTool(): string
    {
        return 'queue_monitor';
    }

    /**
     * @return TestResult
     */
    #[\Override]
    public function test(array $overrides = []): array
    {
        try {
            return $this->rabbitMqClient->testConnection();
        } catch (\Throwable $e) {
            return [
                'success' => false,
                'message' => 'RabbitMQ check failed: ' . $e->getMessage(),
                'details' => [],
            ];
        }
    }
}
