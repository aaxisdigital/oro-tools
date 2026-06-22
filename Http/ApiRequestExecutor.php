<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Http;

use Symfony\Contracts\HttpClient\Exception\ExceptionInterface;
use Symfony\Contracts\HttpClient\HttpClientInterface;

/**
 * Performs an HTTP request server-side (proxy) so the browser is not subject to CORS.
 *
 * SECURITY: this lets an authenticated backend user make the server issue arbitrary outbound
 * HTTP requests (SSRF surface). It is gated by the API Collection feature toggle, mirrors the
 * risk profile of the existing Network Tools curl, and should only be exposed in trusted setups.
 */
class ApiRequestExecutor
{
    private const int MAX_TIMEOUT = 120;
    private const int DEFAULT_TIMEOUT = 30;
    private const int MAX_BODY_BYTES = 5_242_880; // 5 MiB cap on the returned body

    /** @var string[] Hop-by-hop / unsafe headers that must not be forwarded. */
    private const array BLOCKED_HEADERS = [
        'host', 'content-length', 'connection', 'keep-alive', 'proxy-authenticate',
        'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
    ];

    public function __construct(
        private readonly HttpClientInterface $httpClient,
    ) {
    }

    /**
     * @param array<int, array{key: string, value: string}> $headers
     *
     * @return array<string, mixed>
     */
    public function execute(string $method, string $url, array $headers, ?string $body, int $timeout): array
    {
        $startedAt = microtime(true);

        $headerLines = [];
        foreach ($headers as $header) {
            $key = trim((string) ($header['key'] ?? ''));
            if ($key === '' || \in_array(mb_strtolower($key), self::BLOCKED_HEADERS, true)) {
                continue;
            }
            $headerLines[$key] = (string) ($header['value'] ?? '');
        }

        $options = [
            'headers' => $headerLines,
            'timeout' => $this->clampTimeout($timeout),
            'max_redirects' => 5,
            'verify_peer' => false,
            'verify_host' => false,
        ];
        $upperMethod = strtoupper($method) ?: 'GET';
        if ($body !== null && $body !== '' && $upperMethod !== 'GET' && $upperMethod !== 'HEAD') {
            $options['body'] = $body;
        }

        try {
            $response = $this->httpClient->request($upperMethod, $url, $options);
            $status = $response->getStatusCode();
            $responseHeaders = $response->getHeaders(false);
            $content = $response->getContent(false);
        } catch (ExceptionInterface $e) {
            return [
                'success' => false,
                'error' => $e->getMessage(),
                'timeMs' => (int) round((microtime(true) - $startedAt) * 1000),
            ];
        }

        $truncated = false;
        if (\strlen($content) > self::MAX_BODY_BYTES) {
            $content = substr($content, 0, self::MAX_BODY_BYTES);
            $truncated = true;
        }

        $flatHeaders = [];
        $contentType = '';
        foreach ($responseHeaders as $name => $values) {
            foreach ($values as $value) {
                $flatHeaders[] = ['key' => $name, 'value' => $value];
                if (mb_strtolower($name) === 'content-type' && $contentType === '') {
                    $contentType = $value;
                }
            }
        }

        return [
            'success' => true,
            'status' => $status,
            'statusText' => $this->reasonPhrase($status),
            'headers' => $flatHeaders,
            'body' => $content,
            'contentType' => $contentType,
            'size' => \strlen($content),
            'truncated' => $truncated,
            'timeMs' => (int) round((microtime(true) - $startedAt) * 1000),
        ];
    }

    private function clampTimeout(int $timeout): int
    {
        if ($timeout <= 0) {
            return self::DEFAULT_TIMEOUT;
        }

        return min($timeout, self::MAX_TIMEOUT);
    }

    private function reasonPhrase(int $status): string
    {
        return \Symfony\Component\HttpFoundation\Response::$statusTexts[$status] ?? '';
    }
}
