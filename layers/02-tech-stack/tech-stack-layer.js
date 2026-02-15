const BaseLayer = require('../core/base-layer');
const path = require('path');

/**
 * TechStackLayer — detects languages, frameworks, versions, and dependencies
 * by analyzing config files (package.json, composer.json, tsconfig.json, etc.)
 */
class TechStackLayer extends BaseLayer {
  constructor() {
    super('tech-stack');
  }

  async process(snapshot, context) {
    const { project } = context;
    const fileContents = snapshot._fileContents || {};
    const files = (snapshot.fileSystem && snapshot.fileSystem.files) || [];
    const byExtension = (snapshot.fileSystem && snapshot.fileSystem.byExtension) || {};

    const result = {
      languages: [],
      frameworks: [],
      runtime: {},
      packageManager: null,
      dependencies: [],
      devDependencies: [],
      scripts: {},
      configFiles: []
    };

    // ─── Detect languages from file extensions ───
    result.languages = this.detectLanguages(byExtension, files);

    // ─── Analyze package.json (Node.js / JS) ───
    const packageJson = this.findAndParse(fileContents, 'package.json');
    if (packageJson) {
      result.configFiles.push('package.json');
      result.packageManager = 'npm';

      // Check for yarn.lock or pnpm-lock.yaml
      if (files.some(f => f.name === 'yarn.lock')) result.packageManager = 'yarn';
      if (files.some(f => f.name === 'pnpm-lock.yaml')) result.packageManager = 'pnpm';

      // Node.js version
      if (packageJson.engines && packageJson.engines.node) {
        result.runtime.node = packageJson.engines.node;
      }

      // Scripts
      if (packageJson.scripts) {
        result.scripts = packageJson.scripts;
      }

      // Dependencies
      if (packageJson.dependencies) {
        result.dependencies = Object.entries(packageJson.dependencies).map(([name, version]) => ({
          name, version, type: 'production', source: 'package.json'
        }));
      }
      if (packageJson.devDependencies) {
        result.devDependencies = Object.entries(packageJson.devDependencies).map(([name, version]) => ({
          name, version, type: 'dev', source: 'package.json'
        }));
      }

      // Detect JS frameworks from dependencies
      const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      result.frameworks.push(...this.detectJsFrameworks(allDeps));
    }

    // ─── Analyze composer.json (PHP) ───
    const composerJson = this.findAndParse(fileContents, 'composer.json');
    if (composerJson) {
      result.configFiles.push('composer.json');

      // PHP version
      if (composerJson.require && composerJson.require.php) {
        result.runtime.php = composerJson.require.php;
      }

      // Dependencies
      if (composerJson.require) {
        const phpDeps = Object.entries(composerJson.require)
          .filter(([name]) => name !== 'php' && !name.startsWith('ext-'))
          .map(([name, version]) => ({
            name, version, type: 'production', source: 'composer.json'
          }));
        result.dependencies.push(...phpDeps);
      }
      if (composerJson['require-dev']) {
        const phpDevDeps = Object.entries(composerJson['require-dev']).map(([name, version]) => ({
          name, version, type: 'dev', source: 'composer.json'
        }));
        result.devDependencies.push(...phpDevDeps);
      }

      // PHP extensions required
      if (composerJson.require) {
        result.phpExtensions = Object.keys(composerJson.require)
          .filter(name => name.startsWith('ext-'))
          .map(name => name.replace('ext-', ''));
      }

      // Detect PHP frameworks
      const allPhpDeps = { ...composerJson.require, ...composerJson['require-dev'] };
      result.frameworks.push(...this.detectPhpFrameworks(allPhpDeps));
    }

    // ─── Analyze tsconfig.json (TypeScript) ───
    const tsConfig = this.findAndParse(fileContents, 'tsconfig.json');
    if (tsConfig) {
      result.configFiles.push('tsconfig.json');
      if (tsConfig.compilerOptions) {
        result.runtime.typescript = {
          target: tsConfig.compilerOptions.target || 'unknown',
          module: tsConfig.compilerOptions.module || 'unknown',
          strict: tsConfig.compilerOptions.strict || false
        };
      }
    }

    // ─── Check for other config files ───
    const configIndicators = [
      { file: '.eslintrc.json', name: 'ESLint' },
      { file: '.eslintrc.js', name: 'ESLint' },
      { file: '.prettierrc', name: 'Prettier' },
      { file: 'webpack.config.js', name: 'Webpack' },
      { file: 'vite.config.js', name: 'Vite' },
      { file: 'vite.config.ts', name: 'Vite' },
      { file: 'next.config.js', name: 'Next.js' },
      { file: 'next.config.mjs', name: 'Next.js' },
      { file: 'nuxt.config.js', name: 'Nuxt.js' },
      { file: 'nuxt.config.ts', name: 'Nuxt.js' },
      { file: 'vue.config.js', name: 'Vue CLI' },
      { file: 'tailwind.config.js', name: 'Tailwind CSS' },
      { file: 'tailwind.config.ts', name: 'Tailwind CSS' },
      { file: 'docker-compose.yml', name: 'Docker' },
      { file: 'Dockerfile', name: 'Docker' },
      { file: '.env', name: 'dotenv' },
      { file: 'artisan', name: 'Laravel' },
      { file: 'wp-config.php', name: 'WordPress' },
    ];

    for (const indicator of configIndicators) {
      if (files.some(f => f.name === indicator.file)) {
        if (!result.configFiles.includes(indicator.file)) {
          result.configFiles.push(indicator.file);
        }
        // Add framework if not already detected
        if (!result.frameworks.some(fw => fw.name === indicator.name)) {
          if (['Laravel', 'WordPress', 'Next.js', 'Nuxt.js', 'Vue CLI'].includes(indicator.name)) {
            result.frameworks.push({ name: indicator.name, source: indicator.file });
          }
        }
      }
    }

    // ─── Analyze ECMAScript version from code patterns ───
    result.ecmaScriptVersion = this.detectEcmaScriptVersion(fileContents, files);

    // ─── Analyze PHP version from code patterns ───
    result.phpVersion = this.detectPhpVersionFromCode(fileContents, files);

    // Use user-specified framework if set
    if (project.framework && project.framework !== 'none') {
      const userFw = result.frameworks.find(f => f.name.toLowerCase() === project.framework.toLowerCase());
      if (!userFw) {
        result.frameworks.unshift({ name: project.framework, source: 'user-specified', primary: true });
      } else {
        userFw.primary = true;
      }
    }

    return { techStack: result };
  }

  // ─── Language Detection ───

  detectLanguages(byExtension, files) {
    const langMap = {
      '.php': 'PHP',
      '.js': 'JavaScript',
      '.jsx': 'JavaScript (JSX)',
      '.ts': 'TypeScript',
      '.tsx': 'TypeScript (TSX)',
      '.vue': 'Vue',
      '.svelte': 'Svelte',
      '.html': 'HTML',
      '.htm': 'HTML',
      '.css': 'CSS',
      '.scss': 'SCSS',
      '.less': 'LESS',
      '.sass': 'SASS',
      '.json': 'JSON',
      '.xml': 'XML',
      '.yaml': 'YAML',
      '.yml': 'YAML',
      '.sql': 'SQL',
      '.py': 'Python',
      '.rb': 'Ruby',
      '.go': 'Go',
      '.java': 'Java',
      '.md': 'Markdown'
    };

    const languages = [];
    for (const [ext, count] of Object.entries(byExtension)) {
      const name = langMap[ext];
      if (name && count > 0) {
        const langFiles = files.filter(f => f.extension === ext);
        const totalLines = langFiles.reduce((sum, f) => sum + f.lines, 0);
        languages.push({ name, extension: ext, files: count, lines: totalLines });
      }
    }

    return languages.sort((a, b) => b.lines - a.lines);
  }

  // ─── JS Framework Detection ───

  detectJsFrameworks(deps) {
    const frameworks = [];
    const checks = [
      { dep: 'react', name: 'React' },
      { dep: 'react-dom', name: 'React' },
      { dep: 'next', name: 'Next.js' },
      { dep: 'vue', name: 'Vue.js' },
      { dep: 'nuxt', name: 'Nuxt.js' },
      { dep: '@angular/core', name: 'Angular' },
      { dep: 'svelte', name: 'Svelte' },
      { dep: 'express', name: 'Express.js' },
      { dep: 'fastify', name: 'Fastify' },
      { dep: 'koa', name: 'Koa' },
      { dep: 'nest', name: 'NestJS' },
      { dep: '@nestjs/core', name: 'NestJS' },
      { dep: 'electron', name: 'Electron' },
      { dep: 'tailwindcss', name: 'Tailwind CSS' },
      { dep: 'bootstrap', name: 'Bootstrap' },
      { dep: 'jquery', name: 'jQuery' },
      { dep: 'socket.io', name: 'Socket.IO' },
      { dep: 'mongoose', name: 'Mongoose (MongoDB)' },
      { dep: 'sequelize', name: 'Sequelize (SQL ORM)' },
      { dep: 'prisma', name: 'Prisma' },
      { dep: '@prisma/client', name: 'Prisma' },
    ];

    const seen = new Set();
    for (const check of checks) {
      if (deps[check.dep] && !seen.has(check.name)) {
        seen.add(check.name);
        frameworks.push({
          name: check.name,
          version: deps[check.dep],
          source: 'package.json'
        });
      }
    }

    return frameworks;
  }

  // ─── PHP Framework Detection ───

  detectPhpFrameworks(deps) {
    const frameworks = [];
    const checks = [
      { dep: 'laravel/framework', name: 'Laravel' },
      { dep: 'symfony/framework-bundle', name: 'Symfony' },
      { dep: 'yiisoft/yii2', name: 'Yii2' },
      { dep: 'cakephp/cakephp', name: 'CakePHP' },
      { dep: 'slim/slim', name: 'Slim' },
      { dep: 'codeigniter4/framework', name: 'CodeIgniter' },
      { dep: 'doctrine/orm', name: 'Doctrine ORM' },
      { dep: 'phpunit/phpunit', name: 'PHPUnit' },
    ];

    const seen = new Set();
    for (const check of checks) {
      if (deps[check.dep] && !seen.has(check.name)) {
        seen.add(check.name);
        frameworks.push({
          name: check.name,
          version: deps[check.dep],
          source: 'composer.json'
        });
      }
    }

    return frameworks;
  }

  // ─── ECMAScript Version Detection ───

  detectEcmaScriptVersion(fileContents, files) {
    const jsFiles = Object.entries(fileContents)
      .filter(([p]) => /\.(js|jsx|ts|tsx|mjs)$/.test(p));

    if (jsFiles.length === 0) return null;

    const features = {
      es2015: false, // let/const, arrow, class, template literals, destructuring
      es2016: false, // ** operator, Array.includes
      es2017: false, // async/await
      es2018: false, // rest/spread properties, for-await
      es2019: false, // optional catch, flat/flatMap
      es2020: false, // ?., ??, BigInt, globalThis
      es2021: false, // ??=, ||=, &&=
      es2022: false, // top-level await, .at(), class fields
      es2023: false, // findLast, hashbang
    };

    for (const [, content] of jsFiles) {
      if (!content) continue;
      if (/\b(let|const)\s/.test(content) || /=>/.test(content) || /class\s+\w+/.test(content)) features.es2015 = true;
      if (/\*\*/.test(content) || /\.includes\(/.test(content)) features.es2016 = true;
      if (/\basync\s/.test(content) || /\bawait\s/.test(content)) features.es2017 = true;
      if (/\.\.\.\w+/.test(content) || /for\s+await/.test(content)) features.es2018 = true;
      if (/\.flat\(/.test(content) || /\.flatMap\(/.test(content)) features.es2019 = true;
      if (/\?\.\w/.test(content) || /\?\?/.test(content)) features.es2020 = true;
      if (/\?\?=/.test(content) || /\|\|=/.test(content) || /&&=/.test(content)) features.es2021 = true;
      if (/\bawait\s+(?!function)(?!=>)\S/.test(content) || /\.at\(/.test(content)) features.es2022 = true;
      if (/\.findLast\(/.test(content)) features.es2023 = true;
    }

    // Return the highest version detected
    const versions = Object.entries(features).filter(([, v]) => v).map(([k]) => k);
    return versions.length > 0 ? versions[versions.length - 1].toUpperCase() : null;
  }

  // ─── PHP Version Detection ───

  detectPhpVersionFromCode(fileContents, files) {
    const phpFiles = Object.entries(fileContents)
      .filter(([p]) => /\.php$/.test(p));

    if (phpFiles.length === 0) return null;

    const features = {
      '5.6': false,
      '7.0': false, // scalar type hints, return types, null coalescing
      '7.1': false, // nullable types, void return
      '7.4': false, // typed properties, arrow functions, null coalescing assignment
      '8.0': false, // named arguments, match, nullsafe operator, constructor promotion
      '8.1': false, // enums, fibers, readonly, intersection types
      '8.2': false, // readonly classes, DNF types
      '8.3': false, // typed class constants, json_validate
    };

    for (const [, content] of phpFiles) {
      if (!content) continue;
      if (/function\s+\w+\s*\([^)]*\)\s*:\s*\w+/.test(content)) features['7.0'] = true;
      if (/\?\w+/.test(content) && /function/.test(content)) features['7.1'] = true;
      if (/fn\s*\(/.test(content) || /\?\?=/.test(content)) features['7.4'] = true;
      if (/\?->/.test(content) || /\bmatch\s*\(/.test(content)) features['8.0'] = true;
      if (/\benum\s+\w+/.test(content) || /\breadonly\s+(public|protected|private)/.test(content)) features['8.1'] = true;
      if (/\breadonly\s+class/.test(content)) features['8.2'] = true;
      // Constructor property promotion
      if (/function\s+__construct\s*\(\s*(public|protected|private)/.test(content)) features['8.0'] = true;
    }

    const versions = Object.entries(features).filter(([, v]) => v).map(([k]) => k);
    return versions.length > 0 ? `>=${versions[versions.length - 1]}` : '>=5.6';
  }

  // ─── Helpers ───

  findAndParse(fileContents, filename) {
    for (const [filePath, content] of Object.entries(fileContents)) {
      if (path.basename(filePath) === filename) {
        try {
          return JSON.parse(content);
        } catch {
          return null;
        }
      }
    }
    return null;
  }
}

module.exports = TechStackLayer;
