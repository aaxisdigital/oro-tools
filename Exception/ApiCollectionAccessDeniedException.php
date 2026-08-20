<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Exception;

/**
 * Thrown when the current user may not view or modify an API collection node.
 *
 * Extends \RuntimeException so ApiCollectionController's existing catches keep turning this into a
 * 403 response with the message intact.
 */
class ApiCollectionAccessDeniedException extends \RuntimeException
{
}
