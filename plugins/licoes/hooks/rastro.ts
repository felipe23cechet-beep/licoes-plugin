import { atom, read } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const savedThisSession = atom({ plugin: 'licoes', key: 'savedThisSession' } as const, [])

const KEEP = /(^|\/)(CLAUDE(\.local)?\.md|\.claude\/settings(\.local)?\.json)$|\/memory\/[^/]+\.md$/i
const LESSON = ['mcp__plugin_licoes_licoes__buscar_licao', 'mcp__plugin_licoes_licoes__pegar_skill']
const MAX_LINES = 5
const MAX_CHARS = 160
export const HEAD = `# What the licoes plugin changed on this machine

One line per change outside the plugin's own folders, written when it happened: the date, the file, what changed.
/licoes:uninstall reads it to undo exactly these. Lines Claude added right after looking up a lesson are here too.

`


let lookedIn: string | undefined
const noted = new Set<string>()

const slash = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '')

async function home($: EngineInterface) {
  return slash((await $.env.get('USERPROFILE').catch(() => undefined)) || (await $.env.get('HOME').catch(() => undefined)) || '')
}


async function rastro($: EngineInterface) {
  const cfg = await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)
  return (cfg ? slash(cfg) : (await home($)) + '/.claude') + '/licoes/RASTRO.md'
}

async function readText($: EngineInterface, path: string) {
  if (!(await $.fs.exists(path).catch(() => false))) return ''
  const got = await $.fs.read(path).catch(() => '')
  return typeof got === 'string' ? got : ''
}


export function added(before: string, after: string): string[] {
  const old = new Set(before.split('\n').map(l => l.trim()))
  return after.split('\n').map(l => l.trim()).filter(l => l && !old.has(l))
}


export function describe(before: string, after: string): string[] {
  const lines = added(before, after)
  if (!lines.length) return []
  if (!before.trim()) return [`new file (${lines.length} line${lines.length === 1 ? '' : 's'})`]
  const cut = (l: string) => JSON.stringify(l.length > MAX_CHARS ? l.slice(0, MAX_CHARS) + '…' : l)
  const out = lines.slice(0, MAX_LINES).map(l => `added ${cut(l)}`)
  if (lines.length > MAX_LINES) out.push(`+${lines.length - MAX_LINES} more added lines`)
  return out
}

export async function note($: EngineInterface, target: string, what: string[]) {
  const path = await rastro($)
  const now = await readText($, path)
  const day = new Date(await $.clock.now()).toLocaleDateString('sv')
  const fresh = what.map(w => `${slash(target)} · ${w}`).filter(l => !now.includes(l))
  if (fresh.length) await $.fs.write(path, (now || HEAD) + fresh.map(l => `- ${day} · ${l}\n`).join(''))
}


export const ganchos: Register = on => {
  on('tool.call', { tool: LESSON }, async ($, e, next) => {
    const r = await next(e)
    if (!('deny' in r) && !r.isError) lookedIn = (await $.session.id().catch(() => undefined)) ?? ''
    return r
  })

  on('tool.call', { tool: ['Edit', 'Write'] }, async ($, e, next) => {
    const target = typeof e.file_path === 'string' ? slash(e.file_path) : ''
    if (!KEEP.test(target) || lookedIn !== ((await $.session.id().catch(() => undefined)) ?? '')) return next(e)
    const before = e.tool === 'Write' ? await readText($, target) : String(e.old_string ?? '')
    const r = await next(e)
    if ('deny' in r || r.isError) return r
    const after = e.tool === 'Write' ? String(e.content ?? '') : String(e.new_string ?? '')
    await note($, target, describe(before, after)).catch(() => undefined)
    return r
  })

  on('turn.complete', { reason: 'answer' }, async ($, e, next) => {
    const r = await next(e)
    const global = (await home($)) + '/.claude/CLAUDE.md'
    for (const s of await read($, savedThisSession).catch(() => [])) {
      const target = s.scope === 'project' ? `${slash(s.project)}/CLAUDE.md` : global
      if (noted.has(target)) continue
      noted.add(target)
      await note($, target, ['section "Learned rules" (between the claude-reflect markers)']).catch(() => undefined)
    }
    return r
  })
}

export const register: Register = on => ganchos(on)
