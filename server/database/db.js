const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'code-inspector.db');

let db = null;

function getDb() {
  if (db) return db;

  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema();
  migrateSchema();

  return db;
}

function migrateSchema() {
  try {
    const info = db.pragma('table_info(projects)');
    if (!info.some(c => c.name === 'project_type')) {
      db.exec('ALTER TABLE projects ADD COLUMN project_type TEXT DEFAULT "auto"');
    }
  } catch (e) { /* ignore */ }
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      entry_point TEXT DEFAULT '',
      technologies TEXT DEFAULT '[]',
      framework TEXT DEFAULT 'none',
      excluded_folders TEXT DEFAULT '["node_modules","vendor",".git","dist","build","cache",".next",".nuxt","reports","data"]',
      wp_db_host TEXT DEFAULT '',
      wp_db_name TEXT DEFAULT '',
      wp_db_user TEXT DEFAULT '',
      wp_db_pass TEXT DEFAULT '',
      enable_llm INTEGER DEFAULT 0,
      llm_model TEXT DEFAULT 'tinyllama',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT,
      duration_ms INTEGER,
      report_path TEXT,
      summary TEXT DEFAULT '{}',
      error_message TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
  `);
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
