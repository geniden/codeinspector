const BaseLayer = require('../core/base-layer');
const fs = require('fs');
const path = require('path');

/**
 * FileSystemLayer — scans project directory, builds file tree, collects stats.
 * This is always the FIRST layer to run. All subsequent layers depend on its output.
 */
class FileSystemLayer extends BaseLayer {
  constructor() {
    super('file-system');
  }

  // Extensions we read & analyze as code
  static CODE_EXTENSIONS = new Set([
    '.php', '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte',
    '.html', '.htm', '.css', '.scss', '.less', '.sass',
    '.json', '.xml', '.yaml', '.yml', '.env', '.sql',
    '.md', '.txt', '.sh', '.bash', '.bat', '.ps1',
    '.py', '.rb', '.go', '.java', '.c', '.cpp', '.h',
    '.twig', '.blade.php', '.ejs', '.pug', '.hbs'
  ]);

  // Extensions shown individually in the file tree (programming-related)
  static TREE_CODE_EXTENSIONS = new Set([
    '.php', '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte',
    '.json', '.xml', '.yaml', '.yml', '.env', '.sql',
    '.md', '.sh', '.bash', '.bat', '.ps1',
    '.py', '.rb', '.go', '.java', '.c', '.cpp', '.h',
    '.twig', '.blade.php', '.ejs', '.pug', '.hbs',
    '.html', '.htm', '.css', '.scss', '.less', '.sass',
    '.txt', '.config', '.lock', '.toml', '.ini', '.conf',
    '.graphql', '.prisma', '.proto'
  ]);

  // Asset/binary extensions that are collapsed in the tree
  static ASSET_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff',
    '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.ogg', '.wav', '.flac',
    '.woff', '.woff2', '.eot', '.ttf', '.otf',
    '.zip', '.rar', '.7z', '.tar', '.gz',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.map', '.min.js', '.min.css'
  ]);

  async process(snapshot, context) {
    const { project } = context;
    const rootPath = project.root_path;
    const excluded = this.parseExcluded(project.excluded_folders);

    if (!fs.existsSync(rootPath)) {
      throw new Error(`Root path does not exist: ${rootPath}`);
    }

    const files = [];
    const folderStats = {};
    let totalFolders = 0;

    // Scan directory recursively
    await this.scanDirectory(rootPath, rootPath, excluded, files, folderStats, () => totalFolders++);

    // Build smart file tree (code files shown, assets collapsed)
    const fileTree = this.buildFileTree(rootPath, excluded);

    // Stats by extension
    const byExtension = {};
    files.forEach(f => {
      const ext = f.extension || '(no ext)';
      byExtension[ext] = (byExtension[ext] || 0) + 1;
    });

    // Stats by folder
    const folderStatsArray = Object.entries(folderStats)
      .map(([folder, stats]) => ({ folder, ...stats }))
      .sort((a, b) => b.files - a.files);

    // Total lines of code
    const totalLines = files.reduce((sum, f) => sum + f.lines, 0);

    return {
      fileSystem: {
        rootPath,
        totalFiles: files.length,
        totalLines,
        totalFolders,
        byExtension,
        fileTree,
        folderStats: folderStatsArray,
        files: files.map(f => ({
          path: f.relativePath,
          name: f.name,
          extension: f.extension,
          size: f.size,
          lines: f.lines,
          lastModified: f.lastModified
        }))
      },
      // Internal: file contents for other layers to use (stripped from final report)
      _fileContents: files.reduce((map, f) => {
        if (f.content !== null) {
          map[f.relativePath] = f.content;
        }
        return map;
      }, {})
    };
  }

  // ─── Directory Scanner ───

  async scanDirectory(dirPath, rootPath, excluded, files, folderStats, onFolder) {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (err) {
      return; // Skip unreadable directories
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(rootPath, fullPath).replace(/\\/g, '/');

      // Check exclusion
      if (this.isExcluded(entry.name, relativePath, excluded)) continue;

      if (entry.isDirectory()) {
        onFolder();
        await this.scanDirectory(fullPath, rootPath, excluded, files, folderStats, onFolder);
      } else if (entry.isFile()) {
        // Skip minified files entirely — unreadable, pollute analysis
        if (this.isMinified(entry.name)) continue;

        const fileInfo = this.analyzeFile(fullPath, rootPath, relativePath);
        if (fileInfo) {
          files.push(fileInfo);

          // Track folder stats
          const folder = path.dirname(relativePath);
          if (!folderStats[folder]) {
            folderStats[folder] = { files: 0, lines: 0, size: 0 };
          }
          folderStats[folder].files++;
          folderStats[folder].lines += fileInfo.lines;
          folderStats[folder].size += fileInfo.size;
        }
      }
    }
  }

  analyzeFile(fullPath, rootPath, relativePath) {
    try {
      const stat = fs.statSync(fullPath);
      const ext = path.extname(fullPath).toLowerCase();
      const name = path.basename(fullPath);

      // Skip very large files (>5MB)
      if (stat.size > 5 * 1024 * 1024) {
        return {
          relativePath,
          name,
          extension: ext,
          size: stat.size,
          lines: 0,
          lastModified: stat.mtime.toISOString(),
          content: null
        };
      }

      // Read content for code files only
      let content = null;
      let lines = 0;

      if (FileSystemLayer.CODE_EXTENSIONS.has(ext) || ext === '') {
        try {
          content = fs.readFileSync(fullPath, 'utf-8');
          lines = content.split('\n').length;
        } catch {
          content = null;
        }
      }

      return {
        relativePath,
        name,
        extension: ext,
        size: stat.size,
        lines,
        lastModified: stat.mtime.toISOString(),
        content
      };
    } catch {
      return null;
    }
  }

  // ─── Smart File Tree Builder ───
  // Shows code files individually, collapses assets/media into "N files"

  buildFileTree(rootPath, excluded) {
    const lines = [];
    this._buildTree(rootPath, rootPath, '', excluded, lines);
    return lines.join('\n');
  }

  _buildTree(dirPath, rootPath, prefix, excluded, lines) {
    let entries;
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    // Filter excluded
    const allItems = entries.filter(e => {
      const rel = path.relative(rootPath, path.join(dirPath, e.name)).replace(/\\/g, '/');
      return !this.isExcluded(e.name, rel, excluded);
    });

    // Separate: directories, code files (shown), asset files (collapsed)
    const dirs = allItems.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    const codeFiles = allItems.filter(e => e.isFile() && this.isTreeCodeFile(e.name)).sort((a, b) => a.name.localeCompare(b.name));
    const assetFiles = allItems.filter(e => e.isFile() && !this.isTreeCodeFile(e.name) && !this.isMinified(e.name));

    // Build the visible items list: dirs + code files + one summary line for assets
    const visibleItems = [];
    dirs.forEach(d => visibleItems.push({ type: 'dir', entry: d }));
    codeFiles.forEach(f => visibleItems.push({ type: 'file', entry: f }));
    if (assetFiles.length > 0) {
      visibleItems.push({ type: 'assets', count: assetFiles.length });
    }

    for (let i = 0; i < visibleItems.length; i++) {
      const item = visibleItems[i];
      const isLast = i === visibleItems.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const nextPrefix = isLast ? '    ' : '│   ';

      if (item.type === 'dir') {
        const fullPath = path.join(dirPath, item.entry.name);
        lines.push(`${prefix}${connector}${item.entry.name}/`);
        this._buildTree(fullPath, rootPath, prefix + nextPrefix, excluded, lines);
      } else if (item.type === 'file') {
        const fullPath = path.join(dirPath, item.entry.name);
        try {
          const stat = fs.statSync(fullPath);
          const date = stat.mtime;
          const dateStr = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
          lines.push(`${prefix}${connector}${item.entry.name} (${dateStr})`);
        } catch {
          lines.push(`${prefix}${connector}${item.entry.name}`);
        }
      } else if (item.type === 'assets') {
        lines.push(`${prefix}${connector}... ${item.count} asset file${item.count > 1 ? 's' : ''} (images, fonts, media)`);
      }
    }
  }

  /**
   * Check if a file should be shown individually in the tree.
   * Returns true for code/config files, false for assets/media/binary.
   */
  isTreeCodeFile(name) {
    // Minified files are never shown
    if (this.isMinified(name)) return false;

    const ext = path.extname(name).toLowerCase();
    return FileSystemLayer.TREE_CODE_EXTENSIONS.has(ext);
  }

  /**
   * Check if a file is minified (e.g. bootstrap.min.js, app.min.css).
   */
  isMinified(name) {
    return /\.min\.(js|css|json)$/i.test(name);
  }

  // ─── Exclusion Logic ───

  parseExcluded(excluded) {
    if (Array.isArray(excluded)) return excluded;
    if (typeof excluded === 'string') {
      try { return JSON.parse(excluded); } catch { return []; }
    }
    return [];
  }

  isExcluded(name, relativePath, excluded) {
    // Skip hidden files/dirs (except .env, .htaccess, etc.)
    if (name.startsWith('.') && !name.startsWith('.env') && !name.startsWith('.htaccess')) {
      return true;
    }

    for (const pattern of excluded) {
      if (name === pattern) return true;
      if (relativePath.includes(pattern)) return true;
    }
    return false;
  }
}

module.exports = FileSystemLayer;
