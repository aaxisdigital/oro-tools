<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Controller;

use Symfony\Bridge\Twig\Attribute\Template;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\Routing\Attribute\Route;

/**
 * Base64 tool page. The encode/decode/detect logic runs entirely client-side (see
 * base64-component.js): nothing is uploaded, conversion is live, and binary decode results are
 * offered as a download.
 */
class Base64Controller extends AbstractController
{
    #[Route(path: '/base64', name: 'aaxis_tools_base64')]
    #[Template('@AaxisTools/Tools/base64.html.twig')]
    public function indexAction(): array
    {
        return [];
    }
}
