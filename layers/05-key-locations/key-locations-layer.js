const BaseLayer = require('../core/base-layer');
const path = require('path');

/**
 * KeyLocationsLayer — finds entry points, DB config, .env, logs for project navigation.
 * Uses project_type (from project settings) to tailor search strategy.
 */
class KeyLocationsLayer extends BaseLayer {
  constructor() {
    super('key-locations');
  }

  async process(snapshot, context) {
    const projectType = (context.project?.project_type || 'auto').toLowerCase();
    const files = (snapshot.fileSystem && snapshot.fileSystem.files) || [];
    const fileContents = snapshot._fileContents || {};
    const rootPath = context.project?.root_path || '';

    const result = {
      entryPoints: [],
      dbConfig: [],
      envFiles: [],
      sqliteFiles: [],
      logLocations: [],
      dottedConfigFiles: []
    };

    const filePaths = files.map(f => (f.path || f.relativePath || '')).filter(Boolean);

    // ─── 1. Entry points ───
    if (projectType === 'telegram-php') {
      // Telegram bot / PHP API: ищем webhook — file_get_contents('php://input'), $_REQUEST, $_POST
      const webhookPatterns = [
        /file_get_contents\s*\(\s*['"]php:\/\/input['"]\s*\)/i,
        /\$_REQUEST\b/i,
        /\$_POST\b/i,
        /webhook/i,
        /getUpdates|setWebhook|sendMessage/i
      ];
      for (const [filePath, content] of Object.entries(fileContents)) {
        if (!content || !/\.php$/i.test(filePath)) continue;
        const sample = typeof content === 'string' ? content.slice(0, 15000) : '';
        if (webhookPatterns.some(re => re.test(sample))) {
          result.entryPoints.push({ path: filePath, hint: 'webhook/api' });
        }
      }
      result.entryPoints = result.entryPoints.slice(0, 10);
    } else {
      const entryCandidates = this.getEntryCandidates(projectType);
      const norm = s => s.toLowerCase().replace(/\\/g, '/');
      for (const candidate of entryCandidates) {
        const c = norm(candidate);
        const found = filePaths.filter(p => {
          const px = norm(p);
          return px === c || px.endsWith('/' + c);
        });
        result.entryPoints.push(...found.map(p => ({ path: p, hint: candidate })));
      }
      result.entryPoints = result.entryPoints.slice(0, 10);
    }

    // ─── 2. DB config (PDO, mysqli, env vars) ───
    const dbPatterns = [
      /\bnew\s+PDO\s*\(/i,
      /\bmysqli_connect\s*\(/i,
      /\bDB_HOST\b/i,
      /\bDATABASE_URL\b/i,
      /\bmysql:\/\//i,
      /\bpg_connect\s*\(/i,
      /config\s*\[\s*['"]database['"]\s*\]/i,
      /connect\s*\(\s*['"]/i
    ];
    for (const [filePath, content] of Object.entries(fileContents)) {
      if (!content) continue;
      const sample = typeof content === 'string' ? content.slice(0, 50000) : '';
      if (dbPatterns.some(re => re.test(sample))) {
        result.dbConfig.push({ path: filePath });
      }
    }
    result.dbConfig = result.dbConfig.slice(0, 15);

    // ─── 2.1 SQLite files ───
    result.sqliteFiles = filePaths.filter(p =>
      /\.(sqlite|sqlite3|db)$/i.test(p) && !p.includes('node_modules') && !p.includes('.git')
    ).slice(0, 10);

    // ─── 2.2 .env and dotted config ───
    result.envFiles = filePaths.filter(p =>
      /^\.env(\.[\w.-]*)?$/i.test(path.basename(p)) || p.endsWith('.env')
    );
    result.dottedConfigFiles = filePaths.filter(p => {
      const name = path.basename(p);
      return name.startsWith('.') && !/^\.env/i.test(name);
    }).filter(p => !result.envFiles.includes(p)).slice(0, 20);

    // ─── 3. Log locations ───
    const logFiles = filePaths.filter(p => /\.log$/i.test(p));
    const logDirs = [...new Set(logFiles.map(p => path.dirname(p)))];
    result.logLocations = logDirs.map(dir => {
      const inDir = logFiles.filter(p => path.dirname(p) === dir);
      return { folder: dir, files: inDir.slice(0, 3) };
    }).slice(0, 5);

    return { keyLocations: result };
  }

  getEntryCandidates(projectType) {
    const byType = {
      php: ['index.php', 'public/index.php', 'bootstrap.php', 'vendor/autoload.php'],
      nodejs: ['server.js', 'index.js', 'main.js', 'app.js'],
      spa: ['index.html', 'index.htm', 'src/main.js', 'src/index.js'],
      pwa: ['index.html', 'src/main.js'],
      telegram: ['index.html', 'app.js'],
      static: ['index.html', 'index.htm'],
      auto: [
        'index.php', 'public/index.php', 'index.html', 'index.htm',
        'server.js', 'main.js', 'app.js', 'bootstrap.php'
      ]
    };
    return byType[projectType] || byType.auto;
  }
}

module.exports = KeyLocationsLayer;
