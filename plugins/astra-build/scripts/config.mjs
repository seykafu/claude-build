#!/usr/bin/env node
import { ConfigError, loadConfig } from './lib/config.mjs';

const usage = 'Usage: node config.mjs --root <dir> (--get <field> | --json)';
try {
  const args = process.argv.slice(2);
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help') values.help = true;
    else if (flag === '--json') values.json = true;
    else if ((flag === '--root' || flag === '--get') && args[i + 1]) values[flag.slice(2)] = args[++i];
    else throw new Error(usage);
  }
  if (values.help) {
    console.log(usage);
  } else {
    const fields = ['model', 'minCodexCli', 'code', 'notCode', 'checks', 'land', 'worktree.base', 'worktree.setup'];
    if (!values.root || Boolean(values.json) === (values.get !== undefined) ||
        (values.get !== undefined && !fields.includes(values.get))) throw new Error(usage);
    const config = loadConfig(values.root);
    if (!config) process.exitCode = 3;
    else if (values.json) console.log(JSON.stringify(config, null, 2));
    else {
      const value = values.get.split('.').reduce((object, key) => object[key], config);
      for (const item of Array.isArray(value) ? value : [value]) console.log(item);
    }
  }
} catch (error) {
  console.error('astra-build: ' + error.message);
  process.exitCode = error instanceof ConfigError ? 4 : 2;
}
