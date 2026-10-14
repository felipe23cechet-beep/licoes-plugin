---
name: uninstall
description: Uninstalls the licoes plugin WITHOUT leaving a trace - what it wrote to the machine, the settings, the CLAUDE.md files, memory and projects, and then the plugin itself. Use when the person asks to uninstall or remove the lessons or the licoes plugin.
---

After this, the person wants their Claude Code to look like it never had the plugin: no file, no setting, no rule or habit
that came from it. Go in order. Don't delete anything before step 3.

## 1. Find everything (read only)

**First, the record: `~/.claude/licoes/RASTRO.md`** (or under `$CLAUDE_CONFIG_DIR`, if that's set). Since plugin 0.7.3 the
plugin writes one line there for each change it made outside its own folders: the date, the file, what changed - the lines
Claude added to a CLAUDE.md, a memory or a settings file right after looking up a lesson, the CLAUDE.md that got the
*"Learned rules"* section, and each skill or plugin switched off in a project's `settings.local.json`. Each line is a
**sure find**, no need to ask where it came from: check it's still there (the person may have removed or changed it since);
gone means nothing to undo. A *"Learned rules"* line still follows item 4's exception. The file itself goes with `licoes/`. No file, or the plugin was used before 0.7.3: the search
below is the whole job. With the file, run the search anyway - it catches what came before the record or outside it.

Look for these, and note each find with its path and one line on what it is:

1. **The plugin's folders and files in `~/.claude/`:** `licoes/` (all of it), `licoes-maquina.txt`, and in `ganchos/`:
   `destilar/`, `rotinas/`, `limites.json`, `so-o-que-usa.json`. Also the answer-length styles the plugin installed:
   `~/.claude/output-styles/licoes-*.md`.
2. **The skill library, `~/.claude/biblioteca/`:** the skills in there were MOVED out of `~/.claude/skills/` by the
   plugin. They're the person's: they **go back** to `~/.claude/skills/`, they don't get deleted. The `CATALOGO.md` in there
   and the skill `~/.claude/skills/biblioteca/` belong to the plugin.
3. **Settings** - `~/.claude/settings.json`, `~/.claude/settings.local.json`, and the `.claude/settings.json` and
   `.claude/settings.local.json` of every project the person works in (the folders where they opened Claude Code):
   - `statusLine` or `hooks` whose command mentions `licoes`, `destilar-licoes`, `chat-parado`, `rotinas.js` or `statusline.js`;
   - an `outputStyle` that starts with `licoes-` (take it out, so the default style comes back);
   - `extraKnownMarketplaces.licoes`, `enabledPlugins["licoes@licoes"]` and the plugin's settings (the license key);
   - permissions (`permissions.allow`) that mention those scripts or the `mcp__plugin_licoes_` tools;
   - in the projects' `settings.local.json`, what the plugin switched off: skills set to `"off"` or `"name-only"` and
     disabled plugins the person didn't put there. Undoing it = removing the entry, so it goes back to the default.
4. **The CLAUDE.md files** - the global one (`~/.claude/CLAUDE.md`) and each project's: lines that mention the lessons, the
   plugin, the `/licoes:…` commands, `/panel`, `/idea`, `/reflect`, `/pass-baton`, the `.passa-bastao.md`, or that were
   written to follow a lesson (they cite a lesson's pointer, or the person confirms that's where they came from).
   **Except** the `<!-- claude-reflect -->` … `<!-- end claude-reflect -->` section (*"Learned rules"*): those are rules the
   person approved, one by one, from their own corrections. List it on its own and recommend keeping it.
5. **ALL the memory that came from the plugin** - every project's memory, `~/.claude/projects/*/memory/` (all projects, not
   just the open one): a file, or a `MEMORY.md` line, that mentions the lessons, the plugin or its commands, that holds a
   rule or habit that came from a lesson (cites the pointer, the topic, or repeats what a lesson says), or that the plugin
   wrote on its own. And the plugin's own memory: `~/.claude/licoes/meu/` (the lessons drawn from chats).
6. **In the projects:** `.passa-bastao.md`, `LICOES-APLICADAS.md` and `IDEIAS.md` (that one's from the `/idea` command).

## 2. Show the list

Show everything you found, grouped as above. **Everything goes, memory included**: Claude Code has to end up as if it never
had the plugin, with no rule, habit or memory that came from it. The one exception is the *"Learned rules"* section: ask
whether it stays (recommended - it's the person's own rules, and Claude Code keeps reading them without the plugin) or goes.
If the person asked you to go ahead without asking, skip the questions: the section stays, and the last step says so.
Before anything is removed, offer to save a copy **outside Claude** (on the Desktop, say) of what holds the person's work -
`~/.claude/licoes/meu/` and `IDEIAS.md`. The copy is a loose file: no CLAUDE.md, memory or setting points to it. A line
you're not sure came from the plugin: ask, one at a time.

## 3. With the person's yes, remove

- Edit the JSON files carefully: take out only the entries you found (a targeted edit, never the file rewritten from
  memory), and check the file is still valid JSON.
- In the CLAUDE.md files and memory, take out only the lines you found; a file left empty goes, and so does its line in
  `MEMORY.md`. The *"Learned rules"* section stays unless the person said it goes - and then it goes whole, markers included.
- The library's skills go back to `~/.claude/skills/` BEFORE the `biblioteca/` folder goes: **move each skill's whole
  folder** (`mv`), never recreate it by writing the file - the skill is the person's, and a rewrite loses what they had.
  Then check each one arrived with the same files.
- A command or write blocked by a permission: ask the person to approve it and redo the SAME step; never switch to another
  way around the block.
- Last, with everything else done, run these two, **each on its own in a separate call** (never together with another
  command: if the person refuses permission for one, the rest can't go with it):

```
claude plugin uninstall licoes@licoes
claude plugin marketplace remove licoes
```

  (`uninstall` also deletes the plugin's data in `~/.claude/plugins/data/`; don't use `--keep-data`).

## 4. Check and tell

Search again for `licoes` in `~/.claude/` (chat history stays as it is) and in the projects' CLAUDE.md files and settings.
Tell the person, in a few lines: what went, what stayed (the *"Learned rules"*, if they did: where they are, and that you'll
remove them if they want), and that they should close and reopen Claude Code.
Uninstalling doesn't cancel the subscription: that's done from the link in the receipt.
