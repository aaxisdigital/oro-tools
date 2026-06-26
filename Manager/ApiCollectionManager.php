<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Manager;

use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRequest;
use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRunHistory;
use Aaxis\Bundle\ToolsBundle\Entity\Repository\ApiCollectionRequestRepository;
use Aaxis\Bundle\ToolsBundle\Entity\Repository\ApiCollectionRunHistoryRepository;
use Doctrine\Persistence\ManagerRegistry;
use Oro\Bundle\SecurityBundle\Authentication\TokenAccessorInterface;
use Oro\Bundle\UserBundle\Entity\User;

/**
 * Manages the API Collection tree (folders/requests) and the run history.
 */
class ApiCollectionManager
{
    public const int RUN_HISTORY_LIMIT = 50;

    public function __construct(
        private readonly ManagerRegistry $doctrine,
        private readonly TokenAccessorInterface $tokenAccessor,
    ) {
    }

    public function getCurrentUserId(): ?int
    {
        $user = $this->tokenAccessor->getUser();

        return $user instanceof User ? $user->getId() : null;
    }

    /**
     * The nodes the current user may see in the tree.
     *
     * Visibility is driven by requests only — a request is visible when it is public or owned by the
     * user. Folders are not visibility-gated: a folder is shown when it (or any descendant) contains
     * a visible request, plus the user always sees their own folders so empty ones can still be
     * filled. Ancestor folders of any visible node are always included so the tree path renders.
     *
     * @return ApiCollectionRequest[]
     */
    public function getVisibleNodes(): array
    {
        $userId = $this->getCurrentUserId();
        $all = $this->requestRepository()->findAll();

        $byId = [];
        foreach ($all as $node) {
            $byId[$node->getId()] = $node;
        }

        $visible = [];
        $include = static function (ApiCollectionRequest $node) use (&$include, &$visible, $byId): void {
            if (isset($visible[$node->getId()])) {
                return;
            }
            $visible[$node->getId()] = $node;
            $parentId = $node->getParentId();
            if ($parentId !== null && isset($byId[$parentId])) {
                $include($byId[$parentId]); // pull in ancestor folders so the path is complete
            }
        };

        foreach ($all as $node) {
            $owned = $this->isOwnedBy($node, $userId);
            $visibleRequest = !$node->isFolder() && ($node->isPublic() || $owned);
            $ownFolder = $node->isFolder() && $owned;
            if ($visibleRequest || $ownFolder) {
                $include($node);
            }
        }

        return array_values($visible);
    }

    private function isOwnedBy(ApiCollectionRequest $node, ?int $userId): bool
    {
        $owner = $node->getUser();

        return $owner === null || ($userId !== null && $owner->getId() === $userId);
    }

    /**
     * @param array<string, mixed> $data
     */
    public function createNode(array $data): ApiCollectionRequest
    {
        $node = new ApiCollectionRequest();
        $node->setType(($data['type'] ?? '') === ApiCollectionRequest::TYPE_FOLDER
            ? ApiCollectionRequest::TYPE_FOLDER
            : ApiCollectionRequest::TYPE_REQUEST);
        $node->setName($this->cleanName((string) ($data['name'] ?? '')));
        $node->setParentId(isset($data['parentId']) && $data['parentId'] !== null ? (int) $data['parentId'] : null);
        $node->setPublic((bool) ($data['public'] ?? false));

        if (!$node->isFolder()) {
            $this->applyRequestFields($node, $data);
        }

        $now = $this->now();
        $node->setCreatedAt($now);
        $node->setUpdatedAt($now);
        $user = $this->tokenAccessor->getUser();
        if ($user instanceof User) {
            $node->setUser($user);
        }

        $em = $this->doctrine->getManagerForClass(ApiCollectionRequest::class);
        $node->setPosition($this->nextPosition($node->getParentId()));
        $em->persist($node);
        $em->flush();

        return $node;
    }

    /**
     * @param array<string, mixed> $data
     */
    public function updateNode(ApiCollectionRequest $node, array $data): ApiCollectionRequest
    {
        $this->assertOwner($node);

        if (\array_key_exists('name', $data) && $data['name'] !== null) {
            $node->setName($this->cleanName((string) $data['name']));
        }
        if (\array_key_exists('public', $data) && $data['public'] !== null) {
            $node->setPublic((bool) $data['public']);
        }
        if (!$node->isFolder()) {
            $this->applyRequestFields($node, $data);
        }
        $node->setUpdatedAt($this->now());

        $this->doctrine->getManagerForClass(ApiCollectionRequest::class)->flush();

        return $node;
    }

    public function deleteNode(ApiCollectionRequest $node): void
    {
        $this->assertOwner($node);

        $em = $this->doctrine->getManagerForClass(ApiCollectionRequest::class);
        foreach ($this->collectSubtreeIds($node) as $id) {
            $entity = $this->requestRepository()->find($id);
            if ($entity !== null) {
                $em->remove($entity);
            }
        }
        $em->flush();
    }

    public function duplicateNode(ApiCollectionRequest $node): ApiCollectionRequest
    {
        $this->assertCanView($node);

        $copy = new ApiCollectionRequest();
        $copy->setType($node->getType());
        $copy->setName($node->getName() . ' (copy)');
        $copy->setParentId($node->getParentId());
        $copy->setPublic(false);
        $copy->setMethod($node->getMethod());
        $copy->setUrl($node->getUrl());
        $copy->setParams($node->getParams());
        $copy->setHeaders($node->getHeaders());
        $copy->setBodyType($node->getBodyType());
        $copy->setBody($node->getBody());

        $now = $this->now();
        $copy->setCreatedAt($now);
        $copy->setUpdatedAt($now);
        $user = $this->tokenAccessor->getUser();
        if ($user instanceof User) {
            $copy->setUser($user);
        }
        $copy->setPosition($this->nextPosition($copy->getParentId()));

        $em = $this->doctrine->getManagerForClass(ApiCollectionRequest::class);
        $em->persist($copy);
        $em->flush();

        return $copy;
    }

    /**
     * @param array<string, mixed> $data
     */
    public function recordRun(array $data): ApiCollectionRunHistory
    {
        $run = new ApiCollectionRunHistory();
        $run->setRequestId(isset($data['requestId']) && $data['requestId'] !== null ? (int) $data['requestId'] : null);
        $run->setName(isset($data['name']) && $data['name'] !== null ? mb_substr((string) $data['name'], 0, 255) : null);
        $run->setMethod(mb_substr((string) ($data['method'] ?? 'GET'), 0, 10));
        $run->setUrl((string) ($data['url'] ?? ''));
        $run->setRunAt($this->now());
        $run->setStatus(isset($data['status']) ? (int) $data['status'] : null);
        $run->setResult(($data['result'] ?? '') === ApiCollectionRunHistory::RESULT_ERROR
            ? ApiCollectionRunHistory::RESULT_ERROR
            : ApiCollectionRunHistory::RESULT_SUCCESS);
        $run->setSizeBytes(isset($data['sizeBytes']) ? (int) $data['sizeBytes'] : null);
        $run->setTimeMs(isset($data['timeMs']) ? (int) $data['timeMs'] : null);

        $user = $this->tokenAccessor->getUser();
        if ($user instanceof User) {
            $run->setUser($user);
        }

        $em = $this->doctrine->getManagerForClass(ApiCollectionRunHistory::class);
        $em->persist($run);
        $em->flush();

        return $run;
    }

    /**
     * @return ApiCollectionRunHistory[]
     */
    public function getRecentRuns(): array
    {
        return $this->runHistoryRepository()->findRecentForUser($this->getCurrentUserId(), self::RUN_HISTORY_LIMIT);
    }

    public function findNode(int $id): ?ApiCollectionRequest
    {
        return $this->requestRepository()->find($id);
    }

    public function canModify(ApiCollectionRequest $node): bool
    {
        return $this->isOwnedBy($node, $this->getCurrentUserId());
    }

    /**
     * A node is viewable when it is public or owned by the current user. Private nodes belonging to
     * someone else must stay invisible — callers should treat a non-viewable node as "not found".
     */
    public function canView(ApiCollectionRequest $node): bool
    {
        return $node->isPublic() || $this->canModify($node);
    }

    private function assertOwner(ApiCollectionRequest $node): void
    {
        if (!$this->canModify($node)) {
            throw new \RuntimeException('You can only modify your own items.');
        }
    }

    private function assertCanView(ApiCollectionRequest $node): void
    {
        if (!$this->canView($node)) {
            throw new \RuntimeException('You do not have access to this item.');
        }
    }

    /**
     * @param array<string, mixed> $data
     */
    private function applyRequestFields(ApiCollectionRequest $node, array $data): void
    {
        if (\array_key_exists('method', $data)) {
            $node->setMethod($data['method'] !== null ? mb_substr((string) $data['method'], 0, 10) : null);
        }
        if (\array_key_exists('url', $data)) {
            $node->setUrl($data['url'] !== null ? (string) $data['url'] : null);
        }
        if (\array_key_exists('params', $data)) {
            $node->setParams(\is_array($data['params']) ? $data['params'] : null);
        }
        if (\array_key_exists('headers', $data)) {
            $node->setHeaders(\is_array($data['headers']) ? $data['headers'] : null);
        }
        if (\array_key_exists('bodyType', $data)) {
            $node->setBodyType($data['bodyType'] !== null ? (string) $data['bodyType'] : null);
        }
        if (\array_key_exists('body', $data)) {
            $node->setBody($data['body'] !== null ? (string) $data['body'] : null);
        }
    }

    /**
     * @return int[]
     */
    private function collectSubtreeIds(ApiCollectionRequest $node): array
    {
        $all = $this->requestRepository()->findAll();
        $childrenByParent = [];
        foreach ($all as $n) {
            $childrenByParent[$n->getParentId() ?? 0][] = $n->getId();
        }

        $ids = [];
        $stack = [$node->getId()];
        while ($stack !== []) {
            $current = array_pop($stack);
            $ids[] = $current;
            foreach ($childrenByParent[$current] ?? [] as $childId) {
                $stack[] = $childId;
            }
        }

        return $ids;
    }

    private function nextPosition(?int $parentId): int
    {
        $count = 0;
        foreach ($this->requestRepository()->findBy(['parentId' => $parentId]) as $sibling) {
            $count = max($count, $sibling->getPosition() + 1);
        }

        return $count;
    }

    private function cleanName(string $name): string
    {
        $name = trim($name);

        return $name === '' ? 'Untitled' : mb_substr($name, 0, 255);
    }

    private function now(): \DateTime
    {
        return new \DateTime('now', new \DateTimeZone('UTC'));
    }

    private function requestRepository(): ApiCollectionRequestRepository
    {
        return $this->doctrine->getRepository(ApiCollectionRequest::class);
    }

    private function runHistoryRepository(): ApiCollectionRunHistoryRepository
    {
        return $this->doctrine->getRepository(ApiCollectionRunHistory::class);
    }
}
