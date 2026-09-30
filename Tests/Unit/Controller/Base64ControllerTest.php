<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Controller;

use Aaxis\Bundle\ToolsBundle\Controller\Base64Controller;
use PHPUnit\Framework\TestCase;
use Symfony\Bridge\Twig\Attribute\Template;
use Symfony\Component\Routing\Attribute\Route;

class Base64ControllerTest extends TestCase
{
    public function testThePageIsRenderedWithoutAnyServerSideData(): void
    {
        // The conversion runs entirely in the browser, so the template gets no variables.
        self::assertSame([], (new Base64Controller())->indexAction());
    }

    public function testThePageIsRoutedAndUsesItsTemplate(): void
    {
        $method = new \ReflectionMethod(Base64Controller::class, 'indexAction');

        $route = $method->getAttributes(Route::class)[0]->newInstance();
        $template = $method->getAttributes(Template::class)[0]->newInstance();

        self::assertSame('aaxis_tools_base64', $route->name);
        self::assertSame('/base64', $route->path);
        self::assertSame('@AaxisTools/Tools/base64.html.twig', $template->template);
    }
}
