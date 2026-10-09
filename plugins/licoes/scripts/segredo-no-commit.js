#!/usr/bin/env node

'use strict';

const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path'),
  os = process.getBuiltinModule('os'), cp = process.getBuiltinModule('child_process');

const SEGREDO = new RegExp([
  String.raw`\bsk[_-](live_|test_|ant-|proj-)?[A-Za-z0-9_-]{16,}`,
  String.raw`\b(pk|rk)_(live|test)_[A-Za-z0-9]{10,}`,
  String.raw`\bwhsec_[A-Za-z0-9]{20,}`,
  String.raw`\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}`,
  String.raw`\bAIza[0-9A-Za-z_-]{30,}`,
  String.raw`\bgh[pousr]_[A-Za-z0-9]{30,}`, String.raw`\bgithub_pat_[A-Za-z0-9_]{40,}`,
  String.raw`\bAKIA[0-9A-Z]{16}\b`,
  String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}`,
  String.raw`\b\d{8,}:[A-Za-z0-9_-]{30,}`,
  String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----`,
  String.raw`service_role[^\n]{0,40}eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}`,
  String.raw`(key|token|secret|senha|password|passwd|api)[\w-]*["']?\s*[:=]\s*["']?[a-f0-9]{32,}\b`,
].join('|'), 'i');
const ARQ_SEGREDO = /(^|\/)(\.env(\.[\w-]+)?|\.dev\.vars)$/;
const ARQ_OK = /\.(example|sample|template|exemplo|modelo)$/;
const SEM_LER = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|uv\.lock)$/;
const ESCAPA = /segredo-ok/;

const tira = s => s.replace(/^["']|["']$/g, '').replace(/^~(?=\/|$)/, os.homedir()).replace(/^\/([a-z])(?=\/|$)/i, '$1:');
function pastaDoGit(partes, cwd) {
  let dir = cwd;
  for (const p of partes) {
    const cd = p.match(/^\s*(?:cd|pushd|Set-Location|sl)\s+(?:\/d\s+)?("[^"]+"|'[^']+'|\S+)\s*$/i);
    if (cd) { dir = path.resolve(dir, tira(cd[1])); continue; }
    if (/\bgit\b.*\b(commit|push)\b/.test(p)) {
      const c = p.match(/\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/);
      return c ? path.resolve(dir, tira(c[1])) : dir;
    }
  }
  return dir;
}

function analisar(cmd, cwd) {
  const partes = cmd.split(/&&|\|\||;|\||\r?\n/);
  const commit = partes.some(p => /\bgit\b.*\bcommit\b/.test(p)), push = partes.some(p => /\bgit\b.*\bpush\b/.test(p));
  if (!commit && !push) return null;
  cwd = pastaDoGit(partes, cwd);
  const git = a => { try { return cp.execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20, timeout: 8000 }); } catch { return ''; } };
  const raiz = git(['rev-parse', '--show-toplevel']).trim();
  if (!raiz) return null;

  const achados = [], nomes = new Set(), diffs = [];
  if (commit) {
    const adds = partes.map(p => p.match(/\bgit\s+(?:-C\s+(?:"[^"]+"|'[^']+'|\S+)\s+)?add\s+(.+)/)).filter(Boolean).map(m => m[1].trim().split(/\s+/));
    const tudo = adds.some(a => a.some(x => ['-A', '--all', '.', '*', ':/'].includes(x)));
    const rastreados = tudo || adds.some(a => a.includes('-u')) || partes.some(p => /\bcommit\b.*\s-[a-z]*a[a-z]*\b/.test(p));
    const citados = adds.flat().filter(x => !x.startsWith('-') && !['.', '*', ':/'].includes(x)).map(x => x.replace(/^["']|["']$/g, ''));
    git(['diff', '--cached', '--name-only']).split('\n').forEach(f => f && nomes.add(f));
    diffs.push(git(['diff', '--cached', '-U0', '--no-color']));
    if (rastreados) { git(['diff', '--name-only']).split('\n').forEach(f => f && nomes.add(f)); diffs.push(git(['diff', '-U0', '--no-color'])); }
    if (citados.length) {
      git(['diff', '--name-only', '--', ...citados]).split('\n').forEach(f => f && nomes.add(f));
      diffs.push(git(['diff', '-U0', '--no-color', '--', ...citados]));
    }
    const novos = tudo ? git(['ls-files', '--others', '--exclude-standard']) : citados.length ? git(['ls-files', '--others', '--exclude-standard', '--', ...citados]) : '';
    for (const f of novos.split('\n').filter(Boolean)) {
      nomes.add(f);
      if (SEM_LER.test(f)) continue;
      try { const st = fs.statSync(path.join(cwd, f)); if (st.size > 1 << 20) continue;
        const t = fs.readFileSync(path.join(cwd, f), 'utf8'); if (!t.includes('\0')) diffs.push(`+++ b/${f}\n` + t.split('\n').map(l => '+' + l).join('\n')); } catch {}
    }
  }
  if (push) {
    const temUpstream = git(['rev-parse', '--abbrev-ref', '@{u}']).trim();
    const faixa = temUpstream ? ['@{u}..HEAD'] : ['HEAD', '--not', '--remotes'];
    git(['log', '--format=', '--name-only', ...faixa]).split('\n').forEach(f => f && nomes.add(f));
    diffs.push(git(['log', '-p', '-U0', '--format=', '--no-color', ...faixa]));
  }

  for (const f of nomes) if (ARQ_SEGREDO.test(f) && !ARQ_OK.test(f)) achados.push(`${f}: arquivo de segredo — fica fora do Git (ponha no .gitignore e tire com git rm --cached)`);
  let arq = '';
  for (const linha of diffs.join('\n').split('\n')) {
    if (linha.startsWith('+++ ')) { arq = linha.replace(/^\+\+\+ (b\/)?/, ''); continue; }
    if (!linha.startsWith('+') || SEM_LER.test(arq) || ESCAPA.test(linha)) continue;
    const m = linha.match(SEGREDO);
    if (m) achados.push(`${arq}: parece chave ou segredo (${m[0].slice(0, 6)}…)`);
  }
  return [...new Set(achados), ...(commit ? regras(raiz, git, nomes, partes) : [])];
}

function regras(raiz, git, nomes, partes) {
  let txt = ''; try { txt = fs.readFileSync(path.join(raiz, '.claude', 'regras-git'), 'utf8'); } catch { return []; }
  const out = [];
  if (/^main:\s*(n[aã]o|no)\b/mi.test(txt) && !partes.some(p => /\bgit\s+(checkout|switch)\b/.test(p))
      && ['main', 'master'].includes(git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()))
    out.push('regra: este projeto não faz commit direto na main — crie um ramo (git switch -c <nome>) e faça o commit nele');
  const nunca = ((txt.match(/^(nunca|never):(.*)$/mi) || [])[2] || '').trim().split(/\s+/).filter(Boolean).map(g => {
    const pasta = g.endsWith('/'), corpo = g.replace(/\/$/, '');
    const re = corpo.replace(/^\//, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
    return new RegExp((corpo.includes('/') ? '^' : '(^|/)') + re + (pasta ? '/' : '$'), 'i');
  });
  for (const f of nomes) if (nunca.some(r => r.test(f))) out.push(`regra: ${f} fica fora dos commits deste projeto`);
  return out;
}

function negar(achados) {
  const regra = achados.filter(a => a.startsWith('regra: ')).map(a => a.slice(7)), seg = achados.filter(a => !a.startsWith('regra: '));
  const motivo = [];
  if (seg.length) motivo.push('segredo-no-commit: isto mandaria um segredo para o Git.\n- ' + seg.slice(0, 8).join('\n- ') +
      (seg.length > 8 ? `\n- e mais ${seg.length - 8}` : '') +
      '\nTire do commit (git restore --staged <arquivo>; no push, reescreva o commit que ainda não subiu), mova o valor para variável ' +
      'de ambiente e rode de novo. Se for falso positivo (hash de teste, chave pública de exemplo), diga à pessoa e, com o sim dela, ' +
      'ponha "segredo-ok" num comentário na mesma linha.');
  if (regra.length) motivo.push('segredo-no-commit: isto quebra as regras de git DESTE projeto (.claude/regras-git, combinadas com a pessoa).\n- ' +
      regra.slice(0, 8).join('\n- ') + '\nAjuste e rode de novo (git restore --staged <arquivo> tira do commit). Só mude o .claude/regras-git se a pessoa pedir.');
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: motivo.join('\n\n') } });
}

function teste() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'segredo-teste-'));
  const sh = (c, cwd) => cp.execSync(c, { cwd, stdio: 'ignore', shell: true });
  const remoto = path.join(raiz, 'remoto.git'), rep = path.join(raiz, 'rep');
  sh(`git init -q --bare "${remoto}"`, raiz); sh(`git init -q "${rep}"`, raiz);
  sh('git config user.email t@t && git config user.name t && git config core.autocrlf false && git commit -q --allow-empty -m 0', rep);
  sh(`git remote add origin "${remoto}" && git push -q -u origin HEAD`, rep);
  const esc = (f, t) => fs.writeFileSync(path.join(rep, f), t);
  const casos = [];
  const caso = (nome, preparo, cmd, esperado, ondeEstou = rep) => {
    preparo();
    const r = analisar(cmd, ondeEstou), negou = !!(r && r.length);
    casos.push([negou === esperado ? 'ok ' : 'ERRO', nome, negou ? 'nega: ' + r.join(' | ') : 'passa']);
    sh('git reset -q --hard && git clean -qfd', rep);
  };
  caso('commit limpo passa', () => { esc('a.js', 'const x = 1\n'); sh('git add a.js', rep); }, 'git commit -m a', false);
  caso('chave Stripe no stage nega', () => { esc('b.js', 'const k = "sk_live_' + 'A'.repeat(24) + '"\n'); sh('git add b.js', rep); }, 'git commit -m b', true);
  caso('.env pelo add do mesmo comando nega', () => esc('.env', 'X=1\n'), 'git add .env && git commit -m e', true);
  caso('.env.example passa', () => esc('.env.example', 'STRIPE_KEY=\n'), 'git add .env.example && git commit -m e', false);
  caso('.dev.vars (Cloudflare) nega', () => esc('.dev.vars', 'A=1\n'), 'git add -A && git commit -m d', true);
  caso('add -A com arquivo novo com chave Google nega', () => esc('c.py', 'K = "AIza' + 'b'.repeat(35) + '"\n'), 'git add -A; git commit -m c', true);
  caso('lockfile com hex longo passa', () => esc('package-lock.json', '{"integrity": "' + 'a'.repeat(64) + '", "token": "' + 'f'.repeat(40) + '"}\n'), 'git add . && git commit -m l', false);
  caso('hex longo COM nome de chave nega', () => esc('cfg.js', 'const API_KEY = "' + '0123456789abcdef'.repeat(3) + '"\n'), 'git add cfg.js && git commit -m k', true);
  caso('hex longo SEM nome (hash de commit) passa', () => esc('h.md', 'commit ' + 'abcdef0123'.repeat(4) + '\n'), 'git add h.md && git commit -m h', false);
  caso('linha com segredo-ok passa', () => esc('t.js', 'const fake = "sk_test_' + 'C'.repeat(24) + '" // segredo-ok: chave de teste\n'), 'git add t.js && git commit -m t', false);
  caso('commit -a pega mudança em arquivo rastreado', () => { esc('a.js', 'x\n'); sh('git add a.js && git commit -q -m a', rep); esc('a.js', 'x\nconst t = "ghp_' + 'z'.repeat(36) + '"\n'); }, 'git commit -am a2', true);
  sh('git reset -q --hard origin/HEAD 2>nul || git reset -q --hard @{u}', rep);
  caso('push de commit limpo passa (o defeito do original)', () => { esc('p.js', 'ok\n'); sh('git add p.js && git commit -q -m p', rep); }, 'git push', false);
  caso('push com segredo num commit que não subiu nega', () => { esc('q.js', 'const s = "whsec_' + 'Q'.repeat(30) + '"\n'); sh('git add q.js && git commit -q -m q', rep); }, 'git push origin HEAD', true);
  caso('chave antiga já commitada não barra o commit de outra linha', () => { esc('v.js', 'k = "sk_live_' + 'D'.repeat(24) + '"\n'); sh('git add v.js && git commit -q -m v', rep); esc('v.js', 'k = "sk_live_' + 'D'.repeat(24) + '"\nnova = 1\n'); }, 'git add v.js && git commit -m v2', false);
  caso('tirar o segredo-ok de uma linha com chave nega', () => { esc('w.js', 'k = "sk_live_' + 'E'.repeat(24) + '" // segredo-ok\n'); sh('git add w.js && git commit -q -m w', rep); esc('w.js', 'k = "sk_live_' + 'E'.repeat(24) + '"\n'); }, 'git commit -am w2', true);
  caso('comando sem git passa', () => {}, 'npm test', false);
  const chaveRep = () => esc('.env', 'STRIPE_SECRET_KEY=sk_live_' + 'F'.repeat(24) + '\n');
  caso('git -C <pasta> de fora do repositório nega', chaveRep, `git -C "${rep}" add -A && git -C "${rep}" commit -m x`, true, raiz);
  caso('cd <pasta> && git commit de fora nega', chaveRep, `cd "${rep}" && git add -A && git commit -m x`, true, raiz);
  caso('comandos em linhas separadas negam', chaveRep, `cd "${rep}"\ngit add -A\ngit commit -m x`, true, raiz);
  caso('caminho do Git Bash (/c/...) nega', chaveRep, `git -C "${rep.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (m, l) => '/' + l.toLowerCase())}" add -A; git -C "${rep.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (m, l) => '/' + l.toLowerCase())}" commit -m x`, true, raiz);

  sh('git reset -q --hard @{u}', rep);
  const regrasDe = t => { fs.mkdirSync(path.join(rep, '.claude'), { recursive: true }); esc('.claude/regras-git', t); sh('git add .claude && git commit -q -m regras', rep); };
  const ramo = () => cp.execSync('git rev-parse --abbrev-ref HEAD', { cwd: rep, encoding: 'utf8' }).trim();
  caso('regra "main: não" nega commit na main', () => { regrasDe('main: não\n'); sh(`git branch -M ${ramo()} main`, rep); esc('m.js', '1\n'); }, 'git add m.js && git commit -m m', true);
  caso('regra "main: não" deixa o commit num ramo', () => { sh('git switch -q -c ramo', rep); esc('n.js', '1\n'); }, 'git add n.js && git commit -m n', false);
  caso('regra "nunca: *.mp4 videos/" nega o vídeo em qualquer pasta', () => { regrasDe('nunca: *.mp4 videos/\n'); fs.mkdirSync(path.join(rep, 'a', 'b'), { recursive: true }); esc('a/b/x.mp4', 'v'); }, 'git add -A && git commit -m v', true);
  caso('e a pasta videos/', () => { fs.mkdirSync(path.join(rep, 'videos'), { recursive: true }); esc('videos/l.txt', 'v'); }, 'git add videos && git commit -m v', true);
  caso('sem casar a regra, passa (meu-videos.txt)', () => esc('meu-videos.txt', 'v'), 'git add meu-videos.txt && git commit -m v', false);
  esc('y.mp4', 'sk_live_' + 'G'.repeat(24));
  const dois = negar(analisar('git add y.mp4 && git commit -m y', rep) || []);
  casos.push([/regras de git DESTE/.test(dois) && /mandaria um segredo/.test(dois) ? 'ok ' : 'ERRO', 'segredo e regra juntos: o motivo diz os dois', '']);
  fs.rmSync(raiz, { recursive: true, force: true });
  for (const c of casos) console.log(c.join('  '));
  const erros = casos.filter(c => c[0] === 'ERRO').length;
  console.log(erros ? `${erros} ERRO(S) de ${casos.length}` : `todos os ${casos.length} casos certos`);
  process.exitCode = erros ? 1 : 0;
}

if (process.argv[2] === '--teste') teste();
else {
  let entrada = '';
  process.stdin.on('data', d => (entrada += d)).on('end', () => {
    try {
      const e = JSON.parse(entrada), cmd = (e.tool_input && e.tool_input.command) || '';
      const achados = analisar(cmd, e.cwd || process.cwd());
      if (achados && achados.length) console.log(negar(achados));
    } catch {}
  });
}
