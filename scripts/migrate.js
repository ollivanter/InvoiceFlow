'use strict';

// Creates/updates the database schema. Usage: npm run db:migrate
require('./load-env');
const db = require('../lib/db');

db.ensureSchema()
  .then(() => { console.log('Database schema is up to date.'); return db.getPool().end(); })
  .catch(err => { console.error(err); process.exit(1); });
