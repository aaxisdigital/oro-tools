<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Http;

use Aaxis\Bundle\ToolsBundle\Http\LocalHostRewriter;
use Oro\Bundle\ConfigBundle\Config\ConfigManager;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\RequestStack;

class LocalHostRewriterTest extends TestCase
{
    private ConfigManager&MockObject $config;
    private RequestStack $requestStack;
    private LocalHostRewriter $rewriter;

    protected function setUp(): void
    {
        $this->config = $this->createMock(ConfigManager::class);
        $this->config->method('get')->with('aaxis_tools.api_collection_local_rewrite')->willReturn(true);
        $this->requestStack = new RequestStack();
        $this->rewriter = new LocalHostRewriter($this->config, $this->requestStack);
    }

    public function testDoesNothingWhenTheRewriteIsDisabled(): void
    {
        $config = $this->createMock(ConfigManager::class);
        $config->expects(self::once())->method('get')->with('aaxis_tools.api_collection_local_rewrite')->willReturn(false);
        $this->pushRequest('shop.example', '10.0.0.5');

        self::assertNull((new LocalHostRewriter($config, $this->requestStack))->rewrite('https://shop.example/x'));
    }

    public function testDoesNothingOutsideARequest(): void
    {
        self::assertNull($this->rewriter->rewrite('https://shop.example/x'));
    }

    public function testRewritesAnOwnHostHttpsUrlToTheLocalInterfaceKeepingTheHostHeader(): void
    {
        $this->pushRequest('shop.example', '10.0.0.5');

        self::assertSame(
            ['url' => 'https://10.0.0.5/api/orders?page=2#top', 'hostHeader' => 'shop.example'],
            $this->rewriter->rewrite('https://shop.example/api/orders?page=2#top')
        );
    }

    public function testTheHostComparisonIgnoresCaseAndThePortOfTheIncomingHost(): void
    {
        $this->pushRequest('Shop.Example:8443', '10.0.0.5');

        self::assertSame(
            ['url' => 'https://10.0.0.5/ping', 'hostHeader' => 'SHOP.example'],
            $this->rewriter->rewrite('https://SHOP.example/ping')
        );
    }

    public function testKeepsTheUrlPortAndForwardsItInTheHostHeader(): void
    {
        $this->pushRequest('shop.example', '10.0.0.5');

        self::assertSame(
            ['url' => 'https://10.0.0.5:8443/health', 'hostHeader' => 'shop.example:8443'],
            $this->rewriter->rewrite('https://shop.example:8443/health')
        );
    }

    public function testKeepsUrlCredentials(): void
    {
        $this->pushRequest('shop.example', '10.0.0.5');

        self::assertSame(
            'https://api:s3cret@10.0.0.5/v1',
            $this->rewriter->rewrite('https://api:s3cret@shop.example/v1')['url'] ?? null
        );
        self::assertSame(
            'https://api@10.0.0.5/v1',
            $this->rewriter->rewrite('https://api@shop.example/v1')['url'] ?? null
        );
    }

    public function testAUrlWithoutAPathRewritesToTheBareAuthority(): void
    {
        $this->pushRequest('shop.example', '10.0.0.5');

        self::assertSame('https://10.0.0.5', $this->rewriter->rewrite('https://shop.example')['url'] ?? null);
    }

    public function testWrapsAnIpv6ServerAddressInBrackets(): void
    {
        $this->pushRequest('shop.example', 'fe80::1');

        self::assertSame(
            ['url' => 'https://[fe80::1]/x', 'hostHeader' => 'shop.example'],
            $this->rewriter->rewrite('https://shop.example/x')
        );
    }

    public function testMatchesBracketedIpv6HostsWithAndWithoutAPort(): void
    {
        $this->pushRequest('[::1]:8080', '127.0.0.1');
        self::assertSame(
            ['url' => 'https://127.0.0.1/x', 'hostHeader' => '[::1]'],
            $this->rewriter->rewrite('https://[::1]/x')
        );
    }

    public function testMatchesABareIpv6HttpHost(): void
    {
        // Several colons means no port to strip.
        $this->pushRequest('::1', '127.0.0.1');

        self::assertNotNull($this->rewriter->rewrite('https://[::1]/x'));
    }

    /**
     * @dataProvider notApplicableProvider
     */
    public function testLeavesUrlsAloneThatDoNotTargetTheOwnHostOverHttps(string $url, string $httpHost, string $serverAddr): void
    {
        $this->pushRequest($httpHost, $serverAddr);

        self::assertNull($this->rewriter->rewrite($url));
    }

    /**
     * @return iterable<string, array{string, string, string}>
     */
    public static function notApplicableProvider(): iterable
    {
        yield 'plain http' => ['http://shop.example/x', 'shop.example', '10.0.0.5'];
        yield 'no scheme' => ['//shop.example/x', 'shop.example', '10.0.0.5'];
        yield 'another host' => ['https://other.example/x', 'shop.example', '10.0.0.5'];
        yield 'unparsable url' => ['https://', 'shop.example', '10.0.0.5'];
        yield 'no host in the url' => ['https:///path', 'shop.example', '10.0.0.5'];
        yield 'empty http host' => ['https://shop.example/x', '', '10.0.0.5'];
        yield 'missing server address' => ['https://shop.example/x', 'shop.example', ''];
        yield 'server address is not an ip' => ['https://shop.example/x', 'shop.example', 'localhost'];
    }

    private function pushRequest(string $httpHost, string $serverAddr): void
    {
        $server = ['HTTP_HOST' => $httpHost];
        if ($serverAddr !== '') {
            $server['SERVER_ADDR'] = $serverAddr;
        }
        $this->requestStack->push(new Request([], [], [], [], [], $server));
    }
}
