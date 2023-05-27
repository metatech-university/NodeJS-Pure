'use strict';

const vm = require('node:vm');
const fsp = require('node:fs').promises;
const path = require('node:path');

const console = require('./lib/logger.js');
const common = require('./lib/common.js');

const { loadDir, createRouting } = require('./src/loader.js');
const { Server } = require('./src/server.js');

const sandbox = vm.createContext({ console, common });

(async () => {
  const applications = await fsp.readFile('.applications', 'utf8');
  const appPath = path.join(process.cwd(), applications.trim());

  const configPath = path.join(appPath, './config');
  const config = await loadDir(configPath, sandbox);

  const libPath = path.join(appPath, './lib');
  const lib = await loadDir(libPath, sandbox);

  const domainPath = path.join(appPath, './domain');
  const domain = await loadDir(domainPath, sandbox);

  sandbox.db = require('./lib/db.js');

  const apiPath = path.join(appPath, './api');
  const api = await loadDir(apiPath, sandbox, true);
  const routing = createRouting(api);

  const application = { path: appPath, sandbox, console, routing, config };
  Object.assign(sandbox, { api, lib, domain, config, application });
  application.server = new Server(application);
})();
