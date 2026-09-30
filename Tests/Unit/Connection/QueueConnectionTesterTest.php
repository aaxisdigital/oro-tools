<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Connection;

use Aaxis\Bundle\CommonBundle\Connection\ConnectionTesterInterface;
use Aaxis\Bundle\ToolsBundle\Connection\QueueConnectionTester;
use Aaxis\Bundle\ToolsBundle\Exception\RabbitMqManagementException;
use Aaxis\Bundle\ToolsBundle\Queue\RabbitMqManagementClient;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

class QueueConnectionTesterTest extends TestCase
{
    private RabbitMqManagementClient&MockObject $client;
    private QueueConnectionTester $tester;

    protected function setUp(): void
    {
        $this->client = $this->createMock(RabbitMqManagementClient::class);
        $this->tester = new QueueConnectionTester($this->client);
    }

    public function testChecksTheQueueMonitorTool(): void
    {
        self::assertInstanceOf(ConnectionTesterInterface::class, $this->tester);
        self::assertSame('queue_monitor', $this->tester->getTool());
    }

    public function testReturnsWhatTheManagementClientReports(): void
    {
        $result = [
            'success' => true,
            'message' => 'Connected to the RabbitMQ management API.',
            'details' => ['Management URL' => 'http://rabbit:15672'],
        ];
        $this->client->expects(self::once())->method('testConnection')->willReturn($result);

        self::assertSame($result, $this->tester->test());
    }

    public function testRequestSuppliedOverridesAreNeverUsed(): void
    {
        $this->client->expects(self::once())->method('testConnection')->with()->willReturn(
            ['success' => true, 'message' => 'ok', 'details' => []]
        );

        $this->tester->test(['dsn' => 'amqp://attacker@evil.example']);
    }

    public function testAnUnexpectedFailureBecomesAFailedCheckInsteadOfBubbling(): void
    {
        $this->client->method('testConnection')->willThrowException(new RabbitMqManagementException('curl exploded'));

        self::assertSame(
            ['success' => false, 'message' => 'RabbitMQ check failed: curl exploded', 'details' => []],
            $this->tester->test()
        );
    }

    public function testErrorsAreCaughtToo(): void
    {
        $this->client->method('testConnection')->willThrowException(new \TypeError('bad'));

        self::assertSame('RabbitMQ check failed: bad', $this->tester->test()['message']);
    }
}
