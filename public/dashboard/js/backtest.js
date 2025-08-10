// public/dashboard/js/backtest.js
const socket = io();
const strategySelect = document.getElementById('bt-strategy');
const runBtn = document.getElementById('bt-run');
const statusBox = document.getElementById('bt-status');
const tradesTbody = document.querySelector('#bt-trades tbody');

async function loadStrategies() {
  const token = localStorage.getItem('adminToken');
  if (!token) return;
  const res = await fetch('/api/strategies', { headers: { 'x-admin-token': token } }).then(r=>r.json());
  strategySelect.innerHTML = '';
  res.strategies.forEach(s => { const o=document.createElement('option'); o.value=s.name; o.textContent=s.name; strategySelect.append(o); });
}

runBtn.onclick = async () => {
  const token = localStorage.getItem('adminToken');
  if (!token) return alert('Login required');
  const job = {
    symbol: document.getElementById('bt-symbol').value,
    timeframe: document.getElementById('bt-timeframe').value,
    strategy: strategySelect.value,
    initialCapital: Number(document.getElementById('bt-capital').value)
  };
  const res = await fetch('/api/backtest/run', { method:'POST', headers: { 'Content-Type':'application/json', 'x-admin-token': token }, body: JSON.stringify(job) }).then(r=>r.json());
  if (!res.ok) return alert('failed to start');
  const id = res.id;
  statusBox.textContent = `Job started: ${id}`;
};

socket.on('backtest:progress', msg => {
  statusBox.textContent = `Progress: ${msg.pct || ''}% ${msg.message || ''}`;
});
socket.on('backtest:done', async (msg) => {
  statusBox.textContent = `Done: ${JSON.stringify(msg.summary)}`;
  // fetch result
  const token = localStorage.getItem('adminToken');
  const list = await fetch('/api/backtests', { headers: { 'x-admin-token': token } }).then(r=>r.json());
  // pick latest
  const id = list[0]._id;
  const res = await fetch(`/api/backtest/${id}`, { headers: { 'x-admin-token': token } }).then(r=>r.json());
  renderResult(res);
});

function renderResult(res) {
  // equity chart
  const eqData = (res.equity || []).map(p => ({ time: Math.floor(new Date(p.t).getTime()/1000), value: p.equity }));
  const chartEq = LightweightCharts.createChart(document.getElementById('chart-equity'));
  const lineSeries = chartEq.addLineSeries();
  lineSeries.setData(eqData);

  // trades table
  tradesTbody.innerHTML = '';
  (res.trades || []).forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${new Date(t.entryTime).toLocaleString()}</td><td>${new Date(t.exitTime).toLocaleString()}</td><td>${t.side}</td><td>${t.pnlUsd}</td>`;
    tradesTbody.append(tr);
  });

  // candle chart is optional - left as enhancement
}

// init
loadStrategies();
