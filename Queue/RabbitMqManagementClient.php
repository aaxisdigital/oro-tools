<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Queue;

use Aaxis\Bundle\ToolsBundle\Exception\RabbitMqManagementException;

/**
 * Thin read-only client for the RabbitMQ management HTTP API.
 *
 * Connection details are derived from the application's AMQP DSN (ORO_MQ_DSN); the management
 * base URL defaults to http://<host>:15672 but can be overridden (ORO_MQ_MANAGEMENT_URL).
 */
class RabbitMqManagementClient
{
    private const int DEFAULT_MANAGEMENT_PORT = 15672;

    private string $baseUrl;
    private string $user;
    private string $password;
    private string $vhost;

    public function __construct(string $amqpDsn, ?string $managementUrl = null)
    {
        $parts = parse_url($amqpDsn) ?: [];

        $this->user = isset($parts['user']) ? rawurldecode((string) $parts['user']) : 'guest';
        $this->password = isset($parts['pass']) ? rawurldecode((string) $parts['pass']) : 'guest';

        $path = trim((string) ($parts['path'] ?? ''), '/');
        $this->vhost = $path === '' ? '/' : rawurldecode($path);

        if ($managementUrl !== null && $managementUrl !== '') {
            $this->baseUrl = rtrim($managementUrl, '/');
        } else {
            $host = (string) ($parts['host'] ?? 'localhost');
            $this->baseUrl = sprintf('http://%s:%d', $host, self::DEFAULT_MANAGEMENT_PORT);
        }
    }

    /**
     * Returns whether the management API is reachable (used to surface a friendly hint).
     */
    public function isAvailable(): bool
    {
        try {
            $this->request('GET', '/api/overview');

            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * Tests connectivity to the management API: verifies the endpoint is reachable AND the
     * credentials are valid. Never returns the password.
     *
     * @return array{success: bool, message: string, details: array<string, string>}
     */
    public function testConnection(): array
    {
        $result = $this->transport($this->baseUrl . '/api/overview', [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_USERPWD => $this->user . ':' . $this->password,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
        ]);
        if ($result === null) {
            return ['success' => false, 'message' => 'Unable to initialise the request.', 'details' => []];
        }

        ['response' => $response, 'status' => $status, 'errno' => $errno, 'error' => $error] = $result;

        $details = [
            'Management URL' => $this->baseUrl,
            'User' => $this->user,
            'Virtual host' => $this->vhost,
        ];

        $failure = $this->connectionFailure($response, $status, $errno, $error);
        if ($failure !== null) {
            return ['success' => false, 'message' => $failure, 'details' => $details];
        }

        $decoded = json_decode((string) $response, true);
        if (\is_array($decoded)) {
            if (isset($decoded['rabbitmq_version'])) {
                $details['RabbitMQ version'] = (string) $decoded['rabbitmq_version'];
            }
            if (isset($decoded['product_version'])) {
                $details['Product version'] = (string) $decoded['product_version'];
            }
            if (isset($decoded['node'])) {
                $details['Node'] = (string) $decoded['node'];
            }
        }

        return ['success' => true, 'message' => 'Connected to the RabbitMQ management API.', 'details' => $details];
    }

    /**
     * Why the overview call did not amount to a working connection, or null when it did.
     */
    private function connectionFailure(string|false $response, int $status, int $errno, string $error): ?string
    {
        return match (true) {
            $response === false || $errno !== 0 => sprintf(
                'Management API unreachable at %s (%s). Ensure the "rabbitmq_management" plugin is enabled '
                . 'and the management port (default 15672) is reachable from the application.',
                $this->baseUrl,
                $error !== '' ? $error : 'connection failed'
            ),
            $status === 401 => sprintf(
                'Authentication failed for user "%s" (HTTP 401). Check the credentials in ORO_MQ_DSN.',
                $this->user
            ),
            $status >= 400 => sprintf('Management API returned HTTP %d.', $status),
            default => null,
        };
    }

    /**
     * Lists the queues of the configured vhost with their outstanding messages and consumers.
     *
     * @return array<int, array{
     *     name: string, state: string, messages: int, messagesReady: int,
     *     messagesUnacked: int, consumers: int, node: string
     * }>
     */
    public function listQueues(): array
    {
        $path = sprintf('/api/queues/%s', rawurlencode($this->vhost));
        $queues = $this->request('GET', $path);

        $result = [];
        foreach ((array) $queues as $queue) {
            if (!\is_array($queue)) {
                continue;
            }
            $result[] = [
                'name' => (string) ($queue['name'] ?? ''),
                'state' => (string) ($queue['state'] ?? ''),
                'messages' => (int) ($queue['messages'] ?? 0),
                'messagesReady' => (int) ($queue['messages_ready'] ?? 0),
                'messagesUnacked' => (int) ($queue['messages_unacknowledged'] ?? 0),
                'consumers' => (int) ($queue['consumers'] ?? 0),
                'node' => (string) ($queue['node'] ?? ''),
            ];
        }

        usort($result, static fn (array $a, array $b) => strcmp($a['name'], $b['name']));

        return $result;
    }

    /**
     * Returns a queue's current counters plus the recent message-count history samples
     * retained by RabbitMQ (native short-term history).
     *
     * @return array{
     *     name: string, state: string, durable: bool, node: string,
     *     messages: int, messagesReady: int, messagesUnacked: int, consumers: int,
     *     samplesAvailable: bool,
     *     samples: array<int, array{timestamp: int, ready: int|null, unacked: int|null, total: int|null}>
     * }
     */
    public function getQueue(string $name, int $lengthsAge = 3600, int $lengthsIncr = 60): array
    {
        $path = sprintf(
            '/api/queues/%s/%s?lengths_age=%d&lengths_incr=%d&msg_rates_age=%d&msg_rates_incr=%d',
            rawurlencode($this->vhost),
            rawurlencode($name),
            $lengthsAge,
            $lengthsIncr,
            $lengthsAge,
            $lengthsIncr
        );
        $queue = $this->request('GET', $path);

        return [
            'name' => (string) ($queue['name'] ?? $name),
            'state' => (string) ($queue['state'] ?? ''),
            'durable' => (bool) ($queue['durable'] ?? false),
            'node' => (string) ($queue['node'] ?? ''),
            'messages' => (int) ($queue['messages'] ?? 0),
            'messagesReady' => (int) ($queue['messages_ready'] ?? 0),
            'messagesUnacked' => (int) ($queue['messages_unacknowledged'] ?? 0),
            'consumers' => (int) ($queue['consumers'] ?? 0),
            'samplesAvailable' => $this->hasSampleDetails($queue),
            'samples' => $this->extractSamples($queue),
        ];
    }

    /**
     * Fetches up to $count messages for preview and immediately requeues them
     * (ackmode "ack_requeue_true"), so the operation is non-destructive.
     *
     * @return array<int, array{
     *     payload: string, payloadBytes: int, encoding: string, redelivered: bool,
     *     routingKey: string, exchange: string, properties: array<string, mixed>
     * }>
     */
    public function getMessages(string $name, int $count = 10, int $maxCount = 100): array
    {
        $maxCount = max(1, $maxCount);
        $count = max(1, min($count, $maxCount));
        $path = sprintf('/api/queues/%s/%s/get', rawurlencode($this->vhost), rawurlencode($name));

        $messages = $this->request('POST', $path, [
            'count' => $count,
            'ackmode' => 'ack_requeue_true',
            'encoding' => 'auto',
            'truncate' => 50000,
        ]);

        $result = [];
        foreach ((array) $messages as $message) {
            if (!\is_array($message)) {
                continue;
            }
            $result[] = [
                'payload' => (string) ($message['payload'] ?? ''),
                'payloadBytes' => (int) ($message['payload_bytes'] ?? 0),
                'encoding' => (string) ($message['payload_encoding'] ?? ''),
                'redelivered' => (bool) ($message['redelivered'] ?? false),
                'routingKey' => (string) ($message['routing_key'] ?? ''),
                'exchange' => (string) ($message['exchange'] ?? ''),
                'properties' => (array) ($message['properties'] ?? []),
            ];
        }

        return $result;
    }

    /**
     * Whether the queue response carries length-history sample details. When RabbitMQ's
     * management metrics collector is disabled, these "*_details" objects are absent, so
     * no history samples can be shown.
     *
     * @param array<string, mixed> $queue
     */
    private function hasSampleDetails(array $queue): bool
    {
        foreach (['messages_details', 'messages_ready_details', 'messages_unacknowledged_details'] as $key) {
            if (isset($queue[$key]['samples']) && \is_array($queue[$key]['samples'])) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param array<string, mixed> $queue
     * @return array<int, array{timestamp: int, ready: int|null, unacked: int|null, total: int|null}>
     */
    private function extractSamples(array $queue): array
    {
        $readySamples = $this->samplesByTimestamp($queue['messages_ready_details'] ?? null);
        $unackedSamples = $this->samplesByTimestamp($queue['messages_unacknowledged_details'] ?? null);
        $totalSamples = $this->samplesByTimestamp($queue['messages_details'] ?? null);

        $timestamps = array_unique(array_merge(
            array_keys($readySamples),
            array_keys($unackedSamples),
            array_keys($totalSamples)
        ));
        sort($timestamps);

        $samples = [];
        foreach ($timestamps as $timestamp) {
            $samples[] = [
                'timestamp' => (int) $timestamp,
                'ready' => $readySamples[$timestamp] ?? null,
                'unacked' => $unackedSamples[$timestamp] ?? null,
                'total' => $totalSamples[$timestamp] ?? null,
            ];
        }

        return $samples;
    }

    /**
     * @param mixed $details
     * @return array<int, int>
     */
    private function samplesByTimestamp(mixed $details): array
    {
        if (!\is_array($details) || !isset($details['samples']) || !\is_array($details['samples'])) {
            return [];
        }

        $result = [];
        foreach ($details['samples'] as $sample) {
            if (\is_array($sample) && isset($sample['timestamp'])) {
                $result[(int) $sample['timestamp']] = (int) ($sample['sample'] ?? 0);
            }
        }

        return $result;
    }

    /**
     * @param array<string, mixed>|null $body
     * @return array<mixed>
     *
     * @throws RabbitMqManagementException on transport or HTTP errors
     */
    private function request(string $method, string $path, ?array $body = null): array
    {
        $headers = ['Accept: application/json'];
        $options = [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_USERPWD => $this->user . ':' . $this->password,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 15,
        ];

        if ($body !== null) {
            $headers[] = 'Content-Type: application/json';
            $options[CURLOPT_POSTFIELDS] = json_encode($body);
        }
        $options[CURLOPT_HTTPHEADER] = $headers;

        $result = $this->transport($this->baseUrl . $path, $options);
        if ($result === null) {
            throw new RabbitMqManagementException('Unable to initialise the management API request.');
        }

        ['response' => $response, 'status' => $status, 'error' => $error] = $result;

        if ($response === false) {
            throw new RabbitMqManagementException(
                sprintf('RabbitMQ management API is unreachable: %s', $error)
            );
        }
        if ($status >= 400) {
            throw new RabbitMqManagementException(
                sprintf('RabbitMQ management API returned HTTP %d.', $status)
            );
        }

        $decoded = json_decode((string) $response, true);

        return \is_array($decoded) ? $decoded : [];
    }

    /**
     * The only place that talks to curl. Kept as a protected method so the management API's
     * answers can be scripted without a network.
     *
     * @param array<int, mixed> $options CURLOPT_* => value
     *
     * @return array{response: string|false, status: int, errno: int, error: string}|null
     *         null when curl cannot be initialised
     */
    protected function transport(string $url, array $options): ?array
    {
        $ch = curl_init($url);
        if ($ch === false) {
            return null;
        }

        curl_setopt_array($ch, $options);
        $response = curl_exec($ch);

        // No curl_close(): a no-op since PHP 8.0 (deprecated in 8.5) — the handle is freed on return.
        return [
            'response' => \is_string($response) ? $response : false,
            'status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE),
            'errno' => curl_errno($ch),
            'error' => curl_error($ch),
        ];
    }
}
