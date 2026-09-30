<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Http;

use Aaxis\Bundle\ToolsBundle\Http\ApiRequestExecutor;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Component\HttpClient\Response\MockResponse;
use Symfony\Contracts\HttpClient\HttpClientInterface;
use Symfony\Contracts\HttpClient\ResponseInterface;
use Symfony\Contracts\HttpClient\ResponseStreamInterface;

class ApiRequestExecutorTest extends TestCase
{
    /** @var list<array{method: string, url: string, options: array<string, mixed>}> */
    private array $calls = [];

    public function testReturnsTheProxiedResponseInTheUiShape(): void
    {
        $executor = $this->executorAnswering(new MockResponse('{"ok":true}', [
            'http_code' => 201,
            'response_headers' => ['Content-Type: application/json; charset=utf-8', 'X-Trace: abc', 'X-Trace: def'],
        ]));

        $result = $executor->execute('post', 'https://api.example/items', [], '{"a":1}', 10);

        self::assertTrue($result['success']);
        self::assertSame(201, $result['status']);
        self::assertSame('Created', $result['statusText']);
        self::assertSame('{"ok":true}', $result['body']);
        self::assertSame('application/json; charset=utf-8', $result['contentType']);
        self::assertSame(11, $result['size']);
        self::assertFalse($result['truncated']);
        self::assertIsInt($result['timeMs']);
        self::assertGreaterThanOrEqual(0, $result['timeMs']);
        // Each header value becomes its own key/value row, in arrival order.
        self::assertContains(['key' => 'x-trace', 'value' => 'abc'], $result['headers']);
        self::assertContains(['key' => 'x-trace', 'value' => 'def'], $result['headers']);
        self::assertContains(['key' => 'content-type', 'value' => 'application/json; charset=utf-8'], $result['headers']);
    }

    public function testHttpErrorStatusesAreStillReportedAsAProxiedResponse(): void
    {
        $executor = $this->executorAnswering(new MockResponse('nope', ['http_code' => 404]));

        $result = $executor->execute('GET', 'https://api.example/missing', [], null, 0);

        self::assertTrue($result['success']);
        self::assertSame(404, $result['status']);
        self::assertSame('Not Found', $result['statusText']);
        self::assertSame('nope', $result['body']);
    }

    public function testAnUnknownStatusHasNoReasonPhrase(): void
    {
        $executor = $this->executorAnswering(new MockResponse('', ['http_code' => 599]));

        self::assertSame('', $executor->execute('GET', 'https://api.example', [], null, 0)['statusText']);
    }

    public function testTheFirstContentTypeWinsIrrespectiveOfHeaderNameCase(): void
    {
        $executor = $this->executorAnswering(new MockResponse('x', [
            'response_headers' => ['X-A: 1', 'CONTENT-TYPE: text/plain', 'Content-Type: text/html'],
        ]));

        self::assertSame('text/plain', $executor->execute('GET', 'https://api.example', [], null, 0)['contentType']);
    }

    public function testSendsTheRequestWithBoundedTimeoutsAndNoTlsVerification(): void
    {
        $executor = $this->executorAnswering(new MockResponse(''));

        $executor->execute('get', 'https://api.example/x?y=1', [], null, 15);

        self::assertSame('GET', $this->calls[0]['method']);
        self::assertSame('https://api.example/x?y=1', $this->calls[0]['url']);
        $options = $this->calls[0]['options'];
        self::assertSame(15.0, (float) $options['timeout']);
        self::assertSame(5, $options['max_redirects']);
        self::assertFalse($options['verify_peer']);
        self::assertFalse($options['verify_host']);
    }

    /**
     * @dataProvider timeoutProvider
     */
    public function testClampsTheTimeout(int $requested, int $expected): void
    {
        $executor = $this->executorAnswering(new MockResponse(''));

        $executor->execute('GET', 'https://api.example', [], null, $requested);

        self::assertSame((float) $expected, (float) $this->calls[0]['options']['timeout']);
    }

    /**
     * @return iterable<string, array{int, int}>
     */
    public static function timeoutProvider(): iterable
    {
        yield 'zero uses the default' => [0, 30];
        yield 'negative uses the default' => [-5, 30];
        yield 'in range is kept' => [45, 45];
        yield 'the maximum is kept' => [120, 120];
        yield 'above the maximum is capped' => [900, 120];
    }

    public function testAnEmptyMethodDefaultsToGet(): void
    {
        $executor = $this->executorAnswering(new MockResponse(''));

        $executor->execute('', 'https://api.example', [], null, 0);

        self::assertSame('GET', $this->calls[0]['method']);
    }

    public function testForwardsUserHeadersButDropsBlockedAndBlankOnes(): void
    {
        $executor = $this->executorAnswering(new MockResponse(''));

        $executor->execute('GET', 'https://api.example', [
            ['key' => ' X-Api-Key ', 'value' => 'k1'],
            ['key' => 'Host', 'value' => 'evil.example'],
            ['key' => 'Content-LENGTH', 'value' => '5'],
            ['key' => 'Transfer-Encoding', 'value' => 'chunked'],
            ['key' => 'Connection', 'value' => 'close'],
            ['key' => 'Proxy-Authorization', 'value' => 'x'],
            ['key' => 'Upgrade', 'value' => 'websocket'],
            ['key' => '   ', 'value' => 'blank key'],
            ['value' => 'no key'],
            ['key' => 'X-No-Value'],
        ], null, 0);

        $headers = $this->calls[0]['options']['normalized_headers'];
        self::assertSame(['x-api-key', 'x-no-value'], array_values(array_filter(
            array_keys($headers),
            static fn (string $name): bool => str_starts_with($name, 'x-')
        )));
        self::assertSame(['X-Api-Key: k1'], $headers['x-api-key']);
        self::assertSame(['X-No-Value: '], $headers['x-no-value']);
        foreach (['host', 'content-length', 'transfer-encoding', 'connection', 'proxy-authorization', 'upgrade'] as $blocked) {
            self::assertArrayNotHasKey($blocked, $headers, $blocked);
        }
    }

    public function testTheHostOverrideFromTheRewriterIsTheOnlyHostHeaderSent(): void
    {
        $executor = $this->executorAnswering(new MockResponse(''));

        $executor->execute('GET', 'https://10.0.0.5/x', [['key' => 'Host', 'value' => 'user.example']], null, 0, 'shop.example');

        self::assertSame(['Host: shop.example'], $this->calls[0]['options']['normalized_headers']['host']);
    }

    public function testAnEmptyHostOverrideIsIgnored(): void
    {
        $executor = $this->executorAnswering(new MockResponse(''));

        $executor->execute('GET', 'https://10.0.0.5/x', [], null, 0, '');

        self::assertArrayNotHasKey('host', $this->calls[0]['options']['normalized_headers']);
    }

    /**
     * @dataProvider bodyProvider
     */
    public function testSendsTheBodyOnlyWhereItMakesSense(string $method, ?string $body, ?string $expectedBody): void
    {
        $executor = $this->executorAnswering(new MockResponse(''));

        $executor->execute($method, 'https://api.example', [], $body, 0);

        self::assertSame($expectedBody, $this->calls[0]['options']['body'] ?? null);
    }

    /**
     * @return iterable<string, array{string, string|null, string|null}>
     */
    public static function bodyProvider(): iterable
    {
        yield 'POST with a body' => ['POST', 'a=1', 'a=1'];
        yield 'PUT with a body' => ['PUT', '{}', '{}'];
        yield 'DELETE with a body' => ['DELETE', 'x', 'x'];
        yield 'GET never sends one' => ['GET', 'a=1', null];
        yield 'HEAD never sends one' => ['head', 'a=1', null];
        yield 'POST without a body' => ['POST', null, null];
        yield 'POST with an empty body' => ['POST', '', null];
    }

    public function testATruncatedBodyIsCappedAtFiveMebibytesAndFlagged(): void
    {
        $executor = $this->executorAnswering(new MockResponse(str_repeat('a', 5_242_880 + 10)));

        $result = $executor->execute('GET', 'https://api.example/big', [], null, 0);

        self::assertTrue($result['truncated']);
        self::assertSame(5_242_880, $result['size']);
        self::assertSame(5_242_880, \strlen($result['body']));
    }

    public function testABodyExactlyAtTheCapIsNotTruncated(): void
    {
        $executor = $this->executorAnswering(new MockResponse(str_repeat('a', 5_242_880)));

        $result = $executor->execute('GET', 'https://api.example/big', [], null, 0);

        self::assertFalse($result['truncated']);
        self::assertSame(5_242_880, $result['size']);
    }

    public function testTransportFailuresBecomeAStructuredError(): void
    {
        $executor = $this->executorFailingWith(new \RuntimeException('Could not resolve host: nowhere.example'));

        $result = $executor->execute('GET', 'https://nowhere.example', [], null, 0);

        self::assertFalse($result['success']);
        self::assertSame('Could not resolve host: nowhere.example', $result['error']);
        self::assertIsInt($result['timeMs']);
        self::assertArrayNotHasKey('status', $result);
    }

    public function testAFailureWithoutAMessageIsReportedByItsClassName(): void
    {
        $executor = $this->executorFailingWith(new \LogicException());

        self::assertSame(
            \LogicException::class,
            $executor->execute('GET', 'https://api.example', [], null, 0)['error']
        );
    }

    public function testAValidUtf8BodyIsReturnedUntouched(): void
    {
        $executor = $this->executorAnswering(new MockResponse('héllo ✓'));

        self::assertSame('héllo ✓', $executor->execute('GET', 'https://api.example', [], null, 0)['body']);
    }

    public function testTranscodesABodyFromTheCharsetTheContentTypeDeclares(): void
    {
        $latin1 = mb_convert_encoding('café', 'ISO-8859-1', 'UTF-8');
        $executor = $this->executorAnswering(new MockResponse($latin1, [
            'response_headers' => ['Content-Type: text/plain; charset="iso-8859-1"'],
        ]));

        $result = $executor->execute('GET', 'https://api.example', [], null, 0);

        self::assertSame('café', $result['body']);
        // The reported size is that of the original bytes, not the transcoded text.
        self::assertSame(4, $result['size']);
        self::assertNotFalse(json_encode($result));
    }

    /**
     * @dataProvider undeclaredCharsetProvider
     */
    public function testSubstitutesInvalidBytesWhenNoUsableCharsetIsDeclared(string $contentType): void
    {
        $headers = $contentType === '' ? [] : ['Content-Type: ' . $contentType];
        $executor = $this->executorAnswering(new MockResponse("ok \xE9 end", ['response_headers' => $headers]));

        $body = $executor->execute('GET', 'https://api.example', [], null, 0)['body'];

        self::assertTrue(mb_check_encoding($body, 'UTF-8'));
        self::assertStringStartsWith('ok ', $body);
        self::assertStringEndsWith(' end', $body);
        self::assertNotFalse(json_encode(['body' => $body]));
    }

    /**
     * @return iterable<string, array{string}>
     */
    public static function undeclaredCharsetProvider(): iterable
    {
        yield 'no content type' => [''];
        yield 'no charset parameter' => ['application/octet-stream'];
        yield 'utf-8 declared but the bytes are not' => ['text/plain; charset=UTF-8'];
    }

    public function testAnUnknownDeclaredCharsetFallsBackToSubstitution(): void
    {
        $executor = $this->executorAnswering(new MockResponse("ok \xE9 end", [
            'response_headers' => ['Content-Type: text/plain; charset=not-a-charset'],
        ]));

        $body = $executor->execute('GET', 'https://api.example', [], null, 0)['body'];

        self::assertTrue(mb_check_encoding($body, 'UTF-8'));
        self::assertStringStartsWith('ok ', $body);
    }

    public function testNonUtf8HeaderBytesAreSanitizedSoTheResultCanBeJsonEncoded(): void
    {
        $executor = $this->executorAnswering(new MockResponse('', [
            'response_headers' => ["X-Name: caf\xE9"],
        ]));

        $result = $executor->execute('GET', 'https://api.example', [], null, 0);

        self::assertNotFalse(json_encode($result));
    }

    public function testTheClientIsResetBeforeEveryRequest(): void
    {
        $client = $this->resettableClient(new MockResponse(''), new MockResponse(''));
        $executor = new ApiRequestExecutor($client);

        $executor->execute('GET', 'https://api.example/1', [], null, 0);
        $executor->execute('GET', 'https://api.example/2', [], null, 0);

        self::assertSame(2, $client->resets);
    }

    public function testAFailingResetDoesNotAbortTheRequest(): void
    {
        $client = $this->resettableClient(new MockResponse('still served'));
        $client->failReset = true;

        $result = (new ApiRequestExecutor($client))->execute('GET', 'https://api.example', [], null, 0);

        self::assertSame(1, $client->resets);
        self::assertTrue($result['success']);
        self::assertSame('still served', $result['body']);
    }

    public function testAClientThatCannotBeResetIsUsedAsIs(): void
    {
        $inner = new MockHttpClient(new MockResponse('plain'));
        // Deliberately not a ResetInterface: delegates to the mock and nothing else.
        $client = new class($inner) implements HttpClientInterface {
            public function __construct(private readonly HttpClientInterface $inner)
            {
            }

            public function request(string $method, string $url, array $options = []): ResponseInterface
            {
                return $this->inner->request($method, $url, $options);
            }

            public function stream(ResponseInterface|iterable $responses, ?float $timeout = null): ResponseStreamInterface
            {
                return $this->inner->stream($responses, $timeout);
            }

            public function withOptions(array $options): static
            {
                return $this;
            }
        };

        $result = (new ApiRequestExecutor($client))->execute('GET', 'https://api.example', [], null, 0);

        self::assertTrue($result['success']);
        self::assertSame('plain', $result['body']);
    }

    private function executorAnswering(ResponseInterface $response): ApiRequestExecutor
    {
        return new ApiRequestExecutor(new MockHttpClient(function (string $method, string $url, array $options) use ($response) {
            $this->calls[] = ['method' => $method, 'url' => $url, 'options' => $options];

            return $response;
        }));
    }

    private function executorFailingWith(\Throwable $error): ApiRequestExecutor
    {
        return new ApiRequestExecutor(new MockHttpClient(static function () use ($error): never {
            throw $error;
        }));
    }

    private function resettableClient(ResponseInterface ...$responses): CountingMockHttpClient
    {
        return new CountingMockHttpClient($responses);
    }
}
