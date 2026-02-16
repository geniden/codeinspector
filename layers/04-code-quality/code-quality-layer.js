// ..\..\nodejs\code-inspector\layers\04-code-quality\code-quality-layer.js

const BaseLayer = require('../core/base-layer');

/**
 * CodeQualityLayer — detects unused code, unused imports/dependencies,
 * commented-out code blocks, and calculates basic complexity metrics.
 *
 * Note: large-function check was removed — with AI-written code, function sizes
 * have grown; strict line limits were too noisy.
 *
 * Now async-friendly: uses yieldControl() to avoid blocking the event loop.
 * Supports progress reporting via context.onProgress.
 */
class CodeQualityLayer extends BaseLayer {
  constructor() {
    super('code-quality');
  }

  async process(snapshot, context) {
    const fileContents = snapshot._fileContents || {};
    const codeStructure = snapshot.codeStructure || {};
    const techStack = snapshot.techStack || {};
    const filesAnalysis = codeStructure.files || [];

    const obfuscatedPaths = new Set(
      (snapshot.fileSystem?.files || [])
        .filter(f => f.obfuscated)
        .map(f => f.path)
    );

    this.context = context;
    this.obfuscatedPaths = obfuscatedPaths;

    // ─── Collect declared symbols ──────────────────────
    const declared = this.collectDeclaredSymbols(filesAnalysis);
    await this.yieldControl();

    // ─── Collect references (async-safe) ───────────────
    const referenced = await this.collectReferencesChunked(fileContents);
    await this.yieldControl();

    // ─── Detect dynamic loading (PHP) ──────────────────
    const hasDynamicLoading = this.detectDynamicClassLoading(fileContents);
    await this.yieldControl();

    // ─── Find unused symbols ───────────────────────────
    const unusedFunctions = this.findUnusedSymbols(declared.functions, referenced);
    const unusedMethods = this.findUnusedSymbols(declared.methods, referenced);
    const unusedClasses = this.findUnusedClasses(declared.classes, referenced, hasDynamicLoading);
    await this.yieldControl();

    // ─── Find unused imports ───────────────────────────
    const unusedImports = await this.findUnusedImportsChunked(filesAnalysis, fileContents);
    await this.yieldControl();

    // ─── Find unused dependencies ──────────────────────
    const unusedDependencies = await this.findUnusedDependenciesChunked(techStack, fileContents);
    await this.yieldControl();

    // ─── Commented-out code blocks ─────────────────────
    const commentedCode = await this.findCommentedCodeChunked(fileContents);
    await this.yieldControl();

    // ─── Complexity analysis ───────────────────────────
    const complexity = await this.analyzeComplexityChunked(fileContents);
    await this.yieldControl();

    // ─── Build issues list ─────────────────────────────
    const issues = [];
    unusedFunctions.forEach(f => issues.push({ ...f, type: 'unused_function', severity: 'warning', tag: 'never called' }));
    unusedMethods.forEach(f => issues.push({ ...f, type: 'unused_method', severity: 'warning', tag: 'never called' }));
    unusedClasses.forEach(f => issues.push({ ...f, type: 'unused_class', tag: f.dynamic ? 'possibly dynamic' : 'never instantiated' }));
    unusedImports.forEach(f => issues.push({ ...f, type: 'unused_import', severity: 'info', tag: 'never used' }));
    unusedDependencies.forEach(f => issues.push({ ...f, type: 'unused_dependency', severity: 'info', tag: 'not imported' }));
    commentedCode.forEach(f => issues.push({ ...f, type: 'commented_code', severity: 'info', tag: `${f.lines} lines` }));

    // Sort: critical → warning → info
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    issues.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9));

    return {
      codeQuality: {
        summary: {
          totalIssues: issues.length,
          unusedFunctions: unusedFunctions.length,
          unusedMethods: unusedMethods.length,
          unusedClasses: unusedClasses.length,
          unusedImports: unusedImports.length,
          unusedDependencies: unusedDependencies.length,
          commentedCode: commentedCode.length,
          hasDynamicLoading,
          bySeverity: {
            critical: issues.filter(i => i.severity === 'critical').length,
            warning: issues.filter(i => i.severity === 'warning').length,
            info: issues.filter(i => i.severity === 'info').length
          }
        },
        issues,
        complexity,
        unusedFunctions,
        unusedMethods,
        unusedClasses,
        unusedImports,
        unusedDependencies,
        commentedCode
      }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Yield control to prevent blocking the event loop
  // ─────────────────────────────────────────────────────────────
  async yieldControl() {
    if (this.context?.onProgress) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  // ═══════════════════════════════════════════════════════
  // Detect Dynamic Class Loading (PHP)
  // ═══════════════════════════════════════════════════════

  detectDynamicClassLoading(fileContents) {
    for (const [filePath, content] of Object.entries(fileContents)) {
      if (!content || !filePath.endsWith('.php')) continue;
      if (/new\s+\$\w+\s*\(/m.test(content)) return true;
      if (/\$\w+\s*=\s*ucfirst\s*\(/m.test(content)) return true;
      if (/call_user_func\s*\(\s*\[/m.test(content)) return true;
      if (/new\s+\$\$/m.test(content)) return true;
    }
    return false;
  }

  // ═══════════════════════════════════════════════════════
  // Collect Declared Symbols
  // ═══════════════════════════════════════════════════════

  collectDeclaredSymbols(filesAnalysis) {
    const functions = [];
    const methods = [];
    const classes = [];

    for (const file of filesAnalysis) {
      for (const func of (file.functions || [])) {
        functions.push({
          name: func.name,
          file: file.path,
          line: func.line,
          language: file.language
        });
      }

      for (const cls of (file.classes || [])) {
        classes.push({
          name: cls.name,
          file: file.path,
          line: cls.line,
          language: file.language
        });

        for (const method of (cls.methods || [])) {
          if (method.name === 'constructor' || method.name === '__construct' || method.name.startsWith('__')) continue;
          methods.push({
            name: method.name,
            className: cls.name,
            file: file.path,
            line: method.line,
            visibility: method.visibility,
            language: file.language
          });
        }
      }
    }

    return { functions, methods, classes };
  }

  // ═══════════════════════════════════════════════════════
  // Collect All References (async-safe)
  // ═══════════════════════════════════════════════════════

  async collectReferencesChunked(fileContents) {
    const references = new Set();
    const entries = Object.entries(fileContents);
    const total = entries.length;
    const MAX_CONTENT_LEN = 300000; // 300KB — limit per file to avoid blocking on huge files

    for (let i = 0; i < entries.length; i++) {
      const [filePath, content] = entries[i];
      if (!content) continue;
      if (this.obfuscatedPaths?.has(filePath)) continue;

      const text = content.length > MAX_CONTENT_LEN ? content.slice(0, MAX_CONTENT_LEN) : content;
      let match;

      // Match function calls, but exclude declarations (function name(, public function name(, etc.)
      const funcCallRegex = /\b(\w+)\s*\(/g;
      while ((match = funcCallRegex.exec(text)) !== null) {
        const before = text.slice(Math.max(0, match.index - 60), match.index);
        if (/\b(?:async\s+)?(?:function\s*\*?\s*|(?:public|protected|private|static)\s+(?:static\s+)?function\s+)$/m.test(before)) {
          continue; // Skip: this is a declaration, not a call
        }
        references.add(match[1]);
      }

      const methodCallRegex = /(?:->|\.|\:\:)\s*(\w+)\s*\(/g;
      while ((match = methodCallRegex.exec(text)) !== null) {
        references.add(match[1]);
      }

      const newClassRegex = /new\s+(\w+)/g;
      while ((match = newClassRegex.exec(text)) !== null) {
        references.add(match[1]);
      }

      const classRefRegex = /(?:extends|implements|instanceof|\:\s*)\s*(\w+)/g;
      while ((match = classRefRegex.exec(text)) !== null) {
        references.add(match[1]);
      }

      const staticCallRegex = /(\w+)\:\:/g;
      while ((match = staticCallRegex.exec(text)) !== null) {
        references.add(match[1]);
      }

      const importRefRegex = /(?:import|require|use)\s+.*?(\w+)/g;
      while ((match = importRefRegex.exec(text)) !== null) {
        references.add(match[1]);
      }

      await this.yieldControl();
      if (i % 25 === 0 && this.context?.onProgress) {
        this.context.onProgress({
          layer: 'Collecting references',
          current: i + 1,
          total
        });
      }
    }

    return references;
  }

  // ═══════════════════════════════════════════════════════
  // Find Unused Symbols
  // ═══════════════════════════════════════════════════════

  findUnusedSymbols(declared, referenced) {
    const unused = [];
    for (const symbol of declared) {
      const name = symbol.name;
      if (this.isEntryPoint(name)) continue;
      if (!referenced.has(name)) {
        unused.push({
          name,
          file: symbol.file,
          line: symbol.line,
          className: symbol.className || null,
          language: symbol.language,
          description: `"${name}" is declared but never referenced in the project`
        });
      }
    }
    return unused;
  }

  findUnusedClasses(declaredClasses, referenced, hasDynamicLoading) {
    const unused = [];
    for (const cls of declaredClasses) {
      const name = cls.name;
      if (this.isEntryPoint(name)) continue;
      if (!referenced.has(name)) {
        const isPhp = cls.language === 'php';
        const isDynamic = isPhp && hasDynamicLoading;
        unused.push({
          name,
          file: cls.file,
          line: cls.line,
          language: cls.language,
          dynamic: isDynamic,
          severity: isDynamic ? 'info' : 'warning',
          description: isDynamic
            ? `"${name}" has no direct reference — likely loaded dynamically`
            : `"${name}" is declared but never referenced`
        });
      }
    }
    return unused;
  }

  isEntryPoint(name) {
    const entryPoints = new Set([
      'main', 'init', 'setup', 'boot', 'register',
      'run', 'start', 'execute', 'handle',
      '__construct', '__destruct', '__get', '__set', '__call',
      '__callStatic', '__toString', '__invoke', '__clone',
      'render', 'componentDidMount', 'componentDidUpdate',
      'componentWillUnmount', 'useEffect', 'useState',
      'mounted', 'created', 'updated', 'destroyed', 'setup',
      'toJSON', 'toString', 'valueOf', 'Symbol',
      'get', 'set', 'post', 'put', 'delete', 'patch',
      'index', 'store', 'show', 'update', 'destroy', 'create'
    ]);
    return entryPoints.has(name);
  }

  // ═══════════════════════════════════════════════════════
  // Find Unused Imports (chunked)
  // ═══════════════════════════════════════════════════════

  async findUnusedImportsChunked(filesAnalysis, fileContents) {
    const unusedImports = [];
    const total = filesAnalysis.length;
    const MAX_LEN = 300000;

    for (let i = 0; i < filesAnalysis.length; i++) {
      await this.yieldControl();
      const file = filesAnalysis[i];
      const raw = fileContents[file.path];
      if (!raw) continue;
      const content = raw.length > MAX_LEN ? raw.slice(0, MAX_LEN) : raw;

      for (const imp of (file.imports || [])) {
        const specifiers = [...(imp.specifiers || []), ...(imp.alias ? [imp.alias] : [])];
        for (const specifier of specifiers) {
          if (!specifier || specifier.startsWith('$')) continue;
          const regex = new RegExp(`\\b${this.escapeRegex(specifier)}\\b`, 'g');
          const allMatches = content.match(regex);
          if (!allMatches || allMatches.length <= 1) {
            unusedImports.push({
              name: specifier,
              source: imp.source,
              file: file.path,
              line: imp.line,
              description: `Import "${specifier}" from "${imp.source}" is never used`
            });
          }
        }
      }

      if (i % 25 === 0 && this.context?.onProgress) {
        this.context.onProgress({ layer: 'Checking unused imports', current: i + 1, total });
      }
    }

    return unusedImports;
  }

  // ═══════════════════════════════════════════════════════
  // Find Unused Dependencies (chunked)
  // ═══════════════════════════════════════════════════════

  async findUnusedDependenciesChunked(techStack, fileContents) {
    const unused = [];
    const deps = techStack.dependencies || [];
    const total = deps.length;
    const MAX_LEN = 200000;

    for (let i = 0; i < deps.length; i++) {
      await this.yieldControl();
      const dep = deps[i];
      const name = dep.name;
      if (!name) continue;

      const implicit = ['php', 'node', 'typescript', '@types/', 'eslint', 'prettier', 'jest', 'webpack', 'vite', 'babel', 'dotenv'];
      if (implicit.some(p => name.includes(p))) continue;

      const namePattern = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let isUsed = false;

      for (const [filePath, content] of Object.entries(fileContents)) {
        if (!content) continue;
        const text = content.length > MAX_LEN ? content.slice(0, MAX_LEN) : content;
        if (new RegExp(`['"]${namePattern}['"/]`).test(text) ||
            new RegExp(`require\\s*\\(\\s*['"]${namePattern}`).test(text) ||
            new RegExp(`from\\s+['"]${namePattern}`).test(text) ||
            new RegExp(`use\\s+${namePattern.replace(/\//g, '\\\\\\\\')}`, 'i').test(text)) {
          isUsed = true;
          break;
        }
      }

      if (!isUsed) {
        unused.push({
          name,
          version: dep.version,
          source: dep.source,
          description: `Dependency "${name}" is listed but not imported`
        });
      }

      if (i % 10 === 0 && this.context?.onProgress) {
        this.context.onProgress({ layer: 'Checking dependencies', current: i + 1, total });
      }
    }

    return unused;
  }

  // ═══════════════════════════════════════════════════════
  // Find Commented-Out Code Blocks (chunked)
  // ═══════════════════════════════════════════════════════

  async findCommentedCodeChunked(fileContents) {
    const results = [];
    const entries = Object.entries(fileContents);
    const total = entries.length;
    const MIN_BLOCK = 8;
    const MAX_LEN = 300000;

    for (let i = 0; i < entries.length; i++) {
      await this.yieldControl();
      const [filePath, content] = entries[i];
      if (!content || !/\.(php|js|jsx|ts|tsx|vue)$/.test(filePath)) continue;
      if (this.obfuscatedPaths?.has(filePath)) continue;

      const text = content.length > MAX_LEN ? content.slice(0, MAX_LEN) : content;
      const lines = text.split('\n');
      let blockStart = -1, blockLines = 0, inBlockComment = false, isDocBlock = false;

      const flushBlock = (endLine) => {
        if (blockLines >= MIN_BLOCK && !isDocBlock) {
          results.push({
            name: `${blockLines} commented lines`,
            file: filePath,
            line: blockStart + 1,
            lines: blockLines,
            description: `${blockLines} consecutive commented lines`
          });
        }
        blockStart = -1;
        blockLines = 0;
        isDocBlock = false;
      };

      for (let j = 0; j < lines.length; j++) {
        const trimmed = lines[j].trim();
        if (!inBlockComment) {
          if (trimmed.startsWith('/*')) {
            isDocBlock = trimmed.startsWith('/**') || trimmed.startsWith('/*!');
            inBlockComment = true;
            if (blockStart === -1) blockStart = j;
            blockLines++;
            if (trimmed.includes('*/')) inBlockComment = false;
            continue;
          }
          if (trimmed.startsWith('//') || (trimmed.startsWith('#') && !trimmed.startsWith('#!'))) {
            if (blockStart === -1) blockStart = j;
            blockLines++;
            continue;
          }
          if (blockLines > 0) flushBlock(j);
        } else {
          blockLines++;
          if (trimmed.includes('*/')) {
            inBlockComment = false;
            if (!this._isNextLineComment(lines, j + 1)) flushBlock(j + 1);
          }
        }
      }
      if (blockLines > 0) flushBlock(lines.length);

      if (i % 25 === 0 && this.context?.onProgress) {
        this.context.onProgress({ layer: 'Scanning commented code', current: i + 1, total });
      }
    }

    return results;
  }

  _isNextLineComment(lines, idx) {
    if (idx >= lines.length) return false;
    const trimmed = lines[idx].trim();
    return trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*');
  }

  // ═══════════════════════════════════════════════════════
  // Complexity Analysis (chunked)
  // ═══════════════════════════════════════════════════════

  async analyzeComplexityChunked(fileContents) {
    const fileComplexity = [];
    const entries = Object.entries(fileContents);
    const total = entries.length;
    const MAX_LEN = 300000;

    for (let i = 0; i < entries.length; i++) {
      await this.yieldControl();
      const [filePath, content] = entries[i];
      if (!content || !/\.(php|js|jsx|ts|tsx)$/.test(filePath)) continue;
      if (this.obfuscatedPaths?.has(filePath)) continue;

      const text = content.length > MAX_LEN ? content.slice(0, MAX_LEN) : content;
      const ifCount = (text.match(/\bif\s*\(/g) || []).length;
      const elseCount = (text.match(/\belse\b/g) || []).length;
      const forCount = (text.match(/\bfor\s*\(/g) || []).length;
      const whileCount = (text.match(/\bwhile\s*\(/g) || []).length;
      const switchCount = (text.match(/\bswitch\s*\(/g) || []).length;
      const caseCount = (text.match(/\bcase\s+/g) || []).length;
      const catchCount = (text.match(/\bcatch\s*\(/g) || []).length;
      const ternaryCount = (text.match(/\?[^?.:]/g) || []).length;
      const andOrCount = (text.match(/&&|\|\|/g) || []).length;

      const complexity = 1 + ifCount + elseCount + forCount + whileCount + switchCount + caseCount + catchCount + ternaryCount + andOrCount;
      const lines = text.split('\n').length;

      if (complexity > 10) {
        fileComplexity.push({
          file: filePath,
          complexity,
          lines,
          complexityPerLine: +(complexity / lines).toFixed(3),
          breakdown: { if: ifCount, else: elseCount, for: forCount, while: whileCount, switch: switchCount, case: caseCount, catch: catchCount, ternary: ternaryCount, logicalOps: andOrCount }
        });
      }

      if (i % 25 === 0 && this.context?.onProgress) {
        this.context.onProgress({ layer: 'Calculating complexity', current: i + 1, total });
      }
    }

    return fileComplexity.sort((a, b) => b.complexity - a.complexity);
  }

  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

module.exports = CodeQualityLayer;