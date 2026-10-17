'use strict';

// Vercel serverless entry point. vercel.json rewrites every /api/* request here.
const { handle } = require('../lib/app');

module.exports = (req, res) => handle(req, res);
