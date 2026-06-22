<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Controller;

use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRequest;
use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRunHistory;
use Aaxis\Bundle\ToolsBundle\Http\ApiRequestExecutor;
use Aaxis\Bundle\ToolsBundle\Manager\ApiCollectionManager;
use Oro\Bundle\SecurityBundle\Attribute\CsrfProtection;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Persistence endpoints for the API Collection tool. Requests are executed client-side; the backend
 * only stores the collection tree (folders/requests) and the run history.
 */
class ApiCollectionController extends AbstractController
{
    #[Route(path: '/api-collection/tree', name: 'aaxis_tools_api_collection_tree', methods: ['GET'])]
    public function treeAction(): JsonResponse
    {
        $manager = $this->manager();
        $userId = $manager->getCurrentUserId();

        return new JsonResponse([
            'currentUserId' => $userId,
            'nodes' => array_map(fn (ApiCollectionRequest $n) => $this->serializeNode($n, $userId), $manager->getVisibleNodes()),
            'runs' => array_map($this->serializeRun(...), $manager->getRecentRuns()),
        ]);
    }

    #[Route(path: '/api-collection/node', name: 'aaxis_tools_api_collection_create', methods: ['POST'])]
    #[CsrfProtection]
    public function createAction(Request $request): JsonResponse
    {
        $payload = json_decode($request->getContent(), true);
        if (!\is_array($payload)) {
            return new JsonResponse(['success' => false, 'message' => 'Invalid payload.'], 400);
        }
        $manager = $this->manager();
        $node = $manager->createNode($payload);

        return new JsonResponse(['success' => true, 'node' => $this->serializeNode($node, $manager->getCurrentUserId())]);
    }

    #[Route(
        path: '/api-collection/node/{id}',
        name: 'aaxis_tools_api_collection_update',
        requirements: ['id' => '\d+'],
        methods: ['PUT', 'POST']
    )]
    #[CsrfProtection]
    public function updateAction(Request $request, int $id): JsonResponse
    {
        $manager = $this->manager();
        $node = $manager->findNode($id);
        if ($node === null) {
            return new JsonResponse(['success' => false, 'message' => 'Not found.'], 404);
        }
        $payload = json_decode($request->getContent(), true);
        if (!\is_array($payload)) {
            return new JsonResponse(['success' => false, 'message' => 'Invalid payload.'], 400);
        }
        try {
            $manager->updateNode($node, $payload);
        } catch (\RuntimeException $e) {
            return new JsonResponse(['success' => false, 'message' => $e->getMessage()], 403);
        }

        return new JsonResponse(['success' => true, 'node' => $this->serializeNode($node, $manager->getCurrentUserId())]);
    }

    #[Route(
        path: '/api-collection/node/{id}',
        name: 'aaxis_tools_api_collection_delete',
        requirements: ['id' => '\d+'],
        methods: ['DELETE']
    )]
    #[CsrfProtection]
    public function deleteAction(int $id): JsonResponse
    {
        $manager = $this->manager();
        $node = $manager->findNode($id);
        if ($node === null) {
            return new JsonResponse(['success' => false, 'message' => 'Not found.'], 404);
        }
        try {
            $manager->deleteNode($node);
        } catch (\RuntimeException $e) {
            return new JsonResponse(['success' => false, 'message' => $e->getMessage()], 403);
        }

        return new JsonResponse(['success' => true]);
    }

    #[Route(
        path: '/api-collection/node/{id}/duplicate',
        name: 'aaxis_tools_api_collection_duplicate',
        requirements: ['id' => '\d+'],
        methods: ['POST']
    )]
    #[CsrfProtection]
    public function duplicateAction(int $id): JsonResponse
    {
        $manager = $this->manager();
        $node = $manager->findNode($id);
        if ($node === null) {
            return new JsonResponse(['success' => false, 'message' => 'Not found.'], 404);
        }
        $copy = $manager->duplicateNode($node);

        return new JsonResponse(['success' => true, 'node' => $this->serializeNode($copy, $manager->getCurrentUserId())]);
    }

    #[Route(path: '/api-collection/run', name: 'aaxis_tools_api_collection_run', methods: ['POST'])]
    #[CsrfProtection]
    public function runAction(Request $request): JsonResponse
    {
        $payload = json_decode($request->getContent(), true);
        if (!\is_array($payload)) {
            return new JsonResponse(['success' => false, 'message' => 'Invalid payload.'], 400);
        }
        $manager = $this->manager();
        $manager->recordRun($payload);

        return new JsonResponse([
            'success' => true,
            'runs' => array_map($this->serializeRun(...), $manager->getRecentRuns()),
        ]);
    }

    /**
     * Executes the request server-side (proxy) to avoid browser CORS, records the run and
     * returns the response together with the refreshed run history.
     */
    #[Route(path: '/api-collection/execute', name: 'aaxis_tools_api_collection_execute', methods: ['POST'])]
    #[CsrfProtection]
    public function executeAction(Request $request): JsonResponse
    {
        $payload = json_decode($request->getContent(), true);
        if (!\is_array($payload)) {
            return new JsonResponse(['success' => false, 'message' => 'Invalid payload.'], 400);
        }

        $method = strtoupper((string) ($payload['method'] ?? 'GET')) ?: 'GET';
        $url = trim((string) ($payload['url'] ?? ''));
        if ($url === '') {
            return new JsonResponse(['success' => false, 'message' => 'A URL is required.'], 400);
        }

        $params = \is_array($payload['params'] ?? null) ? $payload['params'] : [];
        $headers = \is_array($payload['headers'] ?? null) ? $payload['headers'] : [];
        $bodyType = (string) ($payload['bodyType'] ?? 'none');
        $body = isset($payload['body']) ? (string) $payload['body'] : '';

        $url = $this->appendQuery($url, $params);
        $headers = $this->withDefaultContentType($headers, $bodyType);

        $result = $this->executor()->execute($method, $url, $headers, $body, (int) ($payload['timeout'] ?? 0));

        $manager = $this->manager();
        $manager->recordRun([
            'requestId' => $payload['requestId'] ?? null,
            'name' => $payload['name'] ?? null,
            'method' => $method,
            'url' => $url,
            'status' => $result['status'] ?? null,
            'result' => ($result['success'] ?? false) ? ApiCollectionRunHistory::RESULT_SUCCESS : ApiCollectionRunHistory::RESULT_ERROR,
            'sizeBytes' => $result['size'] ?? 0,
            'timeMs' => $result['timeMs'] ?? null,
        ]);

        return new JsonResponse([
            'success' => $result['success'] ?? false,
            'response' => $result,
            'runs' => array_map($this->serializeRun(...), $manager->getRecentRuns()),
        ]);
    }

    /**
     * @param array<int, array{key?: string, value?: string}> $params
     */
    private function appendQuery(string $url, array $params): string
    {
        $pairs = [];
        foreach ($params as $param) {
            $key = trim((string) ($param['key'] ?? ''));
            if ($key !== '') {
                $pairs[] = rawurlencode($key) . '=' . rawurlencode((string) ($param['value'] ?? ''));
            }
        }
        if ($pairs === []) {
            return $url;
        }

        return $url . (str_contains($url, '?') ? '&' : '?') . implode('&', $pairs);
    }

    /**
     * @param array<int, array{key?: string, value?: string}> $headers
     *
     * @return array<int, array{key: string, value: string}>
     */
    private function withDefaultContentType(array $headers, string $bodyType): array
    {
        $hasContentType = false;
        $normalized = [];
        foreach ($headers as $header) {
            $key = trim((string) ($header['key'] ?? ''));
            if ($key === '') {
                continue;
            }
            if (mb_strtolower($key) === 'content-type') {
                $hasContentType = true;
            }
            $normalized[] = ['key' => $key, 'value' => (string) ($header['value'] ?? '')];
        }

        $defaultType = match ($bodyType) {
            'json' => 'application/json',
            'xml' => 'application/xml',
            'form' => 'application/x-www-form-urlencoded',
            default => null,
        };
        if (!$hasContentType && $defaultType !== null) {
            $normalized[] = ['key' => 'Content-Type', 'value' => $defaultType];
        }

        return $normalized;
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeNode(ApiCollectionRequest $node, ?int $currentUserId): array
    {
        return [
            'id' => $node->getId(),
            'type' => $node->getType(),
            'name' => $node->getName(),
            'parentId' => $node->getParentId(),
            'public' => $node->isPublic(),
            'owned' => $node->getUser() === null || ($currentUserId !== null && $node->getUser()->getId() === $currentUserId),
            'method' => $node->getMethod(),
            'url' => $node->getUrl(),
            'params' => $node->getParams() ?? [],
            'headers' => $node->getHeaders() ?? [],
            'bodyType' => $node->getBodyType() ?? 'none',
            'body' => $node->getBody() ?? '',
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function serializeRun(ApiCollectionRunHistory $run): array
    {
        return [
            'id' => $run->getId(),
            'name' => $run->getName(),
            'method' => $run->getMethod(),
            'url' => $run->getUrl(),
            'status' => $run->getStatus(),
            'result' => $run->getResult(),
            'sizeBytes' => $run->getSizeBytes(),
            'timeMs' => $run->getTimeMs(),
            'runAt' => $run->getRunAt()?->format(\DateTimeInterface::ATOM),
        ];
    }

    private function manager(): ApiCollectionManager
    {
        return $this->container->get(ApiCollectionManager::class);
    }

    private function executor(): ApiRequestExecutor
    {
        return $this->container->get(ApiRequestExecutor::class);
    }

    #[\Override]
    public static function getSubscribedServices(): array
    {
        return array_merge(parent::getSubscribedServices(), [
            ApiCollectionManager::class,
            ApiRequestExecutor::class,
        ]);
    }
}
