'use strict';

const fsp = require('node:fs').promises;
const path = require('node:path');

const staticServer = require('./lib/static.js');
const logger = require('./lib/logger.js');
const common = require('./lib/common.js');
const { load, loadDir } = require('./lib/load.js');
const ws = require('./lib/ws.js');

const appPath = path.join(process.cwd(), '../NodeJS-Application');
const apiPath = path.join(appPath, './api');
const configPath = path.join(appPath, './config');
const staticPath = path.join(appPath, './static');

(async () => {
  const sandbox = {
    console: Object.freeze(logger),
    common: Object.freeze(common),
  };

  const config = await loadDir(configPath, sandbox);
  const db = require('./lib/db.js')(config.db);

  sandbox.api = Object.freeze({});
  sandbox.db = Object.freeze(db);

  const routing = await loadDir(apiPath, sandbox);

  const [port] = config.server.ports;
  const server = staticServer(staticPath, port, logger);
  ws(routing, server, logger);
})();
