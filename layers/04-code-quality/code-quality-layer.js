const BaseLayer = require('../core/base-layer');

/**
 * CodeQualityLayer — detects unused code, unused imports/dependencies,
 * large functions, and calculates basic complexity metrics.
 *
 * Aware of PHP dynamic class loading patterns (new $variable).
 */
class CodeQualityLayer extends BaseLayer {
  constructor() {
    super('code-quality');
  }

  // Language-aware thresholds for "large function"
  static THRESHOLDS = {
    php: 500,
    javascript: 100,
    typescript: 100,
    vue: 100,
    default: 150
  };

  // Languages where large functions are informational, not warnings
  static LENIENT_LANGUAGES = new Set(['php', 'javascript', 'typescript', 'vue']);

  async process(snapshot, context) {
    const fileContents = snapshot._fileContents || {};
    const codeStructure = snapshot.codeStructure || {};
    const techStack = snapshot.techStack || {};
    const filesAnalysis = codeStructure.files || [];

    // Collect all declared symbols and all references across the project
    const declared = this.collectDeclaredSymbols(filesAnalysis);
    const referenced = this.collectReferences(fileContents);

    // Detect dynamic class loading patterns in PHP
    const hasDynamicLoading = this.detectDynamicClassLoading(fileContents);

    // ─── Find unused functions/methods ───
    const unusedFunctions = this.findUnusedSymbols(declared.functions, referenced);
    const unusedMethods = this.findUnusedSymbols(declared.methods, referenced);
    const unusedClasses = this.findUnusedClasses(declared.classes, referenced, hasDynamicLoading);

    // ─── Find unused imports ───
    const unusedImports = this.findUnusedImports(filesAnalysis, fileContents);

    // ─── Find unused npm/composer dependencies ───
    const unusedDependencies = this.findUnusedDependencies(techStack, fileContents);

    // ─── Detect large functions (language-aware thresholds) ───
    const largeFunctions = this.findLargeFunctions(fileContents, filesAnalysis);

    // ─── Detect large commented-out code blocks ───
    const commentedCode = this.findCommentedCode(fileContents);

    // ─── Calculate file complexity ───
    const complexity = this.analyzeComplexity(fileContents);

    // ─── Build issues list ───
    const issues = [];
    unusedFunctions.forEach(f => issues.push({ ...f, type: 'unused_function', severity: 'warning', tag: 'never called' }));
    unusedMethods.forEach(f => issues.push({ ...f, type: 'unused_method', severity: 'warning', tag: 'never called' }));
    unusedClasses.forEach(f => issues.push({ ...f, type: 'unused_class', tag: f.dynamic ? 'possibly dynamic' : 'never instantiated' }));
    unusedImports.forEach(f => issues.push({ ...f, type: 'unused_import', severity: 'info', tag: 'never used' }));
    unusedDependencies.forEach(f => issues.push({ ...f, type: 'unused_dependency', severity: 'info', tag: 'not imported' }));
    largeFunctions.forEach(f => {
      const sev = CodeQualityLayer.LENIENT_LANGUAGES.has(f.language) ? 'info' : 'warning';
      issues.push({ ...f, type: 'large_function', severity: sev, tag: `${f.lines} lines` });
    });
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
          largeFunctions: largeFunctions.length,
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
        largeFunctions,
        commentedCode
      }
    };
  }

  // ═══════════════════════════════════════════════════════
  // Detect Dynamic Class Loading (PHP)
  // ═══════════════════════════════════════════════════════

  /**
   * Detect patterns like: new $variable, new $class(...), $class = ucfirst(...)
   * If present, unused class reports become "info" instead of "warning".
   */
  detectDynamicClassLoading(fileContents) {
    for (const [filePath, content] of Object.entries(fileContents)) {
      if (!content || !filePath.endsWith('.php')) continue;

      // Pattern: new $variable(...)
      if (/new\s+\$\w+\s*\(/m.test(content)) return true;

      // Pattern: $class = ucfirst(...); or $class = '...' class name from variable
      if (/\$\w+\s*=\s*ucfirst\s*\(/m.test(content)) return true;

      // Pattern: call_user_func with array (dynamic method calls)
      if (/call_user_func\s*\(\s*\[/m.test(content)) return true;

      // Pattern: $obj = new $$variable
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
      // Standalone functions
      for (const func of (file.functions || [])) {
        functions.push({
          name: func.name,
          file: file.path,
          line: func.line,
          language: file.language
        });
      }

      // Classes and their methods
      for (const cls of (file.classes || [])) {
        classes.push({
          name: cls.name,
          file: file.path,
          line: cls.line,
          language: file.language
        });

        for (const method of (cls.methods || [])) {
          // Skip constructor and magic methods
          if (method.name === 'constructor' || method.name === '__construct' ||
              method.name.startsWith('__')) continue;

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
  // Collect All References (function calls, class usage)
  // ═══════════════════════════════════════════════════════

  collectReferences(fileContents) {
    const references = new Set();

    for (const [filePath, content] of Object.entries(fileContents)) {
      if (!content) continue;

      let match;

      // Function calls: functionName(
      const funcCallRegex = /\b(\w+)\s*\(/g;
      while ((match = funcCallRegex.exec(content)) !== null) {
        references.add(match[1]);
      }

      // Method calls: ->methodName( or .methodName( or ::methodName(
      const methodCallRegex = /(?:->|\.|\:\:)\s*(\w+)\s*\(/g;
      while ((match = methodCallRegex.exec(content)) !== null) {
        references.add(match[1]);
      }

      // Class instantiation: new ClassName
      const newClassRegex = /new\s+(\w+)/g;
      while ((match = newClassRegex.exec(content)) !== null) {
        references.add(match[1]);
      }

      // Class references in type hints, extends, implements
      const classRefRegex = /(?:extends|implements|instanceof|\:\s*)\s*(\w+)/g;
      while ((match = classRefRegex.exec(content)) !== null) {
        references.add(match[1]);
      }

      // PHP static calls: ClassName::
      const staticCallRegex = /(\w+)\:\:/g;
      while ((match = staticCallRegex.exec(content)) !== null) {
        references.add(match[1]);
      }

      // Import specifiers
      const importRefRegex = /(?:import|require|use)\s+.*?(\w+)/g;
      while ((match = importRefRegex.exec(content)) !== null) {
        references.add(match[1]);
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

      // Skip common entry points and lifecycle methods
      if (this.isEntryPoint(name)) continue;

      // Check if the symbol name appears in references
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

  /**
   * Find unused classes, with special handling for dynamic loading.
   * If dynamic class loading is detected (new $var), unused PHP classes
   * get severity "info" instead of "warning" and a note about dynamic loading.
   */
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
            ? `"${name}" has no direct reference — likely loaded dynamically (new $variable pattern detected)`
            : `"${name}" is declared but never referenced in the project`
        });
      }
    }

    return unused;
  }

  isEntryPoint(name) {
    const entryPoints = new Set([
      'main', 'init', 'setup', 'boot', 'register',
      'run', 'start', 'execute', 'handle',
      // PHP magic methods
      '__construct', '__destruct', '__get', '__set', '__call',
      '__callStatic', '__toString', '__invoke', '__clone',
      // JS lifecycle
      'render', 'componentDidMount', 'componentDidUpdate',
      'componentWillUnmount', 'useEffect', 'useState',
      'mounted', 'created', 'updated', 'destroyed', 'setup',
      // Common patterns
      'toJSON', 'toString', 'valueOf', 'Symbol',
      'get', 'set', 'post', 'put', 'delete', 'patch',
      'index', 'store', 'show', 'update', 'destroy', 'create'
    ]);
    return entryPoints.has(name);
  }

  // ═══════════════════════════════════════════════════════
  // Find Unused Imports
  // ═══════════════════════════════════════════════════════

  findUnusedImports(filesAnalysis, fileContents) {
    const unusedImports = [];

    for (const file of filesAnalysis) {
      const content = fileContents[file.path];
      if (!content) continue;

      for (const imp of (file.imports || [])) {
        const specifiers = imp.specifiers || [];
        if (specifiers.length === 0 && imp.alias) {
          specifiers.push(imp.alias);
        }

        for (const specifier of specifiers) {
          if (!specifier || specifier.startsWith('$')) continue;

          // Count occurrences in the file (subtract the import line itself)
          const allMatches = content.match(new RegExp(`\\b${this.escapeRegex(specifier)}\\b`, 'g'));
          const importMatches = 1; // The import itself

          if (!allMatches || allMatches.length <= importMatches) {
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
    }

    return unusedImports;
  }

  // ═══════════════════════════════════════════════════════
  // Find Unused Dependencies (npm / composer)
  // ═══════════════════════════════════════════════════════

  findUnusedDependencies(techStack, fileContents) {
    const unused = [];
    const deps = techStack.dependencies || [];

    const allCode = Object.values(fileContents).filter(Boolean).join('\n');

    for (const dep of deps) {
      const name = dep.name;
      if (!name) continue;

      const implicit = ['php', 'node', 'typescript', 'nodemon', '@types/',
        'eslint', 'prettier', 'jest', 'mocha', 'webpack', 'vite', 'babel',
        'autoprefixer', 'postcss', 'sass', 'less', 'dotenv'];
      if (implicit.some(p => name.includes(p))) continue;

      const namePattern = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const isUsed = new RegExp(`['"]${namePattern}['"/]`).test(allCode) ||
                     new RegExp(`require\\s*\\(\\s*['"]${namePattern}`).test(allCode) ||
                     new RegExp(`from\\s+['"]${namePattern}`).test(allCode) ||
                     new RegExp(`use\\s+${namePattern.replace(/\//g, '\\\\\\\\')}`, 'i').test(allCode);

      if (!isUsed) {
        unused.push({
          name,
          version: dep.version,
          source: dep.source,
          description: `Dependency "${name}" is listed in ${dep.source} but not imported in code`
        });
      }
    }

    return unused;
  }

  // ═══════════════════════════════════════════════════════
  // Find Large Functions (language-aware thresholds)
  // ═══════════════════════════════════════════════════════

  findLargeFunctions(fileContents, filesAnalysis) {
    const large = [];

    for (const file of filesAnalysis) {
      const content = fileContents[file.path];
      if (!content) continue;
      const lines = content.split('\n');

      const lang = file.language || 'default';
      const threshold = CodeQualityLayer.THRESHOLDS[lang] || CodeQualityLayer.THRESHOLDS.default;

      // Check standalone functions
      for (const func of (file.functions || [])) {
        const funcLines = this.countFunctionLines(lines, func.line - 1);
        if (funcLines > threshold) {
          large.push({
            name: func.name,
            file: file.path,
            line: func.line,
            lines: funcLines,
            threshold,
            language: lang,
            description: `Function "${func.name}" is ${funcLines} lines (threshold for ${lang}: ${threshold})`
          });
        }
      }

      // Check methods
      for (const cls of (file.classes || [])) {
        for (const method of (cls.methods || [])) {
          const methodLines = this.countFunctionLines(lines, method.line - 1);
          if (methodLines > threshold) {
            large.push({
              name: `${cls.name}.${method.name}`,
              file: file.path,
              line: method.line,
              lines: methodLines,
              threshold,
              language: lang,
              description: `Method "${cls.name}.${method.name}" is ${methodLines} lines (threshold for ${lang}: ${threshold})`
            });
          }
        }
      }
    }

    return large;
  }

  countFunctionLines(lines, startLine) {
    let depth = 0;
    let started = false;
    let count = 0;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i];
      for (const ch of line) {
        if (ch === '{') { depth++; started = true; }
        if (ch === '}') depth--;
      }
      if (started) count++;
      if (started && depth === 0) break;
    }

    return count;
  }

  // ═══════════════════════════════════════════════════════
  // Find Commented-Out Code Blocks
  // ═══════════════════════════════════════════════════════

  /**
   * Detect large blocks of commented-out code in PHP/JS/TS files.
   * Flags blocks of 8+ consecutive commented lines as "dead code".
   * Ignores normal doc-blocks (/** ... * /).
   */
  findCommentedCode(fileContents) {
    const results = [];
    const MIN_BLOCK = 8; // minimum consecutive lines to flag

    for (const [filePath, content] of Object.entries(fileContents)) {
      if (!content) continue;
      if (!/\.(php|js|jsx|ts|tsx|vue)$/.test(filePath)) continue;

      const lines = content.split('\n');
      let blockStart = -1;
      let blockLines = 0;
      let inBlockComment = false;
      let isDocBlock = false;

      const flushBlock = (endLine) => {
        if (blockLines >= MIN_BLOCK && !isDocBlock) {
          results.push({
            name: `${blockLines} commented lines`,
            file: filePath,
            line: blockStart + 1,
            lines: blockLines,
            description: `${blockLines} consecutive commented lines (line ${blockStart + 1}–${endLine}). Consider removing dead code to reduce file size.`
          });
        }
        blockStart = -1;
        blockLines = 0;
        isDocBlock = false;
      };

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        // Track block comments /* ... */
        if (!inBlockComment) {
          // Start of block comment
          if (trimmed.startsWith('/*')) {
            // Detect doc-block: /** or /*! (intentional documentation)
            isDocBlock = trimmed.startsWith('/**') || trimmed.startsWith('/*!');
            inBlockComment = true;
            if (blockStart === -1) blockStart = i;
            blockLines++;
            // Single-line block comment
            if (trimmed.includes('*/') && trimmed.indexOf('*/') > trimmed.indexOf('/*') + 1) {
              inBlockComment = false;
              // Don't flush single-line comments
              if (blockLines < MIN_BLOCK && !this._isNextLineComment(lines, i + 1)) {
                flushBlock(i + 1);
              }
            }
            continue;
          }

          // Single-line comment: // or #
          if (trimmed.startsWith('//') || (trimmed.startsWith('#') && !trimmed.startsWith('#!'))) {
            // Skip short comments (likely intentional doc/notes)
            const commentText = trimmed.replace(/^\/\/\s*|^#\s*/, '');

            // Heuristic: real commented-out code usually has code-like patterns
            if (blockStart === -1) blockStart = i;
            blockLines++;
            continue;
          }

          // Not a comment line — flush any accumulated block
          if (blockLines > 0) {
            flushBlock(i);
          }
        } else {
          // Inside a block comment
          blockLines++;
          if (trimmed.includes('*/')) {
            inBlockComment = false;
            // Check if next line continues with comments
            if (!this._isNextLineComment(lines, i + 1)) {
              flushBlock(i + 1);
            }
          }
        }
      }

      // Flush remaining block at end of file
      if (blockLines > 0) {
        flushBlock(lines.length);
      }
    }

    return results;
  }

  _isNextLineComment(lines, idx) {
    if (idx >= lines.length) return false;
    const trimmed = lines[idx].trim();
    return trimmed.startsWith('//') || trimmed.startsWith('#') ||
           trimmed.startsWith('/*') || trimmed.startsWith('*');
  }

  // ═══════════════════════════════════════════════════════
  // Complexity Analysis
  // ═══════════════════════════════════════════════════════

  analyzeComplexity(fileContents) {
    const fileComplexity = [];

    for (const [filePath, content] of Object.entries(fileContents)) {
      if (!content) continue;
      if (!/\.(php|js|jsx|ts|tsx)$/.test(filePath)) continue;

      const ifCount = (content.match(/\bif\s*\(/g) || []).length;
      const elseCount = (content.match(/\belse\b/g) || []).length;
      const forCount = (content.match(/\bfor\s*\(/g) || []).length;
      const whileCount = (content.match(/\bwhile\s*\(/g) || []).length;
      const switchCount = (content.match(/\bswitch\s*\(/g) || []).length;
      const caseCount = (content.match(/\bcase\s+/g) || []).length;
      const catchCount = (content.match(/\bcatch\s*\(/g) || []).length;
      const ternaryCount = (content.match(/\?[^?.:]/g) || []).length;
      const andOrCount = (content.match(/&&|\|\|/g) || []).length;

      const complexity = 1 + ifCount + elseCount + forCount + whileCount +
                         switchCount + caseCount + catchCount + ternaryCount + andOrCount;

      const lines = content.split('\n').length;

      if (complexity > 10) {
        fileComplexity.push({
          file: filePath,
          complexity,
          lines,
          complexityPerLine: +(complexity / lines).toFixed(3),
          breakdown: { if: ifCount, else: elseCount, for: forCount, while: whileCount, switch: switchCount, case: caseCount, catch: catchCount, ternary: ternaryCount, logicalOps: andOrCount }
        });
      }
    }

    return fileComplexity.sort((a, b) => b.complexity - a.complexity);
  }

  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

module.exports = CodeQualityLayer;
