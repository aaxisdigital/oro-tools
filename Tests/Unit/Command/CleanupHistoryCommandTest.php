<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Tests\Unit\Command;

use Aaxis\Bundle\CommonBundle\Command\HistoryRetentionPurger;
use Aaxis\Bundle\ToolsBundle\Command\CleanupHistoryCommand;
use Aaxis\Bundle\ToolsBundle\Entity\ApiCollectionRunHistory;
use Oro\Bundle\ConfigBundle\Config\ConfigManager;
use Oro\Bundle\CronBundle\Command\CronCommandScheduleDefinitionInterface;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Tester\CommandTester;

class CleanupHistoryCommandTest extends TestCase
{
    private HistoryRetentionPurger&MockObject $purger;
    private ConfigManager&MockObject $config;
    private CleanupHistoryCommand $command;

    protected function setUp(): void
    {
        $this->purger = $this->createMock(HistoryRetentionPurger::class);
        $this->config = $this->createMock(ConfigManager::class);
        $this->command = new CleanupHistoryCommand($this->purger, $this->config);
    }

    public function testIsTheNightlyCleanupCommand(): void
    {
        self::assertSame('aaxis:tools:history:cleanup', $this->command->getName());
        self::assertStringContainsString('older than the configured retention', $this->command->getDescription());
    }

    public function testRunsEveryDayAtMidnight(): void
    {
        self::assertInstanceOf(CronCommandScheduleDefinitionInterface::class, $this->command);
        self::assertSame('0 0 * * *', $this->command->getDefaultDefinition());
    }

    public function testPurgesTheApiCollectionHistoryOlderThanTheConfiguredRetention(): void
    {
        $this->config->expects(self::once())->method('get')
            ->with('aaxis_tools.api_collection_history_retention_days')->willReturn(30);
        $this->purger->expects(self::once())->method('purge')
            ->with(ApiCollectionRunHistory::class, 30)->willReturn(12);

        $tester = new CommandTester($this->command);
        $status = $tester->execute([]);

        self::assertSame(Command::SUCCESS, $status);
        $output = $tester->getDisplay();
        self::assertStringContainsString('API Collection: removed 12 record(s) older than 30 day(s).', $output);
        self::assertStringContainsString('Removed 12 expired history record(s).', $output);
    }

    public function testTheRetentionSettingIsReadAsAnInteger(): void
    {
        $this->config->method('get')->willReturn('45');
        $this->purger->expects(self::once())->method('purge')->with(ApiCollectionRunHistory::class, 45)->willReturn(0);

        (new CommandTester($this->command))->execute([]);
    }

    /**
     * @dataProvider disabledRetentionProvider
     */
    public function testAnUnsetOrNonPositiveRetentionKeepsEverything(mixed $configured): void
    {
        $this->config->method('get')->willReturn($configured);
        $this->purger->expects(self::never())->method('purge');

        $tester = new CommandTester($this->command);
        $status = $tester->execute([]);

        self::assertSame(Command::SUCCESS, $status);
        $output = $tester->getDisplay();
        self::assertStringContainsString('API Collection: retention disabled, keeping all records.', $output);
        self::assertStringContainsString('Removed 0 expired history record(s).', $output);
    }

    /**
     * @return iterable<string, array{mixed}>
     */
    public static function disabledRetentionProvider(): iterable
    {
        yield 'zero' => [0];
        yield 'negative' => [-7];
        yield 'unset' => [null];
        yield 'not a number' => ['forever'];
    }
}
