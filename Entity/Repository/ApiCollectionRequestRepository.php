<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Entity\Repository;

use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRequest;
use Doctrine\ORM\EntityRepository;

/**
 * @extends EntityRepository<ApiCollectionRequest>
 */
class ApiCollectionRequestRepository extends EntityRepository
{
    /**
     * All nodes visible to the user: their own plus any public ones.
     *
     * @return ApiCollectionRequest[]
     */
    public function findVisibleForUser(?int $userId): array
    {
        $qb = $this->createQueryBuilder('n')->orderBy('n.position', 'ASC')->addOrderBy('n.name', 'ASC');
        if ($userId !== null) {
            $qb->where('n.public = true')->orWhere('n.user = :userId')->setParameter('userId', $userId);
        } else {
            $qb->where('n.public = true');
        }

        return $qb->getQuery()->getResult();
    }
}
