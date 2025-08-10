// middleware/auth.js
require('dotenv').config();

// Simple API key based auth middleware
module.exports = function requireAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const expectedKey = process.env.API_KEY;

  if (!expectedKey) {
    console.warn('⚠ No API_KEY set in env — skipping auth check.');
    return next();
  }

  if (apiKey && apiKey === expectedKey) {
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
};
