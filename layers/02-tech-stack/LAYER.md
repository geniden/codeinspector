# Layer 02 — Tech Stack Detection

## Purpose
Detects languages, frameworks, runtime versions, and dependencies by analyzing
project configuration files and code patterns.

## State Owned
- `techStack.*` — detected technology stack

## State Read
- `fileSystem.files` — list of files (names, extensions)
- `fileSystem.byExtension` — file count per extension
- `_fileContents` — file contents (reads package.json, composer.json, etc.)

## Process
1. Detect languages from file extensions (count files + lines per language)
2. Parse `package.json` → extract npm dependencies, scripts, node version
3. Parse `composer.json` → extract PHP dependencies, required PHP version
4. Parse `tsconfig.json` → extract TypeScript configuration
5. Detect frameworks from dependency names (React, Vue, Laravel, etc.)
6. Scan code for ECMAScript version features (let/const → ES2015, async/await → ES2017, ?. → ES2020)
7. Scan code for PHP version features (typed properties → 7.4, match → 8.0, enum → 8.1)
8. Detect config files (ESLint, Prettier, Webpack, Vite, Docker, etc.)

## Delta Format
```json
{
  "techStack": {
    "languages": [
      { "name": "JavaScript", "extension": ".js", "files": 20, "lines": 3500 }
    ],
    "frameworks": [
      { "name": "Express.js", "version": "^4.18.2", "source": "package.json" }
    ],
    "runtime": { "node": ">=18", "php": ">=8.1" },
    "packageManager": "npm",
    "dependencies": [
      { "name": "express", "version": "^4.18.2", "type": "production", "source": "package.json" }
    ],
    "devDependencies": [...],
    "scripts": { "start": "node server.js", "test": "jest" },
    "configFiles": ["package.json", "tsconfig.json", ".eslintrc.json"],
    "ecmaScriptVersion": "ES2022",
    "phpVersion": ">=8.1"
  }
}
```
