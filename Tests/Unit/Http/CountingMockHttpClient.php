<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Http;

use Symfony\Component\HttpClient\MockHttpClient;
use Symfony\Contracts\HttpClient\ResponseInterface;

/**
 * MockHttpClient that counts how often it is reset and can be told to fail while resetting.
 */
class CountingMockHttpClient extends MockHttpClient
{
    public int $resets = 0;
    public bool $failReset = false;

    /**
     * @param ResponseInterface[] $responses
     */
    public function __construct(array $responses)
    {
        parent::__construct($responses);
    }

    #[\Override]
    public function reset(): void
    {
        ++$this->resets;
        if ($this->failReset) {
            throw new \RuntimeException('reset failed');
        }
    }
}
