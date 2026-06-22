<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Entity\Repository;

use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRunHistory;
use Doctrine\ORM\EntityRepository;

/**
 * @extends EntityRepository<ApiCollectionRunHistory>
 */
class ApiCollectionRunHistoryRepository extends EntityRepository
{
    /**
     * @return ApiCollectionRunHistory[]
     */
    public function findRecentForUser(?int $userId, int $limit): array
    {
        $qb = $this->createQueryBuilder('r')
            ->orderBy('r.runAt', 'DESC')
            ->setMaxResults($limit);
        if ($userId !== null) {
            $qb->where('r.user = :userId')->setParameter('userId', $userId);
        }

        return $qb->getQuery()->getResult();
    }
}
