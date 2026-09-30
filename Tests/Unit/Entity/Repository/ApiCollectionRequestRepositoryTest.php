<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Entity\Repository;

use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRequest;
use Aaxis\Bundle\ToolsBundle\Entity\Repository\ApiCollectionRequestRepository;
use Doctrine\ORM\EntityManagerInterface;
use Doctrine\ORM\EntityRepository;
use Doctrine\ORM\Mapping\ClassMetadata;
use PHPUnit\Framework\TestCase;

class ApiCollectionRequestRepositoryTest extends TestCase
{
    public function testItIsAPlainRepositoryBoundToTheRequestEntity(): void
    {
        $em = $this->createMock(EntityManagerInterface::class);

        $repository = new ApiCollectionRequestRepository($em, new ClassMetadata(ApiCollectionRequest::class));

        self::assertInstanceOf(EntityRepository::class, $repository);
        self::assertSame(ApiCollectionRequest::class, $repository->getClassName());
        // Visibility is resolved in ApiCollectionManager; the repository adds no query logic of its own.
        $own = array_filter(
            (new \ReflectionClass(ApiCollectionRequestRepository::class))->getMethods(),
            static fn (\ReflectionMethod $m): bool => $m->getDeclaringClass()->getName() === ApiCollectionRequestRepository::class
        );
        self::assertSame([], array_values($own));
    }
}
