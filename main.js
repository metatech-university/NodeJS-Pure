'use strict';

const fsp = require('node:fs').promises;
const path = require('node:path');

const console = require('./lib/logger.js');
const common = require('./lib/common.js');

const { loadDir, createRouting } = require('./src/loader.js');
const { Server } = require('./src/server.js');

const api = Object.freeze({});
const sandbox = { console, common, api, db: null };

(async () => {
  const applications = await fsp.readFile('.applications', 'utf8');
  const appPath = path.join(process.cwd(), applications.trim());

  const configPath = path.join(appPath, './config');
  const config = await loadDir(configPath, sandbox);

  const db = require('./lib/db.js')(config.db);
  sandbox.db = Object.freeze(db);

  const apiPath = path.join(appPath, './api');
  const api = await loadDir(apiPath, sandbox, true);
  const routing = createRouting(api);

  const application = { path: appPath, sandbox, console, config, routing };
  application.server = new Server(application);
})();
