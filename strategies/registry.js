// strategies/registry.js
// Simple strategy registry. Register modules and manage active strategy.

const fs = require('fs');
const path = require('path');
const Settings = require('../models/Settings');

const registry = {
  strategies: {},    // name -> module
  active: null
};

function register(name, mod) {
  registry.strategies[name] = mod;
}

function list() {
  return Object.keys(registry.strategies).map(name => ({
    name,
    info: registry.strategies[name].info || {}
  }));
}

async function activate(name) {
  if (!registry.strategies[name]) throw new Error('strategy not found: ' + name);
  registry.active = name;
  // persist to Settings
  try {
    await Settings.findOneAndUpdate({}, { activeStrategy: name, lastUpdated: new Date() }, { upsert: true });
  } catch (e) {
    console.warn('Failed to persist active strategy:', e.message || e);
  }
  return name;
}

function getActive() {
  return registry.active;
}

function getModule(name) {
  return registry.strategies[name];
}

// auto-load all files in this folder (except registry.js)
function autoload(dir = __dirname) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (f === 'registry.js') continue;
    if (!f.endsWith('.js')) continue;
    const full = path.join(dir, f);
    try {
      const mod = require(full);
      const name = mod.name || f.replace('.js','');
      register(name, mod);
      console.log('Strategy loaded:', name);
    } catch (e) {
      console.error('Failed to load strategy', f, e.message || e);
    }
  }
}

module.exports = { register, list, activate, getActive, getModule, autoload };
