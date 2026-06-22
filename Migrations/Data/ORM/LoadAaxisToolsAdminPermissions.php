<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Migrations\Data\ORM;

use Doctrine\Persistence\ObjectManager;
use Oro\Bundle\DistributionBundle\Handler\ApplicationState;
use Oro\Bundle\SecurityBundle\Migrations\Data\ORM\AbstractUpdatePermissions;
use Oro\Bundle\UserBundle\Entity\User;

/**
 * Grants the "Access Aaxis Tools" capability to the Administrator role so admins keep access to
 * the Aaxis Tools section after the access ACL is introduced.
 */
class LoadAaxisToolsAdminPermissions extends AbstractUpdatePermissions
{
    #[\Override]
    public function load(ObjectManager $manager): void
    {
        if (!$this->container->get(ApplicationState::class)->isInstalled()) {
            return;
        }

        $aclManager = $this->getAclManager();
        if (!$aclManager->isAclEnabled()) {
            return;
        }

        $this->enableActions(
            $aclManager,
            $this->getRole($manager, User::ROLE_ADMINISTRATOR),
            ['aaxis_tools']
        );

        $aclManager->flush();
    }
}
