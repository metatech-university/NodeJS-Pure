'use strict';

const fsp = require('node:fs').promises;
const vm = require('node:vm');
const path = require('node:path');

const OPTIONS = {
  timeout: 5000,
  displayErrors: false,
};

const load = async (filePath, sandbox) => {
  const src = await fsp.readFile(filePath, 'utf8');
  const code = `'use strict';\n{\n${src}\n}`;
  const lineOffset = -2;
  const script = new vm.Script(code, { ...OPTIONS, lineOffset });
  const context = vm.createContext(Object.freeze({ ...sandbox }));
  const exported = script.runInContext(context, OPTIONS);
  return typeof exp === 'object' ? exp : { method: exp };
};

const loadDir = async (dir, sandbox) => {
  const files = await fsp.readdir(dir, { withFileTypes: true });
  const container = {};
  for (const file of files) {
    const { name } = file;
    if (file.isFile() && !name.endsWith('.js')) continue;
    const location = path.join(dir, name);
    const key = path.basename(name, '.js');
    const loader = file.isFile() ? load : loadDir;
    container[key] = await loader(location, sandbox);
  }
  return container;
};

module.exports = { load, loadDir };
