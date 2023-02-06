'use strict';

const fsp = require('node:fs').promises;
const path = require('node:path');

const staticServer = require('./lib/static.js');
const logger = require('./lib/logger.js');
const common = require('./lib/common.js');
const loadConfig = require('./lib/config.js');
const load = require('./lib/load.js');
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

  const config = await loadConfig(configPath, sandbox);
  const db = require('./lib/db.js')(config.db);

  sandbox.api = Object.freeze({});
  sandbox.db = Object.freeze(db);

  const routing = {};

  const files = await fsp.readdir(apiPath);
  for (const fileName of files) {
    if (!fileName.endsWith('.js')) continue;
    const filePath = path.join(apiPath, fileName);
    const serviceName = path.basename(fileName, '.js');
    routing[serviceName] = await load(filePath, sandbox);
  }

  const [port] = config.server.ports;
  const server = staticServer(staticPath, port, logger);
  ws(routing, server, logger);
})();
