<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Manager;

use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRequest;
use Aaxis\Bundle\ToolsBundle\Manager\ApiCollectionNodeFields;
use PHPUnit\Framework\TestCase;

class ApiCollectionNodeFieldsTest extends TestCase
{
    /**
     * @dataProvider nameProvider
     */
    public function testCleanName(string $raw, string $expected): void
    {
        self::assertSame($expected, ApiCollectionNodeFields::cleanName($raw));
    }

    /**
     * @return iterable<string, array{string, string}>
     */
    public static function nameProvider(): iterable
    {
        yield 'trimmed' => ["  Orders \n", 'Orders'];
        yield 'blank becomes untitled' => ['   ', 'Untitled'];
        yield 'empty becomes untitled' => ['', 'Untitled'];
        yield 'capped by characters, not bytes' => [str_repeat('ñ', 300), str_repeat('ñ', 255)];
        yield 'inner spaces are kept' => ['a  b', 'a  b'];
    }

    public function testAppliesOnlyThePresentKeys(): void
    {
        $node = (new ApiCollectionRequest())->setMethod('GET')->setUrl('https://old.example')->setBody('old');

        ApiCollectionNodeFields::applyRequestFields($node, ['url' => 'https://new.example', 'unknown' => 'ignored']);

        self::assertSame('GET', $node->getMethod());
        self::assertSame('https://new.example', $node->getUrl());
        self::assertSame('old', $node->getBody());
    }

    public function testCoercesScalarsAndDropsNonArrayCollections(): void
    {
        $node = new ApiCollectionRequest();

        ApiCollectionNodeFields::applyRequestFields($node, [
            'method' => 'OPTIONS-EXTRA-LONG',
            'url' => 8080,
            'params' => 'not-an-array',
            'headers' => [['key' => 'a', 'value' => 'b']],
            'bodyType' => 7,
            'body' => 1.5,
        ]);

        self::assertSame('OPTIONS-EX', $node->getMethod());
        self::assertSame('8080', $node->getUrl());
        self::assertNull($node->getParams());
        self::assertSame([['key' => 'a', 'value' => 'b']], $node->getHeaders());
        self::assertSame('7', $node->getBodyType());
        self::assertSame('1.5', $node->getBody());
    }

    public function testNullValuesClearTheFields(): void
    {
        $node = (new ApiCollectionRequest())->setMethod('GET')->setUrl('u')->setParams([1])->setHeaders([1])->setBodyType('json')->setBody('b');

        ApiCollectionNodeFields::applyRequestFields($node, [
            'method' => null, 'url' => null, 'params' => null, 'headers' => null, 'bodyType' => null, 'body' => null,
        ]);

        foreach (['getMethod', 'getUrl', 'getParams', 'getHeaders', 'getBodyType', 'getBody'] as $getter) {
            self::assertNull($node->$getter(), $getter);
        }
    }
}
