<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Entity;

use Aaxis\Bundle\ToolsBundle\Entity\Repository\ApiCollectionRequestRepository;
use Doctrine\DBAL\Types\Types;
use Doctrine\ORM\Mapping as ORM;
use Oro\Bundle\UserBundle\Entity\User;

/**
 * A node in the API Collection tree: either a folder or a request. Owned by a user and
 * optionally public (visible to everyone).
 */
#[ORM\Entity(repositoryClass: ApiCollectionRequestRepository::class)]
#[ORM\Table(name: 'aaxis_apicollection_request')]
#[ORM\Index(columns: ['parent_id'], name: 'aaxis_apicol_parent_idx')]
#[ORM\Index(columns: ['is_public'], name: 'aaxis_apicol_public_idx')]
class ApiCollectionRequest
{
    public const string TYPE_FOLDER = 'folder';
    public const string TYPE_REQUEST = 'request';

    #[ORM\Id]
    #[ORM\Column(name: 'id', type: Types::INTEGER)]
    #[ORM\GeneratedValue(strategy: 'AUTO')]
    private ?int $id = null;

    #[ORM\ManyToOne(targetEntity: User::class)]
    #[ORM\JoinColumn(name: 'user_id', referencedColumnName: 'id', nullable: true, onDelete: 'SET NULL')]
    private ?User $user = null;

    #[ORM\Column(name: 'is_public', type: Types::BOOLEAN, options: ['default' => false])]
    private bool $public = false;

    #[ORM\Column(name: 'type', type: Types::STRING, length: 16)]
    private string $type = self::TYPE_REQUEST;

    #[ORM\Column(name: 'parent_id', type: Types::INTEGER, nullable: true)]
    private ?int $parentId = null;

    #[ORM\Column(name: 'position', type: Types::INTEGER, options: ['default' => 0])]
    private int $position = 0;

    #[ORM\Column(name: 'name', type: Types::STRING, length: 255)]
    private ?string $name = null;

    #[ORM\Column(name: 'method', type: Types::STRING, length: 10, nullable: true)]
    private ?string $method = null;

    #[ORM\Column(name: 'url', type: Types::TEXT, nullable: true)]
    private ?string $url = null;

    #[ORM\Column(name: 'params', type: Types::JSON, nullable: true, columnDefinition: 'JSONB DEFAULT NULL')]
    private ?array $params = null;

    #[ORM\Column(name: 'headers', type: Types::JSON, nullable: true, columnDefinition: 'JSONB DEFAULT NULL')]
    private ?array $headers = null;

    #[ORM\Column(name: 'body_type', type: Types::STRING, length: 16, nullable: true)]
    private ?string $bodyType = null;

    #[ORM\Column(name: 'body', type: Types::TEXT, nullable: true)]
    private ?string $body = null;

    #[ORM\Column(name: 'created_at', type: Types::DATETIME_MUTABLE)]
    private ?\DateTimeInterface $createdAt = null;

    #[ORM\Column(name: 'updated_at', type: Types::DATETIME_MUTABLE)]
    private ?\DateTimeInterface $updatedAt = null;

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

    public function isPublic(): bool
    {
        return $this->public;
    }

    public function setPublic(bool $public): self
    {
        $this->public = $public;

        return $this;
    }

    public function getType(): string
    {
        return $this->type;
    }

    public function setType(string $type): self
    {
        $this->type = $type;

        return $this;
    }

    public function isFolder(): bool
    {
        return $this->type === self::TYPE_FOLDER;
    }

    public function getParentId(): ?int
    {
        return $this->parentId;
    }

    public function setParentId(?int $parentId): self
    {
        $this->parentId = $parentId;

        return $this;
    }

    public function getPosition(): int
    {
        return $this->position;
    }

    public function setPosition(int $position): self
    {
        $this->position = $position;

        return $this;
    }

    public function getName(): ?string
    {
        return $this->name;
    }

    public function setName(string $name): self
    {
        $this->name = $name;

        return $this;
    }

    public function getMethod(): ?string
    {
        return $this->method;
    }

    public function setMethod(?string $method): self
    {
        $this->method = $method;

        return $this;
    }

    public function getUrl(): ?string
    {
        return $this->url;
    }

    public function setUrl(?string $url): self
    {
        $this->url = $url;

        return $this;
    }

    public function getParams(): ?array
    {
        return $this->params;
    }

    public function setParams(?array $params): self
    {
        $this->params = $params;

        return $this;
    }

    public function getHeaders(): ?array
    {
        return $this->headers;
    }

    public function setHeaders(?array $headers): self
    {
        $this->headers = $headers;

        return $this;
    }

    public function getBodyType(): ?string
    {
        return $this->bodyType;
    }

    public function setBodyType(?string $bodyType): self
    {
        $this->bodyType = $bodyType;

        return $this;
    }

    public function getBody(): ?string
    {
        return $this->body;
    }

    public function setBody(?string $body): self
    {
        $this->body = $body;

        return $this;
    }

    public function getCreatedAt(): ?\DateTimeInterface
    {
        return $this->createdAt;
    }

    public function setCreatedAt(\DateTimeInterface $createdAt): self
    {
        $this->createdAt = $createdAt;

        return $this;
    }

    public function getUpdatedAt(): ?\DateTimeInterface
    {
        return $this->updatedAt;
    }

    public function setUpdatedAt(\DateTimeInterface $updatedAt): self
    {
        $this->updatedAt = $updatedAt;

        return $this;
    }
}
