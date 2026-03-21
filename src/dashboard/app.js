// ═══════ Mind Keeper Dashboard — SPA ═══════
let API = localStorage.getItem('mk_api_url') || window.location.origin;
let PROJECT_ROOT = localStorage.getItem('mk_project_root') || '';

// ── API Client ───────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (PROJECT_ROOT) {
    opts.headers['X-Project-Root'] = PROJECT_ROOT;
  }
  if (body && method !== 'GET') {
    opts.body = JSON.stringify({ project_root: PROJECT_ROOT, ...body });
  }

  let url = `${API}${path}`;
  if (method === 'GET' && PROJECT_ROOT) {
    url += `${path.includes('?') ? '&' : '?'}project_root=${encodeURIComponent(PROJECT_ROOT)}`;
  }

  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || 'API Error');
  return data;
}

// ── Toast ────────────────────────────────────────────────────
function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ── Modal ────────────────────────────────────────────────────
function showModal(html) {
  const overlay = document.getElementById('modalOverlay');
  overlay.innerHTML = `<div class="modal">${html}</div>`;
  overlay.classList.add('active');
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  }, { once: true });
}

function closeModal() {
  const overlay = document.getElementById('modalOverlay');
  overlay.classList.remove('active');
  overlay.innerHTML = '';
}

// ── Navigation ───────────────────────────────────────────────
const PAGE_TITLES = {
  overview: '知识总览',
  domains: '领域管理',
  memories: '记忆管理',
  hygiene: '治理工具',
  logs: '项目日志'
};

let currentPage = 'overview';

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    currentPage = btn.dataset.page;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('pageTitle').textContent = PAGE_TITLES[currentPage];
    renderPage();
  });
});

// ── Project Root ─────────────────────────────────────────────
const projectInput = document.getElementById('projectRoot');
const apiInput = document.getElementById('apiUrl');
projectInput.value = PROJECT_ROOT;
apiInput.value = API;

document.getElementById('btnSetProject').addEventListener('click', () => {
  API = apiInput.value.trim() || window.location.origin;
  PROJECT_ROOT = projectInput.value.trim();
  localStorage.setItem('mk_api_url', API);
  localStorage.setItem('mk_project_root', PROJECT_ROOT);
  toast(`设置已保存`, 'success');
  checkHealth();
  renderPage();
});

// ── Health Check ─────────────────────────────────────────────
async function checkHealth() {
  const dot = document.querySelector('.status-dot');
  const text = document.querySelector('.status-text');
  try {
    await api('GET', '/api/health');
    dot.className = 'status-dot connected';
    text.textContent = '已连接';
    return true;
  } catch {
    dot.className = 'status-dot error';
    text.textContent = '连接失败';
    return false;
  }
}

// ── Page Router ──────────────────────────────────────────────
async function renderPage() {
  const content = document.getElementById('content');
  if (!PROJECT_ROOT) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="emoji">📂</div>
        <div class="title">请先设置项目根目录</div>
        <div class="desc">在右上角输入项目路径，例如 D:\\projects\\my-project</div>
      </div>`;
    return;
  }

  content.innerHTML = '<div class="loader"></div>';
  try {
    switch (currentPage) {
      case 'overview': await renderOverview(content); break;
      case 'domains': await renderDomains(content); break;
      case 'memories': await renderMemories(content); break;
      case 'hygiene': await renderHygiene(content); break;
      case 'logs': await renderLogs(content); break;
    }
  } catch (err) {

    content.innerHTML = `
      <div class="empty-state">
        <div class="emoji">⚠️</div>
        <div class="title">加载失败</div>
        <div class="desc">${escapeHtml(err.message)}</div>
        <button class="btn btn-primary" style="margin-top:12px" onclick="renderPage()">重试</button>
      </div>`;
  }
}

async function renderLogs(container) {
  const sources = await api('POST', '/api/recall', {
    query: '',
    source_kinds: ['log'],
    top_k: 50
  });
  const list = Array.isArray(sources) ? sources : sources.results || [];

  container.innerHTML = `
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">项目运行日志 (${list.length})</h2>
      </div>
      ${list.length === 0 ? `
        <div class="empty-state">
          <div class="emoji">📜</div>
          <div class="title">暂无运行日志</div>
          <div class="desc">使用 remember_log 工具记录项目进展</div>
        </div>
      ` : `
        <div class="log-list">
          ${list.map(log => {
            const lines = (log.content || '').split('\n');
            const details = lines.slice(lines.findIndex(l => l.includes('## Details')) + 1).join('\n').trim();
            const meta = {};
            lines.forEach(l => {
              if (l.startsWith('**Time**:')) meta.time = l.replace('**Time**:', '').trim();
              if (l.startsWith('**Model**:')) meta.model = l.replace('**Model**:', '').trim();
              if (l.startsWith('**Action**:')) meta.action = l.replace('**Action**:', '').trim();
              if (l.startsWith('**Test Result**:')) meta.testResult = l.replace('**Test Result**:', '').trim();
            });

            return `
              <div class="log-entry">
                <div class="log-header">
                  <div>
                    <div class="log-title">${escapeHtml(log.title || '无标题')}</div>
                    <div class="log-meta">
                      ${meta.time ? `<span>🕒 ${meta.time}</span>` : ''}
                      ${meta.model ? `<span>🤖 ${meta.model}</span>` : ''}
                    </div>
                  </div>
                  <span class="badge badge-teal">LOG</span>
                </div>
                ${details ? `<div class="log-details">${escapeHtml(details)}</div>` : ''}
                <div class="log-grid">
                  ${meta.action ? `<div class="log-stat"><b>操作:</b> ${escapeHtml(meta.action)}</div>` : ''}
                  ${meta.testResult ? `<div class="log-stat"><b>结果:</b> ${escapeHtml(meta.testResult)}</div>` : ''}
                </div>
                ${log.tags?.length ? `
                  <div class="tag-list" style="margin-top:12px">
                    ${log.tags.map(t => `<span class="badge badge-sky">${escapeHtml(t)}</span>`).join('')}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;
}

// ═══════ Overview Page ═══════════════════════════════════════

async function renderOverview(container) {
  const [surface, canonical, domains] = await Promise.all([
    api('GET', '/api/memory/access-surface'),
    api('GET', '/api/memory/canonical').catch(() => null),
    api('GET', '/api/domains').catch(() => [])
  ]);

  const stats = surface.surfaceStats || surface;
  const totalMemories = stats.totalChunks ?? stats.totalSources ?? 0;
  const totalSources = stats.totalSources ?? 0;
  const sourceBreakdown = stats.sourceBreakdown || stats.byKind || {};

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card indigo">
        <div class="stat-value">${totalMemories}</div>
        <div class="stat-label">记忆总数</div>
      </div>
      <div class="stat-card emerald">
        <div class="stat-value">${totalSources}</div>
        <div class="stat-label">数据源</div>
      </div>
      <div class="stat-card amber">
        <div class="stat-value">${domains.length}</div>
        <div class="stat-label">知识领域</div>
      </div>
      <div class="stat-card sky">
        <div class="stat-value">${sourceBreakdown.decision ?? 0}</div>
        <div class="stat-label">决策记录</div>
      </div>
      <div class="stat-card rose">
        <div class="stat-value">${sourceBreakdown.manual ?? 0}</div>
        <div class="stat-label">手动记忆</div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <h2 class="section-title">数据源分布</h2>
      </div>
      <div class="stats-grid">
        ${Object.entries(sourceBreakdown).map(([kind, count]) => `
          <div class="card">
            <div style="display:flex;align-items:center;gap:10px;">
              <span class="badge badge-${kindColor(kind)}">${kind}</span>
              <span style="font-size:20px;font-weight:700">${count}</span>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    ${canonical ? `
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">最近记忆</h2>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>标题</th><th>类型</th><th>模块</th><th>更新时间</th></tr>
          </thead>
          <tbody>
            ${(canonical.recentSources || []).slice(0, 10).map(s => `
              <tr>
                <td>${escapeHtml(s.title || s.path || '-')}</td>
                <td><span class="badge badge-${kindColor(s.sourceKind)}">${s.sourceKind}</span></td>
                <td>${escapeHtml(s.moduleName || '-')}</td>
                <td>${formatTime(s.updatedAt)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}
  `;
}

// ═══════ Domains Page ════════════════════════════════════════
async function renderDomains(container) {
  const domains = await api('GET', '/api/domains');

  container.innerHTML = `
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">知识领域 (${domains.length})</h2>
        <button class="btn btn-primary" id="btnCreateDomain">+ 新建领域</button>
      </div>
      ${domains.length === 0 ? `
        <div class="empty-state">
          <div class="emoji">📚</div>
          <div class="title">暂无知识领域</div>
          <div class="desc">点击"新建领域"创建第一个知识库</div>
        </div>
      ` : `
        <div class="domain-grid">
          ${domains.map(d => `
            <div class="domain-card">
              <div class="domain-name">${escapeHtml(d.displayName)}</div>
              <div class="domain-display">${escapeHtml(d.name)}</div>
              ${d.description ? `<div class="domain-desc">${escapeHtml(d.description)}</div>` : ''}
              <div class="tag-list" style="margin-bottom:12px">
                ${(d.aliases || []).map(a => `<span class="badge badge-indigo">${escapeHtml(a)}</span>`).join('')}
                ${(d.tags || []).map(t => `<span class="badge badge-sky">${escapeHtml(t)}</span>`).join('')}
              </div>
              <div class="domain-meta">
                <span style="font-size:11px;color:var(--text-muted)">${(d.sections || []).length} 板块</span>
                <div class="domain-actions">
                  <button class="btn btn-sm" onclick="editDomain('${escapeAttr(d.name)}')">编辑</button>
                  <button class="btn btn-sm btn-danger" onclick="deleteDomain('${escapeAttr(d.name)}')">删除</button>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;

  document.getElementById('btnCreateDomain')?.addEventListener('click', () => showCreateDomainModal());
}

function showCreateDomainModal() {
  showModal(`
    <h2>新建知识领域</h2>
    <div class="form-group">
      <label>名称 (slug, 如 coffee-knowledge)</label>
      <input type="text" id="domainName" placeholder="my-domain">
    </div>
    <div class="form-group">
      <label>显示名称</label>
      <input type="text" id="domainDisplayName" placeholder="咖啡专业知识">
    </div>
    <div class="form-group">
      <label>别名 (逗号分隔)</label>
      <input type="text" id="domainAliases" placeholder="装饰施工, 室内装修">
    </div>
    <div class="form-group">
      <label>描述</label>
      <textarea id="domainDesc" placeholder="记录关于该领域的专业知识..."></textarea>
    </div>
    <div class="form-group">
      <label>标签 (逗号分隔)</label>
      <input type="text" id="domainTags" placeholder="专业, 工程">
    </div>
    <div class="form-actions">
      <button class="btn" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="submitCreateDomain()">创建</button>
    </div>
  `);
}

window.submitCreateDomain = async function() {
  try {
    const name = document.getElementById('domainName').value.trim();
    const displayName = document.getElementById('domainDisplayName').value.trim();
    const aliasStr = document.getElementById('domainAliases').value.trim();
    const desc = document.getElementById('domainDesc').value.trim();
    const tagStr = document.getElementById('domainTags').value.trim();

    if (!name || !displayName) { toast('名称和显示名称必填', 'error'); return; }

    await api('POST', '/api/domains', {
      name,
      display_name: displayName,
      aliases: aliasStr ? aliasStr.split(',').map(s => s.trim()).filter(Boolean) : [],
      description: desc || undefined,
      tags: tagStr ? tagStr.split(',').map(s => s.trim()).filter(Boolean) : []
    });

    closeModal();
    toast(`领域 "${displayName}" 创建成功`, 'success');
    renderPage();
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.editDomain = async function(name) {
  try {
    const domain = await api('POST', '/api/domains/resolve', { query: name });
    if (!domain) { toast('领域不存在', 'error'); return; }

    showModal(`
      <h2>编辑领域: ${escapeHtml(domain.displayName)}</h2>
      <div class="form-group">
        <label>显示名称</label>
        <input type="text" id="editDisplayName" value="${escapeAttr(domain.displayName)}">
      </div>
      <div class="form-group">
        <label>别名 (逗号分隔)</label>
        <input type="text" id="editAliases" value="${escapeAttr((domain.aliases || []).join(', '))}">
      </div>
      <div class="form-group">
        <label>描述</label>
        <textarea id="editDesc">${escapeHtml(domain.description || '')}</textarea>
      </div>
      <div class="form-group">
        <label>标签 (逗号分隔)</label>
        <input type="text" id="editTags" value="${escapeAttr((domain.tags || []).join(', '))}">
      </div>
      <div class="form-actions">
        <button class="btn" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" onclick="submitEditDomain('${escapeAttr(name)}')">保存</button>
      </div>
    `);
  } catch (err) {
    toast(err.message, 'error');
  }
};

window.submitEditDomain = async function(name) {
  try {
    await api('PUT', `/api/domains/${encodeURIComponent(name)}`, {
      display_name: document.getElementById('editDisplayName').value.trim() || undefined,
      aliases: document.getElementById('editAliases').value.split(',').map(s => s.trim()).filter(Boolean),
      description: document.getElementById('editDesc').value.trim() || undefined,
      tags: document.getElementById('editTags').value.split(',').map(s => s.trim()).filter(Boolean)
    });
    closeModal();
    toast('领域已更新', 'success');
    renderPage();
  } catch (err) { toast(err.message, 'error'); }
};

window.deleteDomain = async function(name) {
  if (!confirm(`确认删除领域 "${name}"？此操作不可恢复。`)) return;
  try {
    await api('DELETE', `/api/domains/${encodeURIComponent(name)}`);
    toast(`领域 "${name}" 已删除`, 'success');
    renderPage();
  } catch (err) { toast(err.message, 'error'); }
};

// ═══════ Memories Page ═══════════════════════════════════════
async function renderMemories(container) {
  const sources = await api('GET', '/api/sources');
  const list = Array.isArray(sources) ? sources : sources.sources || [];

  container.innerHTML = `
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">所有记忆源 (${list.length})</h2>
        <button class="btn btn-primary" id="btnRemember">+ 写入记忆</button>
      </div>
      ${list.length === 0 ? `
        <div class="empty-state">
          <div class="emoji">💾</div>
          <div class="title">暂无记忆</div>
          <div class="desc">通过 MCP 工具或上方按钮写入第一条记忆</div>
        </div>
      ` : `
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>标题</th><th>类型</th><th>模块</th><th>标签</th><th>更新</th><th>操作</th></tr>
            </thead>
            <tbody>
              ${list.slice(0, 50).map(s => `
                <tr>
                  <td title="${escapeAttr(s.path || '')}">${escapeHtml(s.title || s.path?.split(/[\\/]/).pop() || '-')}</td>
                  <td><span class="badge badge-${kindColor(s.sourceKind)}">${s.sourceKind}</span></td>
                  <td>${escapeHtml(s.moduleName || '-')}</td>
                  <td><div class="tag-list">${(s.tags || []).slice(0, 3).map(t =>
                    `<span class="badge badge-sky">${escapeHtml(t)}</span>`).join('')}</div></td>
                  <td>${formatTime(s.updatedAt)}</td>
                  <td>
                    <button class="btn btn-sm btn-danger" onclick="forgetSource('${escapeAttr(s.docId)}')">删除</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;

  document.getElementById('btnRemember')?.addEventListener('click', () => showRememberModal());
}

function showRememberModal() {
  showModal(`
    <h2>写入记忆</h2>
    <div class="form-group">
      <label>类型</label>
      <select id="remSourceKind">
        <option value="manual">manual (手动知识)</option>
        <option value="decision">decision (决策记录)</option>
        <option value="diary">diary (日记/日志)</option>
        <option value="imported">imported (导入)</option>
      </select>
    </div>
    <div class="form-group">
      <label>标题</label>
      <input type="text" id="remTitle" placeholder="记忆标题">
    </div>
    <div class="form-group">
      <label>内容</label>
      <textarea id="remContent" rows="6" placeholder="记忆内容..."></textarea>
    </div>
    <div class="form-group">
      <label>模块名 (可选)</label>
      <input type="text" id="remModule" placeholder="src/core">
    </div>
    <div class="form-group">
      <label>标签 (逗号分隔)</label>
      <input type="text" id="remTags" placeholder="架构, 数据库">
    </div>
    <div class="form-actions">
      <button class="btn" onclick="closeModal()">取消</button>
      <button class="btn btn-primary" onclick="submitRemember()">保存</button>
    </div>
  `);
}

window.submitRemember = async function() {
  try {
    const content = document.getElementById('remContent').value.trim();
    if (!content) { toast('内容不能为空', 'error'); return; }

    await api('POST', '/api/remember', {
      source_kind: document.getElementById('remSourceKind').value,
      title: document.getElementById('remTitle').value.trim() || undefined,
      content,
      module_name: document.getElementById('remModule').value.trim() || undefined,
      tags: document.getElementById('remTags').value.split(',').map(s => s.trim()).filter(Boolean)
    });

    closeModal();
    toast('记忆写入成功', 'success');
    renderPage();
  } catch (err) { toast(err.message, 'error'); }
};

window.forgetSource = async function(docId) {
  if (!confirm('确认删除该记忆？')) return;
  try {
    await api('POST', '/api/sources/forget', { doc_id: docId });
    toast('记忆已删除', 'success');
    renderPage();
  } catch (err) { toast(err.message, 'error'); }
};

// ═══════ Hygiene Page ════════════════════════════════════════
async function renderHygiene(container) {
  container.innerHTML = `
    <div class="section">
      <div class="section-header">
        <h2 class="section-title">记忆治理工具</h2>
      </div>

      <div class="stats-grid" style="grid-template-columns: repeat(3, 1fr)">
        <div class="card" style="cursor:pointer" id="btnHealthCheck">
          <div style="font-size:24px;margin-bottom:8px">🏥</div>
          <div class="card-title">健康检查</div>
          <div class="card-subtitle">分析记忆库整体健康状况</div>
        </div>
        <div class="card" style="cursor:pointer" id="btnCleanup">
          <div style="font-size:24px;margin-bottom:8px">🧹</div>
          <div class="card-title">清理建议</div>
          <div class="card-subtitle">识别过期、冗余的记忆</div>
        </div>
        <div class="card" style="cursor:pointer" id="btnConsolidate">
          <div style="font-size:24px;margin-bottom:8px">🔗</div>
          <div class="card-title">合并建议</div>
          <div class="card-subtitle">找出可合并的相似记忆</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-header">
        <h2 class="section-title">冲突记忆</h2>
        <button class="btn btn-sm" id="btnRefreshConflicts">刷新</button>
      </div>
      <div id="conflictList"><div class="loader"></div></div>
    </div>

    <div id="hygieneResults"></div>
  `;

  // Load conflicts
  loadConflicts();

  document.getElementById('btnHealthCheck').addEventListener('click', async () => {
    const results = document.getElementById('hygieneResults');
    results.innerHTML = '<div class="loader"></div>';
    try {
      const data = await api('GET', '/api/hygiene/health');
      results.innerHTML = `
        <div class="section">
          <h2 class="section-title" style="margin-bottom:14px">健康报告</h2>
          <div class="card"><pre style="font-size:12px;color:var(--text-secondary);white-space:pre-wrap;word-break:break-all">${escapeHtml(JSON.stringify(data, null, 2))}</pre></div>
        </div>`;
    } catch (err) { results.innerHTML = ''; toast(err.message, 'error'); }
  });

  document.getElementById('btnCleanup').addEventListener('click', async () => {
    const results = document.getElementById('hygieneResults');
    results.innerHTML = '<div class="loader"></div>';
    try {
      const data = await api('POST', '/api/hygiene/cleanup/suggest');
      const suggestions = data.suggestions || data.candidates || [];
      results.innerHTML = `
        <div class="section">
          <h2 class="section-title" style="margin-bottom:14px">清理建议 (${suggestions.length})</h2>
          ${suggestions.length === 0 ? '<div class="card"><p style="color:var(--text-muted)">没有需要清理的记忆 ✨</p></div>' : `
            <div class="hygiene-action-list">
              ${suggestions.map(s => `
                <div class="hygiene-action">
                  <div class="icon">🗑️</div>
                  <div class="details">
                    <div class="title">${escapeHtml(s.title || s.docId || '-')}</div>
                    <div class="desc">${escapeHtml(s.reason || s.suggestion || '')}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>`;
    } catch (err) { results.innerHTML = ''; toast(err.message, 'error'); }
  });

  document.getElementById('btnConsolidate').addEventListener('click', async () => {
    const results = document.getElementById('hygieneResults');
    results.innerHTML = '<div class="loader"></div>';
    try {
      const data = await api('POST', '/api/hygiene/consolidate/suggest');
      const groups = data.groups || data.candidates || [];
      results.innerHTML = `
        <div class="section">
          <h2 class="section-title" style="margin-bottom:14px">合并建议 (${groups.length})</h2>
          ${groups.length === 0 ? '<div class="card"><p style="color:var(--text-muted)">没有可合并的记忆 ✨</p></div>' : `
            <div class="hygiene-action-list">
              ${groups.map(g => `
                <div class="hygiene-action">
                  <div class="icon">🔗</div>
                  <div class="details">
                    <div class="title">${escapeHtml(g.suggestedTitle || g.title || '-')}</div>
                    <div class="desc">${(g.docIds || []).length} 条记忆可合并: ${escapeHtml((g.docIds || []).join(', '))}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>`;
    } catch (err) { results.innerHTML = ''; toast(err.message, 'error'); }
  });

  document.getElementById('btnRefreshConflicts').addEventListener('click', loadConflicts);
}

async function loadConflicts() {
  const el = document.getElementById('conflictList');
  if (!el) return;
  try {
    const data = await api('GET', '/api/hygiene/conflicts');
    const conflicts = data.conflicts || data || [];
    if (!Array.isArray(conflicts) || conflicts.length === 0) {
      el.innerHTML = '<div class="card"><p style="color:var(--text-muted);font-size:13px">没有冲突记忆 ✅</p></div>';
      return;
    }
    el.innerHTML = `
      <div class="hygiene-action-list">
        ${conflicts.map(c => `
          <div class="hygiene-action">
            <div class="icon">⚡</div>
            <div class="details">
              <div class="title">${escapeHtml(c.subject || c.title || '-')}</div>
              <div class="desc">${escapeHtml(c.reason || c.description || '')}</div>
            </div>
          </div>
        `).join('')}
      </div>`;
  } catch {
    el.innerHTML = '<div class="card"><p style="color:var(--text-muted);font-size:13px">无法加载冲突数据</p></div>';
  }
}

// ═══════ Utilities ═══════════════════════════════════════════
function kindColor(kind) {
  const map = { manual: 'indigo', decision: 'amber', diary: 'sky', project: 'emerald', imported: 'rose' };
  return map[kind] || 'indigo';
}

function formatTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
  return d.toLocaleDateString('zh-CN');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, '&#39;');
}

// ═══════ Init ════════════════════════════════════════════════
checkHealth().then(() => renderPage());
