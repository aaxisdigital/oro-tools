<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Manager;

use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRequest;

/**
 * Turns the loosely typed payloads of the API Collection endpoints into node fields. Stateless
 * helper of {@see ApiCollectionManager}.
 *
 * @internal
 */
final class ApiCollectionNodeFields
{
    /**
     * Trims the name and caps it at the column length; a blank name becomes "Untitled".
     */
    public static function cleanName(string $name): string
    {
        $name = trim($name);

        return $name === '' ? 'Untitled' : mb_substr($name, 0, 255);
    }

    /**
     * Copies the supported request fields from a payload onto the node. Only keys actually present
     * are touched, so a partial payload leaves the rest of the request alone.
     *
     * @param array<string, mixed> $data
     */
    public static function applyRequestFields(ApiCollectionRequest $node, array $data): void
    {
        self::applyEndpointFields($node, $data);
        self::applyPayloadFields($node, $data);
    }

    /**
     * Where the request goes: method and URL.
     *
     * @param array<string, mixed> $data
     */
    private static function applyEndpointFields(ApiCollectionRequest $node, array $data): void
    {
        if (\array_key_exists('method', $data)) {
            $node->setMethod($data['method'] !== null ? mb_substr((string) $data['method'], 0, 10) : null);
        }
        if (\array_key_exists('url', $data)) {
            $node->setUrl($data['url'] !== null ? (string) $data['url'] : null);
        }
    }

    /**
     * What it sends: params, headers and body.
     *
     * @param array<string, mixed> $data
     */
    private static function applyPayloadFields(ApiCollectionRequest $node, array $data): void
    {
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
}
