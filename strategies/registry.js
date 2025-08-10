// strategies/registry.js
const fs = require('fs');
const path = require('path');
const Settings = require('../models/Settings');

const registry = { strategies: {}, active: null };

function register(name, mod) { registry.strategies[name] = mod; }
function list() { return Object.keys(registry.strategies).map(n=>({ name:n, info: registry.strategies[n].info || {} })); }
function getModule(name) { return registry.strategies[name]; }
function getActive() { return registry.active; }

async function activate(name) {
  if (!registry.strategies[name]) throw new Error('not found');
  registry.active = name;
  try { await Settings.findOneAndUpdate({}, { activeStrategy: name, lastUpdated: new Date() }, { upsert:true }); } catch(e){}
  return name;
}

function autoload(dir = path.join(__dirname)) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (f === 'registry.js') continue;
    if (!f.endsWith('.js')) continue;
    try {
      const mod = require(path.join(dir, f));
      const name = mod.name || f.replace('.js','');
      register(name, mod);
      console.log('Strategy loaded:', name);
    } catch (e) {
      console.error('Failed load strategy', f, e);
    }
  }
}

module.exports = { register, list, activate, getModule, getActive, autoload };