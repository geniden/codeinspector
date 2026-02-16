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
  strings: {},
  lang: 'en',

  t(key, params = {}) {
    let s = this.strings[key] || key;
    Object.keys(params).forEach(k => { s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), params[k]); });
    return s;
  },

  getScoreMessage(score) {
    if (score == null) return '';
    if (score >= 9.5) return this.t('score_9_5');
    if (score >= 8.5) return this.t('score_8_5');
    if (score >= 7) return this.t('score_7');
    if (score >= 5.5) return this.t('score_5_5');
    if (score >= 4) return this.t('score_4');
    if (score >= 2.5) return this.t('score_2_5');
    return this.t('score_0');
  },

  async loadLanguage() {
    const lang = localStorage.getItem('lang') || 'en';
    this.lang = lang;
    try {
      const res = await fetch(`/lang/${lang}.json`);
      if (res.ok) this.strings = await res.json();
    } catch (_) {}
  },

  async setLanguage(lang) {
    this.lang = lang;
    localStorage.setItem('lang', lang);
    await this.loadLanguage();
    this.applyLanguage();
    this.loadSettings();
    if (this.currentReport) {
      const activeTab = document.querySelector('.report-tab.active');
      const tab = (activeTab?.getAttribute('onclick') || '').match(/'(overview|structure|quality)'/)?.[1] || 'overview';
      this.showReportTab(tab);
    }
    if (this.currentPage === 'projects') this.renderProjects();
    if (this.currentPage === 'reports') this.loadAllReports();
    if (this.currentProject) this.renderProjectDetail(this.currentProject);
  },

  applyLanguage() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      if (key) el.textContent = this.t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = this.t(el.dataset.i18nPlaceholder);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      el.title = this.t(el.dataset.i18nTitle);
    });
  },

  // ─── Initialization ───
  async init() {
    await this.loadLanguage();
    this.loadTheme();
    this.loadSettings();
    this.setupNavigation();
    await this.loadProjects();
    this.checkServerHealth();
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (document.getElementById('browse-overlay').style.display === 'flex') App.closeBrowseFolder();
        else if (document.getElementById('code-preview-overlay').style.display === 'flex') App.closeCodePreview();
        else if (document.getElementById('export-modal-overlay').style.display === 'flex') App.closeExportModal();
        else if (document.getElementById('modal-overlay').style.display === 'flex') App.closeModal();
        else if (document.getElementById('confirm-overlay').style.display === 'flex') App.closeConfirm(false);
      }
    });
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
          <span class="tech-badge">${this.esc(p.project_type || 'auto')}</span>
        </div>
        <div class="project-card-footer">
          <span class="project-card-meta">
            ${p.last_analysis_at ? `${this.t('last_analysis')}: ${this.formatDate(p.last_analysis_at)}` : this.t('not_analyzed_yet')}
          </span>
          <div class="project-card-actions" onclick="event.stopPropagation()">
            <button class="btn btn-sm btn-ghost" onclick="App.editProjectById(${p.id})" title="Edit">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn btn-sm btn-ghost" onclick="App.deleteProject(${p.id}, '${this.escAttr(p.name)}')" title="${this.t('delete')}" style="color:var(--danger)">
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
    document.getElementById('modal-title').textContent = this.t('add_project');
    document.getElementById('modal-submit-btn').textContent = this.t('add_project');
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

      // Project type
      document.getElementById('pf-project-type').value = p.project_type || 'auto';

      // WordPress fields
      document.getElementById('pf-wp-host').value = p.wp_db_host || '';
      document.getElementById('pf-wp-name').value = p.wp_db_name || '';
      document.getElementById('pf-wp-user').value = p.wp_db_user || '';
      document.getElementById('pf-wp-pass').value = p.wp_db_pass || '';

      this.onFrameworkChange();

      document.getElementById('modal-title').textContent = this.t('edit_project');
      document.getElementById('modal-submit-btn').textContent = this.t('save_changes');
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
    const excludedRaw = document.getElementById('pf-excluded').value;
    const excluded_folders = excludedRaw.split(',').map(s => s.trim()).filter(Boolean);

    const name = document.getElementById('pf-name').value.trim();
    const rootPath = document.getElementById('pf-path').value.trim();
    const finalName = name || (rootPath ? rootPath.replace(/^.*[/\\]/, '') : '');
    return {
      name: finalName || 'Project',
      root_path: rootPath,
      entry_point: document.getElementById('pf-entry').value,
      project_type: document.getElementById('pf-project-type').value || 'auto',
      technologies: [],
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
      this.t('delete_project'),
      this.t('confirm_delete_project', { name }),
      async () => {
        try {
          const res = await fetch(`${API}/projects/${id}`, { method: 'DELETE' });
          const data = await res.json();

          if (data.success) {
            this.toast(this.t('project_deleted'), 'success');
            await this.loadProjects();

            // If viewing deleted project, go back
            if (this.currentProject && this.currentProject.id === id) {
              this.navigate('projects');
            }
          } else {
            this.toast(data.error || this.t('failed_to_delete'), 'error');
          }
        } catch (err) {
          this.toast(this.t('failed_to_delete_project'), 'error');
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
          <div class="detail-label">Project Type</div>
          <div class="detail-value"><span class="tech-badge">${this.esc(project.project_type || 'auto')}</span></div>
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
                <div class="report-item-actions-container">
                  <div class="report-item-actions" onclick="event.stopPropagation()">
                    <button class="btn btn-sm btn-ghost" onclick="App.deleteReportById(${a.id}, ${project.id})" title="${this.t('delete')}" style="color:var(--danger)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  </div>                
                  <span class="status-badge ${a.status}">${a.status}</span>
                </div>
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
      this.currentAnalysisId = analysisId; // ← сохраняем ID

      // Показываем модалку с прогрессом
      this.showProgressModal();

      // Продолжаем polling (можно оставить, если нужно знать "completed")
      // this.pollAnalysis(analysisId); // ← можно удалить, если poll ведётся в startProgressPolling
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
          <div class="report-item-actions-container">
            <div class="report-item-actions" onclick="event.stopPropagation()">
              <button class="btn btn-sm btn-ghost" onclick="App.deleteReportById(${r.id})" title="${this.t('delete')}" style="color:var(--danger)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </button>
            </div>          
            <span class="status-badge ${r.status}">${r.status}</span>
          </div>
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
      if (data.data.project_id && !this.currentReport.meta?.projectId) {
        this.currentReport.meta = this.currentReport.meta || {};
        this.currentReport.meta.projectId = data.data.project_id;
      }

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

  async deleteReport() {
    const id = this.currentReportId;
    if (!id) return;
    if (!confirm(this.t('confirm_delete_report'))) return;
    try {
      const res = await fetch(`${API}/reports/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        this.toast(this.t('report_deleted'), 'success');
        this.backFromReport();
      } else {
        this.toast(data.error || this.t('delete_error'), 'error');
      }
    } catch (err) {
      this.toast(this.t('delete_report_error'), 'error');
    }
  },

  async deleteReportById(id, projectIdForRefresh) {
    if (!id) return;
    if (!confirm(this.t('confirm_delete_report'))) return;
    try {
      const res = await fetch(`${API}/reports/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        this.toast(this.t('report_deleted'), 'success');
        if (projectIdForRefresh) this.viewProject(projectIdForRefresh);
        else this.loadAllReports();
      } else {
        this.toast(data.error || this.t('delete_error'), 'error');
      }
    } catch (err) {
      this.toast(this.t('delete_report_error'), 'error');
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

  // Map language names to icon filenames (from /icons/*.svg)
  langIcon(name) {
    const map = {
      'javascript': 'js', 'typescript': 'ts', 'php': 'php',
      'html': 'html', 'css': 'css', 'json': 'json', 'sass': 'sass',
      'jsx': 'js', 'tsx': 'ts', 'dart': 'dart', 'rust': 'rs'
    };
    return map[(name || '').toLowerCase()] || null;
  },

  renderKeyLocations(kl) {
    if (!kl || (!kl.entryPoints?.length && !kl.dbConfig?.length && !kl.envFiles?.length && !kl.sqliteFiles?.length && !kl.logLocations?.length && !kl.dottedConfigFiles?.length)) return '';
    const link = (path, label) => `<span class="proj-tree-symbol proj-tree-symbol-clickable" onclick="App.openCodePreview('${this.escAttr(path)}', 0, '${this.escAttr(label || path)}');event.stopPropagation()" style="cursor:pointer;color:var(--accent)">${this.esc(path)}</span>`;
    let html = '<div class="detail-card full-width"><h3>Key Locations</h3><div style="display:grid;gap:12px;font-size:0.9rem">';
    if (kl.entryPoints?.length) html += `<div><strong>Entry points:</strong> ${kl.entryPoints.map(e => link(e.path, 'Entry')).join(', ')}</div>`;
    if (kl.dbConfig?.length) html += `<div><strong>DB config:</strong> ${kl.dbConfig.map(d => link(d.path, 'DB')).join(', ')}</div>`;
    if (kl.sqliteFiles?.length) html += `<div><strong>SQLite:</strong> ${kl.sqliteFiles.map(p => link(p, 'SQLite')).join(', ')}</div>`;
    if (kl.envFiles?.length) html += `<div><strong>.env:</strong> ${kl.envFiles.map(p => link(p, '.env')).join(', ')}</div>`;
    if (kl.dottedConfigFiles?.length) html += `<div><strong>${this.t('config_important')}:</strong> ${kl.dottedConfigFiles.map(p => link(p, 'Config')).join(', ')}</div>`;
    if (kl.logLocations?.length) html += `<div><strong>Logs:</strong> ${kl.logLocations.map(l => l.files?.[0] ? link(l.files[0], 'Log') + ` (${this.t('in_folder', { folder: l.folder })})` : this.esc(l.folder)).join(', ')}</div>`;
    html += '</div></div>';
    return html;
  },

  renderReportOverview(r) {
    const fs = r.fileSystem || {};
    const ts = r.techStack || {};
    const cs = r.codeStructure || {};
    const cq = r.codeQuality || {};
    const summary = cq.summary || {};
    const scoreData = r.codeScore || {};
    const score = scoreData.score ?? null;
    const scoreMsg = this.getScoreMessage(score);
    const scoreClass = score >= 9 ? 'score-awesome' : score >= 7 ? 'score-good' : score >= 5 ? 'score-ok' : score >= 4 ? 'score-warn' : 'score-low';

    return `
      ${score !== null ? `
      <div class="detail-card full-width score-card ${scoreClass}">
        <div class="score-value">${score.toFixed(1)}</div>
        <div class="score-label">${this.t('score_label')}</div>
        <div class="score-message">${this.esc(scoreMsg)}</div>
      </div>
      ` : ''}
      <div class="stats-row">
        <div class="stat-card">
          <span class="stat-value">${fs.totalFiles || 0}</span>
          <span class="stat-label">${this.t('files')}</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${(fs.totalLines || 0).toLocaleString()}</span>
          <span class="stat-label">${this.t('lines_of_code')}</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${fs.totalFolders || 0}</span>
          <span class="stat-label">${this.t('folders')}</span>
        </div>
        <div class="stat-card">
          <span class="stat-value" style="color:var(--accent)">${cs.totalClasses || 0}</span>
          <span class="stat-label">${this.t('classes')}</span>
        </div>
        <div class="stat-card">
          <span class="stat-value" style="color:var(--success)">${cs.totalFunctions || 0}</span>
          <span class="stat-label">${this.t('functions')}</span>
        </div>
        <div class="stat-card">
          <span class="stat-value" style="color:var(--lang-ts)">${cs.totalMethods || 0}</span>
          <span class="stat-label">${this.t('methods')}</span>
        </div>
        <div class="stat-card">
          <span class="stat-value" style="color:${summary.totalIssues > 0 ? 'var(--warning)' : 'var(--success)'}">${summary.totalIssues || 0}</span>
          <span class="stat-label">${this.t('issues_found')}</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${cs.totalImports || 0}</span>
          <span class="stat-label">${this.t('imports')}</span>
        </div>
      </div>

      <div class="detail-grid">
        <!-- Languages -->
        <div class="detail-card">
          <h3>Languages</h3>
          <div class="badge-row">
            ${(ts.languages || []).map(l => {
              const cls = this.langClass(l.name);
              const icon = this.langIcon(l.name);
              return `
                <div class="lang-badge${cls ? ' lang-' + cls : ''}">
                  ${icon ? `<img src="/icons/${icon}.svg" alt="" class="lang-icon">` : '<span class="lang-dot"></span>'}
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

        <!-- Key Locations -->
        ${this.renderKeyLocations(r.keyLocations)}

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

  fileIcon(ext, isFolder, isOpen) {
    if (isFolder) return `/icons/${isOpen ? 'folder-open' : 'folder'}.svg`;
    const icon = this.langIcon(ext?.replace(/^\./, '') || '') || (document.documentElement.getAttribute('data-theme') === 'light' ? 'file-light' : 'file');
    return `/icons/${icon}.svg`;
  },

  buildStructureTree(files, structureMap, analyzedAt) {
    const root = { children: [] };
    const cutoff = new Date(analyzedAt || Date.now()).getTime() - 30 * 24 * 60 * 60 * 1000;

    for (const f of files) {
      const parts = f.path.split('/');
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const name = parts[i];
        node.children = node.children || [];
        let folder = node.children.find(c => c.type === 'folder' && c.name === name);
        if (!folder) {
          folder = { type: 'folder', name, children: [], open: true };
          node.children.push(folder);
        }
        node = folder;
      }
      node.children = node.children || [];
      const lastMod = f.lastModified ? new Date(f.lastModified).getTime() : 0;
      const showDate = lastMod > cutoff;
      node.children.push({
        type: 'file',
        name: parts[parts.length - 1],
        path: f.path,
        ext: f.extension || '',
        lastModified: f.lastModified,
        showDate,
        structure: structureMap[f.path] || null
      });
    }

    const sortNode = (n) => {
      if (n.children) {
        n.children.sort((a, b) => {
          if (a.type === 'folder' && b.type === 'file') return -1;
          if (a.type === 'file' && b.type === 'folder') return 1;
          return (a.name || '').localeCompare(b.name || '');
        });
        n.children.forEach(sortNode);
      }
    };
    sortNode(root);
    return root;
  },

  renderTreeItem(item, depth, structureMap) {
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    const fileIcon = theme === 'light' ? 'file-light' : 'file';

    if (item.type === 'folder') {
      const childHtml = (item.children || []).map(c => this.renderTreeItem(c, depth + 1, structureMap)).join('');
      return `
        <div class="proj-tree-folder" data-depth="${depth}">
          <div class="proj-tree-row proj-tree-folder-row open" onclick="var r=this;var i=r.querySelector('img');r.classList.toggle('open');i.src=r.classList.contains('open')?'/icons/folder-open.svg':'/icons/folder.svg';r.nextElementSibling.classList.toggle('open')">
            <img src="/icons/folder-open.svg" alt="" class="proj-tree-icon proj-tree-icon-folder">
            <span class="proj-tree-name">${this.esc(item.name)}/</span>
          </div>
          <div class="proj-tree-children open">${childHtml}</div>
        </div>`;
    }

    const s = item.structure;
    const ext = (item.ext || '').replace(/^\./, '');
    const typeIcon = this.langIcon(ext) ? ext : (theme === 'light' ? 'file-light' : 'file');

    const dateStr = item.showDate && item.lastModified
      ? new Date(item.lastModified).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';

    const isScript = /\.(php|js|jsx|mjs|ts|tsx|vue)$/i.test(item.path);
    let body = '';
    if (s || isScript) {
      const previewClick = `App.openCodePreview('${this.escAttr(item.path)}', 0, 'preview');event.stopPropagation()`;
      const previewLink = `<div class="proj-tree-symbol proj-tree-preview-link" onclick="${previewClick}" title="${this.esc(this.t('open_file_code'))}">${this.t('preview')}</div>`;
      const items = [];
      if (s) {
        (s.classes || []).forEach(cls => {
          (cls.methods || []).forEach(m => {
            items.push({ name: `${cls.name} > ${m.name}`, line: m.line });
          });
        });
        (s.functions || []).forEach(fn => {
          items.push({ name: fn.name, line: fn.line });
        });
      }
      const symbolClick = (path, line, name) => `App.openCodePreview('${this.escAttr(path)}', ${line}, '${this.escAttr(name)}');event.stopPropagation()`;
      const symbolRows = items.map(i => `<div class="proj-tree-symbol proj-tree-symbol-clickable" onclick="${symbolClick(item.path, i.line, i.name)}" title="${this.esc(this.t('go_to_line'))} ${i.line}">${this.esc(i.name)} <span class="proj-tree-line">${this.t('line_n', { n: i.line })}</span></div>`).join('');
      body = previewLink + (symbolRows || '');
    }

    return `
      <div class="proj-tree-file" data-depth="${depth}">
        <div class="proj-tree-row proj-tree-file-row" onclick="this.nextElementSibling?.classList?.toggle('open')">
          <img src="/icons/${typeIcon}.svg" alt="" class="proj-tree-icon">
          <span class="proj-tree-name">${this.esc(item.name)}</span>
          ${dateStr ? `<span class="proj-tree-date">${dateStr}</span>` : ''}
        </div>
        ${body ? `<div class="proj-tree-body open">${body}</div>` : ''}
      </div>`;
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

  collapseAllStructure() {
    document.querySelectorAll('.proj-tree-children.open').forEach(el => el.classList.remove('open'));
    document.querySelectorAll('.proj-tree-body.open').forEach(el => el.classList.remove('open'));
    document.querySelectorAll('.proj-tree-folder-row.open').forEach(row => {
      row.classList.remove('open');
      const img = row.querySelector('img');
      if (img) img.src = '/icons/folder.svg';
    });
  },

  expandFoldersStructure() {
    document.querySelectorAll('.proj-tree-children').forEach(el => el.classList.add('open'));
    document.querySelectorAll('.proj-tree-folder-row').forEach(row => {
      row.classList.add('open');
      const img = row.querySelector('img.proj-tree-icon-folder');
      if (img) img.src = '/icons/folder-open.svg';
    });
  },

  toggleAllStructure() {
    this.structureExpanded = !this.structureExpanded;
    const display = this.structureExpanded ? 'block' : 'none';
    document.querySelectorAll('.structure-file-body').forEach(el => {
      el.style.display = display;
    });
    // Update button text
    const btn = document.getElementById('btn-toggle-structure');
    if (btn) {
      btn.textContent = this.structureExpanded ? this.t('collapse_all') : this.t('expand_folders');
      btn.classList.toggle('active', !this.structureExpanded);
    }
  },

  TREE_EXTENSIONS: new Set(['.php','.js','.jsx','.mjs','.ts','.tsx','.vue','.svelte','.json','.html','.htm','.css','.scss','.less','.sass','.md','.xml','.yaml','.yml','.env','.sql','.twig','.blade.php','.ejs','.pug','.hbs','.py','.rb','.go','.java','.c','.cpp','.h']),

  renderReportStructure(r) {
    const fs = r.fileSystem || {};
    const cs = r.codeStructure || {};
    const files = (fs.files || []).filter(f => this.TREE_EXTENSIONS.has((f.extension || '').toLowerCase()));
    const structureMap = {};
    (cs.files || []).forEach(f => { structureMap[f.path] = f; });

    const tree = this.buildStructureTree(files, structureMap, r.meta?.analyzedAt);

    const folders = fs.folderStats || [];
    const totalAnalyzedFiles = folders.reduce((s, f) => s + (f.files || 0), 0);
    const totalAnalyzedLines = folders.reduce((s, f) => s + (f.lines || 0), 0);
    const totalAnalyzedSize = folders.reduce((s, f) => s + (f.size || 0), 0);

    let treeHtml = '';
    (tree.children || []).forEach(c => {
      treeHtml += this.renderTreeItem(c, 0, structureMap);
    });

    return `
      <div class="proj-structure-container">
        <div class="proj-structure-toolbar">
          <button type="button" class="btn btn-sm btn-ghost" onclick="App.collapseAllStructure()">${this.t('collapse_all')}</button>
          <button type="button" class="btn btn-sm btn-ghost" onclick="App.expandFoldersStructure()">${this.t('expand_folders')}</button>
        </div>
        <div class="proj-tree">${treeHtml || `<div class="empty-state-inline">${this.t('no_files')}</div>`}</div>
        <div class="tree-totals" style="margin-top:16px">
          <div class="tree-total-item">
            <span class="tree-total-value">${totalAnalyzedFiles}</span>
            <span class="tree-total-label">${this.t('files')}</span>
          </div>
          <div class="tree-total-item">
            <span class="tree-total-value">${totalAnalyzedLines.toLocaleString()}</span>
            <span class="tree-total-label">${this.t('lines')}</span>
          </div>
          <div class="tree-total-item">
            <span class="tree-total-value">${this.formatSize(totalAnalyzedSize)}</span>
            <span class="tree-total-label">${this.t('size')}</span>
          </div>
        </div>
      </div>`;
  },

  renderScoreDeductions(codeScore) {
    const deductions = codeScore?.deductions || [];
    if (deductions.length === 0) return '';
    const labels = {
      commented_code: () => App.t('deduction_commented_code', { count: deductions.find(d => d.key === 'commented_code')?.count || 0 }),
      large_huge: () => App.t('deduction_large_huge', { count: deductions.find(d => d.key === 'large_huge')?.count || 0 }),
      large_big: () => App.t('deduction_large_big', { count: deductions.find(d => d.key === 'large_big')?.count || 0 }),
      unsafe_sql: () => App.t('deduction_unsafe_sql')
    };
    const items = deductions.map(d => labels[d.key] ? labels[d.key]() : d.key).filter(Boolean);
    if (items.length === 0) return '';
    return `
      <div class="score-deductions-block" style="margin-bottom:16px;padding:12px 16px;background:var(--surface);border-radius:8px;border:1px solid var(--border)">
        <div class="score-deductions-title" style="font-weight:600;margin-bottom:8px;color:var(--text-primary)">${App.t('main_issues')}</div>
        <div class="score-deductions-list" style="display:flex;flex-wrap:wrap;gap:6px">${items.map(t => `<span class="deduction-badge" style="padding:4px 10px;background:var(--danger-soft);color:var(--danger);border-radius:6px;font-size:0.85rem">${t}</span>`).join('')}</div>
      </div>`;
  },

  renderReportQuality(r) {
    const cq = r.codeQuality || {};
    const summary = cq.summary || {};
    const issues = cq.issues || [];
    const hasDeductions = (r.codeScore?.deductions || []).length > 0;

    if (issues.length === 0 && !hasDeductions) {
      return `<div class="empty-state" style="padding:32px"><h3 style="color:var(--success)">${this.t('no_issues')}</h3><p>${this.t('code_clean')}</p></div>`;
    }

    // Severity icons
    const severityIcon = { critical: '!!', warning: '!', info: 'i' };

    const typeLabels = {
      unused_function: () => this.t('issue_unused_function'),
      unused_method: () => this.t('issue_unused_method'),
      unused_class: () => this.t('issue_unused_class'),
      commented_code: () => this.t('issue_commented_code'),
      unused_import: () => this.t('issue_unused_import'),
      unused_dependency: () => this.t('issue_unused_dependency'),
      large_function: () => this.t('issue_large_function')
    };
    const tagLabels = {
      'never called': () => this.t('tag_never_called'),
      'never instantiated': () => this.t('tag_never_instantiated'),
      'possibly dynamic': () => this.t('tag_possibly_dynamic'),
      'never used': () => this.t('tag_never_used'),
      'not imported': () => this.t('tag_not_imported'),
      'dynamic?': () => this.t('tag_dynamic')
    };

    return `
      <div class="stats-row" style="margin-bottom:20px">
        <div class="stat-card">
          <span class="stat-value" style="color:var(--danger)">${summary.bySeverity?.critical || 0}</span>
          <span class="stat-label">${this.t('critical')}</span>
        </div>
        <div class="stat-card">
          <span class="stat-value" style="color:var(--warning)">${summary.bySeverity?.warning || 0}</span>
          <span class="stat-label">${this.t('warnings')}</span>
        </div>
        <div class="stat-card">
          <span class="stat-value" style="color:var(--accent)">${summary.bySeverity?.info || 0}</span>
          <span class="stat-label">${this.t('info')}</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${summary.unusedFunctions || 0}</span>
          <span class="stat-label">${this.t('unused_functions')}</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${summary.unusedImports || 0}</span>
          <span class="stat-label">${this.t('unused_imports')}</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${summary.unusedDependencies || 0}</span>
          <span class="stat-label">${this.t('unused_dependencies')}</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${summary.commentedCode || 0}</span>
          <span class="stat-label">${this.t('commented_code')}</span>
        </div>
      </div>

      ${this.renderScoreDeductions(r.codeScore)}

      ${issues.length === 0 ? `<div class="empty-state-inline" style="padding:16px 0;color:var(--success)">${this.t('no_issues')} ${this.t('code_clean')}</div>` : ''}

      ${summary.hasDynamicLoading ? `
        <div class="dynamic-notice">
          <strong>Note:</strong>&nbsp;Dynamic class loading detected (new $variable). Some "unused class" reports may be false positives — classes loaded at runtime.
        </div>
      ` : ''}

      ${issues.length > 0 ? issues.map(issue => {
        const tagRaw = issue.tag || issue.severity;
        const tag = (tagLabels[tagRaw] ? tagLabels[tagRaw]() : (/^\d+\s*lines?$/.test(tagRaw) ? this.t('tag_lines', { n: tagRaw.split(/\s/)[0] }) : tagRaw));
        const labelFn = typeLabels[issue.type];
        const label = labelFn ? labelFn() : issue.type.replace(/_/g, ' ');
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
                  ${issue.dynamic ? `<span class="issue-type-badge" style="background:var(--accent-soft);color:var(--accent)">${this.t('tag_dynamic')}</span>` : ''}
                </div>
                ${issue.file ? `<span class="issue-location" ${fileClick}>${this.esc(issue.file)}${issue.line ? ':' + issue.line : ''}</span>` : ''}
                <div class="issue-desc">${this.esc(this.translateIssueDescription(issue.description))}</div>
              </div>
            </div>
            <div class="issue-right">
              <span class="issue-tag ${issue.severity}">${this.esc(tag)}</span>
              <span class="issue-severity-label">${this.t(issue.severity === 'critical' ? 'critical' : issue.severity === 'warning' ? 'warning' : 'info')}</span>
            </div>
          </div>`;
      }).join('') : ''}

      ${cq.complexity && cq.complexity.length > 0 ? `
        <div class="detail-card full-width" style="margin-top:20px">
          <h3>${App.t('complexity_title')}</h3>
          <p class="complexity-help" style="margin:0 0 12px 0;font-size:0.9rem;color:var(--text-muted)">${App.t('complexity_help')}</p>
          <table style="width:100%;border-collapse:collapse;font-size:0.88rem">
            <thead>
              <tr style="border-bottom:1px solid var(--border);text-align:left">
                <th style="padding:8px 12px;color:var(--text-muted)">File</th>
                <th style="padding:8px 12px;color:var(--text-muted)">Complexity</th>
                <th style="padding:8px 12px;color:var(--text-muted)">Lines</th>
                <th style="padding:8px 12px;color:var(--text-muted)">${App.t('complexity_if_else')}</th>
                <th style="padding:8px 12px;color:var(--text-muted)">${App.t('complexity_loops')}</th>
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

  showExportModal() {
    if (!this.currentReport) return;
    document.getElementById('export-modal-overlay').style.display = 'flex';
    this.updateExportSizeHint();
    document.querySelectorAll('#export-options input').forEach(cb => {
      cb.addEventListener('change', () => this.updateExportSizeHint());
    });
  },

  closeExportModal() {
    document.getElementById('export-modal-overlay').style.display = 'none';
  },

  buildExportReport() {
    const r = this.currentReport;
    if (!r) return null;
    const out = {};
    const expOverview = document.getElementById('exp-overview')?.checked;
    const expStructure = document.getElementById('exp-structure')?.checked;
    const expQuality = document.getElementById('exp-quality')?.checked;

    if (expOverview) {
      const meta = r.meta || {};
      out.meta = {
        projectName: meta.projectName,
        rootPath: meta.rootPath,
        analyzedAt: meta.analyzedAt
      };
      out.techStack = {};
      if (r.techStack) {
        const ts = r.techStack;
        out.techStack.languages = (ts.languages || []).map(l => ({ name: l.name, ext: l.extension }));
        out.techStack.frameworks = ts.frameworks || [];
        out.techStack.packageManager = ts.packageManager || null;
        out.techStack.dependencies = (ts.dependencies || []).map(d => ({ name: d.name, version: d.version || '', type: d.type || 'prod' }));
        out.techStack.devDependencies = (ts.devDependencies || []).map(d => ({ name: d.name, version: d.version || '', type: d.type || 'dev' }));
      }
      out.fileSystem = r.fileSystem ? {
        rootPath: r.fileSystem.rootPath,
        totalFiles: r.fileSystem.totalFiles,
        totalLines: r.fileSystem.totalLines,
        totalFolders: r.fileSystem.totalFolders
      } : {};
    }
    if (expStructure) {
      if (r.fileSystem) {
        out.fileSystem = out.fileSystem || {};
        out.fileSystem.fileTree = r.fileSystem.fileTree;
      }
      if (r.codeStructure) {
        out.codeStructure = {
          totalClasses: r.codeStructure.totalClasses,
          totalFunctions: r.codeStructure.totalFunctions,
          totalMethods: r.codeStructure.totalMethods,
          files: (r.codeStructure.files || []).map(f => ({
            path: f.path,
            classes: (f.classes || []).map(c => ({ name: c.name, methods: (c.methods || []).map(m => m.name) })),
            functions: (f.functions || []).map(fn => fn.name)
          }))
        };
      }
    }
    if (expOverview && r.keyLocations) out.keyLocations = r.keyLocations;
    if (expOverview && r.codeScore) out.codeScore = r.codeScore;
    if (expQuality) {
      const cq = r.codeQuality || {};
      out.codeQuality = {
        issues: (cq.issues || []).map(i => ({ file: i.file, line: i.line, type: i.type, message: i.description || i.message }))
      };
    }
    return out;
  },

  reportToMarkdown(report) {
    const lines = [];
    if (report.meta) {
      lines.push(`# ${report.meta.projectName || 'Project'}\n`);
      if (report.meta.rootPath) lines.push(`**Root:** \`${report.meta.rootPath}\``);
      if (report.meta.analyzedAt) lines.push(`**Analyzed:** ${report.meta.analyzedAt}`);
      if (report.codeScore) lines.push(`**Score:** ${report.codeScore.score?.toFixed(1) || '—'}/10 — ${this.getScoreMessage(report.codeScore.score) || report.codeScore.message || ''}`);
      lines.push('');
    }
    if (report.techStack) {
      const ts = report.techStack;
      lines.push('## Stack');
      if (ts.languages?.length) lines.push('- Languages: ' + ts.languages.map(l => l.name).join(', '));
      if (ts.frameworks?.length) lines.push('- Frameworks: ' + ts.frameworks.map(f => typeof f === 'string' ? f : (f.name || f)).join(', '));
      if (ts.packageManager) lines.push('- Package manager: ' + ts.packageManager);
      if (ts.dependencies?.length) {
        lines.push('\n### Dependencies');
        ts.dependencies.forEach(d => lines.push(`- ${d.name} ${d.version}`));
      }
      if (ts.devDependencies?.length) {
        lines.push('\n### Dev dependencies');
        ts.devDependencies.forEach(d => lines.push(`- ${d.name} ${d.version}`));
      }
      lines.push('');
    }
    if (report.fileSystem) {
      const fs = report.fileSystem;
      lines.push('## Structure');
      lines.push(`Files: ${fs.totalFiles}, Lines: ${fs.totalLines?.toLocaleString() || 0}`);
      if (fs.fileTree) {
        lines.push('\n```\n' + fs.fileTree + '\n```');
      }
      lines.push('');
    }
    if (report.codeStructure) {
      const cs = report.codeStructure;
      lines.push('## Code Structure');
      lines.push(`Classes: ${cs.totalClasses}, Functions: ${cs.totalFunctions}, Methods: ${cs.totalMethods}`);
      if (cs.files?.length) {
        lines.push('\n### Files');
        cs.files.forEach(f => {
          const parts = [];
          (f.classes || []).forEach(c => parts.push(`${c.name}(${(c.methods || []).join(', ')})`));
          (f.functions || []).forEach(fn => parts.push(fn));
          if (parts.length) lines.push(`- \`${f.path}\`: ${parts.join('; ')}`);
        });
      }
      lines.push('');
    }
    if (report.keyLocations) {
      const kl = report.keyLocations;
      lines.push('## Key Locations');
      if (kl.entryPoints?.length) lines.push('\n### Entry points\n' + kl.entryPoints.map(e => `- \`${e.path}\``).join('\n'));
      if (kl.dbConfig?.length) lines.push('\n### DB config\n' + kl.dbConfig.map(d => `- \`${d.path}\``).join('\n'));
      if (kl.sqliteFiles?.length) lines.push('\n### SQLite files\n' + kl.sqliteFiles.map(p => `- \`${p}\``).join('\n'));
      if (kl.envFiles?.length) lines.push('\n### .env files\n' + kl.envFiles.map(p => `- \`${p}\``).join('\n'));
      if (kl.dottedConfigFiles?.length) lines.push('\n### ' + this.t('dotted_config') + '\n' + kl.dottedConfigFiles.map(p => `- \`${p}\``).join('\n'));
      if (kl.logLocations?.length) lines.push('\n### Logs\n' + kl.logLocations.map(l => `- \`${l.folder}\` ${l.files?.length ? `(${l.files[0]})` : ''}`).join('\n'));
      lines.push('');
    }
    if (report.codeQuality?.issues?.length) {
      lines.push('## Code Quality Issues');
      report.codeQuality.issues.slice(0, 100).forEach(i => lines.push(`- \`${i.file}\`:${i.line} [${i.type}] ${i.description || i.message || ''}`));
    }
    return lines.join('\n');
  },

  updateExportSizeHint() {
    const report = this.buildExportReport();
    if (!report) return;
    const format = document.getElementById('exp-format')?.value || 'json';
    const content = format === 'md' ? this.reportToMarkdown(report) : JSON.stringify(report, null, 2);
    const size = new Blob([content]).size;
    const el = document.getElementById('export-size-hint');
    if (el) el.textContent = this.t('export_size_format', { size: this.formatSize(size) });
  },

  downloadReport() {
    if (!this.currentReport) return;
    const report = this.buildExportReport();
    if (!report || Object.keys(report).length === 0) {
      this.toast(this.t('select_one_section'), 'warning');
      return;
    }
    const format = document.getElementById('exp-format')?.value || 'json';
    const content = format === 'md' ? this.reportToMarkdown(report) : JSON.stringify(report, null, 2);
    const mime = format === 'md' ? 'text/markdown' : 'application/json';
    const ext = format === 'md' ? 'md' : 'json';
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${this.currentReport.meta?.projectName || 'analysis'}-${Date.now()}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    this.closeExportModal();
    this.toast(this.t('report_exported'), 'success');
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
  browseCurrentPath: '',

  async showBrowseFolder() {
    document.getElementById('browse-overlay').style.display = 'flex';
    this.browseCurrentPath = document.getElementById('pf-path').value.trim() || '';
    await this.loadBrowseFolder();
  },

  async loadBrowseFolder() {
    const listEl = document.getElementById('browse-list');
    const pathEl = document.getElementById('browse-current-path');
    pathEl.textContent = this.browseCurrentPath || this.t('root');

    try {
      const q = this.browseCurrentPath ? `?path=${encodeURIComponent(this.browseCurrentPath)}` : '';
      const res = await fetch(`${API}/projects/fs/browse${q}`);
      const data = await res.json();

      if (!data.success) {
        listEl.innerHTML = `<div style="color:var(--danger);padding:12px">${this.esc(data.error || this.t('error'))}</div>`;
        return;
      }

      const d = data.data;
      let html = '';
      if (d.parent !== null && d.parent !== undefined) {
        html += `<div class="browse-item" data-path="${encodeURIComponent(d.parent)}" onclick="App.browseNavigate(decodeURIComponent(this.dataset.path))"><span class="browse-icon">📁</span> ..</div>`;
      }
      (d.entries || []).filter(e => e.isDir).forEach(e => {
        const sep = d.path && (d.path.includes('\\') || !d.path.startsWith('/')) ? '\\' : '/';
        const full = d.path ? `${d.path}${sep}${e.name}` : e.name;
        html += `<div class="browse-item" data-path="${encodeURIComponent(full)}" onclick="App.browseNavigate(decodeURIComponent(this.dataset.path))"><span class="browse-icon">📁</span> ${this.esc(e.name)}/</div>`;
      });
      listEl.innerHTML = html || `<div style="color:var(--text-muted);padding:12px">${this.t('folder_empty')}</div>`;
    } catch (err) {
      listEl.innerHTML = `<div style="color:var(--danger);padding:12px">${this.t('load_error')}</div>`;
    }
  },

  browseNavigate(fullPath) {
    this.browseCurrentPath = fullPath;
    this.loadBrowseFolder();
  },

  selectBrowseFolder() {
    document.getElementById('pf-path').value = this.browseCurrentPath;
    const nameEl = document.getElementById('pf-name');
    if (!nameEl.value.trim() && this.browseCurrentPath) {
      const parts = this.browseCurrentPath.replace(/\\/g, '/').split('/');
      nameEl.value = parts.filter(Boolean).pop() || '';
    }
    this.closeBrowseFolder();
  },

  closeBrowseFolder() {
    document.getElementById('browse-overlay').style.display = 'none';
  },

  closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
    this.editingId = null;
  },

  resetForm() {
    document.getElementById('project-form').reset();
    document.getElementById('pf-id').value = '';
    document.getElementById('pf-excluded').value = 'node_modules, vendor, .git, dist, build, cache, .next, .nuxt, reports, data, lib';
    document.getElementById('wp-db-section').style.display = 'none';
  },

  onFrameworkChange() {
    const fw = document.getElementById('pf-framework').value;
    document.getElementById('wp-db-section').style.display = fw === 'wordpress' ? 'block' : 'none';
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
      toast.style.transform = 'translateY(-100%)';
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

  loadSettings() {
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === this.lang);
    });
    this.applyLanguage();
  },

  // ═══════════════════════════════════════════════════════
  // Modal
  // ═══════════════════════════════════════════════════════

  // ─── Progress Modal ───
  showProgressModal() {
    const overlay = document.getElementById('progress-overlay');
    overlay.style.display = 'flex';
    this.startProgressPolling();
  },

  hideProgressModal() {
    const overlay = document.getElementById('progress-overlay');
    overlay.style.display = 'none';
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  },

  startProgressPolling() {
    this.progressInterval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/analysis/${this.currentAnalysisId}/status`);
        const data = await res.json();
        if (!data.success) return;

        const status = data.data.status;

        // Check completion FIRST — when completed, progress is null (runningAnalyses was cleared)
        if (status === 'completed') {
          this.hideProgressModal();
          this.toast('Analysis completed!', 'success');
          if (this.currentProject) {
            this.viewProject(this.currentProject.id);
          }
          return;
        }
        if (status === 'failed') {
          this.hideProgressModal();
          this.toast(`Analysis failed: ${data.data.error_message || 'Unknown error'}`, 'error');
          return;
        }

        // Update progress UI (only when running, progress may be null initially)
        const progress = data.data.progress;
        if (progress) {
          const stepEl = document.getElementById('progress-step');
          const countEl = document.getElementById('progress-count');
          const fillEl = document.getElementById('progress-fill');

          const total = progress.total || 1;
          const current = progress.subStep
            ? (progress.current ?? 0)
            : (progress.current ?? progress.step ?? 0);
          const pct = Math.min(100, (current / total) * 100);

          const layerDisplay = {
            'file-system': 'File System',
            'tech-stack': 'Tech Stack',
            'code-structure': 'Code Structure',
            'code-quality': 'Code Quality',
            'starting': 'Starting...'
          };
          const layerName = layerDisplay[progress.layer] || progress.layer || progress.detail || 'Processing';
          stepEl.textContent = progress.subStep && progress.detail
            ? `${layerName}: ${progress.detail}`
            : layerName;
          countEl.textContent = progress.subStep
            ? `${progress.current ?? 0} / ${progress.total ?? 0}`
            : `${current} / ${total} layers`;
          fillEl.style.width = `${pct}%`;
        }
      } catch (err) {
        console.error('Failed to poll progress', err);
      }
    }, 500);
  },

  // ═══════════════════════════════════════════════════════
  // Code Preview Modal
  // ═══════════════════════════════════════════════════════
  async openCodePreview(filePath, line, symbolName) {
    const projectId = this.currentProject?.id ?? this.currentReport?.meta?.projectId;
    if (!projectId) return;

    const overlay = document.getElementById('code-preview-overlay');
    const title = document.getElementById('code-preview-title');
    const subtitle = document.getElementById('code-preview-subtitle');
    const content = document.getElementById('code-preview-content');
    const loading = document.getElementById('code-preview-loading');

    // Show modal
    overlay.style.display = 'flex';
    title.textContent = filePath.split('/').pop() || filePath;
    subtitle.textContent = line
      ? (symbolName ? `${symbolName} — ${this.t('line_n', { n: line })}` : this.t('line_n', { n: line }))
      : (symbolName === 'preview' ? this.t('full_file_code') : symbolName || '');
    content.innerHTML = '';
    loading.style.display = 'flex';

    try {
      const res = await fetch(`${API}/reports/file-preview/${projectId}?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();

      if (!data.success) {
        content.innerHTML = `<span style="color:var(--danger);padding:16px;display:block">${this.esc(data.error)}</span>`;
        loading.style.display = 'none';
        return;
      }

      let raw = data.data.content || '';
      if (typeof raw !== 'string') raw = String(raw);
      loading.style.display = 'none';

      const langMap = { php: 'php', js: 'javascript', jsx: 'jsx', mjs: 'javascript', ts: 'typescript', tsx: 'tsx', vue: 'javascript', html: 'markup', htm: 'markup', css: 'css', scss: 'css', sass: 'css', less: 'css', json: 'json' };
      const ext = (filePath.match(/\.(\w+)$/i) || [])[1] || '';
      const lang = langMap[ext.toLowerCase()] || 'javascript';

      content.className = `code-preview-pre line-numbers language-${lang}`;
      content.dataset.start = '1';
      if (line) {
        const totalLines = raw.split('\n').length;
        content.dataset.line = `${line}-${Math.min(line + 4, totalLines)}`;
      }

      const code = document.createElement('code');
      code.className = `language-${lang}`;

      content.innerHTML = '';
      content.appendChild(code);

      if (typeof Prism !== 'undefined' && Prism.languages[lang]) {
        try {
          // Подсветка по чанкам (200 строк) — Prism иначе может ошибочно
          // распознать / или /* и «закомментировать» остаток файла
          const CHUNK_LINES = 200;
          const lines = raw.split('\n');
          let html = '';
          for (let i = 0; i < lines.length; i += CHUNK_LINES) {
            const chunk = lines.slice(i, i + CHUNK_LINES).join('\n');
            if (chunk) html += Prism.highlight(chunk, Prism.languages[lang], lang);
          }
          code.innerHTML = html || raw;
          Prism.hooks.run('complete', { element: code, language: lang, code: raw, grammar: Prism.languages[lang], result: html || raw });
        } catch (e) {
          code.textContent = raw;
        }
      } else {
        code.textContent = raw;
      }

      if (line) {
        requestAnimationFrame(() => {
          const row = content.querySelector('.line-numbers-rows span:nth-child(' + line + ')');
          if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
      }
    } catch (err) {
      content.innerHTML = `<span style="color:var(--danger);padding:16px;display:block">Failed to load file</span>`;
      loading.style.display = 'none';
    }
  },

  closeCodePreview() {
    document.getElementById('code-preview-overlay').style.display = 'none';
  },

  // ═══════════════════════════════════════════════════════
  // Utilities
  // ═══════════════════════════════════════════════════════
  translateIssueDescription(desc) {
    if (!desc || this.lang === 'en') return desc;
    const s = String(desc);
    let m = s.match(/^"([^"]+)" is declared but never referenced in the project$/);
    if (m) return this.t('desc_declared_never_ref_project', { name: m[1] });
    m = s.match(/^"([^"]+)" is declared but never referenced$/);
    if (m) return this.t('desc_declared_never_ref', { name: m[1] });
    m = s.match(/^"([^"]+)" has no direct reference — likely loaded dynamically$/);
    if (m) return this.t('desc_no_direct_ref', { name: m[1] });
    m = s.match(/^Import "([^"]+)" from "([^"]+)" is never used$/);
    if (m) return this.t('desc_import_never_used', { specifier: m[1], source: m[2] });
    m = s.match(/^Dependency "([^"]+)" is listed but not imported$/);
    if (m) return this.t('desc_dependency_not_imported', { name: m[1] });
    m = s.match(/^(\d+) consecutive commented lines$/);
    if (m) return this.t('desc_commented_lines', { n: m[1] });
    return desc;
  },

  esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },

  escAttr(str) {
    if (!str) return '';
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '&quot;');
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
