<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Exception;

use Aaxis\Bundle\ToolsBundle\Exception\ApiCollectionAccessDeniedException;
use Aaxis\Bundle\ToolsBundle\Exception\RabbitMqManagementException;
use PHPUnit\Framework\TestCase;

class ExceptionsTest extends TestCase
{
    /**
     * @dataProvider exceptionProvider
     *
     * @param class-string<\RuntimeException> $class
     */
    public function testExistingRuntimeExceptionCatchesKeepWorking(string $class): void
    {
        $previous = new \LogicException('cause');
        $exception = new $class('the message', 12, $previous);

        self::assertInstanceOf(\RuntimeException::class, $exception);
        self::assertSame('the message', $exception->getMessage());
        self::assertSame(12, $exception->getCode());
        self::assertSame($previous, $exception->getPrevious());

        try {
            throw $exception;
        } catch (\RuntimeException $caught) {
            self::assertSame($exception, $caught);
        }
    }

    /**
     * @return iterable<string, array{class-string<\RuntimeException>}>
     */
    public static function exceptionProvider(): iterable
    {
        yield 'api collection access denied' => [ApiCollectionAccessDeniedException::class];
        yield 'rabbitmq management' => [RabbitMqManagementException::class];
    }
}
