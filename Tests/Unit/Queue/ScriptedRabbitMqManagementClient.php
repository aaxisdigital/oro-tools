<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Queue;

use Aaxis\Bundle\ToolsBundle\Queue\RabbitMqManagementClient;

/**
 * RabbitMqManagementClient whose curl transport is replaced by a script of canned answers, so the
 * client's own logic runs without a network. Every attempted call is recorded in $requests.
 */
class ScriptedRabbitMqManagementClient extends RabbitMqManagementClient
{
    /** @var list<array{url: string, options: array<int, mixed>}> */
    public array $requests = [];

    /** @var list<array{response: string|false, status: int, errno: int, error: string}|null> */
    private array $replies = [];

    /**
     * @param array{response: string|false, status: int, errno: int, error: string}|null $reply
     */
    public function willReply(?array $reply): self
    {
        $this->replies[] = $reply;

        return $this;
    }

    /**
     * @param array<mixed>|string $body
     */
    public function willReplyOk(array|string $body, int $status = 200): self
    {
        return $this->willReply([
            'response' => \is_array($body) ? json_encode($body, JSON_THROW_ON_ERROR) : $body,
            'status' => $status,
            'errno' => 0,
            'error' => '',
        ]);
    }

    #[\Override]
    protected function transport(string $url, array $options): ?array
    {
        $this->requests[] = ['url' => $url, 'options' => $options];

        return array_shift($this->replies);
    }
}
