<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Entity;

use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRequest;
use Aaxis\Bundle\ToolsBundle\Entity\Repository\ApiCollectionRequestRepository;
use Doctrine\ORM\Mapping as ORM;
use Oro\Bundle\UserBundle\Entity\User;
use PHPUnit\Framework\TestCase;

class ApiCollectionRequestTest extends TestCase
{
    public function testANewNodeIsAPrivateUnsavedRequestWithNoDetails(): void
    {
        $node = new ApiCollectionRequest();

        self::assertNull($node->getId());
        self::assertNull($node->getUser());
        self::assertFalse($node->isPublic());
        self::assertSame(ApiCollectionRequest::TYPE_REQUEST, $node->getType());
        self::assertFalse($node->isFolder());
        self::assertNull($node->getParentId());
        self::assertSame(0, $node->getPosition());
        foreach (['getName', 'getMethod', 'getUrl', 'getParams', 'getHeaders', 'getBodyType', 'getBody', 'getCreatedAt', 'getUpdatedAt'] as $getter) {
            self::assertNull($node->$getter(), $getter);
        }
    }

    public function testSettersStoreTheirValuesAndAreFluent(): void
    {
        $user = new User();
        $created = new \DateTime('2026-01-01');
        $updated = new \DateTimeImmutable('2026-02-02');
        $node = new ApiCollectionRequest();

        $result = $node
            ->setUser($user)
            ->setPublic(true)
            ->setType(ApiCollectionRequest::TYPE_FOLDER)
            ->setParentId(4)
            ->setPosition(9)
            ->setName('Orders')
            ->setMethod('POST')
            ->setUrl('https://api.example')
            ->setParams([['key' => 'a']])
            ->setHeaders([['key' => 'h']])
            ->setBodyType('json')
            ->setBody('{}')
            ->setCreatedAt($created)
            ->setUpdatedAt($updated);

        self::assertSame($node, $result);
        self::assertSame($user, $node->getUser());
        self::assertTrue($node->isPublic());
        self::assertSame('folder', $node->getType());
        self::assertTrue($node->isFolder());
        self::assertSame(4, $node->getParentId());
        self::assertSame(9, $node->getPosition());
        self::assertSame('Orders', $node->getName());
        self::assertSame('POST', $node->getMethod());
        self::assertSame('https://api.example', $node->getUrl());
        self::assertSame([['key' => 'a']], $node->getParams());
        self::assertSame([['key' => 'h']], $node->getHeaders());
        self::assertSame('json', $node->getBodyType());
        self::assertSame('{}', $node->getBody());
        self::assertSame($created, $node->getCreatedAt());
        self::assertSame($updated, $node->getUpdatedAt());
    }

    public function testNullableFieldsCanBeClearedAgain(): void
    {
        $node = (new ApiCollectionRequest())
            ->setUser(new User())->setParentId(1)->setMethod('GET')->setUrl('u')
            ->setParams([1])->setHeaders([1])->setBodyType('xml')->setBody('b');

        $node->setUser(null)->setParentId(null)->setMethod(null)->setUrl(null)
            ->setParams(null)->setHeaders(null)->setBodyType(null)->setBody(null);

        foreach (['getUser', 'getParentId', 'getMethod', 'getUrl', 'getParams', 'getHeaders', 'getBodyType', 'getBody'] as $getter) {
            self::assertNull($node->$getter(), $getter);
        }
    }

    public function testTheEntityIsMappedToItsRepository(): void
    {
        $attributes = (new \ReflectionClass(ApiCollectionRequest::class))->getAttributes(ORM\Entity::class);

        self::assertCount(1, $attributes);
        self::assertSame(ApiCollectionRequestRepository::class, $attributes[0]->getArguments()['repositoryClass']);
    }
}
