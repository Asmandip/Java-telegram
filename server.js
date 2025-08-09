import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import bodyParser from 'body-parser';
import config from './config/index.js';
import bot from './bot.js';
import Settings from './models/Settings.js';
import Signal from './models/Signal.js';

const app = express();
app.use(cors());
app.use(bodyParser.json());

mongoose.connect(config.mongoUri)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error(err));

app.get('/', (req, res) => res.send("Bot server running"));

app.get('/api/settings', async (req, res) => {
  const settings = await Settings.findOne();
  res.json(settings);
});

app.post('/api/settings', async (req, res) => {
  const updated = await Settings.findOneAndUpdate({}, req.body, { new: true, upsert: true });
  res.json(updated);
});

app.get('/api/signals', async (req, res) => {
  const signals = await Signal.find().sort({ createdAt: -1 }).limit(50);
  res.json(signals);
});

app.listen(10000, () => console.log("✅ Server running on port 10000"));
const { monitorLoop } = require('./monitor');
// after DB connected and bot ready
monitorLoop().catch(e => console.error('monitor start err', e));