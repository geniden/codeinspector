# Layer 04 — Code Quality

## Purpose
Detects code quality issues: unused functions/methods/classes, unused imports,
unused npm/composer dependencies, commented-out code blocks, and calculates
cyclomatic complexity per file.

## State Owned
- `codeQuality.*` — issues, metrics, and unused code listings

## State Read
- `_fileContents` — file contents for reference scanning
- `codeStructure.files` — declared symbols (classes, functions, methods, imports)
- `techStack.dependencies` — installed packages to check usage

## Process
1. Collect all declared symbols from `codeStructure` (functions, methods, classes)
2. Scan all file contents to collect references (function calls, class usage, method calls)
3. Compare declared vs referenced — anything declared but never referenced is "unused"
4. Check imports: if an imported specifier is only used in the import line itself, it's unused
5. Check dependencies: if a package from package.json/composer.json is never imported in code
6. Detect commented-out code blocks (8+ consecutive lines)
7. Calculate cyclomatic complexity per file

## Limitations
- **Static analysis only** — cannot detect dynamic calls (`$method()`, `call_user_func`, computed property access)
- **Entry points excluded** — common lifecycle/handler names are whitelisted (constructor, render, etc.)
- Results should be treated as "likely unused" not "definitely unused"

## Delta Format
```json
{
  "codeQuality": {
    "summary": {
      "totalIssues": 15,
      "unusedFunctions": 3,
      "unusedMethods": 2,
      "unusedClasses": 1,
      "unusedImports": 5,
      "unusedDependencies": 2,
      "bySeverity": { "critical": 0, "warning": 5, "info": 10 }
    },
    "issues": [
      {
        "name": "processOldMessages",
        "file": "src/database.class.php",
        "line": 156,
        "type": "unused_method",
        "severity": "warning",
        "description": "\"processOldMessages\" is declared but never referenced in the project"
      }
    ],
    "complexity": [
      {
        "file": "src/bot.class.php",
        "complexity": 42,
        "lines": 350,
        "complexityPerLine": 0.12,
        "breakdown": { "if": 15, "else": 8, "for": 3, "while": 2 }
      }
    ],
    "unusedDependencies": [
      {
        "name": "lodash",
        "version": "^4.17.21",
        "source": "package.json",
        "description": "Dependency \"lodash\" is listed in package.json but not imported in code"
      }
    ]
  }
}
```
