<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Entity\Repository;

use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRunHistory;
use Aaxis\Bundle\ToolsBundle\Entity\Repository\ApiCollectionRunHistoryRepository;
use Doctrine\Common\Collections\ArrayCollection;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\Mapping\ClassMetadata;
use Doctrine\ORM\Query;
use Doctrine\ORM\Query\Parameter;
use Doctrine\ORM\QueryBuilder;
use PHPUnit\Framework\TestCase;

class ApiCollectionRunHistoryRepositoryTest extends TestCase
{
    private ?string $dql = null;
    private ?ArrayCollection $parameters = null;
    private mixed $maxResults = 'unset';

    public function testFindsTheLatestRunsOfOneUserNewestFirst(): void
    {
        $runs = [new ApiCollectionRunHistory()];

        $result = $this->repository($runs)->findRecentForUser(7, 25);

        self::assertSame($runs, $result);
        self::assertSame(
            'SELECT r FROM ' . ApiCollectionRunHistory::class . ' r WHERE r.user = :userId ORDER BY r.runAt DESC',
            $this->dql
        );
        self::assertSame(25, $this->maxResults);
        self::assertNotNull($this->parameters);
        self::assertCount(1, $this->parameters);
        $parameter = $this->parameters->first();
        self::assertInstanceOf(Parameter::class, $parameter);
        self::assertSame('userId', $parameter->getName());
        self::assertSame(7, $parameter->getValue());
    }

    public function testWithoutAUserItReturnsTheLatestRunsOfEveryone(): void
    {
        $this->repository([])->findRecentForUser(null, 10);

        self::assertSame(
            'SELECT r FROM ' . ApiCollectionRunHistory::class . ' r ORDER BY r.runAt DESC',
            $this->dql
        );
        self::assertSame(10, $this->maxResults);
        self::assertCount(0, $this->parameters);
    }

    /**
     * @param array<int, ApiCollectionRunHistory> $rows
     */
    private function repository(array $rows): ApiCollectionRunHistoryRepository
    {
        $query = $this->createMock(Query::class);
        $query->method('setParameters')->willReturnCallback(function (ArrayCollection $parameters) use ($query): Query {
            $this->parameters = $parameters;

            return $query;
        });
        $query->method('setFirstResult')->willReturnSelf();
        $query->method('setMaxResults')->willReturnCallback(function (mixed $max) use ($query): Query {
            $this->maxResults = $max;

            return $query;
        });
        $query->method('getResult')->willReturn($rows);

        $em = $this->createMock(EntityManagerInterface::class);
        $em->method('createQueryBuilder')->willReturnCallback(static fn () => new QueryBuilder($em));
        $em->method('createQuery')->willReturnCallback(function (string $dql) use ($query): Query {
            $this->dql = $dql;

            return $query;
        });

        return new ApiCollectionRunHistoryRepository($em, new ClassMetadata(ApiCollectionRunHistory::class));
    }
}
