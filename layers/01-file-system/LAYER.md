# Layer 01 — File System

## Purpose
Scans the project directory recursively, builds a file tree, collects file statistics, and reads file contents for subsequent layers.

## State Owned
- `fileSystem.*` — file tree, file list, statistics
- `_fileContents` — (internal, stripped from report) map of relative path → file content

## State Read
None (this is the first layer)

## Process
1. Validate that `project.root_path` exists on disk
2. Recursively scan directory, respecting `project.excluded_folders`
3. For each file: read content, count lines, get metadata
4. Build text-based file tree with last-modified dates
5. Calculate stats: by extension, by folder, totals
6. Store file contents in `_fileContents` for later layers

## Exclusion Rules
- Folders/files matching names in `excluded_folders`
- Hidden files/folders (starting with `.`) except `.env`, `.htaccess`
- Files larger than 5MB (metadata only, no content read)

## Delta Format
```json
{
  "fileSystem": {
    "rootPath": "/path/to/project",
    "totalFiles": 47,
    "totalLines": 8432,
    "totalFolders": 12,
    "byExtension": { ".js": 20, ".php": 15 },
    "fileTree": "├── src/\n│   ├── app.js (15.02.2026 14:30)\n...",
    "folderStats": [
      { "folder": "src", "files": 23, "lines": 4500, "size": 120000 }
    ],
    "files": [
      {
        "path": "src/app.js",
        "name": "app.js",
        "extension": ".js",
        "size": 2048,
        "lines": 89,
        "lastModified": "2026-02-15T12:00:00.000Z"
      }
    ]
  },
  "_fileContents": {
    "src/app.js": "const express = require('express');\n..."
  }
}
```
