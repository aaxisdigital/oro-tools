<?php

declare(strict_types=1);

namespace Aaxis\Bundle\ToolsBundle\DependencyInjection;

use Symfony\Component\Config\FileLocator;
use Symfony\Component\DependencyInjection\ContainerBuilder;
use Symfony\Component\DependencyInjection\Loader;
use Symfony\Component\HttpKernel\DependencyInjection\Extension;
use Oro\Bundle\ConfigBundle\DependencyInjection\SettingsBuilder;

/**
 * Loads and manages the bundle configuration.
 * The alias resolves to "aaxis_tools".
 */
class AaxisToolsExtension extends Extension
{
    #[\Override]
    public function load(array $configs, ContainerBuilder $container): void
    {
        $configuration = new Configuration();
        $config = $this->processConfiguration($configuration, $configs);
        $container->prependExtensionConfig($this->getAlias(), SettingsBuilder::getSettings($config));

        // Absolute path to this bundle's root, resolved wherever the package is installed
        // (src/… in a monorepo, vendor/aaxisdigital/oro-tools when pulled via Composer).
        // Used to point the TypeScript build at this bundle's own tsconfig.
        $container->setParameter('aaxis_tools.bundle_dir', \dirname(__DIR__));

        $loader = new Loader\YamlFileLoader($container, new FileLocator(__DIR__ . '/../Resources/config'));
        $loader->load('services.yml');
        $loader->load('controllers.yml');
    }
}
