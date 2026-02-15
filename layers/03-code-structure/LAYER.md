# Layer 03 — Code Structure

## Purpose
Extracts structural elements from source files: classes, functions, methods,
imports, exports, and comments. Uses regex-based pattern matching (no AST dependency).

## State Owned
- `codeStructure.*` — extracted code structure per file

## State Read
- `fileSystem.files` — list of files
- `_fileContents` — file contents to parse

## Supported Languages
- **PHP**: classes, methods, functions, properties, `use`/`require` imports, comments
- **JavaScript/TypeScript**: classes, methods, functions (declaration + arrow), ES6/CommonJS imports/exports, comments
- **Vue SFC**: extracts `<script>` block and analyzes as JavaScript

## Process
1. Iterate through all files with code extensions
2. Dispatch to language-specific analyzer based on extension
3. Extract: classes (with methods, properties), standalone functions, imports, exports, comments
4. Aggregate totals

## Delta Format
```json
{
  "codeStructure": {
    "totalClasses": 12,
    "totalFunctions": 89,
    "totalMethods": 156,
    "totalImports": 45,
    "totalExports": 30,
    "files": [
      {
        "path": "src/app.js",
        "language": "javascript",
        "classes": [
          {
            "name": "AppController",
            "extends": "BaseController",
            "methods": [
              { "name": "index", "params": ["req", "res"], "isAsync": true, "line": 15 }
            ],
            "line": 10
          }
        ],
        "functions": [
          { "name": "helper", "params": ["data"], "isAsync": false, "line": 50 }
        ],
        "imports": [
          { "source": "express", "specifiers": ["Router"], "type": "commonjs", "line": 1 }
        ],
        "exports": [
          { "name": "AppController", "type": "commonjs", "line": 60 }
        ],
        "comments": [
          { "text": "Handle incoming requests", "line": 14 }
        ]
      }
    ]
  }
}
```
