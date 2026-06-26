<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Entity\Repository;

use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRequest;
use Doctrine\ORM\EntityRepository;

/**
 * @extends EntityRepository<ApiCollectionRequest>
 *
 * Tree visibility is computed in {@see \Aaxis\Bundle\ToolsBundle\Manager\ApiCollectionManager::getVisibleNodes()}
 * because it requires walking folder ancestors, which is awkward to express as a single query.
 */
class ApiCollectionRequestRepository extends EntityRepository
{
}
