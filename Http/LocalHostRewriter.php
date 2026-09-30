<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Http;

use Oro\Bundle\ConfigBundle\Config\ConfigManager;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;

/**
 * Work-around for hairpin / NAT-loopback setups where the application's public hostname is not
 * reachable from inside its own server or container: when enabled via config
 * (`aaxis_tools.api_collection_local_rewrite`, default OFF) and an API Collection request targets
 * `https://<our own HTTP_HOST>/...`, the URL host is replaced with the local interface IP that
 * received the current request (SERVER_ADDR — the value the Dev Tools "Connection Info" page shows
 * as "Connection arrived on local interface / IP"). The original hostname is kept as the outgoing
 * Host header so name-based vhosts still route to the application; the executor already disables
 * TLS verification, so the certificate/IP mismatch does not break the call.
 */
class LocalHostRewriter
{
    public function __construct(
        private readonly ConfigManager $configManager,
        private readonly RequestStack $requestStack,
    ) {
    }

    /**
     * @return array{url: string, hostHeader: string}|null the rewritten URL plus the Host header to
     *                                                     send, or null when the rewrite does not apply
     */
    public function rewrite(string $url): ?array
    {
        $request = $this->requestStack->getMainRequest();
        if ($request === null || !$this->configManager->get('aaxis_tools.api_collection_local_rewrite')) {
            return null;
        }

        $parts = $this->ownHostHttpsParts($url, $request);
        $serverAddr = (string) $request->server->get('SERVER_ADDR', '');
        if ($parts === null || filter_var($serverAddr, FILTER_VALIDATE_IP) === false) {
            return null;
        }
        // IPv6 literals need brackets inside a URL authority.
        $ipForUrl = str_contains($serverAddr, ':') ? '[' . $serverAddr . ']' : $serverAddr;

        $auth = '';
        if (isset($parts['user'])) {
            $auth = $parts['user'] . (isset($parts['pass']) ? ':' . $parts['pass'] : '') . '@';
        }

        return [
            'url' => 'https://' . $auth . $ipForUrl
                . (isset($parts['port']) ? ':' . $parts['port'] : '')
                . ($parts['path'] ?? '')
                . (isset($parts['query']) ? '?' . $parts['query'] : '')
                . (isset($parts['fragment']) ? '#' . $parts['fragment'] : ''),
            'hostHeader' => $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : ''),
        ];
    }

    /**
     * The parsed URL when it is an https URL for this very application host (HTTP_HOST), else null.
     *
     * @return array<string, int|string>|null
     */
    private function ownHostHttpsParts(string $url, Request $request): ?array
    {
        $parts = parse_url($url);
        if (!\is_array($parts) || strtolower($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])) {
            return null;
        }

        $urlHost = $this->normalizeHost($parts['host']);
        $httpHost = $this->normalizeHost($this->stripPort((string) $request->server->get('HTTP_HOST', '')));
        if ($urlHost === '' || $urlHost !== $httpHost) {
            return null;
        }

        return $parts;
    }

    /** Lowercases and strips IPv6 brackets so hosts from different sources compare equal. */
    private function normalizeHost(string $host): string
    {
        return strtolower(trim($host, '[]'));
    }

    /** Strips a trailing :port, leaving bare IPv6 (which contains multiple colons) intact. */
    private function stripPort(string $host): string
    {
        if (str_starts_with($host, '[')) {
            // "[::1]:8080" -> "[::1]"
            return (string) preg_replace('/\]:\d+$/', ']', $host);
        }

        return substr_count($host, ':') === 1 ? (string) preg_replace('/:\d+$/', '', $host) : $host;
    }
}
