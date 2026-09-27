#!/usr/bin/env node
// Identificador desta máquina, mandado ao servidor no cabeçalho X-Maquina (limite de 3 máquinas por chave).
// Nasce na primeira vez e fica em ~/.claude/licoes-maquina.txt. Na nuvem (claude.ai/code) o contêiner é novo a
// cada sessão, então lá o identificador é um só: "nuvem" — senão cada sessão contaria como máquina nova.
// Qualquer falha: sai sem o cabeçalho (o servidor conta como "sem-id"), nunca trava a conexão.
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
