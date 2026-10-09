#!/usr/bin/env node

'use strict';
const fs = process.getBuiltinModule('fs'), path = process.getBuiltinModule('path'), os = process.getBuiltinModule('os');

const raiz = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const pastaBib = () => path.join(raiz(), 'biblioteca');
const pastaSkills = projeto => projeto ? path.join(process.cwd(), '.claude', 'skills') : path.join(raiz(), 'skills');
const barra = p => p.replace(/\\/g, '/');
const CORTE = 120;

function cabecalho(texto) {
  const m = texto.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const linhas = m[1].split(/\r?\n/), r = {};
  for (let i = 0; i < linhas.length; i++) {
    const c = linhas[i].match(/^(name|description):\s*(.*)$/);
    if (!c) continue;
    let v = c[2].trim();
    if (/^[>|][+-]?$/.test(v)) {
      const partes = [];
      while (i + 1 < linhas.length && (/^\s+\S/.test(linhas[i + 1]) || linhas[i + 1].trim() === '')) partes.push(linhas[++i].trim());
      v = partes.filter(Boolean).join(' ');
    }
    r[c[1]] = v.replace(/^(["'])([\s\S]*)\1$/, '$2').replace(/\s+/g, ' ');
  }
  return r;
}

function catalogo() {
  const bib = pastaBib();
  fs.mkdirSync(bib, { recursive: true });
  const itens = fs.readdirSync(bib, { withFileTypes: true }).filter(d => d.isDirectory())
    .map(d => ({ pasta: d.name, arq: path.join(bib, d.name, 'SKILL.md') }))
    .filter(s => fs.existsSync(s.arq))
    .map(s => ({ ...s, ...cabecalho(fs.readFileSync(s.arq, 'utf8')) }))
    .sort((a, b) => a.pasta.localeCompare(b.pasta));
  const corta = t => (t || '(sem descrição)').length > CORTE ? t.slice(0, CORTE) + '…' : (t || '(sem descrição)');
  const txt = ['# Catálogo da biblioteca', '',
    'Para usar: leia o SKILL.md dela e siga. Caminho relativo dentro da skill parte da pasta dela.', '',
    ...itens.map(s => `- **${s.name || s.pasta}**: ${corta(s.description)}  \n  \`${barra(s.arq)}\``), ''].join('\n');
  fs.writeFileSync(path.join(bib, 'CATALOGO.md'), txt);
  return itens.length;
}

function instalar() {
  const bib = pastaBib(), destino = path.join(pastaSkills(false), 'biblioteca');
  const modelo = fs.readFileSync(path.join(__dirname, 'SKILL.md'), 'utf8');
  fs.mkdirSync(destino, { recursive: true });
  fs.writeFileSync(path.join(destino, 'SKILL.md'), modelo.replaceAll('{{BIBLIOTECA}}', barra(bib)));
  const n = catalogo();
  return `skill \`biblioteca\` em ${barra(destino)}; biblioteca em ${barra(bib)} (${n} skill${n === 1 ? '' : 's'})`;
}

function muda(nome, de, para) {
  if (!/^[\w.-]+$/.test(nome) || nome === 'biblioteca') throw new Error(`nome inválido: ${nome}`);
  const origem = path.join(de, nome), alvo = path.join(para, nome);
  if (!fs.existsSync(path.join(origem, 'SKILL.md'))) throw new Error(`não achei ${barra(origem)}/SKILL.md`);
  if (fs.existsSync(alvo)) throw new Error(`já existe ${barra(alvo)} — nada foi movido`);
  fs.mkdirSync(para, { recursive: true });
  try { fs.renameSync(origem, alvo); }
  catch { fs.cpSync(origem, alvo, { recursive: true }); fs.rmSync(origem, { recursive: true, force: true }); }
}

function principal(args) {
  const projeto = args.includes('--projeto'), [cmd, ...nomes] = args.filter(a => a !== '--projeto');
  if (cmd === 'instalar') return instalar();
  if (cmd === 'catalogo') return `catálogo refeito: ${catalogo()} skills`;
  if (cmd === 'mover' || cmd === 'voltar') {
    if (!nomes.length) throw new Error(`diga o nome: node biblioteca.js ${cmd} <nome>`);
    if (!fs.existsSync(path.join(pastaSkills(false), 'biblioteca', 'SKILL.md')))
      throw new Error('a skill `biblioteca` não está instalada: rode antes  node biblioteca.js instalar');
    const skills = pastaSkills(projeto), bib = pastaBib();
    for (const n of nomes) cmd === 'mover' ? muda(n, skills, bib) : muda(n, bib, skills);
    return `${cmd === 'mover' ? 'movida(s) para a biblioteca' : 'de volta em ' + barra(skills)}: ${nomes.join(', ')} · catálogo com ${catalogo()} skills · vale no próximo chat`;
  }
  throw new Error('uso: node biblioteca.js instalar | mover <nome...> | voltar <nome...> | catalogo  [--projeto]  |  --teste');
}

function teste() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bib-')), velho = process.cwd(), env = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'claude');
  const proj = path.join(tmp, 'proj'); fs.mkdirSync(proj); process.chdir(proj);
  const skill = (dir, nome, desc) => { fs.mkdirSync(path.join(dir, nome), { recursive: true });
    fs.writeFileSync(path.join(dir, nome, 'SKILL.md'), `---\nname: ${nome}\n${desc}\n---\n# ${nome}\n`);
    fs.writeFileSync(path.join(dir, nome, 'extra.md'), 'arquivo da skill'); };
  let ok = 0, falhas = 0;
  const caso = (nome, f) => { try { const r = f(); if (r === false) throw new Error('falso'); ok++; console.log('✅', nome); }
    catch (e) { falhas++; console.log('❌', nome, '—', e.message); } };
  const lerCat = () => fs.readFileSync(path.join(pastaBib(), 'CATALOGO.md'), 'utf8');
  try {
    const us = pastaSkills(false), pj = pastaSkills(true);
    skill(us, 'mobile-native', 'description: Make a web app feel native on a phone.');
    skill(us, 'longa', 'description: >\n  Primeira linha da descrição\n  e a segunda, ' + 'x'.repeat(150));
    skill(us, 'aspas', 'description: "Com aspas: e dois-pontos"');
    skill(pj, 'do-projeto', "description: 'Skill do projeto'");
    caso('mover antes de instalar recusa', () => { try { principal(['mover', 'mobile-native']); return false; } catch (e) { return /instalar/.test(e.message); } });
    caso('instalar grava a skill com o caminho da biblioteca', () => {
      principal(['instalar']);
      const s = fs.readFileSync(path.join(us, 'biblioteca', 'SKILL.md'), 'utf8');
      return s.includes(barra(pastaBib()) + '/CATALOGO.md') && !s.includes('{{');
    });
    caso('mover leva a pasta inteira e entra no catálogo', () => {
      principal(['mover', 'mobile-native', 'longa', 'aspas']);
      return !fs.existsSync(path.join(us, 'mobile-native')) && fs.existsSync(path.join(pastaBib(), 'mobile-native', 'extra.md'))
        && /\*\*mobile-native\*\*: Make a web app feel native on a phone\./.test(lerCat());
    });
    caso('descrição de várias linhas junta e corta em 120', () => /\*\*longa\*\*: Primeira linha da descrição e a segunda, x+…/.test(lerCat())
      && lerCat().match(/\*\*longa\*\*: (.*?) {2}$/m)[1].length === CORTE + 1);
    caso('aspas saem', () => lerCat().includes('**aspas**: Com aspas: e dois-pontos\n') || lerCat().includes('**aspas**: Com aspas: e dois-pontos  '));
    caso('--projeto move a do projeto', () => { principal(['mover', 'do-projeto', '--projeto']);
      return !fs.existsSync(path.join(pj, 'do-projeto')) && lerCat().includes('**do-projeto**: Skill do projeto'); });
    caso('a biblioteca não se move para dentro de si', () => { try { principal(['mover', 'biblioteca']); return false; } catch (e) { return /inválido/.test(e.message); } });
    caso('nome com barra recusa', () => { try { principal(['mover', '../x']); return false; } catch (e) { return /inválido/.test(e.message); } });
    caso('voltar não sobrescreve a que já existe', () => {
      skill(us, 'aspas', 'description: outra'); try { principal(['voltar', 'aspas']); return false; }
      catch (e) { return /já existe/.test(e.message) && fs.existsSync(path.join(pastaBib(), 'aspas')); }
    });
    caso('voltar devolve e tira do catálogo', () => { principal(['voltar', 'mobile-native']);
      return fs.existsSync(path.join(us, 'mobile-native', 'extra.md')) && !lerCat().includes('mobile-native'); });
    caso('skill sem cabeçalho entra pelo nome da pasta', () => {
      fs.mkdirSync(path.join(pastaBib(), 'crua')); fs.writeFileSync(path.join(pastaBib(), 'crua', 'SKILL.md'), '# sem cabeçalho');
      principal(['catalogo']); return lerCat().includes('**crua**: (sem descrição)');
    });
    caso('pasta sem SKILL.md fica fora do catálogo', () => { fs.mkdirSync(path.join(pastaBib(), 'vazia')); principal(['catalogo']); return !lerCat().includes('vazia'); });
  } finally {
    process.chdir(velho);
    if (env === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = env;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`\n${ok} de ${ok + falhas} passaram`);
  process.exit(falhas ? 1 : 0);
}

if (require.main === module) {
  const a = process.argv.slice(2);
  if (a[0] === '--teste') teste();
  else try { console.log(principal(a)); } catch (e) { console.error('✋ ' + e.message); process.exit(1); }
}
