'use strict';

const path = require('node:path');

const console = require('./lib/logger.js');
const common = require('./lib/common.js');

const { loadDir } = require('./src/loader.js');
const { Server } = require('./src/server.js');

const sandbox = { console, common, api: Object.freeze({}) };

const application = {
  path: path.join(process.cwd(), '../NodeJS-Application'),
  sandbox,
  console,
  config: null,
  routing: null,
  server: null,
};

(async () => {
  const configPath = path.join(application.path, './config');
  application.config = await loadDir(configPath, application.sandbox);

  const db = require('./lib/db.js')(application.config.db);
  application.sandbox.db = Object.freeze(db);

  const apiPath = path.join(application.path, './api');
  application.routing = await loadDir(apiPath, sandbox, true);

  application.server = new Server(application);
})();
