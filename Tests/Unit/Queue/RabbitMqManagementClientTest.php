<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Queue;

use Aaxis\Bundle\ToolsBundle\Exception\RabbitMqManagementException;
use Aaxis\Bundle\ToolsBundle\Queue\RabbitMqManagementClient;
use PHPUnit\Framework\TestCase;

class RabbitMqManagementClientTest extends TestCase
{
    private const DSN = 'amqp://app:s3cret@rabbit.internal:5672/';

    // --- connection settings derived from the DSN -------------------------------------------------

    public function testUsesTheDsnCredentialsHostAndTheDefaultManagementPort(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk([]);

        $client->listQueues();

        self::assertSame('http://rabbit.internal:15672/api/queues/%2F', $client->requests[0]['url']);
        self::assertSame('app:s3cret', $client->requests[0]['options'][CURLOPT_USERPWD]);
    }

    public function testDecodesPercentEncodedCredentialsAndVirtualHost(): void
    {
        $client = (new ScriptedRabbitMqManagementClient('amqp://us%40er:p%3Ass@mq.example/my%2Fvhost'))
            ->willReplyOk([]);

        $client->listQueues();

        self::assertSame('us@er:p:ss', $client->requests[0]['options'][CURLOPT_USERPWD]);
        // The decoded "my/vhost" is re-encoded as one path segment.
        self::assertSame('http://mq.example:15672/api/queues/my%2Fvhost', $client->requests[0]['url']);
    }

    public function testFallsBackToGuestCredentialsAndLocalhostForABareDsn(): void
    {
        $client = (new ScriptedRabbitMqManagementClient('amqp://'))->willReplyOk([]);

        $client->listQueues();

        self::assertSame('guest:guest', $client->requests[0]['options'][CURLOPT_USERPWD]);
        self::assertSame('http://localhost:15672/api/queues/%2F', $client->requests[0]['url']);
    }

    public function testAnUnparsableDsnStillYieldsTheDefaults(): void
    {
        $client = (new ScriptedRabbitMqManagementClient('amqp://:80'))->willReplyOk([]);

        $client->listQueues();

        self::assertSame('http://localhost:15672/api/queues/%2F', $client->requests[0]['url']);
    }

    public function testTheManagementUrlOverrideWinsAndLosesItsTrailingSlash(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN, 'https://mgmt.example:8443/rmq///'))
            ->willReplyOk([]);

        $client->listQueues();

        self::assertSame('https://mgmt.example:8443/rmq/api/queues/%2F', $client->requests[0]['url']);
    }

    public function testAnEmptyManagementUrlOverrideIsIgnored(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN, ''))->willReplyOk([]);

        $client->listQueues();

        self::assertSame('http://rabbit.internal:15672/api/queues/%2F', $client->requests[0]['url']);
    }

    // --- isAvailable ------------------------------------------------------------------------------

    public function testIsAvailableWhenTheOverviewAnswers(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk(['rabbitmq_version' => '3.13']);

        self::assertTrue($client->isAvailable());
        self::assertSame('http://rabbit.internal:15672/api/overview', $client->requests[0]['url']);
        self::assertSame('GET', $client->requests[0]['options'][CURLOPT_CUSTOMREQUEST]);
    }

    public function testIsNotAvailableWhenTheRequestFails(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk('nope', 503);

        self::assertFalse($client->isAvailable());
    }

    // --- testConnection ---------------------------------------------------------------------------

    public function testTestConnectionReportsSuccessWithTheBrokerVersionDetails(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk([
            'rabbitmq_version' => '3.13.1',
            'product_version' => '4.0.2',
            'node' => 'rabbit@host',
        ]);

        $result = $client->testConnection();

        self::assertTrue($result['success']);
        self::assertSame('Connected to the RabbitMQ management API.', $result['message']);
        self::assertSame([
            'Management URL' => 'http://rabbit.internal:15672',
            'User' => 'app',
            'Virtual host' => '/',
            'RabbitMQ version' => '3.13.1',
            'Product version' => '4.0.2',
            'Node' => 'rabbit@host',
        ], $result['details']);
        self::assertStringNotContainsString('s3cret', (string) json_encode($result));
    }

    public function testTestConnectionUsesShortTimeoutsAndBasicAuth(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk([]);

        $client->testConnection();

        $options = $client->requests[0]['options'];
        self::assertSame('http://rabbit.internal:15672/api/overview', $client->requests[0]['url']);
        self::assertTrue($options[CURLOPT_RETURNTRANSFER]);
        self::assertSame('app:s3cret', $options[CURLOPT_USERPWD]);
        self::assertSame(5, $options[CURLOPT_CONNECTTIMEOUT]);
        self::assertSame(10, $options[CURLOPT_TIMEOUT]);
        self::assertSame(['Accept: application/json'], $options[CURLOPT_HTTPHEADER]);
    }

    public function testTestConnectionToleratesAnUnexpectedBodyOnSuccess(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN, 'http://m:1'))->willReplyOk('<html>', 200);

        $result = $client->testConnection();

        self::assertTrue($result['success']);
        self::assertSame(['Management URL', 'User', 'Virtual host'], array_keys($result['details']));
    }

    public function testTestConnectionOnlyReportsTheVersionFieldsThatArePresent(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk(['node' => 'rabbit@x']);

        $details = $client->testConnection()['details'];

        self::assertSame('rabbit@x', $details['Node']);
        self::assertArrayNotHasKey('RabbitMQ version', $details);
        self::assertArrayNotHasKey('Product version', $details);
    }

    public function testTestConnectionFailsWhenCurlCannotBeInitialised(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReply(null);

        self::assertSame(
            ['success' => false, 'message' => 'Unable to initialise the request.', 'details' => []],
            $client->testConnection()
        );
    }

    public function testTestConnectionExplainsAnUnreachableEndpoint(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReply([
            'response' => false,
            'status' => 0,
            'errno' => 7,
            'error' => 'Connection refused',
        ]);

        $result = $client->testConnection();

        self::assertFalse($result['success']);
        self::assertStringContainsString('unreachable at http://rabbit.internal:15672 (Connection refused)', $result['message']);
        self::assertStringContainsString('rabbitmq_management', $result['message']);
        self::assertSame('app', $result['details']['User']);
    }

    public function testTestConnectionFallsBackToAGenericReasonWhenCurlGivesNone(): void
    {
        // A curl error number without a response body counts as unreachable even with no message.
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReply([
            'response' => '',
            'status' => 0,
            'errno' => 28,
            'error' => '',
        ]);

        $result = $client->testConnection();

        self::assertFalse($result['success']);
        self::assertStringContainsString('(connection failed)', $result['message']);
    }

    public function testTestConnectionPointsAtTheCredentialsOnHttp401(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk('', 401);

        $result = $client->testConnection();

        self::assertFalse($result['success']);
        self::assertSame(
            'Authentication failed for user "app" (HTTP 401). Check the credentials in ORO_MQ_DSN.',
            $result['message']
        );
    }

    public function testTestConnectionReportsOtherHttpErrors(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk('', 500);

        $result = $client->testConnection();

        self::assertFalse($result['success']);
        self::assertSame('Management API returned HTTP 500.', $result['message']);
        self::assertSame('/', $result['details']['Virtual host']);
    }

    // --- listQueues -------------------------------------------------------------------------------

    public function testListQueuesMapsCountersAndSortsByName(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk([
            [
                'name' => 'oro.queue.b',
                'state' => 'running',
                'messages' => '12',
                'messages_ready' => 10,
                'messages_unacknowledged' => 2,
                'consumers' => 3,
                'node' => 'rabbit@a',
            ],
            'not-a-queue',
            ['name' => 'oro.queue.a'],
        ]);

        self::assertSame([
            [
                'name' => 'oro.queue.a',
                'state' => '',
                'messages' => 0,
                'messagesReady' => 0,
                'messagesUnacked' => 0,
                'consumers' => 0,
                'node' => '',
            ],
            [
                'name' => 'oro.queue.b',
                'state' => 'running',
                'messages' => 12,
                'messagesReady' => 10,
                'messagesUnacked' => 2,
                'consumers' => 3,
                'node' => 'rabbit@a',
            ],
        ], $client->listQueues());
    }

    public function testListQueuesReturnsAnEmptyListForAnUnexpectedBody(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk('not json');

        self::assertSame([], $client->listQueues());
    }

    // --- getQueue ---------------------------------------------------------------------------------

    public function testGetQueueBuildsTheHistoryQueryAndMapsTheCounters(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk([
            'name' => 'oro.queue.a',
            'state' => 'running',
            'durable' => 1,
            'node' => 'rabbit@a',
            'messages' => 7,
            'messages_ready' => 5,
            'messages_unacknowledged' => 2,
            'consumers' => 1,
        ]);

        $queue = $client->getQueue('oro.queue/a', 900, 30);

        self::assertSame(
            'http://rabbit.internal:15672/api/queues/%2F/oro.queue%2Fa'
            . '?lengths_age=900&lengths_incr=30&msg_rates_age=900&msg_rates_incr=30',
            $client->requests[0]['url']
        );
        self::assertSame('oro.queue.a', $queue['name']);
        self::assertTrue($queue['durable']);
        self::assertSame(7, $queue['messages']);
        self::assertSame(5, $queue['messagesReady']);
        self::assertSame(2, $queue['messagesUnacked']);
        self::assertSame(1, $queue['consumers']);
        self::assertFalse($queue['samplesAvailable']);
        self::assertSame([], $queue['samples']);
    }

    public function testGetQueueDefaultsTheHistoryWindowToOneHourInMinuteSteps(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk([]);

        $queue = $client->getQueue('q');

        self::assertStringEndsWith(
            '?lengths_age=3600&lengths_incr=60&msg_rates_age=3600&msg_rates_incr=60',
            $client->requests[0]['url']
        );
        // A response without a name echoes the requested one; everything else is zeroed.
        self::assertSame('q', $queue['name']);
        self::assertFalse($queue['durable']);
        self::assertSame(0, $queue['messages']);
        self::assertSame('', $queue['state']);
    }

    public function testGetQueueMergesTheThreeSampleSeriesByAscendingTimestamp(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk([
            'name' => 'q',
            'messages_details' => ['samples' => [
                ['timestamp' => 2000, 'sample' => 9],
                ['timestamp' => 1000, 'sample' => 8],
            ]],
            'messages_ready_details' => ['samples' => [
                ['timestamp' => 1000, 'sample' => 6],
                'garbage',
                ['sample' => 5],
                ['timestamp' => 3000],
            ]],
            'messages_unacknowledged_details' => ['samples' => [
                ['timestamp' => 2000, 'sample' => 1],
            ]],
        ]);

        $queue = $client->getQueue('q');

        self::assertTrue($queue['samplesAvailable']);
        self::assertSame([
            ['timestamp' => 1000, 'ready' => 6, 'unacked' => null, 'total' => 8],
            ['timestamp' => 2000, 'ready' => null, 'unacked' => 1, 'total' => 9],
            // A sample without a value counts as 0; one without a timestamp is dropped.
            ['timestamp' => 3000, 'ready' => 0, 'unacked' => null, 'total' => null],
        ], $queue['samples']);
    }

    /**
     * @dataProvider detailsWithoutSamplesProvider
     *
     * @param array<string, mixed> $response
     */
    public function testGetQueueReportsNoSamplesWhenTheMetricsCollectorIsOff(array $response): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk($response);

        $queue = $client->getQueue('q');

        self::assertFalse($queue['samplesAvailable']);
        self::assertSame([], $queue['samples']);
    }

    /**
     * @return iterable<string, array{array<string, mixed>}>
     */
    public static function detailsWithoutSamplesProvider(): iterable
    {
        yield 'no details at all' => [['name' => 'q']];
        yield 'details without samples key' => [['messages_details' => ['rate' => 0.0]]];
        yield 'samples not an array' => [['messages_ready_details' => ['samples' => 'x']]];
        yield 'details not an array' => [['messages_unacknowledged_details' => 'x']];
    }

    public function testGetQueueSurfacesAManagementApiError(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk('', 404);

        $this->expectException(RabbitMqManagementException::class);
        $this->expectExceptionMessage('RabbitMQ management API returned HTTP 404.');

        $client->getQueue('gone');
    }

    // --- getMessages ------------------------------------------------------------------------------

    public function testGetMessagesPostsANonDestructiveFetchAndMapsTheMessages(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk([
            [
                'payload' => '{"a":1}',
                'payload_bytes' => 7,
                'payload_encoding' => 'string',
                'redelivered' => true,
                'routing_key' => 'rk',
                'exchange' => 'ex',
                'properties' => ['priority' => 5],
            ],
            'skip me',
            [],
        ]);

        $messages = $client->getMessages('oro.queue/a', 5, 100);

        $request = $client->requests[0];
        self::assertSame('http://rabbit.internal:15672/api/queues/%2F/oro.queue%2Fa/get', $request['url']);
        self::assertSame('POST', $request['options'][CURLOPT_CUSTOMREQUEST]);
        self::assertSame(
            ['Accept: application/json', 'Content-Type: application/json'],
            $request['options'][CURLOPT_HTTPHEADER]
        );
        self::assertSame(
            ['count' => 5, 'ackmode' => 'ack_requeue_true', 'encoding' => 'auto', 'truncate' => 50000],
            json_decode((string) $request['options'][CURLOPT_POSTFIELDS], true)
        );
        self::assertSame([
            [
                'payload' => '{"a":1}',
                'payloadBytes' => 7,
                'encoding' => 'string',
                'redelivered' => true,
                'routingKey' => 'rk',
                'exchange' => 'ex',
                'properties' => ['priority' => 5],
            ],
            [
                'payload' => '',
                'payloadBytes' => 0,
                'encoding' => '',
                'redelivered' => false,
                'routingKey' => '',
                'exchange' => '',
                'properties' => [],
            ],
        ], $messages);
    }

    /**
     * @dataProvider messageCountProvider
     */
    public function testGetMessagesClampsTheRequestedCount(int $count, int $maxCount, int $expected): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk([]);

        $client->getMessages('q', $count, $maxCount);

        $sent = json_decode((string) $client->requests[0]['options'][CURLOPT_POSTFIELDS], true);
        self::assertSame($expected, $sent['count']);
    }

    /**
     * @return iterable<string, array{int, int, int}>
     */
    public static function messageCountProvider(): iterable
    {
        yield 'within the limit' => [20, 100, 20];
        yield 'above the limit' => [500, 100, 100];
        yield 'zero becomes one' => [0, 100, 1];
        yield 'negative becomes one' => [-4, 100, 1];
        yield 'a non-positive limit is raised to one' => [10, 0, 1];
    }

    public function testGetMessagesDefaultsToTenMessages(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk([]);

        $client->getMessages('q');

        $sent = json_decode((string) $client->requests[0]['options'][CURLOPT_POSTFIELDS], true);
        self::assertSame(10, $sent['count']);
    }

    // --- request failures -------------------------------------------------------------------------

    public function testRequestFailsWhenCurlCannotBeInitialised(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReply(null);

        $this->expectException(RabbitMqManagementException::class);
        $this->expectExceptionMessage('Unable to initialise the management API request.');

        $client->listQueues();
    }

    public function testRequestReportsAnUnreachableApiWithTheCurlError(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReply([
            'response' => false,
            'status' => 0,
            'errno' => 6,
            'error' => 'Could not resolve host',
        ]);

        $this->expectException(RabbitMqManagementException::class);
        $this->expectExceptionMessage('RabbitMQ management API is unreachable: Could not resolve host');

        $client->listQueues();
    }

    public function testRequestReportsHttpErrorStatuses(): void
    {
        $client = (new ScriptedRabbitMqManagementClient(self::DSN))->willReplyOk('', 401);

        $this->expectException(RabbitMqManagementException::class);
        $this->expectExceptionMessage('RabbitMQ management API returned HTTP 401.');

        $client->listQueues();
    }

    public function testManagementExceptionsAreRuntimeExceptions(): void
    {
        // The controllers catch \Throwable and QueueConnectionTester reports it as a tool error.
        self::assertInstanceOf(\RuntimeException::class, new RabbitMqManagementException('x'));
    }

    // --- the real curl transport (no network: file:// URLs) ---------------------------------------

    public function testTheRealTransportReadsTheResponseThroughCurl(): void
    {
        $dir = $this->tempDir();
        mkdir($dir . '/api', 0777, true);
        file_put_contents($dir . '/api/overview', '{"rabbitmq_version":"3.13.1"}');

        $client = new RabbitMqManagementClient(self::DSN, 'file://' . $dir);

        $result = $client->testConnection();

        self::assertTrue($result['success']);
        self::assertSame('3.13.1', $result['details']['RabbitMQ version']);
        self::assertTrue($client->isAvailable());
    }

    public function testTheRealTransportReportsCurlErrors(): void
    {
        $client = new RabbitMqManagementClient(self::DSN, 'file://' . $this->tempDir() . '/missing');

        $result = $client->testConnection();

        self::assertFalse($result['success']);
        self::assertStringContainsString('unreachable at', $result['message']);
        self::assertFalse($client->isAvailable());

        $this->expectException(RabbitMqManagementException::class);
        $this->expectExceptionMessage('RabbitMQ management API is unreachable:');
        $client->listQueues();
    }

    private function tempDir(): string
    {
        $dir = sys_get_temp_dir() . '/aaxis-tools-rmq-' . bin2hex(random_bytes(4));
        mkdir($dir, 0777, true);
        register_shutdown_function(static function () use ($dir): void {
            if (is_file($dir . '/api/overview')) {
                unlink($dir . '/api/overview');
            }
            if (is_dir($dir . '/api')) {
                rmdir($dir . '/api');
            }
            if (is_dir($dir)) {
                rmdir($dir);
            }
        });

        return $dir;
    }
}
