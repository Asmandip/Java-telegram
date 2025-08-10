// dashboard.js (Vanilla JS + Socket.IO)
// assumes you served socket.io client at /socket.io/socket.io.js
const socket = io();

let ADMIN_TOKEN = null; // set after login

// elements
const statusDb = document.getElementById('status-db');
const statusBot = document.getElementById('status-bot');
const statusScanner = document.getElementById('status-scanner');
const signalsTbody = document.querySelector('#signals-table tbody');
const positionsTbody = document.querySelector('#positions-table tbody');
const activityBox = document.getElementById('activity');

const btnLogin = document.getElementById('btn-login');
const btnScanToggle = document.getElementById('btn-scan-toggle');
const btnRefresh = document.getElementById('btn-refresh');
const btnEditSettings = document.getElementById('btn-edit-settings');

const modal = document.getElementById('modal');
const mAuto = document.getElementById('m-auto');
const mStrategy = document.getElementById('m-strategy');
const mLev = document.getElementById('m-lev');
const mSave = document.getElementById('m-save');
const mCancel = document.getElementById('m-cancel');

function addLog(text) {
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString()} — ${text}`;
  activityBox.prepend(line);
}

// Auth flow
btnLogin.onclick = async () => {
  const pwd = prompt('Enter dashboard password:');
  if (!pwd) return;
  const res = await fetch('/api/auth', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: pwd }) });
  const j = await res.json();
  if (j.ok && j.token) {
    ADMIN_TOKEN = j.token;
    addLog('Login success');
    alert('Logged in');
    loadInitialData();
  } else {
    addLog('Login failed');
    alert('Invalid password');
  }
};

// init
socket.on('connect', () => {
  addLog('Socket connected');
  socket.emit('init');
});
socket.on('disconnect', () => addLog('Socket disconnected'));

socket.on('init:data', (payload) => {
  renderSettings(payload.settings);
  renderSignals(payload.signals);
  renderPositions(payload.positions);
  document.getElementById('status-scanner').textContent = payload.scannerRunning ? 'Running' : 'Stopped';
});

socket.on('signal:new', (sig) => {
  addLog(`Signal: ${sig.symbol} ${sig.side} ${sig.price}`);
  prependSignal(sig);
});
socket.on('settings:updated', (s) => {
  addLog('Settings updated');
  renderSettings(s);
});
socket.on('scanner:status', (st) => {
  document.getElementById('status-scanner').textContent = st.running ? 'Running' : 'Stopped';
  addLog('Scanner ' + (st.running ? 'started' : 'stopped'));
});
socket.on('position:updated', (p) => {
  addLog('Position updated: ' + p.symbol);
  loadPositions();
});

// API helper
async function api(path, opts = {}) {
  opts.headers = opts.headers || {};
  if (ADMIN_TOKEN) opts.headers['x-admin-token'] = ADMIN_TOKEN;
  const res = await fetch(path, opts);
  if (res.status === 401) { alert('Unauthorized — login again'); ADMIN_TOKEN = null; }
  return res.json();
}

// render helpers
function renderSettings(s) {
  document.getElementById('auto-trade').textContent = s?.autoTrade ? 'ON' : 'OFF';
  document.getElementById('active-strategy').textContent = s?.activeStrategy || '—';
  document.getElementById('leverage').textContent = s?.leverage || '—';
  mAuto.checked = !!s?.autoTrade;
  mStrategy.value = s?.activeStrategy || '';
  mLev.value = s?.leverage || 5;
}
function renderSignals(list) {
  signalsTbody.innerHTML = '';
  list.forEach(prependSignal);
}
function prependSignal(sig) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${new Date(sig.createdAt).toLocaleString()}</td>
    <td>${sig.pair || sig.symbol}</td>
    <td>${sig.type}</td>
    <td>${sig.price}</td>
    <td>${(sig.confirmations||[]).join(', ')}</td>
    <td>
      <button data-id="${sig._id}" class="exec">Exec</button>
      <button data-id="${sig._id}" class="reject">Reject</button>
    </td>`;
  signalsTbody.prepend(tr);
  tr.querySelector('.exec').onclick = () => execSignal(sig._id);
  tr.querySelector('.reject').onclick = () => rejectSignal(sig._id);
}

async function renderPositions(list) {
  positionsTbody.innerHTML = '';
  list.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.symbol}</td><td>${p.side}</td><td>${p.entry}</td><td>${p.sl}</td><td>${p.tp}</td><td>${p.status}</td>`;
    positionsTbody.append(tr);
  });
}

async function loadInitialData() {
  try {
    const s = await api('/api/settings', { method:'GET' });
    renderSettings(s);
    const sig = await api('/api/signals', { method:'GET' });
    renderSignals(sig);
    const pos = await api('/api/positions', { method:'GET' });
    renderPositions(pos);
    addLog('Initial data loaded');
  } catch (e) { console.error(e); addLog('Failed load data'); }
}

btnRefresh.onclick = () => loadInitialData();

btnScanToggle.onclick = async () => {
  const res = await api('/api/scan-toggle', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action: 'toggle' }) });
  addLog('Toggled scanner');
};

async function execSignal(id) {
  // execute via server side (must implement endpoint if want full automation)
  const ok = confirm('Confirm execute (this will call bot openPosition via server). Continue?');
  if (!ok) return;
  // call server internal endpoint (not implemented in simple API) — fallback: tell via log
  addLog('Please confirm via Telegram or implement /api/execute endpoint for direct execution.');
}

async function rejectSignal(id) {
  if (!ADMIN_TOKEN) return alert('Login required');
  await fetch(`/api/signals/reject/${id}`, { method:'POST', headers:{'x-admin-token': ADMIN_TOKEN} });
  addLog('Signal rejected: ' + id);
  loadInitialData();
}

// settings modal
btnEditSettings.onclick = () => { modal.classList.remove('hidden'); };
mCancel.onclick = () => { modal.classList.add('hidden'); };
mSave.onclick = async () => {
  const payload = { autoTrade: mAuto.checked, activeStrategy: mStrategy.value, leverage: Number(mLev.value) };
  await api('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  modal.classList.add('hidden');
  addLog('Settings saved');
};

// initial attempt to auto-login if token stored in localStorage
if (localStorage.getItem('adminToken')) {
  ADMIN_TOKEN = localStorage.getItem('adminToken');
  loadInitialData();
}
