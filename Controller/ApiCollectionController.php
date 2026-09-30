<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Controller;

use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRequest;
use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRunHistory;
use Aaxis\Bundle\ToolsBundle\Http\ApiRequestExecutor;
use Aaxis\Bundle\ToolsBundle\Http\LocalHostRewriter;
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
    /** Body could not be decoded as a JSON object. */
    private const string MSG_INVALID_PAYLOAD = 'Invalid payload.';

    /** Node does not exist, or is not visible to the current user. */
    private const string MSG_NOT_FOUND = 'Not found.';

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
            return new JsonResponse(['success' => false, 'message' => self::MSG_INVALID_PAYLOAD], 400);
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
        if ($node === null || !$manager->canView($node)) {
            return new JsonResponse(['success' => false, 'message' => self::MSG_NOT_FOUND], 404);
        }
        $payload = json_decode($request->getContent(), true);
        if (!\is_array($payload)) {
            return new JsonResponse(['success' => false, 'message' => self::MSG_INVALID_PAYLOAD], 400);
        }

        return $this->applyUpdate($manager, $node, $payload);
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function applyUpdate(ApiCollectionManager $manager, ApiCollectionRequest $node, array $payload): JsonResponse
    {
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
        if ($node === null || !$manager->canView($node)) {
            return new JsonResponse(['success' => false, 'message' => self::MSG_NOT_FOUND], 404);
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
        if ($node === null || !$manager->canView($node)) {
            return new JsonResponse(['success' => false, 'message' => self::MSG_NOT_FOUND], 404);
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
            return new JsonResponse(['success' => false, 'message' => self::MSG_INVALID_PAYLOAD], 400);
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
            return new JsonResponse(['success' => false, 'message' => self::MSG_INVALID_PAYLOAD], 400);
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

        // Optional own-host -> local-IP rewrite (config-gated, default off). Transport-level only:
        // the run history below still records the URL the user asked for.
        $targetUrl = $url;
        $hostOverride = null;
        $rewrite = $this->localHostRewriter()->rewrite($url);
        if ($rewrite !== null) {
            $targetUrl = $rewrite['url'];
            $hostOverride = $rewrite['hostHeader'];
        }

        $result = $this->executor()->execute($method, $targetUrl, $headers, $body, (int) ($payload['timeout'] ?? 0), $hostOverride);

        $manager = $this->manager();
        $response = [
            'success' => $result['success'] ?? false,
            'response' => $result,
        ];

        // The proxied request already ran — persisting/fetching the run history is secondary, so a
        // storage failure must not turn a successful request into a 500. Omit "runs" on failure;
        // the UI keeps its current history list when the key is absent.
        try {
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
            $response['runs'] = array_map($this->serializeRun(...), $manager->getRecentRuns());
        } catch (\Throwable) {
            // run history is best-effort; the response above is still returned
        }

        return new JsonResponse($response);
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

    private function localHostRewriter(): LocalHostRewriter
    {
        return $this->container->get(LocalHostRewriter::class);
    }

    #[\Override]
    public static function getSubscribedServices(): array
    {
        return array_merge(parent::getSubscribedServices(), [
            ApiCollectionManager::class,
            ApiRequestExecutor::class,
            LocalHostRewriter::class,
        ]);
    }
}
