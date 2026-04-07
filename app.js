// ═══════════════════════════════════════════════════════════════════════════
//  DiskOS v2 — Frontend Logic
// ═══════════════════════════════════════════════════════════════════════════

// ── STATE ────────────────────────────────────────────────────────────────────
let state          = { bitmap: [], inodes: [], stats: {}, log: [] };
let filterMode     = 'all';
let selectedId     = null;          // currently selected inode id
let currentEditId  = null;          // inode being edited (null = write mode)
let writing        = false;         // debounce flag
let prevLogLen     = 0;

// ── BOOT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  fetchState();
  setInterval(fetchState, 2000);

  document.getElementById('f-content').addEventListener('input', updateSizePreview);
  document.getElementById('f-name').addEventListener('input', updateSizePreview);

  const fileInput = document.getElementById("f-file");
  if (fileInput) {
    fileInput.addEventListener("change", function () {
      const name = this.files[0]?.name || "No file selected";

      const label = document.getElementById("file-name");
      if (label) label.textContent = name;

      const nameInput = document.getElementById("f-name");
      if (this.files[0] && nameInput) {
        nameInput.value = this.files[0].name;
      }
    });
  }

  document.getElementById('f-content').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey) submitForm();
  });
});

// ── API ───────────────────────────────────────────────────────────────────────
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  return res.json();
}

async function fetchState() {
  try {
    const data = await api('/api/state');
    state = data;
    render();
  } catch (err) { console.error('fetchState:', err); }
}

// ── RENDER ────────────────────────────────────────────────────────────────────
function render() {
  renderStats();
  renderDiskMap();
  renderInodes();
  renderLog();
  updateSelBar();
}

// ── STATS ─────────────────────────────────────────────────────────────────────
function renderStats() {
  const s = state.stats || {};
  set('sr-used',    s.used    ?? '—');
  set('sr-free',    s.free    ?? '—');
  set('sr-reclaim', s.deleted_blocks ?? '—');
  set('sr-files',   s.files   ?? '—');
  set('sr-deleted', s.deleted_files ?? '—');

  const capPct  = s.capacity_pct ?? 0;
  const fragPct = s.fragmentation ?? 0;

  set('sr-capacity', capPct + '%');
  const capFill = document.getElementById('cap-fill');
  if (capFill) capFill.style.width = capPct + '%';

  set('frag-pct',   fragPct + '%');
  const ff = document.getElementById('frag-fill');
  if (ff) {
    ff.style.width = fragPct + '%';
    ff.className   = 'frag-fill' + (fragPct >= 60 ? ' high' : fragPct >= 30 ? ' med' : '');
  }
  set('frag-label',
    fragPct === 0 ? 'OPTIMAL' :
    fragPct < 30  ? 'LOW' :
    fragPct < 60  ? 'MODERATE — DEFRAG RECOMMENDED' :
                    'HIGH — DEFRAG REQUIRED'
  );
}

// ── DISK MAP ──────────────────────────────────────────────────────────────────
function renderDiskMap() {
  const grid = document.getElementById('disk-grid');
  const bm   = state.bitmap || [];

  // Build owner map: block → inode
  const owner = {};
  (state.inodes || []).forEach(nd => nd.blocks.forEach(b => owner[b] = nd));

  if (grid.children.length !== bm.length) {
    grid.innerHTML = '';
    bm.forEach((v, i) => {
      const d = document.createElement('div');
      d.className = 'blk ' + blkClass(v);
      d.dataset.i = i;
      d.addEventListener('mouseenter', () => inspectBlock(i, v, owner[i]));
      d.addEventListener('mouseleave', clearInspector);
      grid.appendChild(d);
    });
  } else {
    Array.from(grid.children).forEach((d, i) => {
      const cls = 'blk ' + blkClass(bm[i]);
      if (d.className !== cls) d.className = cls;
      d.onmouseenter = () => inspectBlock(i, bm[i], owner[i]);
    });
  }

  // Highlight selected file's blocks
  highlightSelection();
}

function blkClass(v) {
  return v === 0 ? 'free'
       : v === 1 ? 'used'
       : v === 2 ? 'ghost'
       : v === 3 ? 'corrupt'
       : 'free';
}

function highlightSelection() {
  const grid = document.getElementById('disk-grid');
  if (!grid) return;
  Array.from(grid.children).forEach(d => d.classList.remove('sel-hl'));
  if (!selectedId) return;
  const nd = (state.inodes || []).find(n => n.id === selectedId);
  if (!nd) return;
  nd.blocks.forEach(b => {
    const el = grid.children[b];
    if (el) el.classList.add('sel-hl');
  });
}

// ── BLOCK INSPECTOR ───────────────────────────────────────────────────────────
function inspectBlock(index, val, nd) {
  const box  = document.getElementById('inspector');
  const state_str = val === 0
  ? '<span class="insp-v g">FREE</span>'
  : val === 1
  ? '<span class="insp-v c">USED</span>'
  : val === 2
  ? '<span class="insp-v r">DELETED</span>'
  : val === 3
  ? '<span class="insp-v r">CORRUPTED</span>'
  : '<span class="insp-v">UNKNOWN</span>';

  let html = `
    <div class="insp-row"><span class="insp-k">Block</span><span class="insp-v a">#${index}</span></div>
    <div class="insp-row"><span class="insp-k">Byte range</span><span class="insp-v">${index*64}–${index*64+63}</span></div>
    <div class="insp-row"><span class="insp-k">State</span>${state_str}</div>`;

  if (nd) {
    html += `<hr class="insp-divider"/>
    <div class="insp-row"><span class="insp-k">File</span><span class="insp-v c">${nd.name}</span></div>
    <div class="insp-row"><span class="insp-k">Inode</span><span class="insp-v">#${nd.id}</span></div>
    <div class="insp-row"><span class="insp-k">All blocks</span><span class="insp-v">[${nd.blocks.join(',')}]</span></div>
    <div class="insp-row"><span class="insp-k">Status</span><span class="insp-v ${nd.status==='active'?'g':'r'}">${nd.status.toUpperCase()}</span></div>`;
  }
  box.innerHTML = html;
}

function clearInspector() {
  document.getElementById('inspector').innerHTML =
    '<div class="insp-empty">Hover a block to inspect</div>';
}

function searchFiles(q) {
  q = q.toLowerCase();
  document.querySelectorAll('#inode-body tr').forEach(tr => {
    tr.style.display = tr.innerText.toLowerCase().includes(q) ? '' : 'none';
  });
}

// ── INODE TABLE ───────────────────────────────────────────────────────────────
function renderInodes() {
  const tbody = document.getElementById('inode-body');
  const list  = (state.inodes || []).filter(
    nd => filterMode === 'all' || nd.status === filterMode
  );

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--t2);padding:20px 10px;font-size:10px">No files</td></tr>`;
    return;
  }

  // Keep scroll position
  const scroll = tbody.closest('.inode-scroll')?.scrollTop || 0;
  tbody.innerHTML = '';

  list.forEach(nd => {
    const tr  = document.createElement('tr');
    const ext = (nd.ext || '').toLowerCase();
    const sel = nd.id === selectedId;
    tr.className = (nd.status === 'deleted' ? 'row-deleted ' : '') + (sel ? 'row-selected' : '');

    const blkShort = nd.blocks.length > 4
      ? nd.blocks.slice(0, 3).join(',') + '…'
      : nd.blocks.join(',');

    tr.innerHTML = `
      <td><input type="radio" class="sel-radio" name="file-sel"
           ${sel ? 'checked' : ''} onchange="selectFile(${nd.id})" /></td>
      <td style="color:var(--t2)">#${nd.id}</td>
      <td class="${ext ? 'ext-'+ext : ''}" style="font-weight:600">${nd.name}</td>
      <td>${nd.size}B</td>
      <td style="color:var(--t2);font-size:10px">[${blkShort}]</td>
      <td style="color:var(--t2)">${nd.modified || nd.created}</td>
      <td><span class="badge ${
    nd.status === 'active' ? 'badge-active' :
    nd.status === 'deleted' ? 'badge-deleted' :
    nd.status === 'corrupted' ? 'badge-corrupt' :
    ''
  }">
    ${nd.status.toUpperCase()}</span></td>`;

    tr.addEventListener('click', e => {
      if (e.target.tagName !== 'INPUT') selectFile(nd.id);
    });
    tbody.appendChild(tr);
  });

  tbody.closest('.inode-scroll').scrollTop = scroll;
}

// ── SELECTION ─────────────────────────────────────────────────────────────────
function selectFile(id) {
  selectedId = (selectedId === id) ? null : id;
  renderInodes();
  highlightSelection();
  updateSelBar();
}

function updateSelBar() {
  const nd = selectedId ? (state.inodes || []).find(n => n.id === selectedId) : null;
  set('sel-fname', nd ? nd.name : '—');

  // Enable/disable action buttons based on status
  const isActive  = nd && nd.status === 'active';
  const isDeleted = nd && nd.status === 'deleted';

  q('.sact-read').disabled    = !isActive;
  q('.sact-edit').disabled    = !isActive;
  q('.sact-del').disabled     = !isActive;
  q('.sact-recover').disabled = !isDeleted;
}

// ── SELECTION ACTIONS ─────────────────────────────────────────────────────────
async function actionRead() {
  if (!selectedId) return toast('Select a file first', 'warn');
  await readFile(selectedId);
}

async function actionEdit() {
  if (!selectedId) return toast('Select a file first', 'warn');
  const nd = (state.inodes || []).find(n => n.id === selectedId);
  if (!nd || nd.status === 'deleted') return toast('File is deleted', 'err');
  loadIntoEditor(nd);
}

async function actionDelete() {
  if (!selectedId) return toast('Select a file first', 'warn');
  await deleteFile(selectedId);
}

async function actionRecover() {
  if (!selectedId) return toast('Select a file first', 'warn');
  const nd = (state.inodes || []).find(n => n.id === selectedId);
  if (!nd || nd.status !== 'deleted') return toast('File is not deleted', 'warn');
  await recoverFile(selectedId);
}

// ── FILE OPERATIONS ───────────────────────────────────────────────────────────
async function submitForm() {
  if (writing) return;
  writing = true;

  const name = q('#f-name').value.trim();
  const fileInput = document.getElementById('f-file');

  if (!name) {
    toast('Filename is required', 'err');
    resetWriting();
    return;
  }

  const formData = new FormData();
  formData.append("name", name);

  if (fileInput.files.length > 0) {
    formData.append("file", fileInput.files[0]);
  } else {
    // fallback: text content as file
    const content = q('#f-content').value;
    const blob = new Blob([content], { type: "text/plain" });
    formData.append("file", blob, name);
  }

  let res;

  if (currentEditId) {
    // keep update as JSON
    const content = q('#f-content').value;
    res = await api(`/api/update/${currentEditId}`, 'PUT', { name, content });
  } else {
  let formData = new FormData();   // ✅ CREATE IT

  formData.append("name", name);

  let fileInput = document.getElementById("f-file");
  if (fileInput.files.length > 0) {
    formData.append("file", fileInput.files[0]);
  } else {
    // fallback for text file
    const content = q('#f-content').value;
    const blob = new Blob([content], { type: "text/plain" });
    formData.append("file", blob, name);
  }

  const response = await fetch('/api/write', {
    method: 'POST',
    body: formData
  });

  res = await response.json();
}

  if (res.error) {
    toast(res.error, 'err');
    resetWriting();
    return;
  }

  toast(`"${name}" written to disk`, 'ok');
  cancelEdit();
  resetWriting();
  await fetchState();
}

function resetWriting() {
  writing = false;
  const btn = q('#btn-submit');
  if (btn) btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>${currentEditId ? 'SAVE CHANGES' : 'WRITE TO DISK'}`;
}

const link = document.createElement("a");
link.href = `data:application/octet-stream;base64,${res.content}`;
link.download = res.name;
link.textContent = "⬇ Download";
q('#viewer-meta').appendChild(link);

async function readFile(id) {
  const res = await api(`/api/read/${id}`);
  if (res.error) { toast(res.error, 'err'); return; }

  const nd = res.inode;
  set('viewer-name', nd.name);

  // ✅ REPLACE CONTENT DISPLAY HERE
  if (res.ext === 'txt' || res.ext === 'md' || res.ext === 'log') {
    const decoded = atob(res.content);
    q('#viewer-body').textContent = decoded;
  } if (res.ext === 'txt' || res.ext === 'md' || res.ext === 'log') {
  const decoded = atob(res.content);
  q('#viewer-body').textContent = decoded;
}
else if (res.ext === 'png' || res.ext === 'jpg' || res.ext === 'jpeg') {
  q('#viewer-body').innerHTML = `
    <img src="data:image/${res.ext};base64,${res.content}" width="100%">
  `;
}
else if (res.ext === 'pdf') {
  q('#viewer-body').innerHTML = `
    <iframe src="data:application/pdf;base64,${res.content}" width="100%" height="400px"></iframe>
  `;
}
else if (res.ext === 'mp3' || res.ext === 'wav') {
  q('#viewer-body').innerHTML = `
    <audio controls style="width:100%">
      <source src="data:audio/${res.ext};base64,${res.content}">
    </audio>
  `;
}
else if (res.ext === 'mp4') {
  q('#viewer-body').innerHTML = `
    <video controls width="100%">
      <source src="data:video/mp4;base64,${res.content}">
    </video>
  `;
}
else {
  q('#viewer-body').innerHTML = `
    <div style="color:cyan">
      File: ${res.name}<br>
      Type: ${res.ext.toUpperCase()}<br>
      Size: ${res.inode.size} bytes<br><br>
      ⚠ Preview not supported
    </div>`;
}

  q('#viewer-meta').innerHTML = `
    <span class="vm-item">size: <span>${nd.size}B</span></span>
    <span class="vm-item">blocks: <span>[${nd.blocks.join(',')}]</span></span>
    <span class="vm-item">inode: <span>#${nd.id}</span></span>
    <span class="vm-item">created: <span>${nd.created}</span></span>
    <span class="vm-item">modified: <span>${nd.modified}</span></span>`;

  await fetchState();
}

async function deleteFile(id) {
  const res = await api(`/api/delete/${id}`, 'DELETE');
  if (res.error) { toast(res.error, 'err'); return; }
  if (selectedId === id) selectedId = null;
  // Reset viewer if viewing this file
  const vname = document.getElementById('viewer-name')?.textContent;
  const nd = (state.inodes || []).find(n => n.id === id);
  if (nd && vname === nd.name) resetViewer();
  toast('File deleted — blocks reclaimable', 'warn');
  await fetchState();
}

async function recoverFile(id) {
  const res = await api('/api/recover', 'POST', { inode_id: id });
  if (res.recovered?.length) toast(`"${res.recovered[0]}" recovered`, 'ok');
  else if (res.skipped?.length) toast(`Cannot recover — blocks overwritten`, 'err');
  else toast('Nothing to recover', 'info');
  await fetchState();
}

async function bulkRecover() {
  const res = await api('/api/recover', 'POST', {});
  const n = res.recovered?.length || 0;
  if (n) toast(`${n} file(s) recovered`, 'ok');
  else toast('Nothing to recover', 'info');
  await fetchState();
}

async function defragDisk() {
  setMount('DEFRAGGING…');

  const blocks = document.querySelectorAll('.blk');

  blocks.forEach((b, i) => {
    setTimeout(() => {
      b.style.transform = "scale(1.3)";
      setTimeout(() => b.style.transform = "", 150);
    }, i * 15);
  });

  await api('/api/defrag', 'POST');

  setMount('MOUNTED');
  toast('Disk defragmented — blocks packed', 'ok');
  await fetchState();
}

function openModal()  { q('#modal-bg').classList.add('open'); }
function closeModal() { q('#modal-bg').classList.remove('open'); }
async function doFormat() {
  closeModal();
  await api('/api/format', 'POST');
  selectedId    = null;
  currentEditId = null;
  cancelEdit();
  resetViewer();
  toast('Disk formatted — all data erased', 'err');
  await fetchState();
}

// ── EDIT MODE ─────────────────────────────────────────────────────────────────
function loadIntoEditor(nd) {
  currentEditId = nd.id;
  q('#f-name').value    = nd.name;
  q('#f-content').value = nd.content;
  updateSizePreview();

  set('form-title', 'EDIT FILE');
  q('#edit-badge').classList.remove('hidden');
  q('#btn-cancel-edit').classList.remove('hidden');
  q('#btn-submit').innerHTML = `<svg viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>SAVE CHANGES`;

  q('#f-name').focus();
  toast(`Editing "${nd.name}"`, 'info');
}

function cancelEdit() {
  currentEditId = null;
  q('#f-name').value    = '';
  q('#f-content').value = '';
  updateSizePreview();

  set('form-title', 'WRITE FILE');
  q('#edit-badge').classList.add('hidden');
  q('#btn-cancel-edit').classList.add('hidden');
  q('#btn-submit').innerHTML = `<svg viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>WRITE TO DISK`;
}

// ── SIZE PREVIEW ──────────────────────────────────────────────────────────────
function updateSizePreview() {
  const content = q('#f-content').value;
  const bytes   = new TextEncoder().encode(content).length;
  const blks    = Math.max(1, Math.ceil(bytes / 64));

  set('byte-count', bytes);
  set('blk-count',  blks);

  // If editing: show reallocation delta
  const delta = document.getElementById('blk-delta');
  if (currentEditId && delta) {
    const nd = (state.inodes || []).find(n => n.id === currentEditId);
    if (nd) {
      const diff = blks - nd.blocks.length;
      delta.textContent = diff === 0 ? 'no realloc'
        : diff > 0 ? `+${diff} block(s)` : `${diff} block(s)`;
      delta.style.color = diff > 0 ? 'var(--red)' : diff < 0 ? 'var(--green)' : 'var(--t2)';
    }
  } else if (delta) {
    delta.textContent = '';
  }
}

// ── LOG ───────────────────────────────────────────────────────────────────────
function renderLog() {
  const entries = state.log || [];
  if (entries.length === prevLogLen) return;
  prevLogLen = entries.length;
  const body = q('#log-body');
  body.innerHTML = entries.map(e => `
    <div class="log-row ${e.level}">
      <span class="log-t">[${e.time}]</span>
      <span class="log-m">${e.msg}</span>
    </div>`).join('');
}

// ── FILTERS ───────────────────────────────────────────────────────────────────
function setFilter(mode, btn) {
  filterMode = mode;
  document.querySelectorAll('.ftab').forEach(t => t.classList.remove('on'));
  btn.classList.add('on');
  renderInodes();
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function q(sel) { return document.querySelector(sel); }
function set(id, val) {
  const el = document.getElementById(id);
  if (el && String(el.textContent) !== String(val)) el.textContent = val;
}
function setMount(txt) {
  const el = document.getElementById('mount-label');
  if (el) el.textContent = txt;
}
function resetViewer() {
  set('viewer-name', '—');
  const vb = q('#viewer-body');
  if (vb) vb.innerHTML = '<div class="viewer-empty">Select a file and press READ to view its contents</div>';
  const vm = q('#viewer-meta');
  if (vm) vm.innerHTML = '';
}

let toastTimer;
function toast(msg, type = 'info') {
  const el = q('#toast');
  el.textContent = msg;
  el.className   = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

async function simulateCrash() {
    // Start shake
    document.body.classList.add("crash-mode");

    // Add red flash overlay
    const overlay = document.createElement("div");
    overlay.className = "crash-overlay";
    document.body.appendChild(overlay);

    // Call backend
    const data = await api("/api/crash", "POST");

    // Stop shake after short time
    setTimeout(() => {
        document.body.classList.remove("crash-mode");
        overlay.remove();
    }, 700);

    alert(data.msg);
    await fetchState();
}
toast("System crash detected — run repair!", "err");

async function getSuggestions() {
    const data = await api("/api/suggest");

    let box = document.getElementById("suggestions");
    box.innerHTML = "";

    data.suggestions.forEach(s => {
        let div = document.createElement("div");
        div.className = "suggestion-card";
        div.innerText = "💡 " + s;
        box.appendChild(div);
    });
}

async function repairDisk() {
    const res = await api("/api/repair", "POST");

    if (res.repaired.length) {
        toast("Repaired: " + res.repaired.join(", "), "ok");
    } else {
        toast("No corrupted files to repair", "info");
    }

    await fetchState();
}