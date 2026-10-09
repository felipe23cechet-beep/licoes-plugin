#!/usr/bin/env node

const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
let id = 'sem-id';
try {
  if (process.env.CLAUDE_CODE_REMOTE === 'true') id = 'nuvem';
  else {
    const arq = path.join(os.homedir(), '.claude', 'licoes-maquina.txt');
    try { id = fs.readFileSync(arq, 'utf8').trim(); } catch {}
    if (!/^[\w-]{8,80}$/.test(id)) {
      id = crypto.randomUUID();
      fs.mkdirSync(path.dirname(arq), { recursive: true });
      fs.writeFileSync(arq, id);
    }
  }
} catch {}
process.stdout.write(JSON.stringify({ 'X-Maquina': id }));
