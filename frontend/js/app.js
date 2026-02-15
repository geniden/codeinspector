/* ═══════════════════════════════════════════════════════
   CodeInspector — Frontend Application
   ═══════════════════════════════════════════════════════ */

const API = '/api';

const App = {
  currentPage: 'projects',
  projects: [],
  currentProject: null,
  editingId: null,
  confirmCallback: null,

  // ─── Initialization ───
  async init() {
    this.loadTheme();
    this.setupNavigation();
    await this.loadProjects();
    this.checkServerHealth();
  },

  // ═══════════════════════════════════════════════════════
  // Navigation
  // ═══════════════════════════════════════════════════════
  setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.dataset.page;
        this.navigate(page);
      });
    });
  },

  navigate(page) {
    this.currentPage = page;

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    // Show/hide pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) pageEl.classList.add('active');

    // Trigger page-specific logic
    if (page === 'projects') this.loadProjects();
    if (page === 'reports') this.loadAllReports();
  },

  // ═══════════════════════════════════════════════════════
  // Projects — CRUD
  // ═══════════════════════════════════════════════════════
  async loadProjects() {
    try {
      const res = await fetch(`${API}/projects`);
      const data = await res.json();

      if (data.success) {
        this.projects = data.data;
        this.renderProjects();
      }
    } catch (err) {
      this.toast('Failed to load projects', 'error');
    }
  },

  renderProjects() {
    const grid = document.getElementById('projects-grid');
    const empty = document.getElementById('empty-state');

    if (this.projects.length === 0) {
      grid.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    grid.style.display = 'grid';

    grid.innerHTML = this.projects.map(p => `
      <div class="project-card" onclick="App.viewProject(${p.id})">
        <div class="project-card-header">
          <span class="project-card-name">${this.esc(p.name)}</span>
          ${p.framework !== 'none' ? `<span class="project-card-framework">${this.esc(p.framework)}</span>` : ''}
        </div>
        <div class="project-card-path">${this.esc(p.root_path)}</div>
        <div class="project-card-techs">
          ${(p.technologies || []).map(t => `<span class="tech-badge">${this.esc(t)}</span>`).join('')}
        </div>
        <div class="project-card-footer">
          <span class="project-card-meta">
            ${p.last_analysis_at ? `Last analysis: ${this.formatDate(p.last_analysis_at)}` : 'Not analyzed yet'}
          </span>
          <div class="project-card-actions" onclick="event.stopPropagation()">
            <button class="btn btn-sm btn-ghost" onclick="App.editProjectById(${p.id})" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn btn-sm btn-ghost" onclick="App.deleteProject(${p.id}, '${this.esc(p.name)}')" title="Delete" style="color:var(--danger)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>
    `).join('');
  },

  // ─── Add Project ───
  showAddProject() {
    this.editingId = null;
    this.resetForm();
    document.getElementById('modal-title').textContent = 'Add Project';
    document.getElementById('modal-submit-btn').textContent = 'Add Project';
    document.getElementById('modal-overlay').style.display = 'flex';
  },

  // ─── Edit Project ───
  async editProjectById(id) {
    try {
      const res = await fetch(`${API}/projects/${id}`);
      const data = await res.json();

      if (!data.success) {
        this.toast('Failed to load project', 'error');
        return;
      }

      const p = data.data;
      this.editingId = p.id;

      // Fill form
      document.getElementById('pf-id').value = p.id;
      document.getElementById('pf-name').value = p.name;
      document.getElementById('pf-path').value = p.root_path;
      document.getElementById('pf-entry').value = p.entry_point || '';
      document.getElementById('pf-framework').value = p.framework || 'none';
      document.getElementById('pf-excluded').value = (p.excluded_folders || []).join(', ');
      document.getElementById('pf-llm').checked = p.enable_llm;
      document.getElementById('pf-notes').value = p.notes || '';

      // Technologies checkboxes
      document.querySelectorAll('#pf-technologies input[type="checkbox"]').forEach(cb => {
        cb.checked = (p.technologies || []).includes(cb.value);
      });

      // WordPress fields
      document.getElementById('pf-wp-host').value = p.wp_db_host || '';
      document.getElementById('pf-wp-name').value = p.wp_db_name || '';
      document.getElementById('pf-wp-user').value = p.wp_db_user || '';
      document.getElementById('pf-wp-pass').value = p.wp_db_pass || '';

      this.onFrameworkChange();

      document.getElementById('modal-title').textContent = 'Edit Project';
      document.getElementById('modal-submit-btn').textContent = 'Save Changes';
      document.getElementById('modal-overlay').style.display = 'flex';
    } catch (err) {
      this.toast('Failed to load project', 'error');
    }
  },

  editProject() {
    if (this.currentProject) {
      this.editProjectById(this.currentProject.id);
    }
  },

  // ─── Save (Create/Update) ───
  async saveProject(e) {
    e.preventDefault();

    const formData = this.getFormData();

    // Validation
    if (!formData.name.trim()) {
      this.toast('Project name is required', 'error');
      return;
    }
    if (!formData.root_path.trim()) {
      this.toast('Root path is required', 'error');
      return;
    }

    try {
      const isEdit = !!this.editingId;
      const url = isEdit ? `${API}/projects/${this.editingId}` : `${API}/projects`;
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await res.json();

      if (data.success) {
        this.toast(isEdit ? 'Project updated' : 'Project added', 'success');
        this.closeModal();
        await this.loadProjects();

        // If we were viewing this project, refresh detail
        if (isEdit && this.currentProject && this.currentProject.id === this.editingId) {
          this.viewProject(this.editingId);
        }
      } else {
        this.toast(data.error || 'Failed to save', 'error');
      }
    } catch (err) {
      this.toast('Failed to save project', 'error');
    }
  },

  getFormData() {
    const technologies = [];
    document.querySelectorAll('#pf-technologies input[type="checkbox"]:checked').forEach(cb => {
      technologies.push(cb.value);
    });

    const excludedRaw = document.getElementById('pf-excluded').value;
    const excluded_folders = excludedRaw.split(',').map(s => s.trim()).filter(Boolean);

    return {
      name: document.getElementById('pf-name').value,
      root_path: document.getElementById('pf-path').value,
      entry_point: document.getElementById('pf-entry').value,
      technologies,
      framework: document.getElementById('pf-framework').value,
      excluded_folders,
      wp_db_host: document.getElementById('pf-wp-host').value,
      wp_db_name: document.getElementById('pf-wp-name').value,
      wp_db_user: document.getElementById('pf-wp-user').value,
      wp_db_pass: document.getElementById('pf-wp-pass').value,
      enable_llm: document.getElementById('pf-llm').checked,
      notes: document.getElementById('pf-notes').value
    };
  },

  // ─── Delete Project ───
  deleteProject(id, name) {
    this.confirm(
      'Delete Project',
      `Are you sure you want to delete "${name}"? This will also remove all associated reports.`,
      async () => {
        try {
          const res = await fetch(`${API}/projects/${id}`, { method: 'DELETE' });
          const data = await res.json();

          if (data.success) {
            this.toast('Project deleted', 'success');
            await this.loadProjects();

            // If viewing deleted project, go back
            if (this.currentProject && this.currentProject.id === id) {
              this.navigate('projects');
            }
          } else {
            this.toast(data.error || 'Failed to delete', 'error');
          }
        } catch (err) {
          this.toast('Failed to delete project', 'error');
        }
      }
    );
  },

  // ═══════════════════════════════════════════════════════
  // Project Detail View
  // ═══════════════════════════════════════════════════════
  async viewProject(id) {
    try {
      const res = await fetch(`${API}/projects/${id}`);
      const data = await res.json();

      if (!data.success) {
        this.toast('Failed to load project', 'error');
        return;
      }

      this.currentProject = data.data;
      this.renderProjectDetail(data.data);

      // Switch to detail page
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-project-detail').classList.add('active');

      // Update nav (none active since detail is not a nav item)
      document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    } catch (err) {
      this.toast('Failed to load project', 'error');
    }
  },

  renderProjectDetail(project) {
    document.getElementById('detail-project-name').textContent = project.name;

    const content = document.getElementById('project-detail-content');
    const techs = (project.technologies || []).map(t => `<span class="tech-badge">${this.esc(t)}</span>`).join('');
    const analyses = project.analyses || [];

    content.innerHTML = `
      <!-- Overview -->
      <div class="detail-card">
        <h3>Overview</h3>
        <div class="detail-field">
          <div class="detail-label">Root Path</div>
          <div class="detail-value mono">${this.esc(project.root_path)}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Entry Point</div>
          <div class="detail-value mono">${project.entry_point ? this.esc(project.entry_point) : '<span style="color:var(--text-muted)">Not specified</span>'}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Framework</div>
          <div class="detail-value">${project.framework !== 'none' ? `<span class="project-card-framework">${this.esc(project.framework)}</span>` : '<span style="color:var(--text-muted)">None</span>'}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Created</div>
          <div class="detail-value">${this.formatDate(project.created_at)}</div>
        </div>
      </div>

      <!-- Technologies -->
      <div class="detail-card">
        <h3>Technology Stack</h3>
        <div class="detail-field">
          <div class="detail-label">Languages & Platforms</div>
          <div class="detail-value" style="margin-top:6px">
            ${techs || '<span style="color:var(--text-muted)">Not specified</span>'}
          </div>
        </div>
        <div class="detail-field" style="margin-top:16px">
          <div class="detail-label">Excluded Folders</div>
          <div class="detail-value" style="margin-top:6px">
            ${(project.excluded_folders || []).map(f => `<span class="tech-badge">${this.esc(f)}</span>`).join(' ')}
          </div>
        </div>
        <div class="detail-field" style="margin-top:16px">
          <div class="detail-label">LLM Analysis</div>
          <div class="detail-value">${project.enable_llm ? '<span style="color:var(--success)">Enabled</span>' : '<span style="color:var(--text-muted)">Disabled</span>'}</div>
        </div>
      </div>

      ${project.framework === 'wordpress' ? `
      <!-- WordPress DB -->
      <div class="detail-card">
        <h3>WordPress Database</h3>
        <div class="detail-field">
          <div class="detail-label">Host</div>
          <div class="detail-value mono">${this.esc(project.wp_db_host) || '—'}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">Database</div>
          <div class="detail-value mono">${this.esc(project.wp_db_name) || '—'}</div>
        </div>
        <div class="detail-field">
          <div class="detail-label">User</div>
          <div class="detail-value mono">${this.esc(project.wp_db_user) || '—'}</div>
        </div>
      </div>
      ` : ''}

      ${project.notes ? `
      <div class="detail-card${project.framework !== 'wordpress' ? '' : ''}">
        <h3>Notes</h3>
        <div class="detail-value" style="white-space:pre-wrap">${this.esc(project.notes)}</div>
      </div>
      ` : ''}

      <!-- Analysis History -->
      <div class="detail-card full-width">
        <h3>Analysis History</h3>
        ${analyses.length > 0 ? `
          <div class="reports-list">
            ${analyses.map(a => `
              <div class="report-item" onclick="${a.report_path ? `App.viewReport(${a.id})` : ''}">
                <div class="report-info">
                  <h4>Analysis #${a.id}</h4>
                  <div class="report-meta">
                    <span>${this.formatDate(a.started_at)}</span>
                    ${a.duration_ms ? `<span>${(a.duration_ms / 1000).toFixed(1)}s</span>` : ''}
                  </div>
                </div>
                <span class="status-badge ${a.status}">${a.status}</span>
              </div>
            `).join('')}
          </div>
        ` : `
          <div style="text-align:center; padding:24px; color:var(--text-muted)">
            <p>No analyses yet. Click "Analyze" to start.</p>
          </div>
        `}
      </div>
    `;
  },

  async analyzeProject() {
    if (!this.currentProject) return;

    this.toast('Starting analysis...', 'info');

    try {
      const res = await fetch(`${API}/analysis/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: this.currentProject.id })
      });

      const data = await res.json();

      if (!data.success) {
        this.toast(data.error || 'Failed to start analysis', 'error');
        return;
      }

      const analysisId = data.data.analysisId;
      this.toast('Analysis running...', 'info');

      // Poll for completion
      this.pollAnalysis(analysisId);
    } catch (err) {
      this.toast('Failed to start analysis', 'error');
    }
  },

  async pollAnalysis(analysisId) {
    const poll = async () => {
      try {
        const res = await fetch(`${API}/analysis/${analysisId}/status`);
        const data = await res.json();

        if (!data.success) return;

        const status = data.data.status;

        if (status === 'completed') {
          this.toast('Analysis completed!', 'success');
          // Refresh project detail to show new analysis
          if (this.currentProject) {
            this.viewProject(this.currentProject.id);
          }
          return;
        }

        if (status === 'failed') {
          this.toast(`Analysis failed: ${data.data.error_message || 'Unknown error'}`, 'error');
          return;
        }

        // Still running — poll again
        setTimeout(poll, 1000);
      } catch {
        this.toast('Lost connection while polling analysis', 'error');
      }
    };

    poll();
  },

  // ═══════════════════════════════════════════════════════
  // Reports
  // ═══════════════════════════════════════════════════════
  async loadAllReports() {
    const container = document.getElementById('reports-list');

    if (this.projects.length === 0) {
      await this.loadProjects();
    }

    try {
      let allReports = [];

      for (const project of this.projects) {
        const res = await fetch(`${API}/reports/project/${project.id}`);
        const data = await res.json();
        if (data.success && data.data.length > 0) {
          data.data.forEach(r => {
            r.project_name = project.name;
          });
          allReports = allReports.concat(data.data);
        }
      }

      if (allReports.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <h3>No reports yet</h3>
            <p>Run an analysis on a project to generate reports</p>
          </div>
        `;
        return;
      }

      allReports.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));

      container.innerHTML = allReports.map(r => `
        <div class="report-item" onclick="App.viewReport(${r.id})">
          <div class="report-info">
            <h4>${this.esc(r.project_name)} — Analysis #${r.id}</h4>
            <div class="report-meta">
              <span>${this.formatDate(r.started_at)}</span>
              ${r.duration_ms ? `<span>${(r.duration_ms / 1000).toFixed(1)}s</span>` : ''}
            </div>
          </div>
          <span class="status-badge ${r.status}">${r.status}</span>
        </div>
      `).join('');
    } catch (err) {
      container.innerHTML = '<div class="empty-state"><p>Failed to load reports</p></div>';
    }
  },

  // ─── View a specific report ───
  currentReport: null,
  currentReportId: null,

  async viewReport(id) {
    try {
      const res = await fetch(`${API}/reports/${id}`);
      const data = await res.json();

      if (!data.success || !data.data.report) {
        this.toast('Failed to load report', 'error');
        return;
      }

      this.currentReport = data.data.report;
      this.currentReportId = id;

      // Set title
      document.getElementById('report-title').textContent = `Report: ${this.currentReport.meta?.projectName || 'Analysis'}`;
      document.getElementById('report-subtitle').textContent =
        `Analyzed ${this.formatDate(this.currentReport.meta?.analyzedAt)} • ${((this.currentReport.meta?.durationMs || 0) / 1000).toFixed(1)}s`;

      // Show report page
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-report').classList.add('active');
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));

      // Render first tab
      this.showReportTab('overview');
    } catch (err) {
      this.toast('Failed to load report', 'error');
    }
  },

  backFromReport() {
    if (this.currentProject) {
      this.viewProject(this.currentProject.id);
    } else {
      this.navigate('reports');
    }
  },

  showReportTab(tab) {
    document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.report-tab[onclick*="${tab}"]`).classList.add('active');

    const container = document.getElementById('report-content');
    const r = this.currentReport;
    if (!r) return;

    switch (tab) {
      case 'overview': container.innerHTML = this.renderReportOverview(r); break;
      case 'tree': container.innerHTML = this.renderReportTree(r); break;
      case 'structure': container.innerHTML = this.renderReportStructure(r); break;
      case 'quality': container.innerHTML = this.renderReportQuality(r); break;
    }
  },

  // Map language names to CSS class suffixes
  langClass(name) {
    const map = {
      'javascript': 'js', 'typescript': 'ts', 'php': 'php',
      'html': 'html', 'css': 'css', 'vue': 'vue', 'json': 'json',
      'jsx': 'jsx', 'tsx': 'ts', 'react': 'react', 'python': 'python',
      'markdown': 'md', 'md': 'md'
    };
    return map[(name || '').toLowerCase()] || '';
  },

  renderReportOverview(r) {
    const fs = r.fileSystem || {};
    const ts = r.techStack || {};
    const cs = r.codeStructure || {};
    const cq = r.codeQuality || {};
    const summary = cq.summary || {};

    return `
      <div class="stats-row">
        <div class="stat-card">
          <span class="stat-value">${fs.totalFiles || 0}</span>
          <span class="stat-label">Files</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${(fs.totalLines || 0).toLocaleString()}</span>
          <span class="stat-label">Lines of Code</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${fs.totalFolders || 0}</span>
          <span class="stat-label">Folders</span>
        </div>
        <div class="stat-card">
          <span class="stat-value" style="color:var(--accent)">${cs.totalClasses || 0}</span>
          <span class="stat-label">Classes</span>
        </div>
        <div class="stat-card">
          <span class="stat-value" style="color:var(--success)">${cs.totalFunctions || 0}</span>
          <span class="stat-label">Functions</span>
        </div>
        <div class="stat-card">
          <span class="stat-value" style="color:var(--lang-ts)">${cs.totalMethods || 0}</span>
          <span class="stat-label">Methods</span>
        </div>
        <div class="stat-card">
          <span class="stat-value" style="color:${summary.totalIssues > 0 ? 'var(--warning)' : 'var(--success)'}">${summary.totalIssues || 0}</span>
          <span class="stat-label">Issues Found</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${cs.totalImports || 0}</span>
          <span class="stat-label">Imports</span>
        </div>
      </div>

      <div class="detail-grid">
        <!-- Languages -->
        <div class="detail-card">
          <h3>Languages</h3>
          <div class="badge-row">
            ${(ts.languages || []).map(l => {
              const cls = this.langClass(l.name);
              return `
                <div class="lang-badge${cls ? ' lang-' + cls : ''}">
                  <span class="lang-dot"></span>
                  <strong>${this.esc(l.name)}</strong>
                  <span class="badge-count">${l.files} files &bull; ${l.lines.toLocaleString()} lines</span>
                </div>`;
            }).join('')}
          </div>
          <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px">
            ${ts.ecmaScriptVersion ? `<span class="tech-badge" style="border-color:rgba(247,223,30,0.3);color:var(--lang-js)">ECMAScript ${ts.ecmaScriptVersion}</span>` : ''}
            ${ts.phpVersion ? `<span class="tech-badge" style="border-color:rgba(119,123,180,0.3);color:var(--lang-php)">PHP ${ts.phpVersion}</span>` : ''}
            ${ts.typeScriptVersion ? `<span class="tech-badge" style="border-color:rgba(49,120,198,0.3);color:var(--lang-ts)">TypeScript ${ts.typeScriptVersion}</span>` : ''}
          </div>
        </div>

        <!-- Frameworks & Tools -->
        <div class="detail-card">
          <h3>Frameworks & Tools</h3>
          <div class="badge-row">
            ${(ts.frameworks || []).map(f => `
              <div class="lang-badge">
                <strong>${this.esc(f.name)}</strong>
                ${f.version ? `<span class="badge-count">${this.esc(f.version)}</span>` : ''}
              </div>
            `).join('') || '<span style="color:var(--text-muted)">None detected</span>'}
          </div>
          ${ts.packageManager ? `<div style="margin-top:14px"><span class="tech-badge" style="font-size:0.82rem">Package Manager: <strong>${ts.packageManager}</strong></span></div>` : ''}
          ${ts.configFiles && ts.configFiles.length > 0 ? `
            <div style="margin-top:14px">
              <div class="detail-label" style="margin-bottom:6px">Config Files</div>
              <div class="badge-row">
                ${ts.configFiles.map(f => `<span class="tech-badge">${this.esc(f)}</span>`).join('')}
              </div>
            </div>
          ` : ''}
        </div>

        <!-- Dependencies -->
        <div class="detail-card full-width">
          <h3>Dependencies (${(ts.dependencies || []).length} production, ${(ts.devDependencies || []).length} dev)</h3>
          <div class="badge-row">
            ${(ts.dependencies || []).slice(0, 30).map(d => `
              <span class="tech-badge">${this.esc(d.name)} <span class="badge-count">${this.esc(d.version)}</span></span>
            `).join('')}
            ${(ts.dependencies || []).length > 30 ? `<span class="tech-badge">... +${(ts.dependencies || []).length - 30} more</span>` : ''}
          </div>
        </div>

        <!-- Layers Executed -->
        <div class="detail-card full-width">
          <h3>Analysis Layers</h3>
          <div class="badge-row">
            ${(r.meta?.layersExecuted || []).map(l => `
              <div class="lang-badge">
                <strong>${this.esc(l.name)}</strong>
                <span class="badge-count">${l.durationMs}ms &mdash; ${l.status}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  },

  renderReportTree(r) {
    const fs = r.fileSystem || {};
    const folders = fs.folderStats || [];

    // Calculate totals from folder stats
    const totalAnalyzedFiles = folders.reduce((s, f) => s + (f.files || 0), 0);
    const totalAnalyzedLines = folders.reduce((s, f) => s + (f.lines || 0), 0);
    const totalAnalyzedSize = folders.reduce((s, f) => s + (f.size || 0), 0);

    return `
      <div class="file-tree-container">
        <pre class="file-tree-pre">${this.esc(fs.fileTree || 'No file tree available')}</pre>
      </div>

      ${folders.length > 0 ? `
        <div class="detail-card full-width" style="margin-top:16px">
          <h3>Folder Statistics</h3>
          <table style="width:100%;border-collapse:collapse;font-size:0.88rem">
            <thead>
              <tr style="border-bottom:1px solid var(--border);text-align:left">
                <th style="padding:8px 12px;color:var(--text-muted)">Folder</th>
                <th style="padding:8px 12px;color:var(--text-muted)">Files</th>
                <th style="padding:8px 12px;color:var(--text-muted)">Lines</th>
                <th style="padding:8px 12px;color:var(--text-muted)">Size</th>
              </tr>
            </thead>
            <tbody>
              ${folders.slice(0, 30).map(s => `
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:8px 12px;font-family:Consolas,monospace;color:var(--accent)">${this.esc(s.folder)}</td>
                  <td style="padding:8px 12px">${s.files}</td>
                  <td style="padding:8px 12px">${s.lines.toLocaleString()}</td>
                  <td style="padding:8px 12px">${this.formatSize(s.size)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="tree-totals">
          <div class="tree-total-item">
            <span class="tree-total-value">${totalAnalyzedFiles}</span>
            <span class="tree-total-label">Script Files Analyzed</span>
          </div>
          <div class="tree-total-item">
            <span class="tree-total-value">${totalAnalyzedLines.toLocaleString()}</span>
            <span class="tree-total-label">Total Lines of Code</span>
          </div>
          <div class="tree-total-item">
            <span class="tree-total-value">${this.formatSize(totalAnalyzedSize)}</span>
            <span class="tree-total-label">Total Script Size</span>
          </div>
        </div>
      ` : ''}
    `;
  },

  structureExpanded: true,

  toggleAllStructure() {
    this.structureExpanded = !this.structureExpanded;
    const display = this.structureExpanded ? 'block' : 'none';
    document.querySelectorAll('.structure-file-body').forEach(el => {
      el.style.display = display;
    });
    // Update button text
    const btn = document.getElementById('btn-toggle-structure');
    if (btn) {
      btn.textContent = this.structureExpanded ? 'Collapse All' : 'Expand All';
      btn.classList.toggle('active', !this.structureExpanded);
    }
  },

  renderReportStructure(r) {
    const cs = r.codeStructure || {};
    const files = (cs.files || []).filter(f => f.classes.length > 0 || f.functions.length > 0);

    if (files.length === 0) {
      return '<div class="empty-state"><h3>No code structure found</h3><p>No classes or functions detected in the analyzed files</p></div>';
    }

    this.structureExpanded = true;

    return `
      <div class="structure-toolbar">
        <span style="color:var(--text-muted);font-size:0.82rem;margin-right:auto">${files.length} files with code structure</span>
        <button class="btn-toggle" id="btn-toggle-structure" onclick="App.toggleAllStructure()">Collapse All</button>
      </div>
      ${files.map(file => `
        <div class="structure-file">
          <div class="structure-file-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">
            <span class="structure-file-name">${this.esc(file.path)}</span>
            <span style="color:var(--text-muted);font-size:0.82rem">
              ${file.classes.length} classes, ${file.functions.length} functions
            </span>
          </div>
          <div class="structure-file-body">
            ${file.classes.map(cls => `
              <div class="structure-item" style="border-left-color:var(--accent)">
                <span class="item-type">class</span>
                <span class="item-name">${this.esc(cls.name)}</span>
                ${cls.extends ? `<span style="color:var(--text-muted)"> extends ${this.esc(cls.extends)}</span>` : ''}
                <span class="item-line">:${cls.line}</span>
              </div>
              ${(cls.methods || []).map(m => `
                <div class="structure-item" style="margin-left:24px;border-left-color:var(--success)">
                  <span class="item-type">${m.visibility || ''}${m.isStatic ? ' static' : ''} method</span>
                  <span class="item-name">${this.esc(m.name)}(${(m.params || []).join(', ')})</span>
                  ${m.returnType ? `<span style="color:var(--text-muted)">: ${m.returnType}</span>` : ''}
                  <span class="item-line">:${m.line}</span>
                </div>
              `).join('')}
              ${(cls.properties || []).map(p => `
                <div class="structure-item" style="margin-left:24px;border-left-color:var(--warning)">
                  <span class="item-type">${p.visibility || ''} prop</span>
                  <span class="item-name">$${this.esc(p.name)}</span>
                  ${p.type ? `<span style="color:var(--text-muted)">: ${p.type}</span>` : ''}
                </div>
              `).join('')}
            `).join('')}
            ${file.functions.map(fn => `
              <div class="structure-item" style="border-left-color:var(--warning)">
                <span class="item-type">${fn.isAsync ? 'async ' : ''}${fn.type === 'arrow' ? 'arrow fn' : 'function'}</span>
                <span class="item-name">${this.esc(fn.name)}</span>
                <span class="item-line">:${fn.line}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}`;
  },

  renderReportQuality(r) {
    const cq = r.codeQuality || {};
    const summary = cq.summary || {};
    const issues = cq.issues || [];

    if (issues.length === 0) {
      return '<div class="empty-state" style="padding:32px"><h3 style="color:var(--success)">No issues found!</h3><p>Your code looks clean</p></div>';
    }

    // Severity icons
    const severityIcon = { critical: '!!', warning: '!', info: 'i' };

    // Type-readable labels
    const typeLabels = {
      unused_function: 'unused function',
      unused_method: 'unused method',
      unused_class: 'unused class',
      commented_code: 'dead code',
      unused_import: 'unused import',
      unused_dependency: 'unused dependency',
      large_function: 'large function'
    };

    return `
      <div class="stats-row" style="margin-bottom:20px">
        <div class="stat-card">
          <span class="stat-value" style="color:var(--danger)">${summary.bySeverity?.critical || 0}</span>
          <span class="stat-label">Critical</span>
        </div>
        <div class="stat-card">
          <span class="stat-value" style="color:var(--warning)">${summary.bySeverity?.warning || 0}</span>
          <span class="stat-label">Warnings</span>
        </div>
        <div class="stat-card">
          <span class="stat-value" style="color:var(--accent)">${summary.bySeverity?.info || 0}</span>
          <span class="stat-label">Info</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${summary.unusedFunctions || 0}</span>
          <span class="stat-label">Unused Functions</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${summary.unusedImports || 0}</span>
          <span class="stat-label">Unused Imports</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${summary.unusedDependencies || 0}</span>
          <span class="stat-label">Unused Dependencies</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${summary.commentedCode || 0}</span>
          <span class="stat-label">Commented Code Blocks</span>
        </div>
      </div>

      ${summary.hasDynamicLoading ? `
        <div class="dynamic-notice">
          <strong>Note:</strong>&nbsp;Dynamic class loading detected (new $variable). Some "unused class" reports may be false positives — classes loaded at runtime.
        </div>
      ` : ''}

      ${issues.map(issue => {
        const tag = issue.tag || issue.severity;
        const label = typeLabels[issue.type] || issue.type.replace(/_/g, ' ');
        const fileClick = issue.file ? `onclick="App.openCodePreview('${this.escAttr(issue.file)}', ${issue.line || 0}, '${this.escAttr(issue.name)}')"` : '';

        return `
          <div class="issue-item">
            <div class="issue-left ${issue.severity}"></div>
            <div class="issue-main">
              <div class="issue-icon ${issue.severity}">${severityIcon[issue.severity] || '?'}</div>
              <div class="issue-center">
                <div class="issue-title">
                  ${this.esc(issue.name)}
                  <span class="issue-type-badge">${label}</span>
                  ${issue.dynamic ? '<span class="issue-type-badge" style="background:var(--accent-soft);color:var(--accent)">dynamic?</span>' : ''}
                </div>
                ${issue.file ? `<span class="issue-location" ${fileClick}>${this.esc(issue.file)}${issue.line ? ':' + issue.line : ''}</span>` : ''}
                <div class="issue-desc">${this.esc(issue.description)}</div>
              </div>
            </div>
            <div class="issue-right">
              <span class="issue-tag ${issue.severity}">${this.esc(tag)}</span>
              <span class="issue-severity-label">${issue.severity}</span>
            </div>
          </div>`;
      }).join('')}

      ${cq.complexity && cq.complexity.length > 0 ? `
        <div class="detail-card full-width" style="margin-top:20px">
          <h3>Complexity Analysis (files with complexity > 10)</h3>
          <table style="width:100%;border-collapse:collapse;font-size:0.88rem">
            <thead>
              <tr style="border-bottom:1px solid var(--border);text-align:left">
                <th style="padding:8px 12px;color:var(--text-muted)">File</th>
                <th style="padding:8px 12px;color:var(--text-muted)">Complexity</th>
                <th style="padding:8px 12px;color:var(--text-muted)">Lines</th>
                <th style="padding:8px 12px;color:var(--text-muted)">if/else</th>
                <th style="padding:8px 12px;color:var(--text-muted)">Loops</th>
              </tr>
            </thead>
            <tbody>
              ${cq.complexity.slice(0, 20).map(c => `
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:8px 12px;font-family:Consolas,monospace;color:var(--accent);font-size:0.82rem">${this.esc(c.file)}</td>
                  <td style="padding:8px 12px;font-weight:600;color:${c.complexity > 30 ? 'var(--danger)' : c.complexity > 20 ? 'var(--warning)' : 'var(--text-primary)'}">${c.complexity}</td>
                  <td style="padding:8px 12px">${c.lines}</td>
                  <td style="padding:8px 12px">${(c.breakdown?.if || 0) + (c.breakdown?.else || 0)}</td>
                  <td style="padding:8px 12px">${(c.breakdown?.for || 0) + (c.breakdown?.while || 0)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    `;
  },

  downloadReport() {
    if (!this.currentReport) return;
    const blob = new Blob([JSON.stringify(this.currentReport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${this.currentReport.meta?.projectName || 'analysis'}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return `${bytes.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  },

  // ═══════════════════════════════════════════════════════
  // Modal Helpers
  // ═══════════════════════════════════════════════════════
  closeModal(e) {
    if (e && e.target !== e.currentTarget) return;
    document.getElementById('modal-overlay').style.display = 'none';
    this.editingId = null;
  },

  resetForm() {
    document.getElementById('project-form').reset();
    document.getElementById('pf-id').value = '';
    document.getElementById('pf-excluded').value = 'node_modules, vendor, .git, dist, build, cache, .next, .nuxt';
    document.getElementById('wp-db-section').style.display = 'none';
  },

  onFrameworkChange() {
    const fw = document.getElementById('pf-framework').value;
    const wpSection = document.getElementById('wp-db-section');
    wpSection.style.display = fw === 'wordpress' ? 'block' : 'none';

    // Auto-check technologies based on framework
    if (fw === 'wordpress' || fw === 'laravel' || fw === 'symfony' || fw === 'yii' || fw === 'codeigniter') {
      this.autoCheckTech(['php']);
    }
    if (fw === 'wordpress') {
      this.autoCheckTech(['php', 'javascript', 'html', 'css']);
    }
    if (fw === 'react' || fw === 'vue' || fw === 'nextjs' || fw === 'nuxtjs' || fw === 'angular' || fw === 'svelte') {
      this.autoCheckTech(['javascript']);
    }
    if (fw === 'express') {
      this.autoCheckTech(['javascript', 'nodejs']);
    }
    if (fw === 'nextjs') {
      this.autoCheckTech(['javascript', 'nodejs']);
    }
  },

  autoCheckTech(techs) {
    techs.forEach(t => {
      const cb = document.querySelector(`#pf-technologies input[value="${t}"]`);
      if (cb) cb.checked = true;
    });
  },

  // ═══════════════════════════════════════════════════════
  // Confirm Dialog
  // ═══════════════════════════════════════════════════════
  confirm(title, message, callback) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    this.confirmCallback = callback;
    document.getElementById('confirm-overlay').style.display = 'flex';
  },

  closeConfirm(confirmed) {
    document.getElementById('confirm-overlay').style.display = 'none';
    if (confirmed && this.confirmCallback) {
      this.confirmCallback();
    }
    this.confirmCallback = null;
  },

  // ═══════════════════════════════════════════════════════
  // Toast Notifications
  // ═══════════════════════════════════════════════════════
  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = '0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  },

  // ═══════════════════════════════════════════════════════
  // Health Check
  // ═══════════════════════════════════════════════════════
  async checkServerHealth() {
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok) {
        document.querySelector('.status-dot').style.background = 'var(--success)';
      }
    } catch {
      document.querySelector('.status-dot').style.background = 'var(--danger)';
      document.querySelector('.status-indicator').lastChild.textContent = ' Server offline';
    }
  },

  // ═══════════════════════════════════════════════════════
  // Theme
  // ═══════════════════════════════════════════════════════
  loadTheme() {
    const saved = localStorage.getItem('ci-theme') || 'dark';
    this.applyTheme(saved);
  },

  setTheme(theme) {
    this.applyTheme(theme);
    localStorage.setItem('ci-theme', theme);
    this.toast(`Switched to ${theme} theme`, 'info');
  },

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);

    // Update Settings toggle buttons if visible
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-theme') === theme);
    });
  },

  // ═══════════════════════════════════════════════════════
  // Code Preview Modal
  // ═══════════════════════════════════════════════════════
  async openCodePreview(filePath, line, symbolName) {
    if (!this.currentProject) return;

    const overlay = document.getElementById('code-preview-overlay');
    const title = document.getElementById('code-preview-title');
    const subtitle = document.getElementById('code-preview-subtitle');
    const content = document.getElementById('code-preview-content');
    const loading = document.getElementById('code-preview-loading');

    // Show modal
    overlay.style.display = 'flex';
    title.textContent = filePath.split('/').pop() || filePath;
    subtitle.textContent = symbolName ? `${symbolName} — line ${line}` : `line ${line}`;
    content.innerHTML = '';
    loading.style.display = 'flex';

    try {
      const res = await fetch(`${API}/reports/file-preview/${this.currentProject.id}?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();

      if (!data.success) {
        content.innerHTML = `<span style="color:var(--danger);padding:16px;display:block">${this.esc(data.error)}</span>`;
        loading.style.display = 'none';
        return;
      }

      const lines = data.data.content.split('\n');
      loading.style.display = 'none';

      // Build code with line numbers and highlighting
      content.innerHTML = lines.map((lineContent, i) => {
        const ln = i + 1;
        const isHighlighted = line && (ln >= line && ln < line + 5);
        return `<span class="code-line${isHighlighted ? ' highlighted' : ''}" data-ln="${ln}">${this.esc(lineContent) || ' '}</span>`;
      }).join('');

      // Scroll to highlighted line
      if (line) {
        requestAnimationFrame(() => {
          const target = content.querySelector(`.code-line[data-ln="${line}"]`);
          if (target) {
            target.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        });
      }
    } catch (err) {
      content.innerHTML = `<span style="color:var(--danger);padding:16px;display:block">Failed to load file</span>`;
      loading.style.display = 'none';
    }
  },

  closeCodePreview(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('code-preview-overlay').style.display = 'none';
  },

  // ═══════════════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════════════
  esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  escAttr(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  },

  formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      const d = new Date(dateStr + (dateStr.includes('Z') || dateStr.includes('+') ? '' : 'Z'));
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  }
};

// ─── Initialize on DOM ready ───
document.addEventListener('DOMContentLoaded', () => App.init());
