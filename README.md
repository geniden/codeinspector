# CodeInspector

**Local code analyzer for web projects — generates structured reports for developers and AI agents.**

CodeInspector scans your project's source code (PHP, JavaScript, TypeScript, Vue) and produces a detailed, structured report: file tree, code structure, technology stack, code quality issues, and more. Reports are saved as JSON files and displayed in a modern web dashboard.

Designed as a **local tool** for developers — runs on your machine, no cloud, no data leaves your computer.

**Built on the [LAYERS pattern](https://github.com/geniden/layers-pattern)** — each analysis step is an isolated, testable layer with its own contract.

---

## What It Does

```
┌──────────────────────────────────────────────────────────┐
│                   CodeInspector Pipeline                  │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Project Root Directory                                   │
│         ↓                                                 │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Layer 1: File System                               │  │
│  │  • Scan directories, collect file metadata          │  │
│  │  • Build smart file tree (code files + asset count) │  │
│  │  • Skip minified files (.min.js, .min.css)          │  │
│  └─────────────────────────────────────────────────────┘  │
│         ↓ snapshot                                        │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Layer 2: Tech Stack Detection                      │  │
│  │  • Detect languages, frameworks, versions           │  │
│  │  • Parse package.json, composer.json, tsconfig.json │  │
│  │  • List dependencies (production + dev)             │  │
│  └─────────────────────────────────────────────────────┘  │
│         ↓ snapshot                                        │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Layer 3: Code Structure                            │  │
│  │  • Extract classes, functions, methods, imports     │  │
│  │  • Detect visibility, static, async, return types   │  │
│  │  • PHP, JS/TS, Vue SFC support                     │  │
│  └─────────────────────────────────────────────────────┘  │
│         ↓ snapshot                                        │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Layer 4: Code Quality                              │  │
│  │  • Unused functions, methods, classes               │  │
│  │  • Unused imports and dependencies                  │  │
│  │  • Large functions (language-aware thresholds)      │  │
│  │  • Commented-out code blocks (dead code)            │  │
│  │  • Cyclomatic complexity per file                   │  │
│  │  • PHP dynamic class loading detection              │  │
│  └─────────────────────────────────────────────────────┘  │
│         ↓                                                 │
│  JSON Report → saved to disk + displayed in dashboard     │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

## Features

- **File System Analysis** — smart file tree that shows code files individually and collapses assets (images, fonts, media) into a summary line
- **Technology Stack Detection** — identifies languages, frameworks, PHP/ECMAScript/TypeScript versions, package managers, config files
- **Code Structure Extraction** — classes, functions, methods with visibility, parameters, return types, inheritance
- **Code Quality Checks** — unused symbols, unused imports, unused dependencies, large functions, commented-out code blocks, cyclomatic complexity
- **PHP Dynamic Loading Awareness** — detects `new $variable` patterns and marks potentially dynamic classes as informational instead of false positives
- **Dependency Audit** — lists all npm/composer dependencies and checks if they are actually imported in the code
- **Report History** — all analysis reports are saved as JSON files, viewable without re-running analysis
- **Code Preview** — click any file path in an issue to open a quick code viewer with syntax highlighting and line scrolling
- **Light & Dark Themes** — switch between dark and light color schemes in Settings
- **Auto Port Selection** — if port 3031 is busy, automatically finds the next available port

## Supported Languages

| Language     | Structure | Quality | Versions |
|-------------|-----------|---------|----------|
| **PHP**     | Classes, functions, methods, properties | Unused code, dead code, complexity | Detected from composer.json + code patterns |
| **JavaScript** | Classes, functions, arrow functions, imports/exports | Unused code, dead code, complexity | ECMAScript version detected from code |
| **TypeScript** | Full JS support + type annotations | Same as JS | Detected from tsconfig.json |
| **Vue SFC** | Script section analysis (Options API + `<script setup>`) | Same as JS | — |
| **JSON** | package.json, composer.json, tsconfig.json parsing | Dependency audit | — |

## Current Limitations

- **Does not support WordPress** and similar CMS frameworks where code or templates may be stored in a database
- **Does not support frameworks with code generation** (e.g., scaffolded code that only exists after build)
- **Static analysis only** — does not execute code, does not resolve runtime dependencies
- **No AST parsing** — uses regex-based analysis (fast but may miss edge cases)

## Best Suited For

- **Microservices** on PHP or Node.js
- **Custom web applications** and frameworks
- **Self-written projects** without heavy framework magic
- **Code review preparation** — get a quick overview before diving into the code
- **AI agent context** — generate a compact JSON report as input for LLM-based code review

## Web Dashboard

CodeInspector includes a modern, responsive web dashboard with:

- **Projects page** — add, configure, and manage multiple projects
- **Report viewer** with 4 tabs:
  - **Overview** — stats, language badges with colors, frameworks, dependencies
  - **File Tree** — smart tree view + folder statistics with total script size
  - **Code Structure** — collapsible file-by-file view of classes, functions, methods
  - **Code Quality** — sorted issues with severity, clickable file paths, code preview
- **Settings** — theme switcher (dark/light), default excluded folders, LLM configuration
- **SQLite storage** — projects and analysis metadata persisted locally

## Quick Start (Windows 11)

### Option 1: Double-click launcher

```
start.bat
```

The launcher will:
1. Check that Node.js is installed
2. Install dependencies if `node_modules` is missing
3. Open the browser at `http://localhost:3031`
4. Start the server (keep the window open)

### Option 2: Manual start

```bash
# Clone the repository
git clone https://github.com/geniden/codeinspector.git
cd codeinspector

# Install dependencies
npm install

# Start the server
npm start

# Open in browser
# http://localhost:3031
```

### Requirements

- **Node.js** v18+ (tested on v22)
- **Windows 11** (primary platform, should work on macOS/Linux too)
- No other dependencies — SQLite is bundled via `better-sqlite3`

## Project Structure

```
codeinspector/
├── server/                              # Express.js backend
│   ├── server.js                        #   HTTP server with auto port selection
│   ├── database/
│   │   └── db.js                        #   SQLite connection + schema
│   └── routes/
│       ├── projects.js                  #   Project CRUD API
│       ├── analysis.js                  #   Analysis trigger + status polling
│       └── reports.js                   #   Report viewer + file preview API
│
├── layers/                              # Analysis layers (LAYERS pattern)
│   ├── core/
│   │   ├── base-layer.js               #   Abstract base class for all layers
│   │   ├── analysis-engine.js          #   Orchestrator: snapshot → deltas → commit
│   │   └── LAYER.md                    #   Core engine contract
│   ├── 01-file-system/
│   │   ├── file-system-layer.js        #   Directory scanning, file tree, metadata
│   │   └── LAYER.md                    #   Layer contract
│   ├── 02-tech-stack/
│   │   ├── tech-stack-layer.js         #   Language/framework/version detection
│   │   └── LAYER.md                    #   Layer contract
│   ├── 03-code-structure/
│   │   ├── code-structure-layer.js     #   Classes, functions, methods extraction
│   │   └── LAYER.md                    #   Layer contract
│   └── 04-code-quality/
│       ├── code-quality-layer.js       #   Unused code, dead code, complexity
│       └── LAYER.md                    #   Layer contract
│
├── frontend/                            # Single-page web dashboard
│   ├── index.html                      #   SPA layout
│   ├── css/style.css                   #   Dark + light themes
│   └── js/app.js                       #   Frontend logic
│
├── reports/                             # Generated JSON reports (per project)
├── data/                                # SQLite database (auto-created)
├── start.bat                            # Windows launcher
├── package.json
├── LICENSE
└── README.md
```

## LAYERS Pattern

Each analysis step is implemented as an isolated **layer** following the [LAYERS pattern](https://github.com/geniden/layers-pattern):

1. **Immutable snapshots** — each layer receives a frozen copy of the accumulated state
2. **Delta-based writes** — layers return only what changed, never mutate state directly
3. **Atomic commits** — all deltas are merged into the state at once
4. **Layer isolation** — each layer has its own `LAYER.md` contract and can be modified independently
5. **Deterministic** — same input always produces the same output

This makes each layer independently testable and easy for AI agents to understand and modify.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects |
| GET | `/api/projects/:id` | Get project details |
| POST | `/api/projects` | Create a new project |
| PUT | `/api/projects/:id` | Update project settings |
| DELETE | `/api/projects/:id` | Delete project and reports |
| POST | `/api/analysis/start` | Start analysis for a project |
| GET | `/api/analysis/:id/status` | Poll analysis progress |
| GET | `/api/reports/project/:id` | List reports for a project |
| GET | `/api/reports/:id` | Get full report data |
| GET | `/api/reports/file-preview/:projectId?path=...` | Read source file for code preview |
| DELETE | `/api/reports/:id` | Delete a report |
| GET | `/api/health` | Server health check |

## Roadmap

- [ ] WordPress layer — understand hooks, template hierarchy, `functions.php`
- [ ] Laravel/Symfony layer — route analysis, service container, middleware
- [ ] React/Vue component analysis — props, state, lifecycle
- [ ] AST-based parsing (replacing regex) for higher accuracy
- [ ] LLM integration (Ollama) — semantic code review with local models
- [ ] Multi-language interface (EN/RU)
- [ ] Export reports to PDF/HTML

---

## Author

Created by **Anton Emelyanov** — concept, architecture, and implementation.

- GitHub: [@geniden](https://github.com/geniden)
- Email: geniden@gmail.com

## License

MIT — Copyright (c) 2026 Anton Emelyanov
