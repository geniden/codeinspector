// ..\..\nodejs\code-inspector\server\routes\analysis.js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { getDb } = require('../database/db');

// Import LAYERS engine and layers
const AnalysisEngine = require('../../layers/core/analysis-engine');
const FileSystemLayer = require('../../layers/01-file-system/file-system-layer');
const TechStackLayer = require('../../layers/02-tech-stack/tech-stack-layer');
const CodeStructureLayer = require('../../layers/03-code-structure/code-structure-layer');
const CodeQualityLayer = require('../../layers/04-code-quality/code-quality-layer');
const KeyLocationsLayer = require('../../layers/05-key-locations/key-locations-layer');
const CodeScoreLayer = require('../../layers/06-code-score/code-score-layer');

// Track running analyses
const runningAnalyses = new Map();

// Общее количество слоёв — вынесено НАРУЖУ, чтобы было доступно везде
const TOTAL_LAYERS = 6;

const LAYERS_INFO = [
  { name: 'File System' },
  { name: 'Tech Stack' },
  { name: 'Code Structure' },
  { name: 'Code Quality' },
  { name: 'Key Locations' },
  { name: 'Code Score' }
];

// ─── POST /api/analysis/start ─── Start analysis for a project
router.post('/start', (req, res) => {
  try {
    const { projectId } = req.body;
    const db = getDb();

    // Get project
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    // Parse JSON fields
    project.technologies = JSON.parse(project.technologies || '[]');
    project.excluded_folders = JSON.parse(project.excluded_folders || '[]');
    project.enable_llm = Boolean(project.enable_llm);
    project.project_type = project.project_type || 'auto';

    // Check if analysis is already running for this project
    if (runningAnalyses.has(projectId)) {
      return res.status(409).json({ success: false, error: 'Analysis already running for this project' });
    }

    // Create analysis record
    const result = db.prepare(`
      INSERT INTO analyses (project_id, status)
      VALUES (?, 'running')
    `).run(projectId);

    const analysisId = result.lastInsertRowid;

    // ✅ Устанавливаем начальное состояние прогресса
    runningAnalyses.set(projectId, {
      analysisId,
      progress: {
        step: 0,
        total: TOTAL_LAYERS,
        layer: 'starting',
        detail: null
      },
      currentLayerIndex: 0
    });

    // Run analysis in background
    runAnalysis(project, analysisId)
      .then(() => {
        runningAnalyses.delete(projectId);
      })
      .catch(err => {
        console.error('[Analysis] Fatal error:', err);
        runningAnalyses.delete(projectId);
      });

    res.json({
      success: true,
      data: {
        analysisId,
        status: 'running',
        message: 'Analysis started'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/analysis/:id/status ─── Check analysis status
router.get('/:id/status', (req, res) => {
  try {
    const db = getDb();
    const analysis = db.prepare('SELECT * FROM analyses WHERE id = ?').get(req.params.id);

    if (!analysis) {
      return res.status(404).json({ success: false, error: 'Analysis not found' });
    }

    // Check if running and add progress info
    const running = runningAnalyses.get(analysis.project_id);
    const progress = running ? running.progress : null;

    res.json({
      success: true,
      data: {
        id: analysis.id,
        project_id: analysis.project_id,
        status: analysis.status,
        started_at: analysis.started_at,
        finished_at: analysis.finished_at,
        duration_ms: analysis.duration_ms,
        error_message: analysis.error_message,
        progress
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Analysis Runner ───
async function runAnalysis(project, analysisId) {
  const db = getDb();
  const startTime = Date.now();

  try {
    // Build the LAYERS engine
    const engine = new AnalysisEngine();
    engine.addLayer(new FileSystemLayer());
    engine.addLayer(new TechStackLayer());
    engine.addLayer(new CodeStructureLayer());
    engine.addLayer(new CodeQualityLayer());
    engine.addLayer(new KeyLocationsLayer());
    engine.addLayer(new CodeScoreLayer());

    // Run analysis with progress tracking
    const report = await engine.analyze(project, (progress) => {
      const running = runningAnalyses.get(project.id);
      if (!running) return;

      // Если это прогресс внутри слоя (например, code-quality)
        if (progress.layer && !['file-system', 'tech-stack', 'code-structure', 'code-quality', 'key-locations', 'code-score'].includes(progress.layer)) {
        running.progress = {
          step: running.currentLayerIndex,
          total: TOTAL_LAYERS,
          layer: LAYERS_INFO[running.currentLayerIndex]?.name || 'Processing',
          detail: progress.layer,
          current: progress.current,
          total: progress.total,
          subStep: true
        };
      } else {
        // Transition between layers
        running.progress = {
          step: progress.current,
          total: progress.total,
          current: progress.current,
          layer: progress.layer,
          detail: null,
          subStep: false
        };
        running.currentLayerIndex = (progress.current || 1) - 1;
      }

      console.log(`[Progress] ${JSON.stringify(running.progress)}`);
    });

    // Save report as JSON file
    const reportsDir = path.join(__dirname, '..', '..', 'reports', String(project.id));
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(reportsDir, `${timestamp}.json`);

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

    // Build summary for quick access
    const summary = {
      totalFiles: report.fileSystem?.totalFiles || 0,
      totalLines: report.fileSystem?.totalLines || 0,
      totalClasses: report.codeStructure?.totalClasses || 0,
      totalFunctions: report.codeStructure?.totalFunctions || 0,
      totalIssues: report.codeQuality?.summary?.totalIssues || 0,
      languages: report.techStack?.languages?.map(l => l.name) || [],
      frameworks: report.techStack?.frameworks?.map(f => f.name) || []
    };

    const durationMs = Date.now() - startTime;

    // Update analysis record
    db.prepare(`
      UPDATE analyses SET
        status = 'completed',
        finished_at = datetime('now'),
        duration_ms = ?,
        report_path = ?,
        summary = ?
      WHERE id = ?
    `).run(durationMs, reportPath, JSON.stringify(summary), analysisId);

    console.log(`[Analysis] Completed in ${durationMs}ms → ${reportPath}`);

  } catch (err) {
    const durationMs = Date.now() - startTime;

    db.prepare(`
      UPDATE analyses SET
        status = 'failed',
        finished_at = datetime('now'),
        duration_ms = ?,
        error_message = ?
      WHERE id = ?
    `).run(durationMs, err.message, analysisId);

    console.error(`[Analysis] Failed after ${durationMs}ms:`, err.message);
  }
}

module.exports = router;