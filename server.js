// server.js
require('dotenv').config();
const mongoose = require('mongoose');
const fetch = (...args) => import('node-fetch').then(m=>m.default(...args));
const express = require('express');
const bodyParser = require('body-parser');
const { TF_MINUTES, SCAN_INTERVAL_MS, CONFIRMATIONS_REQUIRED, SYMBOL_FETCH_LIMIT, SYMBOL_CACHE_TTL_MS, PER_SYMBOL_DELAY_MS } = require('./config');
const { sma, emaFromArray, rsiFromCloses, atrFromOHLC