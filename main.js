// QuestSound for Obsidian: the full QuestSound app in a side panel, controlled from notes and commands.
// The panel is the hosted web app in a frame; notes talk to it with postMessage commands
// ({lorescape: 'scene' | 'env' | 'mood' | 'fight' | 'sfx' | 'weather' | 'music' | 'stop', ...}).
const { Plugin, ItemView, PluginSettingTab, Setting, Notice, SuggestModal, moment } = require('obsidian');

const VIEW = 'lorescape-view';
const DEFAULTS = { url: 'https://questsound.ru', lang: 'auto', autoUpdate: true, noteSound: true };
// The server's former address: the panel opens there once more, carries its data over and lands on the new one.
const OLD_URLS = ['https://lorescape.191-223-140-8.sslip.io'];

// Plugin text in Russian or English: 'auto' follows Obsidian's own language. The panel gets the same one.
let LANG = 'en';
const L = (ru, en) => LANG === 'ru' ? ru : en;

class QuestSoundView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return VIEW; }
  getDisplayText() { return 'QuestSound'; }
  getIcon() { return 'music'; }
  async onOpen() {
    const box = this.contentEl; box.empty(); box.addClass('lorescape-view');
    const frame = box.createEl('iframe', { attr: { src: this.plugin.frameUrl(), allow: 'autoplay; clipboard-write; fullscreen', title: 'QuestSound' } });
    this.plugin.attach(frame);
  }
  async onClose() { this.plugin.detach(); }
}

// one picker for scenes, sounds, atmospheres and moods
class Pick extends SuggestModal {
  constructor(app, items, placeholder, onPick) { super(app); this.items = items; this.onPick = onPick; this.setPlaceholder(placeholder); }
  getSuggestions(q) { q = q.toLowerCase(); return this.items.filter(x => (x.name + ' ' + (x.group || '')).toLowerCase().includes(q)); }
  renderSuggestion(x, el) { el.createDiv({ text: (x.icon ? x.icon + ' ' : '') + x.name }); if (x.group) el.createEl('small', { text: x.group, cls: 'lorescape-muted' }); }
  onChooseSuggestion(x) { this.onPick(x); }
}

// lines of a ```questsound block → [command, label, icon]
const VERBS = {
  scene: ['scene', '🎬'], сцена: ['scene', '🎬'],
  env: ['env', '🌲'], окружение: ['env', '🌲'], атмосфера: ['env', '🌲'],
  mood: ['mood', '🎼'], музыка: ['mood', '🎼'], настроение: ['mood', '🎼'],
  sfx: ['sfx', '💥'], звук: ['sfx', '💥'],
  weather: ['weather', '🌧️'], погода: ['weather', '🌧️'],
  fight: ['fight', '⚔️'], бой: ['fight', '⚔️'],
  set: ['set', '🎵'], playlist: ['set', '🎵'], набор: ['set', '🎵'], плейлист: ['set', '🎵'],
  cue: ['cue', '🎺'], theme: ['cue', '🎺'], тема: ['cue', '🎺'],
  turn: ['turn', '⏭'], ход: ['turn', '⏭'],
  stop: ['stop', '⏹'], стоп: ['stop', '⏹'],
};
function parseLine(line) {
  const m = line.trim().match(/^([^:|]+?)\s*(?::\s*([^|]*?))?\s*(?:\|\s*(.+))?$/);
  if (!m) return null;
  const v = VERBS[m[1].toLowerCase()]; if (!v) return null;
  const [kind, icon] = v, arg = (m[2] || '').trim(), label = m[3]?.trim();
  if (kind === 'mood') { // "эпос 0.8 бой" → zone, strength, fight
    const words = arg.split(/\s+/), num = words.find(w => /^\d+(\.\d+)?%?$/.test(w));
    const fight = words.some(w => /^(бой|fight)$/i.test(w));
    const name = words.filter(w => w !== num && !/^(бой|fight)$/i.test(w)).join(' ') || 'neutral';
    const intensity = num ? (num.endsWith('%') ? parseFloat(num) / 100 : +num > 1 ? +num / 100 : +num) : undefined;
    return { cmd: { lorescape: 'mood', name, intensity, fight: fight || undefined }, label: label || name + (fight ? L(' (бой)', ' (combat)') : ''), icon: fight ? '⚔️' : icon };
  }
  if (kind === 'fight') { const on = /^(off|выкл|нет)$/i.test(arg) ? false : /^(on|вкл|да)$/i.test(arg) ? true : undefined; return { cmd: { lorescape: 'fight', on }, label: label || (on === false ? L('Бой: выкл', 'Combat: off') : on ? L('Бой: вкл', 'Combat: on') : L('Бой', 'Combat')), icon }; }
  if (kind === 'set') return { cmd: { lorescape: 'set', name: arg }, label: label || arg || L('Вся библиотека', 'Whole library'), icon };
  if (kind === 'turn') return { cmd: { lorescape: 'turn' }, label: label || L('Следующий ход', 'Next turn'), icon };
  if (kind === 'stop') return { cmd: { lorescape: 'stop' }, label: label || L('Стоп', 'Stop'), icon };
  if (!arg) return null;
  return { cmd: { lorescape: kind, name: arg }, label: label || arg, icon };
}

module.exports = class QuestSoundPlugin extends Plugin {
  async onload() {
    // the plugin used to be "lorescape": a fresh install picks up that folder's settings once
    let saved = await this.loadData();
    if (!saved) try { saved = JSON.parse(await this.app.vault.adapter.read(this.app.vault.configDir + '/plugins/lorescape/data.json')); } catch { }
    this.settings = Object.assign({}, DEFAULTS, saved);
    if (OLD_URLS.includes(this.settings.url.replace(/\/+$/, ''))) {
      this.settings.moveFrom = this.settings.url; this.settings.url = DEFAULTS.url; await this.saveData(this.settings);
    }
    LANG = this.settings.lang !== 'auto' ? this.settings.lang : /^ru/i.test(moment.locale()) ? 'ru' : 'en';
    this.frame = null; this.ready = null; this.pending = new Map(); this.catalog = { scenes: [], sfx: [], envs: [], moods: [], weather: [], sets: [], cues: [] };
    this.registerView(VIEW, leaf => new QuestSoundView(leaf, this));
    this.addRibbonIcon('music', L('Открыть QuestSound', 'Open QuestSound'), () => this.openView(true));
    this.registerDomEvent(window, 'message', e => this.onMessage(e));

    const cmd = (id, name, fn) => this.addCommand({ id, name, callback: fn });
    cmd('open', L('Открыть панель', 'Open the panel'), () => this.openView(true));
    cmd('scene', L('Включить сцену…', 'Play a scene…'), () => this.pick('scenes', L('Сцена…', 'Scene…'), x => this.send({ lorescape: 'scene', name: x.name })));
    cmd('env', L('Включить окружение…', 'Play an environment…'), () => this.pick('envs', L('Окружение…', 'Environment…'), x => this.send({ lorescape: 'env', name: x.id })));
    cmd('mood', L('Настроение музыки…', 'Music mood…'), () => this.pick('moods', L('Настроение…', 'Mood…'), x => this.send({ lorescape: 'mood', name: x.id })));
    cmd('sfx', L('Проиграть звук…', 'Play a sound…'), () => this.pick('sfx', L('Звук…', 'Sound…'), x => this.send({ lorescape: 'sfx', name: x.id })));
    cmd('set', L('Набор музыки для круга…', 'Wheel track set…'), () => this.pick('sets', L('Набор…', 'Set…'), x => this.send({ lorescape: 'set', name: x.id })));
    cmd('cue', L('Тема для момента…', 'Play a theme…'), () => this.pick('cues', L('Тема…', 'Theme…'), x => this.send({ lorescape: 'cue', name: x.id })));
    cmd('turn', L('Следующий ход в бою', 'Next combat turn'), () => this.send({ lorescape: 'turn' }));
    cmd('note', L('Включить звук этой заметки', 'Play this note’s sound'), () => this.playNote(this.app.workspace.getActiveFile(), true));
    cmd('fight', L('Боевая музыка вкл/выкл', 'Combat music on/off'), () => this.send({ lorescape: 'fight' }));
    cmd('music', L('Музыка вкл/выкл', 'Music on/off'), () => this.send({ lorescape: 'music' }));
    cmd('stop', L('Остановить всё', 'Stop everything'), () => this.send({ lorescape: 'stop' }));
    for (let i = 1; i <= 9; i++) cmd('scene-' + i, L(`Сцена №${i} из списка`, `Scene #${i} of the list`), () => { const s = this.catalog.scenes[i - 1]; s ? this.send({ lorescape: 'scene', name: s.name }) : new Notice(L('QuestSound: нет сцены №', 'QuestSound: no scene #') + i); });

    for (const lang of ['lorescape', 'questsound']) this.registerMarkdownCodeBlockProcessor(lang, (src, el) => {
      el.addClass('lorescape-buttons');
      const items = src.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
      for (const line of items) {
        const p = parseLine(line);
        if (!p) { el.createDiv({ text: L('⚠ Не понял строку: ', '⚠ Could not read the line: ') + line, cls: 'lorescape-bad' }); continue; }
        const b = el.createEl('button', { text: p.icon + ' ' + p.label, cls: 'lorescape-btn lorescape-' + p.cmd.lorescape });
        b.addEventListener('click', async () => { b.addClass('is-busy'); await this.send(p.cmd); b.removeClass('is-busy'); });
      }
    });
    this.addSettingTab(new QuestSoundSettings(this.app, this));
    // notes with a "questsound" property switch the sound when they are opened
    this.registerEvent(this.app.workspace.on('file-open', file => { if (this.settings.noteSound) this.playNote(file, false); }));
  }

  // The "questsound" property (or the older "lorescape") of a note: one line ("сцена: Таверна"), a list of lines, or YAML pairs
  // (- погода: Дождь). A bare name is a scene. Opening the same note again does nothing.
  noteLines(file) {
    const fm = file && this.app.metadataCache.getFileCache(file)?.frontmatter;
    const raw = fm?.questsound ?? fm?.lorescape;
    if (raw == null || raw === '') return [];
    return (Array.isArray(raw) ? raw : [raw]).flatMap(x => x && typeof x === 'object' ? Object.entries(x).map(([k, v]) => k + (v == null ? '' : ': ' + v)) : String(x).split(/\n|;/))
      .map(l => l.trim()).filter(Boolean);
  }
  async playNote(file, manual) {
    if (!file) return;
    if (!manual && file.path === this.lastNote) return;
    this.lastNote = file.path;
    const lines = this.noteLines(file);
    if (!lines.length) { if (manual) new Notice(L('QuestSound: у заметки нет свойства «questsound»', 'QuestSound: the note has no “questsound” property')); return; }
    for (const line of lines) {
      const p = parseLine(line) || (!line.includes(':') && parseLine('scene: ' + line));
      if (p) await this.send(p.cmd); else new Notice(L('QuestSound: не понял ', 'QuestSound: could not read ') + line);
    }
  }

  onunload() { this.detach(); }

  origin() { try { return new URL(this.settings.url).origin; } catch { return '*'; } }
  frameUrl() { const url = this.settings.moveFrom || this.settings.url; try { const u = new URL(url); u.searchParams.set('lang', LANG); return u.href; } catch { return url; } }
  // every page the frame loads is greeted: after a move the first one is the old address's moving page
  attach(frame) {
    this.frame = frame;
    let ok; this.ready = new Promise(r => ok = r);
    frame.addEventListener('load', async () => {
      const hi = await this.request({ lorescape: 'hello' }, 8000).catch(() => null);
      if (hi && this.settings.moveFrom) { delete this.settings.moveFrom; await this.saveData(this.settings); }
      ok();
    });
  }
  detach() { this.frame = null; this.ready = null; }
  onMessage(e) {
    if (!this.frame || e.source !== this.frame.contentWindow || e.origin !== this.origin()) return;
    const d = e.data || {};
    if (d.lorescape === 'catalog') Object.assign(this.catalog, d);
    if (d.id && this.pending.has(d.id)) { this.pending.get(d.id)(d); this.pending.delete(d.id); }
  }
  request(cmd, timeout = 5000) {
    const id = Math.random().toString(36).slice(2);
    return new Promise((ok, fail) => {
      this.pending.set(id, ok);
      setTimeout(() => { if (this.pending.delete(id)) fail(new Error(L('QuestSound не ответил', 'QuestSound did not respond'))); }, timeout);
      this.frame.contentWindow.postMessage({ ...cmd, id }, this.origin());
    });
  }
  // Commands work even when the panel is closed: it opens in the side bar (without stealing focus) first.
  async send(cmd) {
    try {
      if (!this.frame) await this.openView(false);
      await this.ready;
      const r = await this.request(cmd);
      if (r.error) new Notice('QuestSound: ' + r.error);
      return r;
    } catch (e) { new Notice('QuestSound: ' + e.message); }
  }
  async pick(list, placeholder, fn) {
    if (!this.frame) { await this.openView(false); await this.ready; }
    const items = this.catalog[list] || [];
    if (!items.length) return new Notice(L('QuestSound: список пуст', 'QuestSound: the list is empty') + (list === 'scenes' ? L(' — сохраните сцены в панели QuestSound', ' — save scenes in the QuestSound panel') : ''));
    new Pick(this.app, items, placeholder, fn).open();
  }
  async openView(focus) {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf(true); await leaf.setViewState({ type: VIEW, active: focus }); }
    if (focus) this.app.workspace.revealLeaf(leaf);
    return leaf;
  }
};

class QuestSoundSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const el = this.containerEl; el.empty();
    const store = () => this.plugin.saveData(this.plugin.settings);
    new Setting(el).setName(L('Адрес сервера QuestSound', 'QuestSound server address')).setDesc(L('Где открыт QuestSound. После изменения закройте и снова откройте панель.', 'Where QuestSound runs. After a change, close and reopen the panel.'))
      .addText(t => t.setPlaceholder(DEFAULTS.url).setValue(this.plugin.settings.url).onChange(async v => { this.plugin.settings.url = v.trim() || DEFAULTS.url; await store(); }));
    new Setting(el).setName(L('Язык', 'Language')).setDesc(L('Язык плагина и панели. Меняется после перезапуска Obsidian.', 'Language of the plugin and the panel. Takes effect after Obsidian restarts.'))
      .addDropdown(d => d.addOptions({ auto: L('Как в Obsidian', 'Same as Obsidian'), ru: 'Русский', en: 'English' }).setValue(this.plugin.settings.lang).onChange(async v => { this.plugin.settings.lang = v; await store(); }));
    new Setting(el).setName(L('Звук заметок', 'Note sound'))
      .setDesc(L('Открыли заметку со свойством questsound — звук переключается сам (пример ниже).', 'Opening a note with a questsound property switches the sound by itself (example below).'))
      .addToggle(t => t.setValue(this.plugin.settings.noteSound).onChange(async v => { this.plugin.settings.noteSound = v; await store(); }));
    new Setting(el).setName(L('Кнопки в заметках', 'Buttons in notes')).setHeading();
    el.createEl('pre', { text: L('```questsound\nсцена: Таверна\nокружение: Лес | Входим в чащу\nмузыка: эпос 0.9\nмузыка: жуть бой\nнабор: Дарк фэнтези\nбой: выкл\nзвук: Удар мечей\nпогода: Дождь\nстоп\n```',
      '```questsound\nscene: Tavern\nenv: Forest | Into the woods\nmood: epic 0.9\nmood: dread fight\nset: Dark fantasy\nfight: off\nsfx: Sword clash\nweather: Rain\nstop\n```') });
    new Setting(el).setName(L('Звук заметки', 'Note sound')).setHeading();
    el.createEl('pre', { text: L('---\nquestsound:\n  - сцена: Таверна\n  - погода: Дождь\n---', '---\nquestsound:\n  - scene: Tavern\n  - weather: Rain\n---') });
    el.createEl('p', { text: L('Каждая строка — кнопка. После «|» можно задать свою подпись. Музыка: зона круга (радость, эпос, грусть, напряжение, жуть, мистика, магия, юмор, нейтрально), сила от 0 до 1 и слово «бой» для боевой музыки. «Набор» переключает набор треков круга. Названия можно писать по-русски или по-английски.',
      'Each line is a button. Add your own caption after “|”. Mood: a wheel zone (joy, epic, sorrow, tension, dread, mystery, magic, humour, neutral), a strength from 0 to 1 and the word “fight” for combat music. “set” switches the wheel’s track set. Names work in English or Russian.') });
  }
}
