// workers/backtestWorker.js
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const BacktestResult = require('../models/BacktestResult');
const { runBacktest } = require('../utils/backtestEngine');
const { loadCandles } = require('../utils/candleCache');

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) { process.send && process.send({ type:'error', message:'MONGO_URI missing' }); process.exit(1); }
  await mongoose.connect(uri);
}

process.on('message', async (msg) => {
  if (!msg || !msg.cmd) return;
  if (msg.cmd === 'run') {
    const job = msg.job;
    if (!job) return;
    try {
      await connectDB();
      const br = await BacktestResult.create({
        jobName: job.jobName || `bt_${Date.now()}`,
        symbol: job.symbol,
        timeframe: job.timeframe,
        from: job.from ? new Date(job.from) : null,
        to: job.to ? new Date(job.to) : null,
        strategy: job.strategy,
        params: job.params,
        initialCapital: job.initialCapital || 1000,
        status: 'running',
        logs: []
      });

      process.send && process.send({ type:'started', id: br._id });

      // load candles
      process.send && process.send({ type:'progress', pct:5, message:'Loading candles' });
      const candles = await loadCandles(job.symbol, parseInt(job.timeframe || 3), { force: !!job.force });

      process.send && process.send({ type:'progress', pct:20, message: 'Preparing strategy' });

      // load strategy module
      const stratPath = path.join(process.cwd(), 'strategies', job.strategy + '.js');
      const strat = require(stratPath);

      process.send && process.send({ type:'progress', pct:30, message: 'Running backtest' });

      const res = await runBacktest({ symbol: job.symbol, timeframe: job.timeframe, candles, strategyModule: strat, params: job.params || {}, initialCapital: job.initialCapital || 1000 });

      // persist result
      br.summary = res.summary;
      br.trades = res.trades;
      br.equity = res.equity;
      br.status = 'done';
      br.logs = (br.logs || []).concat(res.logs || []);
      br.finishedAt = new Date();
      await br.save();

      process.send && process.send({ type:'done', id: br._id, summary: res.summary });
      process.exit(0);
    } catch (err) {
      console.error('worker err', err);
      process.send && process.send({ type:'error', message: err.message || String(err) });
      process.exit(1);
    }
  }
});
