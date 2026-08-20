<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Exception;

/**
 * Thrown when a call to the RabbitMQ management API fails — the endpoint is unreachable, curl could
 * not be initialised, or the API answered with an HTTP error.
 *
 * Extends \RuntimeException so the surrounding \Throwable catches in QueueMonitorController and
 * QueueConnectionTester keep reporting it as a normal tool error.
 */
class RabbitMqManagementException extends \RuntimeException
{
}
