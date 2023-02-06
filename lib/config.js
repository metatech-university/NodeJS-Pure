'use strict';

const fsp = require('node:fs').promises;
const path = require('node:path');
const load = require('./load.js');

module.exports = async (configPath, sandbox) => {
  const files = await fsp.readdir(configPath);
  const config = {};
  for (const fileName of files) {
    if (!fileName.endsWith('.js')) continue;
    const filePath = path.join(configPath, fileName);
    const name = path.basename(fileName, '.js');
    config[name] = await load(filePath, sandbox);
  }
  return config;
};
