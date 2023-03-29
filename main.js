'use strict';

const path = require('node:path');

const logger = require('./lib/logger.js');
const common = require('./lib/common.js');

const { loadDir } = require('./src/loader.js');
const { createServer } = require('./src/server.js');

const appPath = path.join(process.cwd(), '../NodeJS-Application');
const apiPath = path.join(appPath, './api');
const configPath = path.join(appPath, './config');

(async () => {
  const sandbox = {
    console: Object.freeze(logger),
    common: Object.freeze(common),
  };

  const config = await loadDir(configPath, sandbox);
  const db = require('./lib/db.js')(config.db);

  sandbox.api = Object.freeze({});
  sandbox.db = Object.freeze(db);

  const routing = await loadDir(apiPath, sandbox, true);
  const server = createServer(appPath, routing, logger);
  const [port] = config.server.ports;
  server.listen(port);
  console.log(`API on port ${server.address().port}`);
})();
