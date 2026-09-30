<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Controller;

use Aaxis\Bundle\ToolsBundle\Controller\QueueMonitorController;
use Aaxis\Bundle\ToolsBundle\Exception\RabbitMqManagementException;
use Aaxis\Bundle\ToolsBundle\Queue\RabbitMqManagementClient;
use Oro\Bundle\ConfigBundle\Config\ConfigManager;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use Symfony\Component\DependencyInjection\Container;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

class QueueMonitorControllerTest extends TestCase
{
    private RabbitMqManagementClient&MockObject $client;
    private ConfigManager&MockObject $config;
    private LoggerInterface&MockObject $logger;
    private QueueMonitorController $controller;

    /** @var array<string, mixed> */
    private array $settings = [];

    protected function setUp(): void
    {
        $this->client = $this->createMock(RabbitMqManagementClient::class);
        $this->config = $this->createMock(ConfigManager::class);
        $this->config->method('get')->willReturnCallback(fn (string $key) => $this->settings[$key] ?? null);
        $this->logger = $this->createMock(LoggerInterface::class);

        $container = new Container();
        $container->set(RabbitMqManagementClient::class, $this->client);
        $container->set(ConfigManager::class, $this->config);
        $container->set(LoggerInterface::class, $this->logger);
        $this->controller = new QueueMonitorController();
        $this->controller->setContainer($container);
    }

    // --- queues -----------------------------------------------------------------------------------

    public function testListsTheQueues(): void
    {
        $queues = [['name' => 'oro.queue.a', 'messages' => 3]];
        $this->client->method('listQueues')->willReturn($queues);

        $response = $this->controller->queuesAction();

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(['queues' => $queues], $this->decode($response));
    }

    public function testAnUnreachableBrokerBecomesABadGatewayWithALoggedWarning(): void
    {
        $error = new RabbitMqManagementException('RabbitMQ management API is unreachable: refused');
        $this->client->method('listQueues')->willThrowException($error);
        $this->logger->expects(self::once())->method('warning')
            ->with('Aaxis Tools queue monitor: unable to list queues.', ['exception' => $error]);

        $response = $this->controller->queuesAction();

        self::assertSame(502, $response->getStatusCode());
        self::assertSame(
            ['success' => false, 'message' => 'RabbitMQ management API is unreachable: refused'],
            $this->decode($response)
        );
    }

    // --- queue ------------------------------------------------------------------------------------

    public function testReadsOneQueueOverTheConfiguredHistoryWindow(): void
    {
        $this->settings = [
            'aaxis_tools.queue_monitor_history_samples' => 20,
            'aaxis_tools.queue_monitor_history_interval' => 30,
        ];
        $queue = ['name' => 'oro.queue.a'];
        // 20 samples every 30 seconds -> a 600 second window.
        $this->client->expects(self::once())->method('getQueue')->with('oro.queue.a', 600, 30)->willReturn($queue);

        self::assertSame(['queue' => $queue], $this->decode($this->controller->queueAction('oro.queue.a')));
    }

    /**
     * @dataProvider historyWindowProvider
     *
     * @param mixed $samples
     * @param mixed $interval
     */
    public function testTheHistoryWindowIsClampedToSaneBounds(mixed $samples, mixed $interval, int $age, int $step): void
    {
        $this->settings = [
            'aaxis_tools.queue_monitor_history_samples' => $samples,
            'aaxis_tools.queue_monitor_history_interval' => $interval,
        ];
        $this->client->expects(self::once())->method('getQueue')->with('q', $age, $step)->willReturn([]);

        $this->controller->queueAction('q');
    }

    /**
     * @return iterable<string, array{mixed, mixed, int, int}>
     */
    public static function historyWindowProvider(): iterable
    {
        yield 'in range' => [15, 60, 900, 60];
        yield 'too few samples' => [0, 60, 120, 60];
        yield 'too many samples' => [9999, 60, 30000, 60];
        yield 'interval too short' => [15, 1, 75, 5];
        yield 'interval too long' => [15, 99999, 54000, 3600];
        yield 'unset settings' => [null, null, 10, 5];
        yield 'numeric strings' => ['10', '20', 200, 20];
    }

    public function testAQueueReadFailureIsLoggedAndReportedAsABadGateway(): void
    {
        $error = new RabbitMqManagementException('RabbitMQ management API returned HTTP 404.');
        $this->client->method('getQueue')->willThrowException($error);
        $this->logger->expects(self::once())->method('warning')
            ->with('Aaxis Tools queue monitor: unable to read the queue.', ['exception' => $error]);

        $response = $this->controller->queueAction('gone');

        self::assertSame(502, $response->getStatusCode());
        self::assertSame('RabbitMQ management API returned HTTP 404.', $this->decode($response)['message']);
    }

    // --- queues-detail ----------------------------------------------------------------------------

    public function testReadsEveryRequestedQueueInOneResponse(): void
    {
        $this->settings = [
            'aaxis_tools.queue_monitor_history_samples' => 15,
            'aaxis_tools.queue_monitor_history_interval' => 60,
        ];
        $this->client->method('getQueue')->willReturnCallback(
            static fn (string $name, int $age, int $interval): array => ['name' => $name, 'age' => $age, 'interval' => $interval]
        );

        $response = $this->controller->queuesDetailAction($this->request(['a', '', 'b', ['nested'], 42]));

        // Blank and non-string entries are dropped; the rest keep their order.
        self::assertSame([
            'queues' => [
                ['name' => 'a', 'age' => 900, 'interval' => 60],
                ['name' => 'b', 'age' => 900, 'interval' => 60],
            ],
        ], $this->decode($response));
    }

    public function testAQueueThatCannotBeReadIsSkippedWhileTheOthersAreKept(): void
    {
        $this->client->method('getQueue')->willReturnCallback(static function (string $name): array {
            if ($name === 'deleted') {
                throw new RabbitMqManagementException('RabbitMQ management API returned HTTP 404.');
            }

            return ['name' => $name];
        });
        $this->logger->expects(self::never())->method('warning');

        $response = $this->controller->queuesDetailAction($this->request(['a', 'deleted', 'b']));

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(['queues' => [['name' => 'a'], ['name' => 'b']]], $this->decode($response));
    }

    public function testWhenNoQueueCanBeReadTheLastErrorIsSurfaced(): void
    {
        $last = new RabbitMqManagementException('second failure');
        $this->client->method('getQueue')->willReturnCallback(static function (string $name) use ($last): never {
            throw $name === 'a' ? new RabbitMqManagementException('first failure') : $last;
        });
        $this->logger->expects(self::once())->method('warning')
            ->with('Aaxis Tools queue monitor: unable to read the queues.', ['exception' => $last]);

        $response = $this->controller->queuesDetailAction($this->request(['a', 'b']));

        self::assertSame(502, $response->getStatusCode());
        self::assertSame('second failure', $this->decode($response)['message']);
    }

    public function testAnEmptyRequestYieldsAnEmptyListNotAnError(): void
    {
        $this->client->expects(self::never())->method('getQueue');
        $this->logger->expects(self::never())->method('warning');

        $response = $this->controller->queuesDetailAction(new Request());

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(['queues' => []], $this->decode($response));
    }

    public function testAFailureBuildingTheRequestIsReportedAsABadGateway(): void
    {
        $config = $this->createMock(ConfigManager::class);
        $config->method('get')->willThrowException(new \RuntimeException('config unavailable'));
        $container = new Container();
        $container->set(RabbitMqManagementClient::class, $this->client);
        $container->set(ConfigManager::class, $config);
        $container->set(LoggerInterface::class, $this->logger);
        $controller = new QueueMonitorController();
        $controller->setContainer($container);
        $this->logger->expects(self::once())->method('warning');

        $response = $controller->queuesDetailAction($this->request(['a']));

        self::assertSame(502, $response->getStatusCode());
        self::assertSame('config unavailable', $this->decode($response)['message']);
    }

    // --- messages ---------------------------------------------------------------------------------

    public function testPreviewsMessagesWithTheRequestedCountAndTheConfiguredCeiling(): void
    {
        $this->settings = [
            'aaxis_tools.queue_monitor_allow_message_preview' => true,
            'aaxis_tools.queue_monitor_max_message_fetch' => 50,
        ];
        $messages = [['payload' => '{}']];
        $this->client->expects(self::once())->method('getMessages')->with('oro.queue.a', 5, 50)->willReturn($messages);

        $response = $this->controller->messagesAction($this->jsonPost('{"count":5}'), 'oro.queue.a');

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(['messages' => $messages], $this->decode($response));
    }

    /**
     * @dataProvider messagePayloadProvider
     */
    public function testTheMessageCountFallsBackToTenAndTheCeilingIsClamped(string $body, mixed $maxFetch, int $count, int $ceiling): void
    {
        $this->settings = [
            'aaxis_tools.queue_monitor_allow_message_preview' => true,
            'aaxis_tools.queue_monitor_max_message_fetch' => $maxFetch,
        ];
        $this->client->expects(self::once())->method('getMessages')->with('q', $count, $ceiling)->willReturn([]);

        $this->controller->messagesAction($this->jsonPost($body), 'q');
    }

    /**
     * @return iterable<string, array{string, mixed, int, int}>
     */
    public static function messagePayloadProvider(): iterable
    {
        yield 'no count in the payload' => ['{}', 100, 10, 100];
        yield 'payload is not json' => ['nonsense', 100, 10, 100];
        yield 'payload is a scalar' => ['7', 100, 10, 100];
        yield 'count sent as a string' => ['{"count":"25"}', 100, 25, 100];
        yield 'ceiling too low' => ['{}', 0, 10, 1];
        yield 'ceiling too high' => ['{}', 99999, 10, 1000];
        yield 'ceiling not configured' => ['{}', null, 10, 1];
    }

    public function testMessagePreviewCanBeSwitchedOff(): void
    {
        $this->settings = ['aaxis_tools.queue_monitor_allow_message_preview' => false];
        $this->client->expects(self::never())->method('getMessages');

        $response = $this->controller->messagesAction($this->jsonPost('{"count":5}'), 'q');

        self::assertSame(403, $response->getStatusCode());
        self::assertSame(['success' => false, 'message' => 'Message preview is disabled.'], $this->decode($response));
    }

    public function testAMessagePreviewFailureIsLoggedAndReportedAsABadGateway(): void
    {
        $this->settings = ['aaxis_tools.queue_monitor_allow_message_preview' => true];
        $error = new RabbitMqManagementException('boom');
        $this->client->method('getMessages')->willThrowException($error);
        $this->logger->expects(self::once())->method('warning')
            ->with('Aaxis Tools queue monitor: unable to preview messages.', ['exception' => $error]);

        $response = $this->controller->messagesAction($this->jsonPost('{}'), 'q');

        self::assertSame(502, $response->getStatusCode());
        self::assertSame(['success' => false, 'message' => 'boom'], $this->decode($response));
    }

    // --- wiring -----------------------------------------------------------------------------------

    public function testDeclaresItsCollaboratorsAsSubscribedServices(): void
    {
        $services = QueueMonitorController::getSubscribedServices();

        foreach ([RabbitMqManagementClient::class, ConfigManager::class, LoggerInterface::class] as $id) {
            self::assertContains($id, $services);
        }
    }

    /**
     * @param array<int, mixed> $names
     */
    private function request(array $names): Request
    {
        return new Request(['names' => $names]);
    }

    private function jsonPost(string $body): Request
    {
        return new Request([], [], [], [], [], ['CONTENT_TYPE' => 'application/json'], $body);
    }

    /**
     * @return array<string, mixed>
     */
    private function decode(JsonResponse $response): array
    {
        return json_decode((string) $response->getContent(), true, 512, JSON_THROW_ON_ERROR);
    }
}
