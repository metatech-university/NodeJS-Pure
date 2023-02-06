'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = (configPath) => {
  const files = fs.readdirSync(configPath);
  const config = {};
  for (const fileName of files) {
    if (!fileName.endsWith('.js')) continue;
    const filePath = path.join(configPath, fileName);
    const name = path.basename(fileName, '.js');
    config[name] = require(filePath);
  }
  return config;
};
