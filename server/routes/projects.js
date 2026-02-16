const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database/db');

// ─── GET /api/projects ─── List all projects
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const projects = db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM analyses WHERE project_id = p.id) as analyses_count,
        (SELECT MAX(started_at) FROM analyses WHERE project_id = p.id AND status = 'completed') as last_analysis_at
      FROM projects p
      ORDER BY p.updated_at DESC
    `).all();

    // Parse JSON fields
    const parsed = projects.map(p => ({
      ...p,
      technologies: JSON.parse(p.technologies || '[]'),
      excluded_folders: JSON.parse(p.excluded_folders || '[]'),
      enable_llm: Boolean(p.enable_llm)
    }));

    res.json({ success: true, data: parsed });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/projects/fs/browse ─── List directories for folder picker
router.get('/fs/browse', (req, res) => {
  try {
    const dirPath = req.query.path;
    if (!dirPath || typeof dirPath !== 'string') {
      let roots = [];
      if (process.platform === 'win32') {
        for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
          const p = `${letter}:\\`;
          try { if (fs.existsSync(p)) roots.push(p); } catch { /* skip */ }
        }
        if (roots.length === 0) roots = ['C:\\'];
      } else {
        roots = ['/'];
      }
      return res.json({ success: true, data: { path: '', parent: null, entries: roots.map(r => ({ name: r, isDir: true })) } });
    }

    const resolved = path.resolve(dirPath.trim());
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ success: false, error: 'Path does not exist' });
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return res.status(400).json({ success: false, error: 'Path is not a directory' });
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({ name: e.name, isDir: e.isDirectory() }))
      .sort((a, b) => (a.isDir === b.isDir) ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1));

    const parent = path.dirname(resolved);
    const hasParent = parent !== resolved;

    res.json({
      success: true,
      data: {
        path: resolved,
        parent: hasParent ? parent : null,
        entries
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/projects/:id ─── Get single project
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);

    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    project.technologies = JSON.parse(project.technologies || '[]');
    project.excluded_folders = JSON.parse(project.excluded_folders || '[]');
    project.enable_llm = Boolean(project.enable_llm);

    // Get analyses history
    const analyses = db.prepare(`
      SELECT id, status, started_at, finished_at, duration_ms, report_path
      FROM analyses
      WHERE project_id = ?
      ORDER BY started_at DESC
      LIMIT 20
    `).all(req.params.id);

    res.json({ success: true, data: { ...project, analyses } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/projects ─── Create new project
router.post('/', (req, res) => {
  try {
    const {
      name, root_path, entry_point = '',
      project_type = 'auto', technologies = [],
      framework = 'none',
      excluded_folders, wp_db_host = '', wp_db_name = '',
      wp_db_user = '', wp_db_pass = '',
      enable_llm = false, llm_model = 'tinyllama', notes = ''
    } = req.body;

    // Validation
    if (!root_path || !root_path.trim()) {
      return res.status(400).json({ success: false, error: 'Root path is required' });
    }
    const finalName = (name && name.trim()) ? name.trim() : path.basename(root_path.trim()) || 'Project';

    // Check if path exists
    if (!fs.existsSync(root_path)) {
      return res.status(400).json({ success: false, error: 'Root path does not exist on disk' });
    }

    const defaultExcluded = ['node_modules', 'vendor', '.git', 'dist', 'build', 'cache', '.next', '.nuxt'];
    const finalExcluded = excluded_folders && excluded_folders.length > 0 ? excluded_folders : defaultExcluded;

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO projects (name, root_path, entry_point, project_type, technologies, framework,
        excluded_folders, wp_db_host, wp_db_name, wp_db_user, wp_db_pass,
        enable_llm, llm_model, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      finalName,
      root_path.trim(),
      entry_point.trim(),
      project_type || 'auto',
      JSON.stringify(technologies),
      framework,
      JSON.stringify(finalExcluded),
      wp_db_host, wp_db_name, wp_db_user, wp_db_pass,
      enable_llm ? 1 : 0,
      llm_model,
      notes.trim()
    );

    // Create reports directory for this project
    const reportsDir = path.join(__dirname, '..', '..', 'reports', String(result.lastInsertRowid));
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
    project.technologies = JSON.parse(project.technologies);
    project.excluded_folders = JSON.parse(project.excluded_folders);
    project.enable_llm = Boolean(project.enable_llm);

    res.status(201).json({ success: true, data: project });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PUT /api/projects/:id ─── Update project
router.put('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    const {
      name, root_path, entry_point,
      project_type, technologies, framework,
      excluded_folders, wp_db_host, wp_db_name,
      wp_db_user, wp_db_pass,
      enable_llm, llm_model, notes
    } = req.body;

    // Validate path if changed
    const finalRootPath = root_path?.trim() || existing.root_path;
    if (finalRootPath && !fs.existsSync(finalRootPath)) {
      return res.status(400).json({ success: false, error: 'Root path does not exist on disk' });
    }
    const finalName = (name && name.trim()) ? name.trim() : (path.basename(finalRootPath) || existing.name);

    const stmt = db.prepare(`
      UPDATE projects SET
        name = COALESCE(?, name),
        root_path = COALESCE(?, root_path),
        entry_point = COALESCE(?, entry_point),
        project_type = COALESCE(?, project_type),
        technologies = COALESCE(?, technologies),
        framework = COALESCE(?, framework),
        excluded_folders = COALESCE(?, excluded_folders),
        wp_db_host = COALESCE(?, wp_db_host),
        wp_db_name = COALESCE(?, wp_db_name),
        wp_db_user = COALESCE(?, wp_db_user),
        wp_db_pass = COALESCE(?, wp_db_pass),
        enable_llm = COALESCE(?, enable_llm),
        llm_model = COALESCE(?, llm_model),
        notes = COALESCE(?, notes),
        updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(
      finalName || null,
      root_path?.trim() || null,
      entry_point !== undefined ? entry_point.trim() : null,
      project_type !== undefined ? project_type : null,
      technologies ? JSON.stringify(technologies) : null,
      framework || null,
      excluded_folders ? JSON.stringify(excluded_folders) : null,
      wp_db_host !== undefined ? wp_db_host : null,
      wp_db_name !== undefined ? wp_db_name : null,
      wp_db_user !== undefined ? wp_db_user : null,
      wp_db_pass !== undefined ? wp_db_pass : null,
      enable_llm !== undefined ? (enable_llm ? 1 : 0) : null,
      llm_model || null,
      notes !== undefined ? notes.trim() : null,
      req.params.id
    );

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
    project.technologies = JSON.parse(project.technologies);
    project.excluded_folders = JSON.parse(project.excluded_folders);
    project.enable_llm = Boolean(project.enable_llm);

    res.json({ success: true, data: project });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── DELETE /api/projects/:id ─── Delete project
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);

    // Optionally clean up reports folder
    const reportsDir = path.join(__dirname, '..', '..', 'reports', String(req.params.id));
    if (fs.existsSync(reportsDir)) {
      fs.rmSync(reportsDir, { recursive: true, force: true });
    }

    res.json({ success: true, message: 'Project deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
