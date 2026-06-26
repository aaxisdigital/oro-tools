<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Http;

use Symfony\Contracts\HttpClient\HttpClientInterface;
use Symfony\Contracts\Service\ResetInterface;

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

        // The injected client is a shared singleton; reset it so no state (a cookie jar, pooled
        // keep-alive connections, DNS cache) from a previously proxied request leaks into this one.
        // Each proxied request must be independent — only the headers the user explicitly set are
        // sent, never a Set-Cookie picked up from an earlier response. Best-effort: a reset failure
        // must never abort the request the user actually asked for.
        if ($this->httpClient instanceof ResetInterface) {
            try {
                $this->httpClient->reset();
            } catch (\Throwable) {
                // ignore — isolation is best-effort, the request below still runs
            }
        }

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
        } catch (\Throwable $e) {
            // Catch everything (not just Symfony's ExceptionInterface) so the proxy always returns a
            // structured error the UI can show, never a bare HTTP 500 with no clear message.
            return [
                'success' => false,
                'error' => $e->getMessage() !== '' ? $e->getMessage() : $e::class,
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
                // Header values may also carry non-UTF-8 bytes — sanitize so JSON encoding can't 500.
                $flatHeaders[] = ['key' => $this->toUtf8((string) $name, ''), 'value' => $this->toUtf8($value, '')];
                if (mb_strtolower($name) === 'content-type' && $contentType === '') {
                    $contentType = $value;
                }
            }
        }

        // Report the true byte size of the response, then coerce the body to valid UTF-8 so it can
        // be JSON-encoded — a non-UTF-8 body (ISO-8859-1, binary, a multibyte char cut by the size
        // cap) otherwise makes JsonResponse throw "Malformed UTF-8 characters" and the endpoint 500s.
        $size = \strlen($content);

        return [
            'success' => true,
            'status' => $status,
            'statusText' => $this->reasonPhrase($status),
            'headers' => $flatHeaders,
            'body' => $this->toUtf8($content, $contentType),
            'contentType' => $contentType,
            'size' => $size,
            'truncated' => $truncated,
            'timeMs' => (int) round((microtime(true) - $startedAt) * 1000),
        ];
    }

    /**
     * Coerces an arbitrary response body into valid UTF-8 so it survives JSON encoding. When the
     * Content-Type declares a non-UTF-8 charset we transcode from it; otherwise (or on failure) we
     * drop invalid byte sequences. Binary payloads become lossy but the request no longer 500s.
     */
    private function toUtf8(string $content, string $contentType): string
    {
        if ($content === '' || mb_check_encoding($content, 'UTF-8')) {
            return $content;
        }

        $charset = '';
        if (preg_match('/charset\s*=\s*["\']?([^"\';\s]+)/i', $contentType, $matches) === 1) {
            $charset = $matches[1];
        }
        if ($charset !== '' && strcasecmp($charset, 'UTF-8') !== 0) {
            $converted = @mb_convert_encoding($content, 'UTF-8', $charset);
            if ($converted !== false && mb_check_encoding($converted, 'UTF-8')) {
                return $converted;
            }
        }

        // Last resort: substitute invalid byte sequences so the payload is always JSON-encodable.
        return mb_convert_encoding($content, 'UTF-8', 'UTF-8');
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
