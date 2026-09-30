<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Manager;

use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRequest;
use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRunHistory;
use Aaxis\Bundle\ToolsBundle\Entity\Repository\ApiCollectionRequestRepository;
use Aaxis\Bundle\ToolsBundle\Entity\Repository\ApiCollectionRunHistoryRepository;
use Aaxis\Bundle\ToolsBundle\Exception\ApiCollectionAccessDeniedException;
use Aaxis\Bundle\ToolsBundle\Manager\ApiCollectionManager;
use Doctrine\Persistence\ManagerRegistry;
use Doctrine\Persistence\ObjectManager;
use Oro\Bundle\SecurityBundle\Authentication\TokenAccessorInterface;
use Oro\Bundle\UserBundle\Entity\User;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Security\Core\User\InMemoryUser;

class ApiCollectionManagerTest extends TestCase
{
    private TokenAccessorInterface&MockObject $tokenAccessor;
    private ApiCollectionRequestRepository&MockObject $requests;
    private ApiCollectionRunHistoryRepository&MockObject $runs;
    private ObjectManager&MockObject $requestEm;
    private ObjectManager&MockObject $runEm;
    private ApiCollectionManager $manager;

    /** @var list<object> */
    private array $persisted = [];
    /** @var list<object> */
    private array $removed = [];
    /** @var array{request: int, run: int} */
    private array $flushes = ['request' => 0, 'run' => 0];

    protected function setUp(): void
    {
        $this->tokenAccessor = $this->createMock(TokenAccessorInterface::class);
        $this->requests = $this->createMock(ApiCollectionRequestRepository::class);
        $this->runs = $this->createMock(ApiCollectionRunHistoryRepository::class);
        $this->requestEm = $this->createMock(ObjectManager::class);
        $this->runEm = $this->createMock(ObjectManager::class);

        foreach (['request' => $this->requestEm, 'run' => $this->runEm] as $key => $em) {
            $em->method('flush')->willReturnCallback(function () use ($key): void {
                ++$this->flushes[$key];
            });
            $em->method('persist')->willReturnCallback(function (object $o): void {
                $this->persisted[] = $o;
            });
            $em->method('remove')->willReturnCallback(function (object $o): void {
                $this->removed[] = $o;
            });
        }

        $doctrine = $this->createMock(ManagerRegistry::class);
        $doctrine->method('getRepository')->willReturnMap([
            [ApiCollectionRequest::class, null, $this->requests],
            [ApiCollectionRunHistory::class, null, $this->runs],
        ]);
        $doctrine->method('getManagerForClass')->willReturnMap([
            [ApiCollectionRequest::class, $this->requestEm],
            [ApiCollectionRunHistory::class, $this->runEm],
        ]);

        $this->manager = new ApiCollectionManager($doctrine, $this->tokenAccessor);
    }

    // --- current user -----------------------------------------------------------------------------

    public function testTheCurrentUserIdIsTheIdOfTheLoggedInOroUser(): void
    {
        $this->loginAs(7);

        self::assertSame(7, $this->manager->getCurrentUserId());
    }

    /**
     * @dataProvider nonOroUserProvider
     */
    public function testThereIsNoCurrentUserIdWithoutAnOroUser(?object $user): void
    {
        $this->tokenAccessor->method('getUser')->willReturn($user);

        self::assertNull($this->manager->getCurrentUserId());
    }

    /**
     * @return iterable<string, array{object|null}>
     */
    public static function nonOroUserProvider(): iterable
    {
        yield 'anonymous' => [null];
        yield 'another user type' => [new InMemoryUser('api', null)];
    }

    // --- getVisibleNodes --------------------------------------------------------------------------

    public function testShowsPublicRequestsAndMyOwnItemsButHidesOtherPeoplesPrivateOnes(): void
    {
        $this->loginAs(1);
        $this->requestsAre([
            $this->node(10, folder: true, owner: 2),                   // someone else's folder holding a visible request
            $this->node(11, parent: 10, owner: 2, public: true),        // public -> visible
            $this->node(12, parent: 10, owner: 2),                      // private of another user -> hidden
            $this->node(13, parent: 10, owner: 1),                      // mine -> visible
            $this->node(20, folder: true, owner: 2),                    // someone else's folder, nothing visible inside
            $this->node(21, parent: 20, owner: 2),                      // private of another user
            $this->node(30, folder: true, owner: 1),                    // my own empty folder
            $this->node(40, owner: null),                               // ownerless request counts as everyone's
        ]);

        self::assertSame([10, 11, 13, 30, 40], $this->visibleIds());
    }

    public function testAncestorFoldersOfAVisibleRequestAreIncludedEvenWhenTheyAreNotMine(): void
    {
        $this->loginAs(1);
        $this->requestsAre([
            $this->node(1, folder: true, owner: 2),
            $this->node(2, folder: true, parent: 1, owner: 2),
            $this->node(3, parent: 2, owner: 1),
            $this->node(4, folder: true, owner: 2),
        ]);

        self::assertSame([1, 2, 3], $this->visibleIds());
    }

    public function testAnOrphanedNodeWhoseParentIsGoneIsStillShown(): void
    {
        $this->loginAs(1);
        $this->requestsAre([$this->node(5, parent: 999, owner: 1)]);

        self::assertSame([5], $this->visibleIds());
    }

    public function testACycleInTheParentChainDoesNotLoopForever(): void
    {
        $this->loginAs(1);
        $this->requestsAre([
            $this->node(1, folder: true, parent: 2, owner: 1),
            $this->node(2, folder: true, parent: 1, owner: 1),
        ]);

        self::assertSame([1, 2], $this->visibleIds());
    }

    public function testAnonymousVisitorsOnlySeePublicAndOwnerlessRequests(): void
    {
        $this->tokenAccessor->method('getUser')->willReturn(null);
        $this->requestsAre([
            $this->node(1, owner: 2),
            $this->node(2, owner: 2, public: true),
            $this->node(3, owner: null),
            $this->node(4, folder: true, owner: 2),
        ]);

        self::assertSame([2, 3], $this->visibleIds());
    }

    // --- createNode -------------------------------------------------------------------------------

    public function testCreatesARequestNodeFromThePayload(): void
    {
        $user = $this->loginAs(4);
        $this->requestsAre([], siblings: [$this->node(1, position: 2), $this->node(2, position: 5)]);

        $before = new \DateTimeImmutable('-1 second');
        $node = $this->manager->createNode([
            'type' => 'request',
            'name' => '  List orders  ',
            'parentId' => '9',
            'public' => 1,
            'method' => 'POST',
            'url' => 'https://api.example/orders',
            'params' => [['key' => 'a', 'value' => '1']],
            'headers' => [['key' => 'X', 'value' => 'y']],
            'bodyType' => 'json',
            'body' => '{}',
        ]);

        self::assertSame([$node], $this->persisted);
        self::assertSame(1, $this->flushCount());
        self::assertSame(ApiCollectionRequest::TYPE_REQUEST, $node->getType());
        self::assertSame('List orders', $node->getName());
        self::assertSame(9, $node->getParentId());
        self::assertTrue($node->isPublic());
        self::assertSame('POST', $node->getMethod());
        self::assertSame('https://api.example/orders', $node->getUrl());
        self::assertSame([['key' => 'a', 'value' => '1']], $node->getParams());
        self::assertSame([['key' => 'X', 'value' => 'y']], $node->getHeaders());
        self::assertSame('json', $node->getBodyType());
        self::assertSame('{}', $node->getBody());
        self::assertSame($user, $node->getUser());
        self::assertSame(6, $node->getPosition(), 'placed after the last sibling');
        self::assertSame('UTC', $node->getCreatedAt()->getTimezone()->getName());
        self::assertGreaterThanOrEqual($before->getTimestamp(), $node->getCreatedAt()->getTimestamp());
        self::assertSame($node->getCreatedAt(), $node->getUpdatedAt());
    }

    public function testCreatesAFolderWithoutAnyRequestFields(): void
    {
        $this->loginAs(4);
        $this->requestsAre([], siblings: []);

        $node = $this->manager->createNode([
            'type' => 'folder',
            'name' => 'Orders',
            'method' => 'POST',
            'url' => 'https://ignored.example',
            'body' => 'ignored',
        ]);

        self::assertTrue($node->isFolder());
        self::assertNull($node->getParentId());
        self::assertFalse($node->isPublic());
        self::assertNull($node->getMethod());
        self::assertNull($node->getUrl());
        self::assertNull($node->getBody());
        self::assertSame(0, $node->getPosition());
    }

    public function testAnUnknownTypeIsTreatedAsARequestAndAMissingNameBecomesUntitled(): void
    {
        $this->loginAs(4);
        $this->requestsAre([], siblings: []);

        $node = $this->manager->createNode(['type' => 'weird', 'parentId' => null]);

        self::assertSame(ApiCollectionRequest::TYPE_REQUEST, $node->getType());
        self::assertSame('Untitled', $node->getName());
        self::assertNull($node->getParentId());
    }

    public function testNamesAreTrimmedAndCappedAt255Characters(): void
    {
        $this->loginAs(4);
        $this->requestsAre([], siblings: []);

        $node = $this->manager->createNode(['name' => str_repeat('é', 300)]);

        self::assertSame(str_repeat('é', 255), $node->getName());
    }

    public function testCreatingWithoutALoggedInUserLeavesTheNodeOwnerless(): void
    {
        $this->tokenAccessor->method('getUser')->willReturn(null);
        $this->requestsAre([], siblings: []);

        self::assertNull($this->manager->createNode(['name' => 'x'])->getUser());
    }

    public function testNodesArePositionedAmongTheSiblingsOfTheirParent(): void
    {
        $this->loginAs(4);
        $this->requests->expects(self::once())->method('findBy')->with(['parentId' => 3])->willReturn([]);

        $this->manager->createNode(['name' => 'x', 'parentId' => 3]);
    }

    // --- updateNode -------------------------------------------------------------------------------

    public function testUpdatesTheProvidedFieldsOfAnOwnedRequestAndLeavesTheRest(): void
    {
        $this->loginAs(1);
        $node = $this->node(5, owner: 1);
        $node->setName('Old')->setPublic(false)->setMethod('GET')->setUrl('https://old.example')->setBody('keep');
        $node->setUpdatedAt(new \DateTime('2000-01-01'));

        $result = $this->manager->updateNode($node, [
            'name' => ' New ',
            'public' => true,
            'method' => 'delete-with-a-very-long-verb',
            'headers' => 'not-an-array',
        ]);

        self::assertSame($node, $result);
        self::assertSame('New', $node->getName());
        self::assertTrue($node->isPublic());
        self::assertSame('delete-wit', $node->getMethod());
        self::assertSame('https://old.example', $node->getUrl());
        self::assertNull($node->getHeaders());
        self::assertSame('keep', $node->getBody());
        self::assertGreaterThan(2000, (int) $node->getUpdatedAt()->format('Y'));
        self::assertSame(1, $this->flushCount());
    }

    public function testNullNameAndPublicFlagAreIgnoredButNullRequestFieldsClearTheValue(): void
    {
        $this->loginAs(1);
        $node = $this->node(5, owner: 1, public: true);
        $node->setName('Keep')->setMethod('GET')->setUrl('u')->setParams([['k']])->setHeaders([['h']])->setBodyType('json')->setBody('b');

        $this->manager->updateNode($node, [
            'name' => null,
            'public' => null,
            'method' => null,
            'url' => null,
            'params' => null,
            'headers' => null,
            'bodyType' => null,
            'body' => null,
        ]);

        self::assertSame('Keep', $node->getName());
        self::assertTrue($node->isPublic());
        self::assertNull($node->getMethod());
        self::assertNull($node->getUrl());
        self::assertNull($node->getParams());
        self::assertNull($node->getHeaders());
        self::assertNull($node->getBodyType());
        self::assertNull($node->getBody());
    }

    public function testUpdatingAFolderOnlyTouchesNameAndVisibility(): void
    {
        $this->loginAs(1);
        $folder = $this->node(5, folder: true, owner: 1);

        $this->manager->updateNode($folder, ['name' => 'Renamed', 'public' => true, 'url' => 'https://x.example', 'method' => 'GET']);

        self::assertSame('Renamed', $folder->getName());
        self::assertTrue($folder->isPublic());
        self::assertNull($folder->getUrl());
        self::assertNull($folder->getMethod());
    }

    public function testUpdatesBodyFieldsAsStringsAndParamsAsArrays(): void
    {
        $this->loginAs(1);
        $node = $this->node(5, owner: 1);

        $this->manager->updateNode($node, [
            'url' => 12345,
            'params' => [['key' => 'a']],
            'headers' => [['key' => 'b']],
            'bodyType' => 'xml',
            'body' => 99,
        ]);

        self::assertSame('12345', $node->getUrl());
        self::assertSame([['key' => 'a']], $node->getParams());
        self::assertSame([['key' => 'b']], $node->getHeaders());
        self::assertSame('xml', $node->getBodyType());
        self::assertSame('99', $node->getBody());
    }

    public function testCannotUpdateSomeoneElsesNode(): void
    {
        $this->loginAs(1);
        $node = $this->node(5, owner: 2, public: true);
        $this->requestEm->expects(self::never())->method('flush');

        $this->expectException(ApiCollectionAccessDeniedException::class);
        $this->expectExceptionMessage('You can only modify your own items.');

        $this->manager->updateNode($node, ['name' => 'hijack']);
    }

    // --- deleteNode -------------------------------------------------------------------------------

    public function testDeletesTheNodeTogetherWithItsWholeSubtree(): void
    {
        $this->loginAs(1);
        $root = $this->node(1, folder: true, owner: 1);
        $child = $this->node(2, folder: true, parent: 1, owner: 1);
        $grandchild = $this->node(3, parent: 2, owner: 1);
        $sibling = $this->node(4, parent: 1, owner: 1);
        $unrelated = $this->node(5, owner: 1);
        $this->requestsAre([$root, $child, $grandchild, $sibling, $unrelated]);

        $this->manager->deleteNode($root);

        $ids = array_map(static fn (ApiCollectionRequest $n) => $n->getId(), $this->removed);
        sort($ids);
        self::assertSame([1, 2, 3, 4], $ids);
        self::assertSame(1, $this->flushCount());
    }

    public function testDeletingALeafRemovesOnlyThatNode(): void
    {
        $this->loginAs(1);
        $leaf = $this->node(3, owner: 1);
        $this->requestsAre([$this->node(1, folder: true, owner: 1), $leaf]);

        $this->manager->deleteNode($leaf);

        self::assertSame([$leaf], $this->removed);
    }

    public function testDeletionSkipsNodesThatVanishedMeanwhile(): void
    {
        $this->loginAs(1);
        $root = $this->node(1, folder: true, owner: 1);
        $this->requests->method('findAll')->willReturn([$root, $this->node(2, parent: 1, owner: 1)]);
        $this->requests->method('find')->willReturnCallback(static fn (int $id) => $id === 1 ? $root : null);

        $this->manager->deleteNode($root);

        self::assertSame([$root], $this->removed);
    }

    public function testCannotDeleteSomeoneElsesNode(): void
    {
        $this->loginAs(1);
        $this->requestEm->expects(self::never())->method('remove');

        $this->expectException(ApiCollectionAccessDeniedException::class);

        $this->manager->deleteNode($this->node(1, owner: 2, public: true));
    }

    // --- duplicateNode ----------------------------------------------------------------------------

    public function testDuplicatesAViewableNodeAsAPrivateCopyOwnedByTheCurrentUser(): void
    {
        $me = $this->loginAs(1);
        $source = $this->node(5, parent: 3, owner: 2, public: true);
        $source->setName('Ping')->setMethod('GET')->setUrl('https://api.example/ping')
            ->setParams([['key' => 'a']])->setHeaders([['key' => 'h']])->setBodyType('json')->setBody('{"x":1}');
        $this->requestsAre([], siblings: [$this->node(6, position: 3)]);

        $copy = $this->manager->duplicateNode($source);

        self::assertNotSame($source, $copy);
        self::assertSame([$copy], $this->persisted);
        self::assertSame(1, $this->flushCount());
        self::assertSame('Ping (copy)', $copy->getName());
        self::assertSame($source->getType(), $copy->getType());
        self::assertSame(3, $copy->getParentId());
        self::assertFalse($copy->isPublic());
        self::assertSame('GET', $copy->getMethod());
        self::assertSame('https://api.example/ping', $copy->getUrl());
        self::assertSame([['key' => 'a']], $copy->getParams());
        self::assertSame([['key' => 'h']], $copy->getHeaders());
        self::assertSame('json', $copy->getBodyType());
        self::assertSame('{"x":1}', $copy->getBody());
        self::assertSame($me, $copy->getUser());
        self::assertSame(4, $copy->getPosition());
        self::assertSame($copy->getCreatedAt(), $copy->getUpdatedAt());
    }

    public function testDuplicatingWithoutALoggedInUserLeavesTheCopyOwnerless(): void
    {
        $this->tokenAccessor->method('getUser')->willReturn(null);
        $this->requestsAre([], siblings: []);

        self::assertNull($this->manager->duplicateNode($this->node(5, owner: null))->getUser());
    }

    public function testCannotDuplicateSomeoneElsesPrivateNode(): void
    {
        $this->loginAs(1);
        $this->requestEm->expects(self::never())->method('persist');

        $this->expectException(ApiCollectionAccessDeniedException::class);
        $this->expectExceptionMessage('You do not have access to this item.');

        $this->manager->duplicateNode($this->node(5, owner: 2));
    }

    // --- run history ------------------------------------------------------------------------------

    public function testRecordsARunFromThePayload(): void
    {
        $user = $this->loginAs(1);

        $run = $this->manager->recordRun([
            'requestId' => '15',
            'name' => str_repeat('n', 300),
            'method' => 'PATCH-WITH-LONG-NAME',
            'url' => 'https://api.example/x',
            'status' => '200',
            'result' => 'error',
            'sizeBytes' => '2048',
            'timeMs' => '35',
        ]);

        self::assertSame([$run], $this->persisted);
        self::assertSame(1, $this->flushCount('run'));
        self::assertSame(15, $run->getRequestId());
        self::assertSame(str_repeat('n', 255), $run->getName());
        self::assertSame('PATCH-WITH', $run->getMethod());
        self::assertSame('https://api.example/x', $run->getUrl());
        self::assertSame(200, $run->getStatus());
        self::assertSame(ApiCollectionRunHistory::RESULT_ERROR, $run->getResult());
        self::assertSame(2048, $run->getSizeBytes());
        self::assertSame(35, $run->getTimeMs());
        self::assertSame($user, $run->getUser());
        self::assertSame('UTC', $run->getRunAt()->getTimezone()->getName());
    }

    public function testARunWithoutDetailsGetsSafeDefaults(): void
    {
        $this->tokenAccessor->method('getUser')->willReturn(null);

        $run = $this->manager->recordRun(['requestId' => null, 'name' => null, 'result' => 'whatever']);

        self::assertNull($run->getRequestId());
        self::assertNull($run->getName());
        self::assertSame('GET', $run->getMethod());
        self::assertSame('', $run->getUrl());
        self::assertNull($run->getStatus());
        self::assertSame(ApiCollectionRunHistory::RESULT_SUCCESS, $run->getResult());
        self::assertNull($run->getSizeBytes());
        self::assertNull($run->getTimeMs());
        self::assertNull($run->getUser());
    }

    public function testRecentRunsAreLimitedToTheLatestFiftyOfTheCurrentUser(): void
    {
        $this->loginAs(8);
        $runs = [new ApiCollectionRunHistory()];
        $this->runs->expects(self::once())->method('findRecentForUser')->with(8, 50)->willReturn($runs);

        self::assertSame($runs, $this->manager->getRecentRuns());
        self::assertSame(50, ApiCollectionManager::RUN_HISTORY_LIMIT);
    }

    public function testRecentRunsOfAnAnonymousVisitorAreNotFilteredByUser(): void
    {
        $this->tokenAccessor->method('getUser')->willReturn(null);
        $this->runs->expects(self::once())->method('findRecentForUser')->with(null, 50)->willReturn([]);

        self::assertSame([], $this->manager->getRecentRuns());
    }

    // --- lookups and permissions ------------------------------------------------------------------

    public function testFindsANodeById(): void
    {
        $node = $this->node(5);
        $this->requests->method('find')->willReturnMap([[5, null, null, $node], [6, null, null, null]]);

        self::assertSame($node, $this->manager->findNode(5));
        self::assertNull($this->manager->findNode(6));
    }

    /**
     * @dataProvider permissionProvider
     */
    public function testViewAndModifyPermissions(?int $me, ?int $owner, bool $public, bool $canModify, bool $canView): void
    {
        if ($me === null) {
            $this->tokenAccessor->method('getUser')->willReturn(null);
        } else {
            $this->loginAs($me);
        }
        $node = $this->node(1, owner: $owner, public: $public);

        self::assertSame($canModify, $this->manager->canModify($node));
        self::assertSame($canView, $this->manager->canView($node));
    }

    /**
     * @return iterable<string, array{int|null, int|null, bool, bool, bool}>
     */
    public static function permissionProvider(): iterable
    {
        yield 'my own private node' => [1, 1, false, true, true];
        yield 'my own public node' => [1, 1, true, true, true];
        yield 'public node of someone else' => [1, 2, true, false, true];
        yield 'private node of someone else' => [1, 2, false, false, false];
        yield 'ownerless private node' => [1, null, false, true, true];
        yield 'anonymous on a private owned node' => [null, 2, false, false, false];
        yield 'anonymous on a public owned node' => [null, 2, true, false, true];
        yield 'anonymous on an ownerless node' => [null, null, false, true, true];
    }

    // --- helpers ----------------------------------------------------------------------------------

    private function loginAs(int $id): User
    {
        $user = new User();
        $user->setId($id);
        $this->tokenAccessor->method('getUser')->willReturn($user);

        return $user;
    }

    /**
     * @param ApiCollectionRequest[] $all      what findAll() returns
     * @param ApiCollectionRequest[] $siblings what findBy(['parentId' => …]) returns
     */
    private function requestsAre(array $all, array $siblings = []): void
    {
        $this->requests->method('findAll')->willReturn($all);
        $this->requests->method('findBy')->willReturn($siblings);
        $this->requests->method('find')->willReturnCallback(static function (int $id) use ($all): ?ApiCollectionRequest {
            foreach ($all as $node) {
                if ($node->getId() === $id) {
                    return $node;
                }
            }

            return null;
        });
    }

    private function node(
        int $id,
        bool $folder = false,
        ?int $parent = null,
        ?int $owner = null,
        bool $public = false,
        int $position = 0,
    ): ApiCollectionRequest {
        $node = new ApiCollectionRequest();
        (new \ReflectionProperty($node, 'id'))->setValue($node, $id);
        $node->setType($folder ? ApiCollectionRequest::TYPE_FOLDER : ApiCollectionRequest::TYPE_REQUEST)
            ->setParentId($parent)
            ->setPublic($public)
            ->setPosition($position)
            ->setName('node ' . $id);
        if ($owner !== null) {
            $user = new User();
            $user->setId($owner);
            $node->setUser($user);
        }

        return $node;
    }

    /**
     * @return int[]
     */
    private function visibleIds(): array
    {
        $ids = array_map(static fn (ApiCollectionRequest $n) => $n->getId(), $this->manager->getVisibleNodes());
        sort($ids);

        return $ids;
    }

    private function flushCount(string $which = 'request'): int
    {
        return $this->flushes[$which];
    }
}
