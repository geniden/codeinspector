const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database/db');

// ─── GET /api/projects/:projectId/reports ─── List reports for a project
router.get('/project/:projectId', (req, res) => {
  try {
    const db = getDb();
    const analyses = db.prepare(`
      SELECT id, status, started_at, finished_at, duration_ms, report_path, summary
      FROM analyses
      WHERE project_id = ? AND status = 'completed'
      ORDER BY started_at DESC
    `).all(req.params.projectId);

    const reports = analyses.map(a => ({
      ...a,
      summary: JSON.parse(a.summary || '{}')
    }));

    res.json({ success: true, data: reports });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/reports/:id ─── Get a specific report
router.get('/:id', (req, res) => {
  try {
    const db = getDb();
    const analysis = db.prepare('SELECT * FROM analyses WHERE id = ?').get(req.params.id);

    if (!analysis) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    // Read the report file
    let reportData = null;
    if (analysis.report_path && fs.existsSync(analysis.report_path)) {
      const raw = fs.readFileSync(analysis.report_path, 'utf-8');
      reportData = JSON.parse(raw);
    }

    res.json({
      success: true,
      data: {
        id: analysis.id,
        project_id: analysis.project_id,
        status: analysis.status,
        started_at: analysis.started_at,
        finished_at: analysis.finished_at,
        duration_ms: analysis.duration_ms,
        summary: JSON.parse(analysis.summary || '{}'),
        report: reportData
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── DELETE /api/reports/:id ─── Delete a report
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const analysis = db.prepare('SELECT * FROM analyses WHERE id = ?').get(req.params.id);

    if (!analysis) {
      return res.status(404).json({ success: false, error: 'Report not found' });
    }

    // Delete report file
    if (analysis.report_path && fs.existsSync(analysis.report_path)) {
      fs.unlinkSync(analysis.report_path);
    }

    db.prepare('DELETE FROM analyses WHERE id = ?').run(req.params.id);

    res.json({ success: true, message: 'Report deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/reports/file-preview ─── Read a source file for code preview
router.get('/file-preview/:projectId', (req, res) => {
  try {
    const db = getDb();
    const project = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(req.params.projectId);

    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    const relativePath = req.query.path;
    if (!relativePath) {
      return res.status(400).json({ success: false, error: 'File path is required' });
    }

    // Security: resolve and verify the path is inside the project root
    const fullPath = path.resolve(project.root_path, relativePath);
    if (!fullPath.startsWith(path.resolve(project.root_path))) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    const stat = fs.statSync(fullPath);
    if (stat.size > 2 * 1024 * 1024) {
      return res.status(413).json({ success: false, error: 'File too large for preview' });
    }

    const content = fs.readFileSync(fullPath, 'utf-8');

    res.json({
      success: true,
      data: {
        path: relativePath,
        content,
        lines: content.split('\n').length,
        size: stat.size
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
