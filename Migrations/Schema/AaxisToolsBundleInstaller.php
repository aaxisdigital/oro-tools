<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\Migrations\Schema;

use Doctrine\DBAL\Schema\Schema;
use Oro\Bundle\MigrationBundle\Migration\Installation;
use Oro\Bundle\MigrationBundle\Migration\QueryBag;

/**
 * Creates the AaxisToolsBundle database tables (API Collection tree + run history). This is a
 * single, consolidated install reflecting the current state of the schema.
 */
class AaxisToolsBundleInstaller implements Installation
{
    private const string JSONB_NULL = 'JSONB DEFAULT NULL';
    private const string FK_SET_NULL = 'SET NULL';

    #[\Override]
    public function getMigrationVersion(): string
    {
        return 'v1_0';
    }

    #[\Override]
    public function up(Schema $schema, QueryBag $queries): void
    {
        $this->createApiCollectionTables($schema);

        $this->addForeignKeys($schema);
    }

    private function createApiCollectionTables(Schema $schema): void
    {
        $request = $schema->createTable('aaxis_apicollection_request');
        $request->addColumn('id', 'integer', ['autoincrement' => true]);
        $request->addColumn('user_id', 'integer', ['notnull' => false]);
        $request->addColumn('is_public', 'boolean', ['default' => false]);
        $request->addColumn('type', 'string', ['length' => 16]);
        $request->addColumn('parent_id', 'integer', ['notnull' => false]);
        $request->addColumn('position', 'integer', ['default' => 0]);
        $request->addColumn('name', 'string', ['length' => 255]);
        $request->addColumn('method', 'string', ['length' => 10, 'notnull' => false]);
        $request->addColumn('url', 'text', ['notnull' => false]);
        $request->addColumn('params', 'json', ['notnull' => false, 'columnDefinition' => self::JSONB_NULL]);
        $request->addColumn('headers', 'json', ['notnull' => false, 'columnDefinition' => self::JSONB_NULL]);
        $request->addColumn('body_type', 'string', ['length' => 16, 'notnull' => false]);
        $request->addColumn('body', 'text', ['notnull' => false]);
        $request->addColumn('created_at', 'datetime', []);
        $request->addColumn('updated_at', 'datetime', []);
        $request->setPrimaryKey(['id']);
        $request->addIndex(['user_id'], 'aaxis_apicol_user_idx');
        $request->addIndex(['parent_id'], 'aaxis_apicol_parent_idx');
        $request->addIndex(['is_public'], 'aaxis_apicol_public_idx');

        $runs = $schema->createTable('aaxis_apicollection_run_history');
        $runs->addColumn('id', 'integer', ['autoincrement' => true]);
        $runs->addColumn('user_id', 'integer', ['notnull' => false]);
        $runs->addColumn('request_id', 'integer', ['notnull' => false]);
        $runs->addColumn('name', 'string', ['length' => 255, 'notnull' => false]);
        $runs->addColumn('method', 'string', ['length' => 10]);
        $runs->addColumn('url', 'text', []);
        $runs->addColumn('run_at', 'datetime', []);
        $runs->addColumn('status', 'integer', ['notnull' => false]);
        $runs->addColumn('result', 'string', ['length' => 16, 'notnull' => false]);
        $runs->addColumn('size_bytes', 'integer', ['notnull' => false]);
        $runs->addColumn('time_ms', 'integer', ['notnull' => false]);
        $runs->setPrimaryKey(['id']);
        $runs->addIndex(['user_id'], 'aaxis_apicol_run_user_idx');
        $runs->addIndex(['run_at'], 'aaxis_apicol_run_at_idx');
    }

    private function addForeignKeys(Schema $schema): void
    {
        $schema->getTable('aaxis_apicollection_request')->addForeignKeyConstraint(
            $schema->getTable('oro_user'),
            ['user_id'],
            ['id'],
            ['onDelete' => self::FK_SET_NULL, 'onUpdate' => null]
        );

        $schema->getTable('aaxis_apicollection_run_history')->addForeignKeyConstraint(
            $schema->getTable('oro_user'),
            ['user_id'],
            ['id'],
            ['onDelete' => self::FK_SET_NULL, 'onUpdate' => null]
        );
    }
}
