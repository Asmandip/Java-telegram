const socket = io();
let ADMIN_TOKEN = null;

const addLog = (t) => {
  const box = document.getElementById('activity');
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString()} — ${t}`;
  box.prepend(line);
};

const elements = {
  statusDb: document.getElementById('status-db'),
  statusBot: document.getElementById('status-bot'),
  statusScanner: document.getElementById('status-scanner'),
  signalsTbody: document.querySelector('#signals-table tbody'),
  positionsTbody: document.querySelector('#positions-table tbody'),
  btnLogin: document.getElementById('btn-login'),
  btnScanToggle: document.getElementById('btn-scan-toggle'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnEditSettings: document.getElementById('btn-edit-settings'),
  strategySelect: document.getElementById('strategy-select'),
  btnActivateStrategy: document.getElementById('btn-activate-strategy'),
  modal: document.getElementById('modal'),
  mAuto: document.getElementById('m-auto'),
  mStrategy: document.getElementById('m-strategy'),
  mLev: document.getElementById('m-lev'),
  mSave: document.getElementById('m-save'),
  mCancel: document.getElementById('m-cancel')
};

socket.on('connect', () => { addLog('Socket connected'); socket.emit('init'); });
socket.on('disconnect', () => addLog('Socket disconnected'));

socket.on('init:data', payload => {
  renderSettings(payload.settings);
  renderSignals(payload.signals);
  renderPositions(payload.positions);
  document.getElementById('status-scanner').textContent = payload.scannerRunning ? 'Running' : 'Stopped';
});

socket.on('signal:new', sig => { addLog('Signal: '+ sig.symbol + ' ' + sig.type); prependSignal(sig); });
socket.on('settings:updated', s => { addLog('Settings updated'); renderSettings(s); });
socket.on('scanner:status', st => { document.getElementById('status-scanner').textContent = st.running ? 'Running' : 'Stopped'; addLog('Scanner ' + (st.running ? 'started':'stopped')); });
socket.on('strategy:activated', p => { addLog('Strategy activated: '+p.name); loadStrategies(); });

async function api(path, opts={}) {
  opts.headers = opts.headers || {};
  if (ADMIN_TOKEN) opts.headers['x-admin-token'] = ADMIN_TOKEN;
  const res = await fetch(path, opts);
  if (res.status === 401) { alert('Unauthorized, login again'); ADMIN_TOKEN = null; throw new Error('unauthorized'); }
  return res.json();
}

function renderSettings(s) {
  document.getElementById('auto-trade').textContent = s?.autoTrade ? 'ON' : 'OFF';
  document.getElementById('active-strategy').textContent = s?.activeStrategy || '-';
  document.getElementById('leverage').textContent = s?.leverage || '-';
  elements.mAuto.checked = !!s?.autoTrade;
  elements.mStrategy.value = s?.activeStrategy || '';
  elements.mLev.value = s?.leverage || 5;
}

function renderSignals(list) {
  elements.signalsTbody.innerHTML = '';
  list.forEach(prependSignal);
}
function prependSignal(sig) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${new Date(sig.createdAt).toLocaleString()}</td><td>${sig.pair||sig.symbol}</td><td>${sig.type}</td><td>${sig.price}</td><td>${(sig.confirmations||[]).join(', ')}</td><td><button class="exec">Exec</button><button class="reject">Reject</button></td>`;
  elements.signalsTbody.prepend(tr);
  tr.querySelector('.exec').onclick = () => { addLog('Please confirm via Telegram inline button to execute.'); };
  tr.querySelector('.reject').onclick = async () => {
    if (!ADMIN_TOKEN) return alert('Login required');
    await fetch(`/api/signals/reject/${sig._id}`, { method:'POST', headers:{'x-admin-token':ADMIN_TOKEN} }).catch(()=>{});
    addLog('Rejected: ' + sig._id);
  };
}

function renderPositions(list) {
  elements.positionsTbody.innerHTML = '';
  list.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${p.symbol}</td><td>${p.side}</td><td>${p.entry}</td><td>${p.sl}</td><td>${p.tp}</td><td>${p.status}</td>`;
    elements.positionsTbody.append(tr);
  });
}

elements.btnLogin.onclick = async () => {
  const pwd = prompt('Enter password:');
  if (!pwd) return;
  try {
    const j = await fetch('/api/auth', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: pwd }) }).then(r=>r.json());
    if (j.ok && j.token) { ADMIN_TOKEN = j.token; localStorage.setItem('adminToken', ADMIN_TOKEN); addLog('Login success'); loadInitialData(); } else { alert('Invalid'); }
  } catch (e) { console.error(e); alert('Login failed'); }
};
elements.btnRefresh.onclick = () => loadInitialData();
elements.btnScanToggle.onclick = async () => {
  if (!ADMIN_TOKEN) return alert('Login required');
  await api('/api/scan-toggle', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action: 'toggle' }) });
  addLog('Toggled scanner');
};

async function loadInitialData() {
  try {
    if (!ADMIN_TOKEN) return;
    const s = await api('/api/settings', { method:'GET' });
    renderSettings(s);
    const sig = await api('/api/signals', { method:'GET' });
    renderSignals(sig);
    const pos = await api('/api/positions', { method:'GET' });
    renderPositions(pos);
    await loadStrategies();
    addLog('Initial data loaded');
  } catch (e) { console.error(e); addLog('Load failed'); }
}

async function loadStrategies() {
  if (!ADMIN_TOKEN) return;
  try {
    const j = await fetch('/api/strategies', { headers: { 'x-admin-token': ADMIN_TOKEN } }).then(r=>r.json());
    elements.strategySelect.innerHTML = '';
    j.strategies.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.name; opt.textContent = s.info?.desc ? `${s.name} — ${s.info.desc}` : s.name;
      elements.strategySelect.append(opt);
    });
    if (j.active) elements.strategySelect.value = j.active;
  } catch (e) { console.error('loadStrategies err', e); }
}
elements.btnActivateStrategy.onclick = async () => {
  if (!ADMIN_TOKEN) return alert('Login required');
  const name = elements.strategySelect.value;
  const res = await fetch('/api/strategy/activate', { method:'POST', headers:{'Content-Type':'application/json','x-admin-token':ADMIN_TOKEN}, body: JSON.stringify({ name }) }).then(r=>r.json());
  if (res.ok) addLog('Activated '+name); else addLog('Activate failed');
};

// settings modal handlers
elements.btnEditSettings.onclick = () => elements.modal.classList.remove('hidden');
elements.mCancel.onclick = () => elements.modal.classList.add('hidden');
elements.mSave.onclick = async () => {
  if (!ADMIN_TOKEN) return alert('Login required');
  const payload = { autoTrade: elements.mAuto.checked, activeStrategy: elements.mStrategy.value, leverage: Number(elements.mLev.value) };
  await api('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  elements.modal.classList.add('hidden');
  addLog('Settings saved');
};

if (localStorage.getItem('adminToken')) { ADMIN_TOKEN = localStorage.getItem('adminToken'); loadInitialData(); }