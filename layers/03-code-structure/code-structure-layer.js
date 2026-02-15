const BaseLayer = require('../core/base-layer');
const path = require('path');

/**
 * CodeStructureLayer — extracts classes, functions, methods, imports, exports,
 * and comments from PHP and JS/TS files using regex-based pattern matching.
 */
class CodeStructureLayer extends BaseLayer {
  constructor() {
    super('code-structure');
  }

  async process(snapshot, context) {
    const fileContents = snapshot._fileContents || {};
    const filesList = (snapshot.fileSystem && snapshot.fileSystem.files) || [];

    const filesAnalysis = [];
    let totalClasses = 0;
    let totalFunctions = 0;
    let totalMethods = 0;
    let totalImports = 0;
    let totalExports = 0;

    for (const fileInfo of filesList) {
      const content = fileContents[fileInfo.path];
      if (!content) continue;

      const ext = fileInfo.extension;
      let analysis = null;

      if (ext === '.php') {
        analysis = this.analyzePhp(content, fileInfo.path);
      } else if (['.js', '.jsx', '.mjs', '.ts', '.tsx'].includes(ext)) {
        analysis = this.analyzeJs(content, fileInfo.path);
      } else if (ext === '.vue') {
        analysis = this.analyzeVue(content, fileInfo.path);
      }

      if (analysis) {
        filesAnalysis.push(analysis);
        totalClasses += analysis.classes.length;
        totalFunctions += analysis.functions.length;
        totalMethods += analysis.classes.reduce((sum, c) => sum + c.methods.length, 0);
        totalImports += analysis.imports.length;
        totalExports += analysis.exports.length;
      }
    }

    return {
      codeStructure: {
        totalClasses,
        totalFunctions,
        totalMethods,
        totalImports,
        totalExports,
        files: filesAnalysis
      }
    };
  }

  // ═══════════════════════════════════════════════════════
  // PHP Analysis
  // ═══════════════════════════════════════════════════════

  analyzePhp(content, filePath) {
    const result = {
      path: filePath,
      language: 'php',
      classes: [],
      functions: [],
      imports: [],
      exports: [],
      comments: []
    };

    const lines = content.split('\n');

    // ─── Extract comments (single-line // and block /** */)
    const commentRegex = /\/\/\s*(.+)/g;
    let match;
    while ((match = commentRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      result.comments.push({ text: match[1].trim(), line });
    }

    // ─── Extract namespace and use statements (imports)
    const useRegex = /^use\s+([\w\\]+)(?:\s+as\s+(\w+))?\s*;/gm;
    while ((match = useRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      result.imports.push({
        source: match[1],
        alias: match[2] || null,
        line
      });
    }

    // ─── Extract require/include
    const requireRegex = /(?:require|include)(?:_once)?\s*(?:\(?\s*['"]([^'"]+)['"]\s*\)?|(\$\w+))/gm;
    while ((match = requireRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      result.imports.push({
        source: match[1] || match[2],
        type: 'require',
        line
      });
    }

    // ─── Extract classes
    const classRegex = /(?:(?:abstract|final)\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s\\]+))?\s*\{/g;
    while ((match = classRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      const className = match[1];
      const extendsClass = match[2] || null;
      const implementsList = match[3] ? match[3].split(',').map(s => s.trim()) : [];

      // Find methods inside this class
      const classBody = this.extractBlock(content, match.index + match[0].length - 1);
      const methods = this.extractPhpMethods(classBody, content.substring(0, match.index).split('\n').length);

      // Find properties
      const properties = this.extractPhpProperties(classBody);

      result.classes.push({
        name: className,
        extends: extendsClass,
        implements: implementsList,
        methods,
        properties,
        line
      });
    }

    // ─── Extract standalone functions
    const funcRegex = /(?:^|\n)\s*function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([\w|?\\]+))?\s*\{/g;
    while ((match = funcRegex.exec(content)) !== null) {
      // Make sure this function is NOT inside a class
      const beforeFunc = content.substring(0, match.index);
      if (this.isInsideClass(beforeFunc)) continue;

      const line = beforeFunc.split('\n').length;
      result.functions.push({
        name: match[1],
        params: this.parseParams(match[2]),
        returnType: match[3] || null,
        line
      });
    }

    return result;
  }

  extractPhpMethods(classBody, classStartLine) {
    const methods = [];
    const methodRegex = /(public|protected|private|static)\s+(?:static\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*([\w|?\\]+))?\s*\{/g;
    let match;

    while ((match = methodRegex.exec(classBody)) !== null) {
      const line = classStartLine + classBody.substring(0, match.index).split('\n').length - 1;
      methods.push({
        name: match[2],
        visibility: match[1],
        params: this.parseParams(match[3]),
        returnType: match[4] || null,
        isStatic: match[0].includes('static'),
        line
      });
    }

    return methods;
  }

  extractPhpProperties(classBody) {
    const properties = [];
    const propRegex = /(public|protected|private)\s+(?:static\s+)?(?:([\w|?\\]+)\s+)?\$(\w+)/g;
    let match;

    while ((match = propRegex.exec(classBody)) !== null) {
      properties.push({
        name: match[3],
        visibility: match[1],
        type: match[2] || null
      });
    }

    return properties;
  }

  // ═══════════════════════════════════════════════════════
  // JavaScript / TypeScript Analysis
  // ═══════════════════════════════════════════════════════

  analyzeJs(content, filePath) {
    const result = {
      path: filePath,
      language: filePath.match(/\.tsx?$/) ? 'typescript' : 'javascript',
      classes: [],
      functions: [],
      imports: [],
      exports: [],
      comments: []
    };

    // ─── Extract comments
    const commentRegex = /\/\/\s*(.+)/g;
    let match;
    while ((match = commentRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      // Skip comments that are inside strings or URLs
      if (match[1].startsWith('/')) continue;
      result.comments.push({ text: match[1].trim(), line });
    }

    // ─── Extract imports
    // ES6 imports
    const es6ImportRegex = /import\s+(?:(?:\{([^}]+)\}|\*\s+as\s+(\w+)|(\w+))(?:\s*,\s*(?:\{([^}]+)\}|\*\s+as\s+(\w+)|(\w+)))?\s+from\s+)?['"]([@\w\/.\\-]+)['"]/g;
    while ((match = es6ImportRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      const specifiers = [];
      if (match[1]) specifiers.push(...match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]));
      if (match[2]) specifiers.push(match[2]);
      if (match[3]) specifiers.push(match[3]);
      if (match[4]) specifiers.push(...match[4].split(',').map(s => s.trim().split(/\s+as\s+/)[0]));

      result.imports.push({
        source: match[7],
        specifiers,
        type: 'es6',
        line
      });
    }

    // CommonJS require
    const requireRegex = /(?:const|let|var)\s+(?:\{([^}]+)\}|(\w+))\s*=\s*require\s*\(\s*['"]([@\w\/.\\-]+)['"]\s*\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      const specifiers = [];
      if (match[1]) specifiers.push(...match[1].split(',').map(s => s.trim()));
      if (match[2]) specifiers.push(match[2]);

      result.imports.push({
        source: match[3],
        specifiers,
        type: 'commonjs',
        line
      });
    }

    // ─── Extract classes
    const classRegex = /(?:export\s+(?:default\s+)?)?class\s+(\w+)(?:\s+extends\s+(\w+))?\s*\{/g;
    while ((match = classRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      const className = match[1];
      const classBody = this.extractBlock(content, match.index + match[0].length - 1);
      const methods = this.extractJsMethods(classBody, line);

      result.classes.push({
        name: className,
        extends: match[2] || null,
        methods,
        line,
        isExported: match[0].includes('export')
      });
    }

    // ─── Extract functions
    // Named function declarations
    const funcDeclRegex = /(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*\{/g;
    while ((match = funcDeclRegex.exec(content)) !== null) {
      if (this.isInsideClass(content.substring(0, match.index))) continue;
      const line = content.substring(0, match.index).split('\n').length;
      result.functions.push({
        name: match[1],
        params: this.parseParams(match[2]),
        isAsync: match[0].includes('async'),
        isExported: match[0].includes('export'),
        line
      });
    }

    // Arrow / const functions
    const arrowRegex = /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|(\w+))\s*=>/g;
    while ((match = arrowRegex.exec(content)) !== null) {
      if (this.isInsideClass(content.substring(0, match.index))) continue;
      const line = content.substring(0, match.index).split('\n').length;
      result.functions.push({
        name: match[1],
        type: 'arrow',
        isAsync: match[0].includes('async'),
        isExported: match[0].includes('export'),
        line
      });
    }

    // ─── Extract exports
    // module.exports
    const moduleExportsRegex = /module\.exports\s*=\s*(?:\{([^}]+)\}|(\w+))/g;
    while ((match = moduleExportsRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      if (match[1]) {
        const names = match[1].split(',').map(s => s.trim().split(':')[0].trim()).filter(Boolean);
        names.forEach(name => result.exports.push({ name, type: 'commonjs', line }));
      } else if (match[2]) {
        result.exports.push({ name: match[2], type: 'commonjs', line });
      }
    }

    // Named exports
    const namedExportRegex = /export\s+\{([^}]+)\}/g;
    while ((match = namedExportRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      const names = match[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
      names.forEach(name => result.exports.push({ name, type: 'es6', line }));
    }

    // export default
    const defaultExportRegex = /export\s+default\s+(?:class|function\s+)?(\w+)/g;
    while ((match = defaultExportRegex.exec(content)) !== null) {
      const line = content.substring(0, match.index).split('\n').length;
      result.exports.push({ name: match[1], type: 'default', line });
    }

    return result;
  }

  extractJsMethods(classBody, classStartLine) {
    const methods = [];
    // JS class methods: async methodName(...) { or methodName(...) {
    const methodRegex = /(?:(?:static|async|get|set)\s+)*(\w+)\s*\(([^)]*)\)\s*\{/g;
    let match;

    while ((match = methodRegex.exec(classBody)) !== null) {
      const name = match[1];
      // Skip constructor of nested objects
      if (['if', 'for', 'while', 'switch', 'catch', 'function'].includes(name)) continue;
      const line = classStartLine + classBody.substring(0, match.index).split('\n').length - 1;
      methods.push({
        name,
        params: this.parseParams(match[2]),
        isStatic: match[0].includes('static'),
        isAsync: match[0].includes('async'),
        isGetter: match[0].includes('get '),
        isSetter: match[0].includes('set '),
        line
      });
    }

    return methods;
  }

  // ═══════════════════════════════════════════════════════
  // Vue SFC Analysis
  // ═══════════════════════════════════════════════════════

  analyzeVue(content, filePath) {
    // Extract <script> block and analyze as JS
    const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (!scriptMatch) {
      return {
        path: filePath,
        language: 'vue',
        classes: [],
        functions: [],
        imports: [],
        exports: [],
        comments: []
      };
    }

    const scriptContent = scriptMatch[1];
    const isSetup = scriptMatch[0].includes('setup');
    const result = this.analyzeJs(scriptContent, filePath);
    result.language = 'vue';
    result.isScriptSetup = isSetup;

    return result;
  }

  // ═══════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════

  /**
   * Extract a brace-delimited block starting at the opening brace.
   */
  extractBlock(content, startIndex) {
    let depth = 0;
    let i = startIndex;
    const start = startIndex;

    while (i < content.length) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') {
        depth--;
        if (depth === 0) return content.substring(start, i + 1);
      }
      i++;
    }

    return content.substring(start);
  }

  /**
   * Check if a position is inside a class body (rough heuristic).
   */
  isInsideClass(textBefore) {
    const classOpens = (textBefore.match(/class\s+\w+[^{]*\{/g) || []).length;
    const braceBalance = (textBefore.match(/\{/g) || []).length - (textBefore.match(/\}/g) || []).length;
    return classOpens > 0 && braceBalance > 0;
  }

  /**
   * Parse a comma-separated parameter list.
   */
  parseParams(paramsStr) {
    if (!paramsStr || !paramsStr.trim()) return [];
    return paramsStr.split(',').map(p => p.trim()).filter(Boolean).map(p => {
      // Handle typed params: "string $name = 'default'" or "name: string"
      const parts = p.split(/[=]/).map(s => s.trim());
      return parts[0].replace(/^\.\.\./, '');
    });
  }
}

module.exports = CodeStructureLayer;
