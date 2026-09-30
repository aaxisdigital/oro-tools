<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Entity;

use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRunHistory;
use Aaxis\Bundle\ToolsBundle\Entity\Repository\ApiCollectionRunHistoryRepository;
use Doctrine\ORM\Mapping as ORM;
use Oro\Bundle\UserBundle\Entity\User;
use PHPUnit\Framework\TestCase;

class ApiCollectionRunHistoryTest extends TestCase
{
    public function testANewRunHasNoDetails(): void
    {
        $run = new ApiCollectionRunHistory();

        foreach (['getId', 'getUser', 'getRequestId', 'getName', 'getMethod', 'getUrl', 'getRunAt', 'getStatus', 'getResult', 'getSizeBytes', 'getTimeMs'] as $getter) {
            self::assertNull($run->$getter(), $getter);
        }
    }

    public function testSettersStoreTheirValuesAndAreFluent(): void
    {
        $user = new User();
        $runAt = new \DateTimeImmutable('2026-03-03 10:00:00');
        $run = new ApiCollectionRunHistory();

        $result = $run
            ->setUser($user)
            ->setRequestId(12)
            ->setName('List orders')
            ->setMethod('GET')
            ->setUrl('https://api.example/orders')
            ->setRunAt($runAt)
            ->setStatus(200)
            ->setResult(ApiCollectionRunHistory::RESULT_SUCCESS)
            ->setSizeBytes(2048)
            ->setTimeMs(35);

        self::assertSame($run, $result);
        self::assertSame($user, $run->getUser());
        self::assertSame(12, $run->getRequestId());
        self::assertSame('List orders', $run->getName());
        self::assertSame('GET', $run->getMethod());
        self::assertSame('https://api.example/orders', $run->getUrl());
        self::assertSame($runAt, $run->getRunAt());
        self::assertSame(200, $run->getStatus());
        self::assertSame('success', $run->getResult());
        self::assertSame(2048, $run->getSizeBytes());
        self::assertSame(35, $run->getTimeMs());
    }

    public function testNullableFieldsCanBeClearedAgain(): void
    {
        $run = (new ApiCollectionRunHistory())
            ->setUser(new User())->setRequestId(1)->setName('n')->setStatus(500)
            ->setResult(ApiCollectionRunHistory::RESULT_ERROR)->setSizeBytes(1)->setTimeMs(1);

        $run->setUser(null)->setRequestId(null)->setName(null)->setStatus(null)
            ->setResult(null)->setSizeBytes(null)->setTimeMs(null);

        foreach (['getUser', 'getRequestId', 'getName', 'getStatus', 'getResult', 'getSizeBytes', 'getTimeMs'] as $getter) {
            self::assertNull($run->$getter(), $getter);
        }
    }

    public function testResultConstantsMatchTheStoredValues(): void
    {
        self::assertSame('success', ApiCollectionRunHistory::RESULT_SUCCESS);
        self::assertSame('error', ApiCollectionRunHistory::RESULT_ERROR);
    }

    public function testTheEntityIsMappedToItsRepository(): void
    {
        $attributes = (new \ReflectionClass(ApiCollectionRunHistory::class))->getAttributes(ORM\Entity::class);

        self::assertCount(1, $attributes);
        self::assertSame(ApiCollectionRunHistoryRepository::class, $attributes[0]->getArguments()['repositoryClass']);
    }
}
