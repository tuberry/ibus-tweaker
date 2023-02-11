// vim:fdm=syntax
// by tuberry
/* exported init */
'use strict';

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const BoxPointer = imports.ui.boxpointer;
const { RunDialog } = imports.ui.runDialog;
const IBusPopup = imports.ui.ibusCandidatePopup;
const IBusManager = imports.misc.ibusManager.getIBusManager();
const InputManager = imports.ui.status.keyboard.getInputSourceManager();
const { Shell, Clutter, Gio, GLib, Meta, IBus, Pango, St, GObject } = imports.gi;

const LightProxy = Main.panel.statusArea.quickSettings._nightLight._proxy;
const CandidatePopup = IBusManager._candidatePopup;
const CandidateArea = CandidatePopup._candidateArea;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { Fields, Field } = Me.imports.fields;
const Initial = Me.imports.initial;
const _ = ExtensionUtils.gettext;

const ClipTable = [];
const Style = { AUTO: 0, LIGHT: 1, DARK: 2, SYSTEM: 3 };
const Indices = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const noop = () => {};
const compact = (s, d = [[/\n|\r/g, '\u21b5'], ['\t', '\u21e5']]) => d.length ? compact(s.replaceAll(...d.pop()), d) : s;
const shrink = (t, m = 45) => t.length > m ? `${t.substring(0, m >> 1)}\u2026${t.substring(t.length - (m >> 1), t.length)}` : t;

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

async function execute(cmd) {
    let proc = new Gio.Subprocess({
        argv: GLib.shell_parse_argv(cmd)[1],
        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });
    proc.init(null);
    let [stdout, stderr] = await proc.communicate_utf8_async(null, null);
    if(proc.get_exit_status()) throw new Error(stderr.trim());
    return stdout.trim();
}

function fuzzySearch(needle, haystack) {
    // Ref: https://github.com/bevacqua/fuzzysearch
    if(needle.length > haystack.length) return false;
    if(needle.length === haystack.length) return needle === haystack;
    outer: for(let i = 0, j = 0; i < needle.length; i++) {
        while(j < haystack.length) if(haystack[j++] === needle[i]) continue outer;
        return false;
    }
    return true;
}

function addStyleClass(tmp, src, aim, cb) {
    for(let p in tmp) {
        if(!(p in aim)) continue;
        if(typeof tmp[p] === 'object') {
            if(Array.isArray(tmp[p])) tmp[p].forEach((x, i) => addStyleClass(x, src[p][i], aim[p][i], cb));
            else addStyleClass(tmp[p], src[p], aim[p], cb);
        } else {
            aim.remove_style_class_name(aim[p]);
            aim.add_style_class_name(cb ? cb(src[p]) : src[p]);
        }
    }
}

const TempPopup = {
    style_class: 'candidate-popup-boxpointer',
    _candidateArea: {
        _candidateBoxes: Array(16).fill({
            style_class: 'candidate-box',
            _indexLabel: { style_class: 'candidate-index' },
            _candidateLabel: { style_class: 'candidate-label' },
        }),
        _buttonBox: { style_class: 'candidate-page-button-box' },
        _previousButton: {
            style_class: 'candidate-page-button candidate-page-button-previous button',
        },
        _nextButton: {
            style_class: 'candidate-page-button candidate-page-button-next button',
        },
    },
    bin: {
        child: { style_class: 'candidate-popup-content' },
    },
    _preeditText: { style_class: 'candidate-popup-text' },
    _auxText: { style_class: 'candidate-popup-text' },
};

class IBusAutoSwitch {
    constructor(field) {
        this._bindSettings(field);
        global.display.connectObject('notify::focus-window', () => this.toggleMode(), this);
        Main.overview.connectObject('hidden', () => this.setEmpty(), 'shown', () => this.setEmpty('#overview'), this); // ?? conflict other connects
    }

    _bindSettings(field) {
        this._field = field;
        this._field.attach({
            modes:    [Fields.INPUTMODES, 'value'],
            shortcut: [Fields.ENABLEDIALOG, 'boolean'],
        }, this);
        this._modes = new Map(Object.entries(this.modes.recursiveUnpack()));
    }

    getInputMode(ps) {
        if(!ps) return '';
        for(let p, i = 0; (p = ps.get(i)); i++) {
            if(!p.key.startsWith('InputMode')) continue;
            switch(p.prop_type) {
            case IBus.PropType.NORMAL: // ibus-libpinyin
                return p.symbol?.get_text() ?? p.label.get_text();
            case IBus.PropType.TOGGLE: // ibus-hangul
                return p.state.toString();
            case IBus.PropType.MENU: // ibus-typing-booster
                return this.getInputMode(p.sub_props);
            case IBus.PropType.RADIO: // ibus-typing-booster
                if(p.state) return p.key.split('.').at(-1); break;
            }
        }
    }

    setInputMode(ps, m) {
        if(!ps) return;
        for(let p, i = 0; (p = ps.get(i)); i++) {
            if(!p.key.startsWith('InputMode')) continue;
            switch(p.prop_type) {
            case IBus.PropType.NORMAL:
            case IBus.PropType.TOGGLE:
                return this.activateProp(p.key, !p.state);
            case IBus.PropType.MENU:
                return this.setInputMode(p.sub_props, m);
            case IBus.PropType.RADIO:
                if(p.key.endsWith(m)) return this.activateProp(p.key, !p.state); break;
            }
        }
    }

    activateProp(key, state) {
        // FIXME: not working on Wayland since https://gitlab.gnome.org/GNOME/gnome-shell/-/issues/6062
        // setTimeout(() => IBusManager.activateProperty(key, state ? 1 : 0), 50);
        IBusManager.activateProperty(key, state ? 1 : 0);
    }

    setEmpty(empty) {
        this._empty = empty;
        this.toggleMode();
    }

    checkMode(win, id, mode) {
        if(!this._modes.has(win)) this._modes.set(win, [id, mode]);
        [this._id, this._mode] = this._modes.get(win);
        return this._id !== id || this._mode !== mode;
    }

    toggleMode() {
        let { id, properties } = InputManager.currentSource;
        let mode = this.getInputMode(properties);
        if(this.checkMode(this._win, id, mode)) this._modes.set(this._win, [id, mode]);
        let win = this._empty || global.display.focus_window?.wm_class?.toLowerCase();
        if(win && this.checkMode(this._win = win, id, mode) && this._id === id) this.setInputMode(properties, this._mode);
    }

    set shortcut(shortcut) {
        if(this._shortcut === shortcut) return;
        if((this._shortcut = shortcut)) {
            if(!Main.runDialog) Main.runDialog = new RunDialog();
            Main.runDialog.connectObject('notify::visible', () => this.setEmpty(Main.runDialog?.visible && '#run-dialog'), this);
            Main.wm.addKeybinding(Fields.RUNSHORTCUT, this._field.gset, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => Main.openRunDialog());
        } else {
            Main.runDialog?.disconnectObject(this);
            Main.wm.removeKeybinding(Fields.RUNSHORTCUT);
        }
    }

    destroy() {
        this.shortcut = null;
        this._field.detach(this);
        Main.overview.disconnectObject(this);
        global.display.disconnectObject(this);
        this.setf('modes', new GLib.Variant('a{s(ss)}', Object.fromEntries(this._modes)));
    }
}

class IBusFontSetting {
    constructor(field) {
        this._field = field.attach({ fontname: [Fields.CUSTOMFONT, 'string'] }, this);
    }

    set fontname(fontname) {
        let scale = 13 / 16,
            desc = Pango.FontDescription.from_string(fontname),
            getWeight = () => { try { return desc.get_weight(); } catch(e) { return parseInt(e.message); } }; // workaround for Pango.Weight enumeration exception (eg: 290)
        CandidatePopup.set_style(`font-weight: ${getWeight()};
                                 font-family: "${desc.get_family()}";
                                 font-size: ${(desc.get_size() / Pango.SCALE) * scale}pt;
                                 font-style: ${Object.keys(Pango.Style)[desc.get_style()].toLowerCase()};`
        );
        CandidateArea._candidateBoxes.forEach(x => {
            x._candidateLabel.set_style(`font-size: ${desc.get_size() / Pango.SCALE}pt;`);
            x._indexLabel.set_style(`padding: ${(1 - scale) * 2}em 0.25em 0 0;`);
        });
    }

    destroy() {
        this._field.detach(this);
        CandidatePopup.set_style('');
        CandidateArea._candidateBoxes.forEach(x => {
            x._candidateLabel.set_style('');
            x._indexLabel.set_style('');
        });
    }
}

class IBusOrientation {
    constructor(field) {
        this._originalSetOrientation = CandidateArea.setOrientation.bind(CandidateArea);
        CandidateArea.setOrientation = noop;
        this._field = field.attach({ orientation: [Fields.ORIENTATION, 'uint'] }, this);
    }

    set orientation(orientation) {
        this._originalSetOrientation(orientation ? IBus.Orientation.HORIZONTAL : IBus.Orientation.VERTICAL);
    }

    destroy() {
        this._field.detach(this);
        CandidateArea.setOrientation = this._originalSetOrientation;
    }
}

class IBusPageButton {
    constructor() {
        CandidateArea._buttonBox.set_style('border-width: 0;');
        CandidateArea._previousButton.hide();
        CandidateArea._nextButton.hide();
    }

    destroy() {
        CandidateArea._buttonBox.set_style('');
        CandidateArea._previousButton.show();
        CandidateArea._nextButton.show();
    }
}

class IBusThemeManager {
    constructor(field) {
        this._replaceStyle();
        this._bindSettings(field);
        this._syncNightLight();
    }

    _bindSettings(field) {
        this._tfield = new Field({
            scheme: ['color-scheme', 'string', x => x === 'prefer-dark'],
        }, 'org.gnome.desktop.interface', this, 'murkey');
        this._field = field.attach({
            color: [Fields.MSTHEMECOLOR, 'uint', x => this._palette[x]],
            style: [Fields.MSTHEMESTYLE, 'uint'],
        }, this, 'murkey');
        LightProxy.connectObject('g-properties-changed', (_l, p) => p.lookup_value('NightLightActive', null) && this._syncNightLight(), this);
    }

    _syncNightLight() {
        if(LightProxy.NightLightActive === null) return;
        this.murkey = ['night_light', LightProxy.NightLightActive];
    }

    set murkey([k, v, out]) {
        this[k] = out ? out(v) : v;
        this.dark = (this.style === Style.AUTO && this.night_light) ||
            (this.style === Style.SYSTEM && this.scheme) || this.style === Style.DARK;
        this._updateStyle();
    }

    toggleDark() {
        if((this._dark = this.dark)) {
            CandidatePopup.remove_style_class_name(this.color);
            CandidatePopup.add_style_class_name('night');
            CandidatePopup.add_style_class_name(`night-${this.color}`);
        } else {
            CandidatePopup.remove_style_class_name('night');
            CandidatePopup.remove_style_class_name(`night-${this.color}`);
            CandidatePopup.add_style_class_name(this.color);
        }
    }

    changeColor() {
        if(this._dark) {
            if(this._color) CandidatePopup.remove_style_class_name(`night-${this._color}`);
            CandidatePopup.add_style_class_name(`night-${this.color}`);
        } else {
            if(this._color) CandidatePopup.remove_style_class_name(this._color);
            CandidatePopup.add_style_class_name(this.color);
        }
        this._color = this.color;
    }

    _updateStyle() {
        if(!('night_light' in this)) return;
        if(this._dark !== this.dark) this.toggleDark();
        if(this._color !== this.color) this.changeColor();
    }

    _replaceStyle() {
        this._palette = ['red', 'green', 'orange', 'blue', 'purple', 'turquoise', 'grey'];
        addStyleClass(TempPopup, TempPopup, CandidatePopup, x => x.replace(/candidate/g, 'ibus-tweaker-candidate'));
    }

    _restoreStyle() {
        if(this.style) {
            CandidatePopup.remove_style_class_name('night');
            CandidatePopup.remove_style_class_name(`night-${this.color}`);
        } else {
            CandidatePopup.remove_style_class_name(this.color);
        }
        addStyleClass(TempPopup, TempPopup, CandidatePopup);
    }

    destroy() {
        ['_field', '_tfield'].forEach(x => this[x].detach(this));
        LightProxy.disconnectObject(this);
        this._restoreStyle();
    }
}

class UpdatesIndicator {
    constructor(field) {
        this._bindSettings(field);
        this._addIndicator();
        this._checkUpdates();
        this._checkUpdatesId = setInterval(() => this._checkUpdates(), 60 * 60 * 1000);
    }

    _bindSettings(field) {
        this._field = field.attach({
            updatesdir: [Fields.UPDATESDIR,   'string'],
            updatescmd: [Fields.CHECKUPDATES, 'string'],
        }, this);
    }

    _checkUpdates() {
        execute(this.updatescmd)
            .then(scc => this._showUpdates(scc ? scc.split(/\r\n|\r|\n/).length : 0))
            .catch(() => this._showUpdates(0));
    }

    _showUpdates(count) {
        this._checkUpdated();
        if(count) {
            let dir = Gio.File.new_for_path(this.updatesdir);
            this._fileMonitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._fileMonitor.connect('changed', (_o, _s, _t, e) => {
                if(e !== Gio.FileMonitorEvent.CHANGES_DONE_HINT) return;
                clearTimeout(this._fileMonitorId);
                this._fileMonitorId = setTimeout(() => this._checkUpdates(), 10 * 1000);
            });
            this._button.label.set_text(count.toString());
            this._button.show();
        } else {
            this._button.hide();
        }
    }

    _addIndicator() {
        this._button = new PanelMenu.Button(0, Me.metadata.uuid, true);
        this._button.reactive = false;
        let box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        let icon = new St.Icon({ y_expand: false, style_class: 'system-status-icon', icon_name: 'software-update-available-symbolic' });
        this._button.label = new St.Label({ y_expand: false, y_align: Clutter.ActorAlign.CENTER });
        box.add_child(icon);
        box.add_child(this._button.label);
        this._button.add_actor(box);
        Main.panel.addToStatusArea(Me.metadata.uuid, this._button, 5, 'center');
        this._button.hide();
    }

    _checkUpdated() {
        this._fileMonitor?.cancel();
        this._fileMonitor = null;
    }

    destroy() {
        this._field.detach(this);
        clearTimeout(this._fileMonitorId);
        clearInterval(this._checkUpdatesId);
        this._checkUpdated();
        this._button.destroy();
        this._button = null;
    }
}

class IBusClipPopup extends BoxPointer.BoxPointer {
    static {
        GObject.registerClass(this);
    }

    constructor(page_btn) {
        super(St.Side.TOP);
        this.visible = false;
        this.reactive = true;
        this.style_class = 'candidate-popup-boxpointer';
        this._buildWidgets(page_btn);
        Main.layoutManager.addChrome(this);
        global.focus_manager.add_group(this);
        global.stage.set_key_focus(this);
    }

    _buildWidgets(page_btn) {
        let box = new St.BoxLayout({ style_class: 'candidate-popup-content', vertical: true });
        let hbox = new St.BoxLayout();
        this._preeditText = new St.Label({ style_class: 'candidate-popup-text', visible: true, x_expand: true });
        this._auxText = new St.Label({ style_class: 'candidate-popup-text', visible: true });
        [this._preeditText, this._auxText].forEach(x => hbox.add(x));
        box.add(hbox);
        this._candidateArea = new IBusPopup.CandidateArea();
        this._candidateArea.setOrientation(IBus.Orientation.VERTICAL);
        box.add(this._candidateArea);
        this.bin.set_child(box);
        this._replaceStyle(page_btn);
    }

    _replaceStyle(page_btn) {
        addStyleClass(TempPopup, CandidatePopup, this);
        this.set_style(CandidatePopup.get_style());
        let [box] = CandidatePopup._candidateArea._candidateBoxes,
            i_style = box._indexLabel.get_style(),
            c_style = box._candidateLabel.get_style();
        this._candidateArea._candidateBoxes.forEach(x => {
            x._indexLabel.set_style(i_style);
            x._candidateLabel.set_style(c_style);
        });
        if(!page_btn) return;
        this._candidateArea._buttonBox.set_style('border-width: 0;');
        this._candidateArea._nextButton.hide();
        this._candidateArea._previousButton.hide();
    }

    set preedit(text) {
        this._preeditText.set_text(`${_('📋：')}${text}`);
    }

    set aux(numb) {
        this._auxText.set_text(_('%dC').format(numb ?? 0));
    }

    get _area() {
        return this._candidateArea;
    }

    _show() {
        this._candidateArea.visible = true;
        this.setPosition(CandidatePopup._dummyCursor, 0);
        this.open(BoxPointer.PopupAnimation.NONE);
        this.get_parent().set_child_above_sibling(this, null);
        this._grab = Main.pushModal(this, { actionMode: Shell.ActionMode.POPUP });
    }

    destroy() {
        Main.popModal(this._grab);
        this._grab = null;
        super.destroy();
    }
}

class IBusClipHistory {
    constructor(field) {
        this._field = field;
        this._field.attach({
            page_size: [Fields.CLIPPAGESIZE, 'uint'],
            page_btn:  [Fields.PAGEBUTTON, 'boolean'],
        }, this);
        global.display.get_selection().connectObject('owner-changed', this.onClipboardChanged.bind(this), this);
        this.shortcut = true;
    }

    set shortcut(shortcut) {
        this._shortId && Main.wm.removeKeybinding(Fields.CLIPHISTCUT);
        this._shortId = shortcut && Main.wm.addKeybinding(Fields.CLIPHISTCUT, this._field.gset, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => this.showLookupTable());
    }

    summon() {
        if(this._ptr) return;
        this._ptr = new IBusClipPopup(this.page_btn);
        this._ptr.connectObject('captured-event', this.onCapturedEvent.bind(this), this);
        this._ptr._area.connectObject('cursor-up', () => (this.offset = -1),
            'cursor-down', () => (this.offset = 1),
            'next-page', () => (this.offset = this.page_size),
            'candidate-clicked', this.candidateClicked.bind(this),
            'previous-page', () => (this.offset = -this.page_size), this);
    }

    onClipboardChanged(_sel, type, _src) {
        if(type !== St.ClipboardType.CLIPBOARD) return;
        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_clip, text) => {
            if(!text) return;
            let index = ClipTable.findIndex(([x]) => x === text);
            if(index < 0) {
                ClipTable.unshift([text, compact(shrink(text)), Initial.s2pyi(text.toLowerCase())]);
                while(ClipTable.length > 64) ClipTable.pop();
            } else if(index > 0) {
                [ClipTable[0], ClipTable[index]] = [ClipTable[index], ClipTable[0]];
            }
        });
    }

    onCapturedEvent(actor, event) {
        if(event.type() === Clutter.EventType.KEY_PRESS) {
            let keyval = event.get_key_symbol();
            switch(keyval) {
            case Clutter.KEY_Up:        this.offset = -1; break;
            case Clutter.KEY_Down:      this.offset = 1; break;
            case Clutter.KEY_Left:
            case Clutter.KEY_Page_Up:   this.offset = -this.page_size; break;
            case Clutter.KEY_Right:
            case Clutter.KEY_Page_Down: this.offset = this.page_size; break;
            case Clutter.KEY_space:
            case Clutter.KEY_Return:    this.candidateClicked(null, this._cursor - this._start, 1, 0); break;
            case Clutter.KEY_Delete:    this.deleteCurrent(); break;
            case Clutter.KEY_backslash: this.mergeCurrent(); break;
            case Clutter.KEY_BackSpace: this.preedit = this._preedit.slice(0, -1); break;
            default:
                if(keyval < 33 || keyval > 126) this.dispel();
                else if(keyval > 47 && keyval < 58) this.selectAt(keyval);
                else this.preedit = this._preedit + String.fromCharCode(keyval); break;
            }
            return Clutter.EVENT_STOP;
        } else if((event.type() === Clutter.EventType.BUTTON_PRESS || event.type() === Clutter.EventType.TOUCH_BEGIN) &&
                  !actor.contains(global.stage.get_event_actor(event))) {
            this.dispel();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    set offset(offset) {
        let pos = this._cursor + offset;
        if(pos >= 0 && pos < this._lookup.length) {
            this.cursor = pos;
        } else if(pos >= this._lookup.length) {
            let expectation = (this._page + 1) * this.page_size;
            if(this._lookup.length > expectation) this.cursor = expectation;
        }
    }

    set cursor(cursor) {
        this._cursor = cursor;
        this.updateLookupTable();
    }

    updateLookupTable() {
        this._page = Math.floor(this._cursor / this.page_size);
        this._start = this._page * this.page_size;
        this._size = Math.min(this.page_size, this._lookup.length - this._start);
        let indices = this._size ? Indices.slice(0, this._size) : ['\u2205'];
        let candidates = this._size ? this._lookup.slice(this._start, this._start + this._size).map(x => x[1]) : [_('Empty history.')];
        this._ptr._area.setCandidates(indices, candidates, this._cursor % this.page_size, this._size);
        this._ptr._area.updateButtons(false, this._page, Math.ceil(this._lookup.length / this.page_size));
        this._ptr.aux = this._lookup[this._cursor]?.[0].length;
        this._ptr.preedit = this._preedit;
    }

    showLookupTable() {
        if(!IBusManager._ready) return;
        this.summon();
        this._preedit = '';
        this._lookup = [...ClipTable];
        this.cursor = 0;
        this._ptr._show();
    }

    candidateClicked(_area, index) {
        this.dispel();
        this.commitAt(index);
    }

    commitAt(index) {
        let [text] = this._lookup[this._start + index] || [undefined];
        if(!text) return;
        clearTimeout(this._delayId);
        this._delayId = setTimeout(() => IBusManager._panelService?.commit_text(IBus.Text.new_from_string(text)), 30);
    }

    deleteCurrent() {
        let index = ClipTable.findIndex(x => x[0] === this._lookup[this._cursor][0]);
        if(index === -1) return;
        ClipTable.splice(index, 1);
        this._lookup.splice(this._cursor, 1);
        this.cursor = this._cursor >= this._lookup.length ? Math.max(this._lookup.length - 1, 0) : this._cursor;
    }

    mergeCurrent() {
        let index = ClipTable.findIndex(x => x[0] === this._lookup[this._cursor][0]);
        if(index === -1 || index >= this._lookup.length - 1) return;
        this._lookup.splice(this._cursor, 1);
        let [clip] = ClipTable.splice(index, 1),
            hays = ClipTable[index][2] + clip[2],
            text = `${ClipTable[index][0]} ${clip[0]}`;
        this._lookup[this._cursor] = ClipTable[index] = [text, compact(shrink(text)), hays];
        this.cursor = this._cursor;
    }

    selectAt(code) {
        let index = Indices.findIndex(x => x === String.fromCharCode(code));
        index >= 0 && index < this._size ? this.candidateClicked(null, index, 1, 0) : this.dispel();
    }

    set preedit(preedit) {
        if(this._preedit === preedit) return;
        this._preedit = preedit;
        this._lookup = ClipTable.filter(x => fuzzySearch(this._preedit, x[2]));
        this.cursor = 0;
    }

    dispel() {
        if(this._ptr) this._ptr.destroy(), this._ptr = null;
    }

    destroy() {
        this._field.detach(this);
        this.dispel();
        this.shortcut = null;
        clearTimeout(this._delayId);
        global.display.get_selection().disconnectObject(this);
    }
}
class Extensions {
    constructor() {
        this._tweaks = {};
        this._bindSettings();
    }

    _bindSettings() {
        this._field = new Field({}, ExtensionUtils.getSettings(), this, 'props');
        this._field.attach({
            clip:   [Fields.ENABLECLIP,    'boolean', IBusClipHistory],
            font:   [Fields.USECUSTOMFONT, 'boolean', IBusFontSetting],
            input:  [Fields.AUTOSWITCH,    'boolean', IBusAutoSwitch],
            orien:  [Fields.ENABLEORIEN,   'boolean', IBusOrientation],
            pgbtn:  [Fields.PAGEBUTTON,    'boolean', IBusPageButton],
            theme:  [Fields.ENABLEMSTHEME, 'boolean', IBusThemeManager],
            update: [Fields.ENABLEUPDATES, 'boolean', UpdatesIndicator],
        }, this, 'props');
    }

    set props([k, v, out]) {
        if(v) {
            this._tweaks[k] ??= new out(this._field);
        } else {
            this._tweaks[k]?.destroy();
            this._tweaks[k] = null;
        }
    }

    destroy() {
        this._field.detach(this);
        for(let x in this._tweaks) this.props = [x, false, null];
    }
}

class Extension {
    constructor() {
        ExtensionUtils.initTranslations();
    }

    enable() {
        this._ext = new Extensions();
    }

    disable() {
        this._ext.destroy();
        this._ext = null;
    }
}

function init() {
    return new Extension();
}
