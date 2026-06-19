/* ════════════════════════════════════════════════════
   StudyShelf — script.js
   Permanent storage via IndexedDB (built into browser)
   Files survive page reload, browser close & restart.
   No server, no database, no internet required.
════════════════════════════════════════════════════ */

/* ══════════════════════════════════════
   INDEXEDDB SETUP
══════════════════════════════════════ */
const DB_NAME    = 'StudyShelfDB';
const DB_VERSION = 1;
const STORE_NAME = 'pdfs';
let   db         = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = function(event) {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = function(event) {
      db = event.target.result;
      resolve();
    };

    request.onerror = function(event) {
      reject('IndexedDB error: ' + event.target.errorCode);
    };
  });
}

function dbGetAll() {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly')
                      .objectStore(STORE_NAME)
                      .getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

function dbPut(record) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite')
                      .objectStore(STORE_NAME)
                      .put(record);
    request.onsuccess = () => resolve();
    request.onerror   = () => reject(request.error);
  });
}

function dbDelete(id) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite')
                      .objectStore(STORE_NAME)
                      .delete(id);
    request.onsuccess = () => resolve();
    request.onerror   = () => reject(request.error);
  });
}

function dbClear() {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readwrite')
                      .objectStore(STORE_NAME)
                      .clear();
    request.onsuccess = () => resolve();
    request.onerror   = () => reject(request.error);
  });
}

/* Read file bytes so they can be stored permanently */
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsArrayBuffer(file);
  });
}

/* ══════════════════════════════════════
   GLOBAL STATE
══════════════════════════════════════ */
const repository = [];   /* in-memory array — mirrors IndexedDB */
let selectedFiles  = [];
let totalIngested  = 0;
let totalFailed    = 0;

/* ══════════════════════════════════════
   INIT — open DB then load all files
══════════════════════════════════════ */
(async function init() {
  try {
    await openDatabase();
    const stored = await dbGetAll();
    /* sort newest first */
    stored.sort((a, b) => new Date(b.date) - new Date(a.date));
    stored.forEach(r => repository.push(r));
    totalIngested = repository.length;
    updateStats();
    renderRepository();
  } catch (err) {
    console.error(err);
    showStatus('Could not open local database. Try Chrome or Edge.', 'error');
    renderRepository();
  }
})();

/* ══════════════════════════════════════
   DRAG & DROP
══════════════════════════════════════ */
function onDragOver(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.add('drag-over');
}
function onDragLeave() {
  document.getElementById('dropZone').classList.remove('drag-over');
}
function onDrop(e) {
  e.preventDefault();
  onDragLeave();
  if (e.dataTransfer.files.length) previewFiles(e.dataTransfer.files);
}

/* ══════════════════════════════════════
   PREVIEW SELECTED FILES
══════════════════════════════════════ */
function previewFiles(fileList) {
  selectedFiles = Array.from(fileList);
  const preview = document.getElementById('filePreview');
  const list    = document.getElementById('filePreviewList');

  if (!selectedFiles.length) {
    preview.classList.remove('show');
    return;
  }

  list.innerHTML = selectedFiles.map(f => {
    const ok = f.type === 'application/pdf';
    return `<div class="file-preview-item ${ok ? 'ok' : 'bad'}">
      ${ok ? '✓' : '✗'} ${escHtml(f.name)}
      ${ok ? '' : '<em style="font-size:0.65rem"> (not a PDF)</em>'}
    </div>`;
  }).join('');

  preview.classList.add('show');
  clearStatus();
}

/* ══════════════════════════════════════
   INGEST FILES
   — for loop + continue (required)
   — stores actual bytes in IndexedDB
══════════════════════════════════════ */
async function ingestFiles() {
  if (!selectedFiles.length) {
    showStatus('Select at least one PDF file first.', 'info');
    return;
  }

  const btn = document.getElementById('uploadBtn');
  const pw  = document.getElementById('progressWrap');
  const pb  = document.getElementById('progressBar');
  const pl  = document.getElementById('progressLabel');

  btn.disabled = true;
  pw.classList.add('show');

  let successCount = 0;
  let failCount    = 0;

  /* for loop inspects every selected file */
  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];

    pb.style.width = ((i / selectedFiles.length) * 82 + 5) + '%';
    pl.textContent = `Saving "${file.name}"… (${i + 1}/${selectedFiles.length})`;

    /* check type — use continue to skip non-PDFs */
    if (file.type !== 'application/pdf') {
      failCount++;
      continue;
    }

    try {
      /* read the actual PDF bytes — this is what makes storage permanent */
      const buffer = await readFileAsArrayBuffer(file);

      const record = {
        id:     uid(),
        name:   file.name,
        title:  file.name.replace(/\.pdf$/i, ''),
        size:   file.size,
        sizeKB: (file.size / 1024).toFixed(1),
        type:   file.type,
        date:   new Date().toISOString(),
        buffer  /* actual PDF bytes stored permanently in IndexedDB */
      };

      await dbPut(record);        /* save to IndexedDB */
      repository.unshift(record); /* also keep in memory */
      successCount++;

    } catch (err) {
      console.error('Save error:', err);
      failCount++;
    }
  }

  pb.style.width = '100%';
  pl.textContent = 'Done!';

  /* update running totals */
  totalIngested += successCount;
  totalFailed   += failCount;

  /* accurate status message */
  clearStatus();
  if (successCount > 0 && failCount === 0) {
    showStatus(`✓ Success: ${successCount} file${successCount > 1 ? 's' : ''} ingested successfully.`, 'success');
  } else if (successCount > 0 && failCount > 0) {
    showStatus(`✓ Success: ${successCount} ingested, ${failCount} failed (not a PDF).`, 'success');
  } else {
    showStatus(`✗ Failed: ${failCount} file${failCount > 1 ? 's' : ''} rejected — PDFs only.`, 'error');
  }

  updateStats();
  renderRepository();

  if (successCount > 0) {
    showToast(`${successCount} PDF${successCount > 1 ? 's' : ''} saved permanently`, 'success');
  } else {
    showToast('No valid PDFs — files must be .pdf format', 'error');
  }

  /* reset selection */
  selectedFiles = [];
  document.getElementById('filePreview').classList.remove('show');
  document.getElementById('fileInput').value = '';
  btn.disabled = false;

  setTimeout(() => {
    pw.classList.remove('show');
    pb.style.width = '0%';
  }, 1400);
}

/* ══════════════════════════════════════
   RENDER REPOSITORY LIST
   — loops repository array to build UI
══════════════════════════════════════ */
function renderRepository() {
  const ul = document.getElementById('repository');

  if (repository.length === 0) {
    ul.innerHTML = `
      <div class="repo-empty">
        <div class="repo-empty-icon">🗂</div>
        <h3>Repository empty</h3>
        <p>Ingest your first PDF using the left panel. Files stay permanently.</p>
      </div>`;
    document.getElementById('heroCount').textContent = 0;
    return;
  }

  ul.innerHTML = '';

  /* loop through repository array to build list */
  for (let i = 0; i < repository.length; i++) {
    const file = repository[i];
    const li   = document.createElement('li');
    li.className  = 'repo-item';
    li.dataset.id = file.id;

    li.innerHTML = `
      <div class="repo-index">${String(i + 1).padStart(2, '0')}</div>
      <div class="repo-icon">📄</div>
      <div class="repo-info">
        <div class="repo-name" title="${escHtml(file.name)}">${escHtml(file.name)}</div>
        <div class="repo-meta">
          <span>${file.sizeKB} KB</span>
          <span class="dot">·</span>
          <span>${fmtDate(file.date)}</span>
        </div>
      </div>
      <div class="repo-actions">
        <button class="btn-download" onclick="downloadFile('${file.id}')">⬇ Download</button>
        <button class="btn-remove"   onclick="removeFile('${file.id}')" title="Remove">🗑</button>
      </div>`;

    ul.appendChild(li);
  }

  document.getElementById('heroCount').textContent = repository.length;
}

/* ══════════════════════════════════════
   DOWNLOAD
   — recreates blob URL from stored bytes
══════════════════════════════════════ */
function downloadFile(id) {
  const file = repository.find(f => f.id === id);
  if (!file || !file.buffer) {
    showToast('File data not found', 'error');
    return;
  }

  const blob = new Blob([file.buffer], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  /* free memory after download */
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast(`Downloading "${file.name}"`, 'info');
}

/* ══════════════════════════════════════
   REMOVE SINGLE FILE
══════════════════════════════════════ */
async function removeFile(id) {
  const idx = repository.findIndex(f => f.id === id);
  if (idx === -1) return;
  if (!confirm(`Remove "${repository[idx].name}" from the repository?`)) return;

  try {
    await dbDelete(id);
    totalIngested = Math.max(0, totalIngested - 1);
    repository.splice(idx, 1);
    updateStats();
    renderRepository();
    showToast('File removed', 'info');
  } catch (err) {
    showToast('Could not remove file', 'error');
  }
}

/* ══════════════════════════════════════
   CLEAR ENTIRE REPOSITORY
══════════════════════════════════════ */
async function clearRepository() {
  if (!repository.length) {
    showToast('Repository is already empty', 'info');
    return;
  }
  if (!confirm('Delete ALL files permanently? This cannot be undone.')) return;

  try {
    await dbClear();
    repository.length = 0;
    totalIngested     = 0;
    totalFailed       = 0;
    updateStats();
    renderRepository();
    clearStatus();
    showToast('Repository cleared', 'info');
  } catch (err) {
    showToast('Could not clear repository', 'error');
  }
}

/* ══════════════════════════════════════
   STATS
══════════════════════════════════════ */
function updateStats() {
  const totalBytes = repository.reduce((acc, f) => acc + (f.size || 0), 0);
  document.getElementById('statIngested').textContent = totalIngested;
  document.getElementById('statFailed').textContent   = totalFailed;
  document.getElementById('statTotal').textContent    = repository.length;
  document.getElementById('statSize').textContent     = fmtSize(totalBytes);
  document.getElementById('heroCount').textContent    = repository.length;
}

/* ══════════════════════════════════════
   STATUS MESSAGES
══════════════════════════════════════ */
function showStatus(msg, type = 'info') {
  document.getElementById('statusMessages').innerHTML =
    `<div class="status-line status-${type}">${msg}</div>`;
}
function clearStatus() {
  document.getElementById('statusMessages').innerHTML = '';
}

/* ══════════════════════════════════════
   TOAST
══════════════════════════════════════ */
let toastTimer;
function showToast(msg, type = 'info') {
  const t   = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

/* ══════════════════════════════════════
   UTILITIES
══════════════════════════════════════ */
function uid() {
  return Date.now() + '_' + Math.random().toString(36).slice(2);
}
function fmtSize(bytes) {
  if (!bytes || bytes < 1024) return (bytes || 0) + ' B';
  if (bytes < 1048576)        return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric'
  });
}
function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}