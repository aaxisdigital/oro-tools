<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Controller;

use Aaxis\Bundle\ToolsBundle\Controller\ApiCollectionController;
use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRequest;
use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRunHistory;
use Aaxis\Bundle\ToolsBundle\Exception\ApiCollectionAccessDeniedException;
use Aaxis\Bundle\ToolsBundle\Http\ApiRequestExecutor;
use Aaxis\Bundle\ToolsBundle\Http\LocalHostRewriter;
use Aaxis\Bundle\ToolsBundle\Manager\ApiCollectionManager;
use Oro\Bundle\UserBundle\Entity\User;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Symfony\Component\DependencyInjection\Container;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;

class ApiCollectionControllerTest extends TestCase
{
    private ApiCollectionManager&MockObject $manager;
    private ApiRequestExecutor&MockObject $executor;
    private LocalHostRewriter&MockObject $rewriter;
    private ApiCollectionController $controller;

    protected function setUp(): void
    {
        $this->manager = $this->createMock(ApiCollectionManager::class);
        $this->executor = $this->createMock(ApiRequestExecutor::class);
        $this->rewriter = $this->createMock(LocalHostRewriter::class);

        $container = new Container();
        $container->set(ApiCollectionManager::class, $this->manager);
        $container->set(ApiRequestExecutor::class, $this->executor);
        $container->set(LocalHostRewriter::class, $this->rewriter);
        $this->controller = new ApiCollectionController();
        $this->controller->setContainer($container);
    }

    // --- tree -------------------------------------------------------------------------------------

    public function testTreeListsTheVisibleNodesAndTheRecentRuns(): void
    {
        $this->manager->method('getCurrentUserId')->willReturn(1);
        $mine = $this->node(1, 'request', owner: 1);
        $mine->setName('List')->setMethod('GET')->setUrl('https://api.example')->setParams([['key' => 'a']])
            ->setHeaders([['key' => 'h']])->setBodyType('json')->setBody('{}')->setPublic(true)->setParentId(9);
        $theirs = $this->node(2, 'folder', owner: 2);
        $orphan = $this->node(3, 'request', owner: null);
        $this->manager->method('getVisibleNodes')->willReturn([$mine, $theirs, $orphan]);
        $this->manager->method('getRecentRuns')->willReturn([$this->historyRun()]);

        $data = $this->decode($this->controller->treeAction());

        self::assertSame(1, $data['currentUserId']);
        self::assertSame([
            'id' => 1,
            'type' => 'request',
            'name' => 'List',
            'parentId' => 9,
            'public' => true,
            'owned' => true,
            'method' => 'GET',
            'url' => 'https://api.example',
            'params' => [['key' => 'a']],
            'headers' => [['key' => 'h']],
            'bodyType' => 'json',
            'body' => '{}',
        ], $data['nodes'][0]);
        self::assertFalse($data['nodes'][1]['owned'], 'someone else\'s node');
        self::assertTrue($data['nodes'][2]['owned'], 'an ownerless node is everyone\'s');
        self::assertSame([], $data['nodes'][2]['params']);
        self::assertSame([], $data['nodes'][2]['headers']);
        self::assertSame('none', $data['nodes'][2]['bodyType']);
        self::assertSame('', $data['nodes'][2]['body']);
        self::assertSame([
            'id' => 70,
            'name' => 'List orders',
            'method' => 'GET',
            'url' => 'https://api.example/orders',
            'status' => 200,
            'result' => 'success',
            'sizeBytes' => 2048,
            'timeMs' => 35,
            'runAt' => '2026-03-03T10:00:00+00:00',
        ], $data['runs'][0]);
    }

    public function testNothingIsOwnedByAnAnonymousVisitorExceptOwnerlessNodes(): void
    {
        $this->manager->method('getCurrentUserId')->willReturn(null);
        $this->manager->method('getVisibleNodes')->willReturn([
            $this->node(1, 'request', owner: 2),
            $this->node(2, 'request', owner: null),
        ]);
        $this->manager->method('getRecentRuns')->willReturn([]);

        $data = $this->decode($this->controller->treeAction());

        self::assertNull($data['currentUserId']);
        self::assertFalse($data['nodes'][0]['owned']);
        self::assertTrue($data['nodes'][1]['owned']);
        self::assertSame([], $data['runs']);
    }

    public function testARunWithoutATimestampSerializesItAsNull(): void
    {
        $this->manager->method('getCurrentUserId')->willReturn(1);
        $this->manager->method('getVisibleNodes')->willReturn([]);
        $this->manager->method('getRecentRuns')->willReturn([(new ApiCollectionRunHistory())->setMethod('GET')->setUrl('u')]);

        self::assertNull($this->decode($this->controller->treeAction())['runs'][0]['runAt']);
    }

    // --- create -----------------------------------------------------------------------------------

    public function testCreateStoresTheNodeAndReturnsIt(): void
    {
        $node = $this->node(5, 'folder', owner: 1);
        $this->manager->expects(self::once())->method('createNode')->with(['name' => 'Orders', 'type' => 'folder'])->willReturn($node);
        $this->manager->method('getCurrentUserId')->willReturn(1);

        $response = $this->controller->createAction($this->json('{"name":"Orders","type":"folder"}'));

        self::assertSame(200, $response->getStatusCode());
        $data = $this->decode($response);
        self::assertTrue($data['success']);
        self::assertSame(5, $data['node']['id']);
        self::assertTrue($data['node']['owned']);
    }

    /**
     * @dataProvider invalidPayloadProvider
     */
    public function testCreateRejectsPayloadsThatAreNotJsonObjects(string $body): void
    {
        $this->manager->expects(self::never())->method('createNode');

        $this->assertInvalidPayload($this->controller->createAction($this->json($body)));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function invalidPayloadProvider(): iterable
    {
        yield 'empty body' => [''];
        yield 'not json' => ['{oops'];
        yield 'scalar json' => ['42'];
        yield 'json null' => ['null'];
    }

    // --- update -----------------------------------------------------------------------------------

    public function testUpdateAppliesThePayloadToAViewableNode(): void
    {
        $node = $this->node(5, 'request', owner: 1);
        $this->viewable($node);
        $this->manager->method('getCurrentUserId')->willReturn(1);
        $this->manager->expects(self::once())->method('updateNode')->with($node, ['name' => 'Renamed'])->willReturn($node);

        $data = $this->decode($this->controller->updateAction($this->json('{"name":"Renamed"}'), 5));

        self::assertTrue($data['success']);
        self::assertSame(5, $data['node']['id']);
    }

    public function testUpdateOfAMissingOrInvisibleNodeIsNotFound(): void
    {
        $this->manager->method('findNode')->willReturnMap([[5, null], [6, $this->node(6, 'request', owner: 2)]]);
        $this->manager->method('canView')->willReturn(false);
        $this->manager->expects(self::never())->method('updateNode');

        $this->assertNotFound($this->controller->updateAction($this->json('{}'), 5));
        $this->assertNotFound($this->controller->updateAction($this->json('{}'), 6));
    }

    /**
     * @dataProvider invalidPayloadProvider
     */
    public function testUpdateRejectsInvalidPayloadsOnceTheNodeIsFound(string $body): void
    {
        $this->viewable($this->node(5, 'request', owner: 1));
        $this->manager->expects(self::never())->method('updateNode');

        $this->assertInvalidPayload($this->controller->updateAction($this->json($body), 5));
    }

    public function testUpdateOfSomeoneElsesPublicNodeIsForbidden(): void
    {
        $node = $this->node(5, 'request', owner: 2);
        $this->viewable($node);
        $this->manager->method('updateNode')->willThrowException(new ApiCollectionAccessDeniedException('You can only modify your own items.'));

        $response = $this->controller->updateAction($this->json('{"name":"x"}'), 5);

        self::assertSame(403, $response->getStatusCode());
        self::assertSame(['success' => false, 'message' => 'You can only modify your own items.'], $this->decode($response));
    }

    // --- delete -----------------------------------------------------------------------------------

    public function testDeleteRemovesAViewableNode(): void
    {
        $node = $this->node(5, 'request', owner: 1);
        $this->viewable($node);
        $this->manager->expects(self::once())->method('deleteNode')->with($node);

        $response = $this->controller->deleteAction(5);

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(['success' => true], $this->decode($response));
    }

    public function testDeleteOfAMissingOrInvisibleNodeIsNotFound(): void
    {
        $this->manager->method('findNode')->willReturn(null);
        $this->manager->expects(self::never())->method('deleteNode');

        $this->assertNotFound($this->controller->deleteAction(5));
    }

    public function testDeleteOfSomeoneElsesNodeIsForbidden(): void
    {
        $this->viewable($this->node(5, 'request', owner: 2));
        $this->manager->method('deleteNode')->willThrowException(new ApiCollectionAccessDeniedException('You can only modify your own items.'));

        $response = $this->controller->deleteAction(5);

        self::assertSame(403, $response->getStatusCode());
        self::assertSame('You can only modify your own items.', $this->decode($response)['message']);
    }

    // --- duplicate --------------------------------------------------------------------------------

    public function testDuplicateReturnsTheCopy(): void
    {
        $source = $this->node(5, 'request', owner: 2);
        $copy = $this->node(6, 'request', owner: 1);
        $this->viewable($source);
        $this->manager->method('getCurrentUserId')->willReturn(1);
        $this->manager->expects(self::once())->method('duplicateNode')->with($source)->willReturn($copy);

        $data = $this->decode($this->controller->duplicateAction(5));

        self::assertTrue($data['success']);
        self::assertSame(6, $data['node']['id']);
        self::assertTrue($data['node']['owned']);
    }

    public function testDuplicateOfAMissingOrInvisibleNodeIsNotFound(): void
    {
        $this->manager->method('findNode')->willReturn($this->node(5, 'request', owner: 2));
        $this->manager->method('canView')->willReturn(false);
        $this->manager->expects(self::never())->method('duplicateNode');

        $this->assertNotFound($this->controller->duplicateAction(5));
    }

    // --- run --------------------------------------------------------------------------------------

    public function testRunRecordsTheRunAndReturnsTheRefreshedHistory(): void
    {
        $this->manager->expects(self::once())->method('recordRun')->with(['url' => 'https://api.example', 'method' => 'GET']);
        $this->manager->method('getRecentRuns')->willReturn([$this->historyRun()]);

        $data = $this->decode($this->controller->runAction($this->json('{"url":"https://api.example","method":"GET"}')));

        self::assertTrue($data['success']);
        self::assertSame(70, $data['runs'][0]['id']);
    }

    /**
     * @dataProvider invalidPayloadProvider
     */
    public function testRunRejectsInvalidPayloads(string $body): void
    {
        $this->manager->expects(self::never())->method('recordRun');

        $this->assertInvalidPayload($this->controller->runAction($this->json($body)));
    }

    // --- execute ----------------------------------------------------------------------------------

    /**
     * @dataProvider invalidPayloadProvider
     */
    public function testExecuteRejectsInvalidPayloads(string $body): void
    {
        $this->executor->expects(self::never())->method('execute');

        $this->assertInvalidPayload($this->controller->executeAction($this->json($body)));
    }

    /**
     * @dataProvider missingUrlProvider
     */
    public function testExecuteRequiresAUrl(string $body): void
    {
        $this->executor->expects(self::never())->method('execute');

        $response = $this->controller->executeAction($this->json($body));

        self::assertSame(400, $response->getStatusCode());
        self::assertSame(['success' => false, 'message' => 'A URL is required.'], $this->decode($response));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function missingUrlProvider(): iterable
    {
        yield 'no url key' => ['{"method":"GET"}'];
        yield 'blank url' => ['{"url":"   "}'];
        yield 'null url' => ['{"url":null}'];
    }

    public function testExecuteProxiesTheRequestAndRecordsTheRun(): void
    {
        $this->rewriter->method('rewrite')->willReturn(null);
        $result = ['success' => true, 'status' => 201, 'size' => 42, 'timeMs' => 17, 'body' => 'ok'];
        $this->executor->expects(self::once())->method('execute')->with(
            'POST',
            'https://api.example/items?a=1&b=x%20y',
            [['key' => 'X-Api-Key', 'value' => 'k'], ['key' => 'Content-Type', 'value' => 'application/json']],
            '{"n":1}',
            20,
            null
        )->willReturn($result);
        // The run history keeps the URL the user asked for, with the query parameters appended.
        $this->manager->expects(self::once())->method('recordRun')->with([
            'requestId' => 7,
            'name' => 'Create item',
            'method' => 'POST',
            'url' => 'https://api.example/items?a=1&b=x%20y',
            'status' => 201,
            'result' => 'success',
            'sizeBytes' => 42,
            'timeMs' => 17,
        ])->willReturn(new ApiCollectionRunHistory());
        $this->manager->method('getRecentRuns')->willReturn([$this->historyRun()]);

        $data = $this->decode($this->controller->executeAction($this->json(json_encode([
            'requestId' => 7,
            'name' => 'Create item',
            'method' => 'post',
            'url' => ' https://api.example/items ',
            'params' => [['key' => 'a', 'value' => '1'], ['key' => ' ', 'value' => 'skipped'], ['key' => 'b', 'value' => 'x y']],
            'headers' => [['key' => 'X-Api-Key', 'value' => 'k'], ['key' => '', 'value' => 'skipped']],
            'bodyType' => 'json',
            'body' => '{"n":1}',
            'timeout' => '20',
        ], JSON_THROW_ON_ERROR))));

        self::assertTrue($data['success']);
        self::assertSame($result, $data['response']);
        self::assertSame(70, $data['runs'][0]['id']);
    }

    public function testExecuteDefaultsToAGetWithoutBodyOrTimeout(): void
    {
        $this->rewriter->method('rewrite')->willReturn(null);
        $this->executor->expects(self::once())->method('execute')
            ->with('GET', 'https://api.example', [], '', 0, null)
            ->willReturn(['success' => true]);
        $this->manager->method('getRecentRuns')->willReturn([]);

        $data = $this->decode($this->controller->executeAction($this->json('{"url":"https://api.example","method":"","params":"nope","headers":5}')));

        self::assertTrue($data['success']);
        self::assertSame([], $data['runs']);
    }

    public function testQueryParametersAreAppendedWithAnAmpersandWhenTheUrlAlreadyHasAQuery(): void
    {
        $this->rewriter->method('rewrite')->willReturn(null);
        $this->executor->expects(self::once())->method('execute')
            ->with('GET', 'https://api.example/x?y=1&z=%26%3D', self::anything(), self::anything(), self::anything(), null)
            ->willReturn(['success' => true]);
        $this->manager->method('getRecentRuns')->willReturn([]);

        $this->controller->executeAction($this->json(json_encode([
            'url' => 'https://api.example/x?y=1',
            'params' => [['key' => 'z', 'value' => '&='], ['value' => 'no key']],
        ], JSON_THROW_ON_ERROR)));
    }

    /**
     * @dataProvider defaultContentTypeProvider
     *
     * @param array<int, array<string, string>> $headers
     * @param array<int, array<string, string>> $expected
     */
    public function testExecuteDefaultsTheContentTypeFromTheBodyTypeUnlessTheUserSetOne(string $bodyType, array $headers, array $expected): void
    {
        $this->rewriter->method('rewrite')->willReturn(null);
        $this->executor->expects(self::once())->method('execute')
            ->with('POST', 'https://api.example', $expected, self::anything(), self::anything(), null)
            ->willReturn(['success' => true]);
        $this->manager->method('getRecentRuns')->willReturn([]);

        $this->controller->executeAction($this->json(json_encode([
            'method' => 'POST',
            'url' => 'https://api.example',
            'bodyType' => $bodyType,
            'headers' => $headers,
        ], JSON_THROW_ON_ERROR)));
    }

    /**
     * @return iterable<string, array{string, array<int, array<string, string>>, array<int, array<string, string>>}>
     */
    public static function defaultContentTypeProvider(): iterable
    {
        yield 'json' => ['json', [], [['key' => 'Content-Type', 'value' => 'application/json']]];
        yield 'xml' => ['xml', [], [['key' => 'Content-Type', 'value' => 'application/xml']]];
        yield 'form' => ['form', [], [['key' => 'Content-Type', 'value' => 'application/x-www-form-urlencoded']]];
        yield 'raw text gets none' => ['text', [], []];
        yield 'no body type gets none' => ['none', [], []];
        yield 'the user\'s own header wins (case-insensitive)' => [
            'json',
            [['key' => ' content-TYPE ', 'value' => 'text/plain']],
            [['key' => 'content-TYPE', 'value' => 'text/plain']],
        ];
    }

    public function testExecuteSendsTheRewrittenTargetButRecordsTheOriginalUrl(): void
    {
        $this->rewriter->expects(self::once())->method('rewrite')->with('https://shop.example/api')
            ->willReturn(['url' => 'https://10.0.0.5/api', 'hostHeader' => 'shop.example']);
        $this->executor->expects(self::once())->method('execute')
            ->with('GET', 'https://10.0.0.5/api', [], '', 0, 'shop.example')
            ->willReturn(['success' => true, 'status' => 200]);
        $recorded = null;
        $this->manager->method('recordRun')->willReturnCallback(function (array $data) use (&$recorded) {
            $recorded = $data;

            return new ApiCollectionRunHistory();
        });
        $this->manager->method('getRecentRuns')->willReturn([]);

        $this->controller->executeAction($this->json('{"url":"https://shop.example/api"}'));

        self::assertSame('https://shop.example/api', $recorded['url']);
    }

    public function testExecuteRecordsAFailedTransportAsAnErrorRun(): void
    {
        $this->rewriter->method('rewrite')->willReturn(null);
        $this->executor->method('execute')->willReturn(['success' => false, 'error' => 'timeout', 'timeMs' => 5000]);
        $recorded = null;
        $this->manager->method('recordRun')->willReturnCallback(function (array $data) use (&$recorded) {
            $recorded = $data;

            return new ApiCollectionRunHistory();
        });
        $this->manager->method('getRecentRuns')->willReturn([]);

        $data = $this->decode($this->controller->executeAction($this->json('{"url":"https://api.example"}')));

        self::assertFalse($data['success']);
        self::assertSame('timeout', $data['response']['error']);
        self::assertSame(ApiCollectionRunHistory::RESULT_ERROR, $recorded['result']);
        self::assertNull($recorded['status']);
        self::assertSame(0, $recorded['sizeBytes']);
        self::assertSame(5000, $recorded['timeMs']);
        self::assertNull($recorded['requestId']);
        self::assertNull($recorded['name']);
    }

    public function testExecuteStillAnswersWhenTheRunHistoryCannotBeStored(): void
    {
        $this->rewriter->method('rewrite')->willReturn(null);
        $result = ['success' => true, 'status' => 200];
        $this->executor->method('execute')->willReturn($result);
        $this->manager->method('recordRun')->willThrowException(new \RuntimeException('database is down'));
        $this->manager->expects(self::never())->method('getRecentRuns');

        $response = $this->controller->executeAction($this->json('{"url":"https://api.example"}'));

        self::assertSame(200, $response->getStatusCode());
        self::assertSame(['success' => true, 'response' => $result], $this->decode($response));
    }

    public function testExecuteAlsoSurvivesAHistoryReadFailure(): void
    {
        $this->rewriter->method('rewrite')->willReturn(null);
        $this->executor->method('execute')->willReturn(['success' => true]);
        $this->manager->method('recordRun')->willReturn(new ApiCollectionRunHistory());
        $this->manager->method('getRecentRuns')->willThrowException(new \RuntimeException('read failed'));

        $data = $this->decode($this->controller->executeAction($this->json('{"url":"https://api.example"}')));

        self::assertTrue($data['success']);
        self::assertArrayNotHasKey('runs', $data);
    }

    public function testExecuteTreatsAResultWithoutASuccessFlagAsAFailure(): void
    {
        $this->rewriter->method('rewrite')->willReturn(null);
        $this->executor->method('execute')->willReturn([]);
        $this->manager->method('getRecentRuns')->willReturn([]);

        self::assertFalse($this->decode($this->controller->executeAction($this->json('{"url":"https://api.example"}')))['success']);
    }

    // --- wiring -----------------------------------------------------------------------------------

    public function testDeclaresItsCollaboratorsAsSubscribedServices(): void
    {
        $services = ApiCollectionController::getSubscribedServices();

        foreach ([ApiCollectionManager::class, ApiRequestExecutor::class, LocalHostRewriter::class] as $id) {
            self::assertContains($id, $services);
        }
    }

    // --- helpers ----------------------------------------------------------------------------------

    private function json(string|false $body): Request
    {
        return new Request([], [], [], [], [], ['CONTENT_TYPE' => 'application/json'], (string) $body);
    }

    /**
     * @return array<string, mixed>
     */
    private function decode(JsonResponse $response): array
    {
        return json_decode((string) $response->getContent(), true, 512, JSON_THROW_ON_ERROR);
    }

    private function assertInvalidPayload(JsonResponse $response): void
    {
        self::assertSame(400, $response->getStatusCode());
        self::assertSame(['success' => false, 'message' => 'Invalid payload.'], $this->decode($response));
    }

    private function assertNotFound(JsonResponse $response): void
    {
        self::assertSame(404, $response->getStatusCode());
        self::assertSame(['success' => false, 'message' => 'Not found.'], $this->decode($response));
    }

    private function viewable(ApiCollectionRequest $node): void
    {
        $this->manager->method('findNode')->willReturn($node);
        $this->manager->method('canView')->willReturn(true);
    }

    private function node(int $id, string $type, ?int $owner): ApiCollectionRequest
    {
        $node = new ApiCollectionRequest();
        (new \ReflectionProperty($node, 'id'))->setValue($node, $id);
        $node->setType($type)->setName('node ' . $id);
        if ($owner !== null) {
            $user = new User();
            $user->setId($owner);
            $node->setUser($user);
        }

        return $node;
    }

    private function historyRun(): ApiCollectionRunHistory
    {
        $run = (new ApiCollectionRunHistory())
            ->setName('List orders')
            ->setMethod('GET')
            ->setUrl('https://api.example/orders')
            ->setRunAt(new \DateTimeImmutable('2026-03-03 10:00:00', new \DateTimeZone('UTC')))
            ->setStatus(200)
            ->setResult(ApiCollectionRunHistory::RESULT_SUCCESS)
            ->setSizeBytes(2048)
            ->setTimeMs(35);
        (new \ReflectionProperty($run, 'id'))->setValue($run, 70);

        return $run;
    }
}
