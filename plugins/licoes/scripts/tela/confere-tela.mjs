import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const alvo = process.argv[2];
if (!alvo) { console.error('uso: node confere-tela.mjs <arquivo.html | url>'); process.exit(2); }

let chromium;
for (const de of [import.meta.url, process.env.CLAUDE_PLUGIN_DATA && pathToFileURL(resolve(process.env.CLAUDE_PLUGIN_DATA, 'package.json')).href]) {
  if (!de) continue;
  try { const m = await import(pathToFileURL(createRequire(de).resolve('playwright-core')).href); chromium = m.chromium || (m.default && m.default.chromium); if (chromium) break; } catch {}
}
if (!chromium) { console.error('playwright-core não instalado (npm install na pasta do gancho; no plugin, a skill "tela")'); process.exit(2); }
const url = existsSync(alvo) ? pathToFileURL(resolve(alvo)).href : alvo;

let nav;
for (const op of [{ channel: 'msedge' }, { channel: 'chrome' }, {}]) {
  try { nav = await chromium.launch(op); break; } catch {}
}
if (!nav) { console.error('sem navegador: o Edge ou o Chrome precisam estar instalados'); process.exit(2); }

const falhas = new Map(), semMedir = new Set(), vazou = [];
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
    const pag = await nav.newPage({ viewport });
    await pag.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await pag.waitForTimeout(800);
    const r = await pag.evaluate(() => {
      const rgba = s => { const m = s.match(/[\d.]+/g) || [0, 0, 0, 0]; return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]]; };
      const lum = ([r, g, b]) => { const c = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
      const sobre = (fg, bg) => [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
      const fundo = el => {
        const camadas = [];
        for (let e = el; e; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.backgroundImage !== 'none') return null;
          const c = rgba(cs.backgroundColor);
          if (c[3] > 0) { camadas.push(c); if (c[3] === 1) break; }
        }
        return camadas.reverse().reduce((acc, c) => sobre(c, acc), [255, 255, 255]);
      };
      const nome = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : '');
      const fora = [], sem = [];
      for (const el of document.querySelectorAll('body *')) {
        const texto = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
        if (!texto) continue;
        const cs = getComputedStyle(el), q = el.getBoundingClientRect();
        if (cs.visibility === 'hidden' || +cs.opacity === 0 || q.width === 0 || q.height === 0) continue;
        const bg = fundo(el);
        if (!bg) { sem.push(nome(el) + ' "' + texto.slice(0, 30) + '"'); continue; }
        const cor = sobre(rgba(cs.color), bg);
        const [a, b] = [lum(cor), lum(bg)].sort((x, y) => y - x);
        const razao = (a + 0.05) / (b + 0.05);
        const px = parseFloat(cs.fontSize), negrito = +cs.fontWeight >= 700;
        const minimo = px >= 24 || (px >= 18.66 && negrito) ? 3 : 4.5;
        if (razao < minimo) fora.push({ sel: nome(el), texto: texto.slice(0, 40), cor: cs.color, bg: `rgb(${bg.map(Math.round)})`, razao: +razao.toFixed(2), minimo });
      }
      const d = document.documentElement;
      return { fora, sem, largura: [d.scrollWidth, d.clientWidth] };
    });
    for (const f of r.fora) falhas.set(f.sel + f.texto, { ...f, tela: viewport.width });
    r.sem.forEach(s => semMedir.add(s));
    if (viewport.width === 375 && r.largura[0] > r.largura[1]) vazou.push(`a 375 px a página tem ${r.largura[0]} px de largura: rola para o lado`);
    await pag.close();
  }
} catch (e) { console.error('não deu para conferir: ' + String(e.message || e).split('\n')[0]); await nav.close(); process.exit(2); }
await nav.close();

const linhas = [];
if (falhas.size) {
  linhas.push(`${falhas.size} texto(s) ilegível(is) (WCAG AA):`);
  for (const f of falhas.values()) linhas.push(`- ${f.sel} "${f.texto}" cor ${f.cor} sobre ${f.bg}: ${f.razao}:1 (mínimo ${f.minimo}:1, tela de ${f.tela} px)`);
}
vazou.forEach(v => linhas.push('- ' + v));
if (semMedir.size) linhas.push(`(${semMedir.size} texto(s) sobre imagem ou degradê não dá para medir assim — olhe na tela: ${[...semMedir].slice(0, 3).join('; ')})`);
if (!falhas.size && !vazou.length) { console.log('tela ok: todo texto visível passa no WCAG AA e nada vaza a 375 px' + (semMedir.size ? '\n' + linhas.at(-1) : '')); process.exit(0); }
console.log(linhas.join('\n'));
process.exit(1);
