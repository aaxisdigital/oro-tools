<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Entity;

use Aaxis\Bundle\ToolsBundle\Entity\Repository\ApiCollectionRunHistoryRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Oro\Bundle\UserBundle\Entity\User;

/**
 * Records each API Collection request execution (run client-side, logged server-side).
 */
#[ORM\Entity(repositoryClass: ApiCollectionRunHistoryRepository::class)]
#[ORM\Table(name: 'aaxis_apicollection_run_history')]
#[ORM\Index(columns: ['run_at'], name: 'aaxis_apicol_run_at_idx')]
class ApiCollectionRunHistory
{
    public const string RESULT_SUCCESS = 'success';
    public const string RESULT_ERROR = 'error';

    #[ORM\Id]
    #[ORM\Column(name: 'id', type: Types::INTEGER)]
    #[ORM\GeneratedValue(strategy: 'AUTO')]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', referencedColumnName: 'id', nullable: true, onDelete: 'SET NULL')]
    private ?User $user = null;

    #[ORM\Column(name: 'request_id', type: Types::INTEGER, nullable: true)]
    private ?int $requestId = null;

    #[ORM\Column(name: 'name', type: Types::STRING, length: 255, nullable: true)]
    private ?string $name = null;

    #[ORM\Column(name: 'method', type: Types::STRING, length: 10)]
    private ?string $method = null;

    #[ORM\Column(name: 'url', type: Types::TEXT)]
    private ?string $url = null;

    #[ORM\Column(name: 'run_at', type: Types::DATETIME_MUTABLE)]
    private ?\DateTimeInterface $runAt = null;

    #[ORM\Column(name: 'status', type: Types::INTEGER, nullable: true)]
    private ?int $status = null;

    #[ORM\Column(name: 'result', type: Types::STRING, length: 16, nullable: true)]
    private ?string $result = null;

    #[ORM\Column(name: 'size_bytes', type: Types::INTEGER, nullable: true)]
    private ?int $sizeBytes = null;

    #[ORM\Column(name: 'time_ms', type: Types::INTEGER, nullable: true)]
    private ?int $timeMs = null;

    public function getId(): ?int
    {
        return $this->id;
    }

    public function getUser(): ?User
    {
        return $this->user;
    }

    public function setUser(?User $user): self
    {
        $this->user = $user;

        return $this;
    }

    public function getRequestId(): ?int
    {
        return $this->requestId;
    }

    public function setRequestId(?int $requestId): self
    {
        $this->requestId = $requestId;

        return $this;
    }

    public function getName(): ?string
    {
        return $this->name;
    }

    public function setName(?string $name): self
    {
        $this->name = $name;

        return $this;
    }

    public function getMethod(): ?string
    {
        return $this->method;
    }

    public function setMethod(string $method): self
    {
        $this->method = $method;

        return $this;
    }

    public function getUrl(): ?string
    {
        return $this->url;
    }

    public function setUrl(string $url): self
    {
        $this->url = $url;

        return $this;
    }

    public function getRunAt(): ?\DateTimeInterface
    {
        return $this->runAt;
    }

    public function setRunAt(\DateTimeInterface $runAt): self
    {
        $this->runAt = $runAt;

        return $this;
    }

    public function getStatus(): ?int
    {
        return $this->status;
    }

    public function setStatus(?int $status): self
    {
        $this->status = $status;

        return $this;
    }

    public function getResult(): ?string
    {
        return $this->result;
    }

    public function setResult(?string $result): self
    {
        $this->result = $result;

        return $this;
    }

    public function getSizeBytes(): ?int
    {
        return $this->sizeBytes;
    }

    public function setSizeBytes(?int $sizeBytes): self
    {
        $this->sizeBytes = $sizeBytes;

        return $this;
    }

    public function getTimeMs(): ?int
    {
        return $this->timeMs;
    }

    public function setTimeMs(?int $timeMs): self
    {
        $this->timeMs = $timeMs;

        return $this;
    }
}
