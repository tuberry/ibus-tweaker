// vim:fdm=syntax
// by tuberry
/* exported init */
'use strict';

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const BoxPointer = imports.ui.boxpointer;
const IBusPopup = imports.ui.ibusCandidatePopup;
const IBusManager = imports.misc.ibusManager.getIBusManager();
const InputScMgr = imports.ui.status.keyboard.getInputSourceManager();
const { Shell, Clutter, Gio, GLib, Meta, IBus, Pango, St, GObject } = imports.gi;

const LightProxy = Main.panel.statusArea.aggregateMenu._nightLight._proxy;
const CandidatePopup = IBusManager._candidatePopup;
const CandidateArea = CandidatePopup._candidateArea;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Fields = Me.imports.fields.Fields;
const _ = ExtensionUtils.gettext;
const noop = () => {};
let [gsettings, ngsettings, tgsettings] = Array(3).fill(null);
let ClipTable = [];

const ASCIIs = ['en', 'A', '英'];
const Unknown = { ON: 0, OFF: 1, DEFAULT: 2 };
const Style = { AUTO: 0, LIGHT: 1, DARK: 2, SYSTEM: 3 };
const Indices = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const TEXTCMD = 'pypinyin -s FIRST_LETTER -- %s'; // python-pinyin for Chinese search
const compact = (s, d = [[/\n|\r/g, '\u21b5'], ['\t', '\u21e5']]) => d.length ? compact(s.replaceAll(...d.pop()), d) : s;
const shrink = (t, m = 35) => t.length > m ? '%s\u2026%s'.format(t.substring(0, m >> 1), t.substring(t.length - (m >> 1), t.length)) : t;
const promiseTo = p => p.then(scc => { return [scc]; }).catch(err => { return [undefined, err]; });
const genParam = (type, name, ...dflt) => GObject.ParamSpec[type](name, name, name, GObject.ParamFlags.READWRITE, ...dflt);

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async');

async function processText(text) {
    let [haystack] = await promiseTo(execute(TEXTCMD.format(GLib.shell_quote(text))));

    return [text, compact(shrink(text)), (haystack || text).replace(/[^A-Za-z]/g, '').toLowerCase()];
}

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
            child: { style_class: 'candidate-page-button-icon' },
        },
        _nextButton: {
            style_class: 'candidate-page-button candidate-page-button-next button',
            child: { style_class: 'candidate-page-button-icon' },
        },
    },
    bin: {
        child: { style_class: 'candidate-popup-content' },
    },
    _preeditText: { style_class: 'candidate-popup-text' },
    _auxText: { style_class: 'candidate-popup-text' },
};

class IBusAutoSwitch extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: {
                unknown:  genParam('uint', 'unknown', 0, 2, 2),
                shortcut: genParam('boolean', 'shortcut', false),
            },
        }, this);
    }

    constructor() {
        super();
        this._bindSettings();
        global.display.connectObject('notify::focus-window', this._onWindowChanged.bind(this), this);
        Main.overview.connectObject('hidden', this._onWindowChanged.bind(this), 'showing', this._onWindowChanged.bind(this), this);
    }

    get _state() {
        return ASCIIs.includes(Main.panel.statusArea.keyboard._indicatorLabels[InputScMgr.currentSource.index].get_text());
    }

    get _toggle() {
        let win = InputScMgr._getCurrentWindow();
        if(!win) return false;

        let state = this._state;
        let store = this._states.get(this._tmp_win);
        if(state !== store) this._states.set(this._tmp_win, state);

        this._tmp_win = win.wm_class ? win.wm_class.toLowerCase() : '';
        if(!this._states.has(this._tmp_win)) {
            let unknown = this.unknown === Unknown.DEFAULT ? state : this.unknown === Unknown.ON;
            this._states.set(this._tmp_win, unknown);
        }

        return state ^ this._states.get(this._tmp_win);
    }

    set shortcut(shortcut) {
        this._shortId && Main.wm.removeKeybinding(Fields.RUNSHORTCUT);
        this._shortId = shortcut && Main.wm.addKeybinding(Fields.RUNSHORTCUT, gsettings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => {
            if(!this._state) IBusManager.activateProperty('InputMode', IBus.PropState.CHECKED);
            Main.openRunDialog();
        });
    }

    _onWindowChanged() {
        if(this._toggle && IBusManager._panelService) IBusManager.activateProperty('InputMode', IBus.PropState.CHECKED);
    }

    _bindSettings() {
        [[Fields.UNKNOWNMODE, 'unknown'], [Fields.ENABLEDIALOG, 'shortcut']]
            .forEach(([x, y, z]) => gsettings.bind(x, this, y, z ?? Gio.SettingsBindFlags.GET));
        this._states = new Map(Object.entries(gsettings.get_value(Fields.INPUTLIST).deep_unpack()));
    }

    destroy() {
        this.shortcut = null;
        global.display.disconnectObject(this);
        Main.overview.disconnectObject(this);
        gsettings.set_value(Fields.INPUTLIST, new GLib.Variant('a{sb}', Object.fromEntries(this._states)));
    }
}

class IBusFontSetting extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: {
                fontname: genParam('string', 'fontname', 'Sans 16'),
            },
        }, this);
    }

    constructor() {
        super();
        gsettings.bind(Fields.CUSTOMFONT, this, 'fontname', Gio.SettingsBindFlags.GET);
    }

    set fontname(fontname) {
        let scale = 13 / 16; // the fonts-size difference between index and candidate
        let desc = Pango.FontDescription.from_string(fontname);
        let getWeight = () => { try { return desc.get_weight(); } catch(e) { return parseInt(e.message); } }; // workaround for Pango.Weight enumeration exception (eg: 290)
        CandidatePopup.set_style('font-weight: %d; font-family: "%s"; font-size: %dpt; font-style: %s;'.format(
            getWeight(),
            desc.get_family(),
            (desc.get_size() / Pango.SCALE) * scale,
            Object.keys(Pango.Style)[desc.get_style()].toLowerCase()
        ));
        CandidateArea._candidateBoxes.forEach(x => {
            x._candidateLabel.set_style('font-size: %dpt;'.format(desc.get_size() / Pango.SCALE));
            x._indexLabel.set_style('padding: %fem 0.25em 0 0;'.format((1 - scale) * 2));
        });
    }

    destroy() {
        CandidatePopup.set_style('');
        CandidateArea._candidateBoxes.forEach(x => {
            x._candidateLabel.set_style('');
            x._indexLabel.set_style('');
        });
    }
}

class IBusOrientation extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: {
                orientation: genParam('uint', 'orientation', 0, 1, 1),
            },
        }, this);
    }

    constructor() {
        super();
        this._originalSetOrientation = CandidateArea.setOrientation.bind(CandidateArea);
        CandidateArea.setOrientation = noop;
        gsettings.bind(Fields.ORIENTATION, this, 'orientation', Gio.SettingsBindFlags.GET);
    }

    set orientation(orientation) {
        this._originalSetOrientation(orientation ? IBus.Orientation.HORIZONTAL : IBus.Orientation.VERTICAL);
    }

    destroy() {
        CandidateArea.setOrientation = this._originalSetOrientation;
    }
}

class IBusPageButton extends GObject.Object {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super();
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

class IBusThemeManager extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: {
                color:  genParam('uint', 'color', 0, 7, 3),
                style:  genParam('uint', 'style', 0, 3, 0),
                night:  genParam('boolean', 'night', false),
                scheme: genParam('string', 'scheme', 'default'),
            },
        }, this);
    }

    constructor() {
        super();
        this._replaceStyle();
        this._bindSettings();
        this._onProxyChanged();
    }

    _bindSettings() {
        tgsettings.bind('color-scheme', this, 'scheme', Gio.SettingsBindFlags.GET);
        ngsettings.bind('night-light-enabled', this, 'night', Gio.SettingsBindFlags.GET);
        [[Fields.MSTHEMESTYLE, 'style'], [Fields.MSTHEMECOLOR, 'color']]
            .forEach(([x, y, z]) => gsettings.bind(x, this, y, z ?? Gio.SettingsBindFlags.GET));
        LightProxy.connectObject('g-properties-changed', this._onProxyChanged.bind(this), this);
    }

    _onProxyChanged() {
        this._light = LightProxy.NightLightActive;
        this._updateStyle();
    }

    set night(night) {
        this._night = night;
        this._updateStyle();
    }

    set scheme(scheme) {
        this._scheme = scheme === 'prefer-dark';
        this._updateStyle();
    }

    set style(style) {
        this._style = style;
        this._updateStyle();
    }

    set color(color) {
        this._color = this._palatte[color];
        this._updateStyle();
    }

    get dark() {
        return (this._style === Style.AUTO && this._night && this._light) ||
            (this._style === Style.SYSTEM && this._scheme) || this._style === Style.DARK;
    }

    setDark(dark) {
        if((this._dark = dark)) {
            CandidatePopup.remove_style_class_name(this._color);
            CandidatePopup.add_style_class_name('night');
            CandidatePopup.add_style_class_name('night-%s'.format(this._color));
        } else {
            CandidatePopup.remove_style_class_name('night');
            CandidatePopup.remove_style_class_name('night-%s'.format(this._color));
            CandidatePopup.add_style_class_name(this._color);
        }
    }

    toggleColor() {
        if(this._dark) {
            if(this._prev_color) CandidatePopup.remove_style_class_name('night-%s'.format(this._prev_color));
            CandidatePopup.add_style_class_name('night-%s'.format(this._color));
        } else {
            if(this._prev_color) CandidatePopup.remove_style_class_name(this._prev_color);
            CandidatePopup.add_style_class_name(this._color);
        }
        this._prev_color = this._color;
    }

    _updateStyle() {
        if(!['_night', '_style', '_color', '_scheme'].every(x => x in this)) return;
        if(this._dark !== this.dark) this.setDark(this.dark);
        if(this._prev_color !== this._color) this.toggleColor();
    }

    _replaceStyle() {
        this._palatte = ['red', 'green', 'orange', 'blue', 'purple', 'turquoise', 'grey'];
        addStyleClass(TempPopup, TempPopup, CandidatePopup, x => x.replace(/candidate/g, 'ibus-tweaker-candidate'));
    }

    _restoreStyle() {
        if(this.style) {
            CandidatePopup.remove_style_class_name('night');
            CandidatePopup.remove_style_class_name('night-%s'.format(this._color));
        } else {
            CandidatePopup.remove_style_class_name(this._color);
        }
        addStyleClass(TempPopup, TempPopup, CandidatePopup);
    }

    destroy() {
        this._restoreStyle();
        LightProxy.disconnectObject(this);
    }
}

class UpdatesIndicator extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: {
                updatescmd: genParam('string', 'updatescmd', 'checkupdates'),
                updatesdir: genParam('string', 'updatesdir', '/var/lib/pacman/local'),
            },
        }, this);
    }

    constructor() {
        super();
        this._bindSettings();
        this._addIndicator();
        this._checkUpdates();
        this._checkUpdatesId = setInterval(this._checkUpdates.bind(this), 60 * 60 * 1000);
    }

    _bindSettings() {
        [[Fields.UPDATESDIR, 'updatesdir'], [Fields.CHECKUPDATES, 'updatescmd']]
            .forEach(([x, y, z]) => gsettings.bind(x, this, y, z ?? Gio.SettingsBindFlags.GET));
    }

    _checkUpdates() {
        execute(this.updatescmd)
            .then(scc => { this._showUpdates(scc ? scc.split(/\r\n|\r|\n/).length : 0); })
            .catch(() => { this._showUpdates(0); });
    }

    _showUpdates(count) {
        this._checkUpdated();
        if(count) {
            let dir = Gio.File.new_for_path(this.updatesdir);
            this._fileMonitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._fileMonitor.connect('changed', () => {
                clearTimeout(this._fileMonitorId);
                this._fileMonitorId = setTimeout(this._checkUpdates.bind(this), 10 * 1000);
            });
            this._button.label.set_text(count.toString());
            this._button.show();
        } else {
            this._button.hide();
        }
    }

    _addIndicator() {
        this._button = new PanelMenu.Button(0, 'Updates Indicator', true);
        let box = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        let icon = new St.Icon({ y_expand: false, style_class: 'system-status-icon', icon_name: 'software-update-available-symbolic' });
        this._button.label = new St.Label({ y_expand: false, y_align: Clutter.ActorAlign.CENTER });
        box.add_child(icon);
        box.add_child(this._button.label);
        this._button.add_actor(box);
        Main.panel.addToStatusArea(Me.metadata.name, this._button, 5, 'center');
        this._button.hide();
    }

    _checkUpdated() {
        this._fileMonitor?.cancel();
        this._fileMonitor = null;
    }

    destroy() {
        clearTimeout(this._fileMonitorId);
        clearInterval(this._checkUpdatesId);
        this._checkUpdated();
        this._button.destroy();
        this._button = null;
    }
}

class IBusClipPad extends Clutter.Actor {
    static {
        GObject.registerClass({
            Signals: {
                clip_pad_pressed: { param_types: [GObject.TYPE_UINT] },
            },
        }, this);
    }

    constructor() {
        super({ reactive: true });
        this.set_size(...global.display.get_size());
        Main.layoutManager.addChrome(this);
        Main.pushModal(this, { actionMode: Shell.ActionMode.NORMAL });
    }

    vfunc_key_press_event(event) {
        this.emit('clip-pad-pressed', event.keyval);
        return Clutter.EVET_STOP;
    }

    destroy() {
        if(Main._findModal(this) !== -1) Main.popModal(this);
        super.destroy();
    }
}

class IBusClipPopup extends BoxPointer.BoxPointer {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super(St.Side.TOP);
        this.visible = false;
        this.style_class = 'candidate-popup-boxpointer';
        Main.layoutManager.addChrome(this);
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
        this._addStyle();
    }

    _addStyle() {
        addStyleClass(TempPopup, CandidatePopup, this);
        this.set_style(CandidatePopup.get_style());
        let [box] = CandidatePopup._candidateArea._candidateBoxes;
        let i_style = box._indexLabel.get_style();
        let c_style = box._candidateLabel.get_style();
        this._candidateArea._candidateBoxes.forEach(x => {
            x._indexLabel.set_style(i_style);
            x._candidateLabel.set_style(c_style);
        });
        if(!gsettings.get_boolean(Fields.PAGEBUTTON)) return;
        this._candidateArea._buttonBox.set_style('border-width: 0;');
        this._candidateArea._nextButton.hide();
        this._candidateArea._previousButton.hide();
    }

    set preedit(text) {
        this._preeditText.set_text('%s%s'.format(_('Clipboard: '), text));
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
    }
}

class IBusClipHistory extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: {
                page_size: genParam('uint', 'page_size', 4, 10, 5),
                shortcut:  genParam('boolean', 'shortcut', false),
            },
        }, this);
    }

    constructor() {
        super();
        gsettings.bind(Fields.CLIPPAGESIZE, this, 'page_size', Gio.SettingsBindFlags.GET);
        Main.overview.connectObject('showing',  this.dispel.bind(this), this);
        global.display.get_selection().connectObject('owner-changed', this.onClipboardChanged.bind(this), this);
        this.shortcut = true;
    }

    set shortcut(shortcut) {
        this._shortId && Main.wm.removeKeybinding(Fields.CLIPHISTCUT);
        this._shortId = shortcut && Main.wm.addKeybinding(Fields.CLIPHISTCUT, gsettings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, this.showLookupTable.bind(this));
    }

    onClipboardChanged(_sel, type, _src) {
        if(type !== St.ClipboardType.CLIPBOARD) return;
        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, async (_clip, text) => {
            if(!text) return;
            let index = ClipTable.findIndex(x => x[0] === text);
            if(index < 0) {
                ClipTable.unshift(await processText(text).catch(noop));
                while(ClipTable.length > 64) ClipTable.pop();
            } else if(index > 0) {
                [ClipTable[0], ClipTable[index]] = [ClipTable[index], ClipTable[0]];
            }
        });
    }

    summon() {
        if(!this._pad) {
            this._pad = new IBusClipPad();
            this._pad.connectObject('clip-pad-pressed', this.processKeyEvent.bind(this),
                'button-press-event', this.dispel.bind(this), this);
        }
        if(!this._ptr) {
            this._ptr = new IBusClipPopup();
            this._ptr._area.connectObject('cursor-up', () => { this.offset = -1; },
                'cursor-down', () => { this.offset = 1; },
                'next-page', () => { this.offset = this.page_size; },
                'candidate-clicked', this.candidateClicked.bind(this),
                'previous-page', () => { this.offset = -this.page_size; }, this);
        }
    }

    set offset(offset) {
        let pos = this._cursor + offset;
        if(pos >= 0 && pos < this._lookup.length) {
            this.cursor = pos;
        } else if(pos >= this._lookup.length) {
            let expection = (this._page + 1) * this.page_size;
            if(this._lookup.length > expection) this.cursor = expection;
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
        this.summon();
        this._preedit = '';
        this._lookup = [...ClipTable];
        this.cursor = 0;
        this._ptr._show();
    }

    candidateClicked(_area, index, _button, _state) {
        this.dispel();
        this.commitAt(index);
    }

    commitAt(index) {
        let [text] = this._lookup[this._start + index] || [undefined];
        if(!text) return;
        if(Meta.is_wayland_compositor()) {
            clearTimeout(this._delayId);
            this._delayId = setTimeout(() => { IBusManager._panelService?.commit_text(IBus.Text.new_from_string(text)); }, 30);
        } else {
            IBusManager._panelService?.commit_text(IBus.Text.new_from_string(text));
        }
    }

    processKeyEvent(_actor, keyval) {
        switch(keyval) {
        case Clutter.KEY_Up: this.offset = -1; break;
        case Clutter.KEY_Down: this.offset = 1; break;
        case Clutter.KEY_Left:
        case Clutter.KEY_Page_Up: this.offset = -this.page_size; break;
        case Clutter.KEY_Right:
        case Clutter.KEY_Page_Down: this.offset = this.page_size; break;
        case Clutter.KEY_space:
        case Clutter.KEY_Return: this.candidateClicked(null, this._cursor - this._start, 1, 0); break;
        case Clutter.KEY_Delete: this.deleteCurrent(); break;
        case Clutter.KEY_backslash: this.mergeCurrent(); break;
        case Clutter.KEY_BackSpace: this.preedit = this._preedit.slice(0, -1); break;
        default:
            if(keyval < 33 || keyval > 126) this.dispel();
            else if(keyval > 47 && keyval < 58) this.selectAt(keyval);
            else this.preedit = this._preedit + String.fromCharCode(keyval); break;
        }
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
        let [clip] = ClipTable.splice(index, 1);
        let hays = ClipTable[index][2] + clip[2];
        let text = '%s %s'.format(ClipTable[index][0], clip[0]);
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
        if(this._pad) this._pad.destroy(), this._pad = null;
        if(this._ptr) this._ptr.destroy(), this._ptr = null;
    }

    destroy() {
        this.dispel();
        this.shortcut = null;
        Main.overview.disconnectObject(this);
        global.display.get_selection().disconnectObject(this);
        if(Meta.is_wayland_compositor()) clearTimeout(this._delayId);
    }
}

const IBUS_TWEAKS = {
    font:   IBusFontSetting,
    pgbtn:  IBusPageButton,
    input:  IBusAutoSwitch,
    orien:  IBusOrientation,
    theme:  IBusThemeManager,
    update: UpdatesIndicator,
    clip:   IBusClipHistory,
};

class Extensions extends GObject.Object {
    static {
        GObject.registerClass({
            Properties: {
                clip:   genParam('boolean', 'clip', false),
                font:   genParam('boolean', 'font', false),
                input:  genParam('boolean', 'input', false),
                orien:  genParam('boolean', 'orien', false),
                pgbtn:  genParam('boolean', 'pgbtn', false),
                theme:  genParam('boolean', 'theme', false),
                update: genParam('boolean', 'update', false),
            },
        }, this);
    }

    constructor() {
        super();
        this._tweaks = new Map();
        this._bindSettings();
    }

    _bindSettings() {
        [
            [Fields.PAGEBUTTON,    'pgbtn'],
            [Fields.ENABLEORIEN,   'orien'],
            [Fields.AUTOSWITCH,    'input'],
            [Fields.USECUSTOMFONT, 'font'],
            [Fields.ENABLEMSTHEME, 'theme'],
            [Fields.ENABLEUPDATES, 'update'],
            [Fields.ENABLECLIP,    'clip'],
        ].forEach(([x, y, z]) => gsettings.bind(x, this, y, z ?? Gio.SettingsBindFlags.GET));
    }

    set clip(clip) {
        this.tweaks = { clip };
    }

    set pgbtn(pgbtn) {
        this.tweaks = { pgbtn };
    }

    set input(input) {
        this.tweaks = { input };
    }

    set font(font) {
        this.tweaks = { font };
    }

    set orien(orien) {
        this.tweaks = { orien };
    }

    set theme(theme) {
        this.tweaks = { theme };
    }

    set update(update) {
        this.tweaks = { update };
    }

    set tweaks(tweaks) {
        let [prop, enable] = Object.entries(tweaks)[0];
        if(enable) {
            if(this._tweaks.get(prop)) return;
            this._tweaks.set(prop, new IBUS_TWEAKS[prop]());
        } else {
            if(!this._tweaks.get(prop)) return;
            this._tweaks.get(prop).destroy();
            this._tweaks.delete(prop);
        }
    }

    destroy() {
        for(let x in IBUS_TWEAKS) this[x] = false;
    }
}

class Extension {
    static {
        ExtensionUtils.initTranslations();
    }

    enable() {
        tgsettings = new Gio.Settings({ schema: 'org.gnome.desktop.interface' });
        ngsettings = new Gio.Settings({ schema: 'org.gnome.settings-daemon.plugins.color' });
        gsettings = ExtensionUtils.getSettings();
        this._ext = new Extensions();
    }

    disable() {
        this._ext.destroy();
        gsettings = ngsettings = tgsettings = this._ext = null;
    }
}

function init() {
    return new Extension();
}

