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

const CandidatePopup = IBusManager._candidatePopup;
const CandidateArea = CandidatePopup._candidateArea;
const ExtensionUtils = imports.misc.extensionUtils;
const _ = ExtensionUtils.gettext;
const gsettings = ExtensionUtils.getSettings();
const Me = ExtensionUtils.getCurrentExtension();
const Fields = Me.imports.fields.Fields;

const System = {
    LIGHT:       'night-light-enabled',
    PROPERTY:    'g-properties-changed',
    BUS_NAME:    'org.gnome.SettingsDaemon.Color',
    OBJECT_PATH: '/org/gnome/SettingsDaemon/Color',
};
const { loadInterfaceXML } = imports.misc.fileUtils;
const ColorInterface = loadInterfaceXML(System.BUS_NAME);
const ColorProxy = Gio.DBusProxy.makeProxyWrapper(ColorInterface);
const ngsettings = new Gio.Settings({ schema: 'org.gnome.settings-daemon.plugins.color' });

let ClipTable = [];
const MAX_LEN = 35;
const INPUTMODE = 'InputMode';
const ASCIIMODES = ['en', 'A', '英'];
const STYLE = { 'AUTO': 0, 'LIGHT': 1, 'DARK': 2 };
const UNKNOWN = { 'ON': 0, 'OFF': 1, 'DEFAULT': 2 };
const INDICES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const TEXTCMD = 'pypinyin -s FIRST_LETTER -- %s'; // python-pinyin for Chinese search
const compact = x => x.replace(/\r|\n/g, '\u21b5');
const shrink = (t, m = MAX_LEN) => t.length > m ? '%s\u2026%s'.format(t.substring(0, m >> 1), t.substring(t.length - (m >> 1), t.length)) : t;
const prune = t => t.length > MAX_LEN ? '%s \u2140%d%s'.format(compact(shrink(t)), t.length, _('C')) : compact(t);
const promiseTo = promise => promise.then(scc => { return [scc]; }).catch(err => { return [undefined, err]; });

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

async function processText(text) {
    let [haystack] = await promiseTo(execute(TEXTCMD.format(GLib.shell_quote(text))));

    return [text, prune(text), (haystack || text).replace(/[^A-Za-z]/g, '').toLowerCase()];
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
        if(aim[p] === undefined) break;
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

const IBusAutoSwitch = GObject.registerClass({
    Properties: {
        'unknown':  GObject.ParamSpec.uint('unknown', 'unknown', 'unknown', GObject.ParamFlags.READWRITE, 0, 2, 2),
        'shortcut': GObject.ParamSpec.boolean('shortcut', 'shortcut', 'shortcut', GObject.ParamFlags.WRITABLE, false),
    },
}, class IBusAutoSwitch extends GObject.Object {
    _init() {
        super._init();
        this._bindSettings();
        this._overviewHiddenId = Main.overview.connect('hidden', this._onWindowChanged.bind(this));
        this._overviewShowingId = Main.overview.connect('showing', this._onWindowChanged.bind(this));
        this._onWindowChangedId = global.display.connect('notify::focus-window', this._onWindowChanged.bind(this));
    }

    get _state() {
        return ASCIIMODES.includes(Main.panel.statusArea.keyboard._indicatorLabels[InputScMgr.currentSource.index].get_text());
    }

    get _toggle() {
        let win = InputScMgr._getCurrentWindow();
        if(!win) return false;

        let state = this._state;
        let store = this._states.get(this._tmpWindow);
        if(state !== store) this._states.set(this._tmpWindow, state);

        this._tmpWindow = win.wm_class ? win.wm_class.toLowerCase() : '';
        if(!this._states.has(this._tmpWindow)) {
            let unknown = this.unknown === UNKNOWN.DEFAULT ? state : this.unknown === UNKNOWN.ON;
            this._states.set(this._tmpWindow, unknown);
        }

        return state ^ this._states.get(this._tmpWindow);
    }

    set shortcut(shortcut) {
        if(this._shortId) Main.wm.removeKeybinding(Fields.RUNSHORTCUT);
        this._shortId = shortcut ? Main.wm.addKeybinding(Fields.RUNSHORTCUT, gsettings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => {
            if(!this._state) IBusManager.activateProperty(INPUTMODE, IBus.PropState.CHECKED);
            Main.openRunDialog();
        }) : undefined;
    }

    _onWindowChanged() {
        if(this._toggle && IBusManager._panelService) IBusManager.activateProperty(INPUTMODE, IBus.PropState.CHECKED);
    }

    _bindSettings() {
        gsettings.bind(Fields.UNKNOWNMODE, this, 'unknown', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.ENABLEDIALOG, this, 'shortcut', Gio.SettingsBindFlags.GET);
        this._states = new Map(Object.entries(gsettings.get_value(Fields.INPUTLIST).deep_unpack()));
    }

    destroy() {
        this.shortcut = false;
        gsettings.set_value(Fields.INPUTLIST, new GLib.Variant('a{sb}', Object.fromEntries(this._states)));
        if(this._onWindowChangedId) global.display.disconnect(this._onWindowChangedId), delete this._onWindowChangedId;
        if(this._overviewShowingId) Main.overview.disconnect(this._overviewShowingId), delete this._overviewShowingId;
        if(this._overviewHiddenId) Main.overview.disconnect(this._overviewHiddenId), delete this._overviewHiddenId;
    }
});

const IBusFontSetting = GObject.registerClass({
    Properties: {
        'fontname': GObject.ParamSpec.string('fontname', 'fontname', 'font name', GObject.ParamFlags.WRITABLE, 'Sans 16'),
    },
}, class IBusFontSetting extends GObject.Object {
    _init() {
        super._init();
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
});

const IBusOrientation = GObject.registerClass({
    Properties: {
        'orientation': GObject.ParamSpec.uint('orientation', 'orientation', 'orientation', GObject.ParamFlags.WRITABLE, 0, 1, 1),
    },
}, class IBusOrientation extends GObject.Object {
    _init() {
        super._init();
        this._originalSetOrientation = CandidateArea.setOrientation.bind(CandidateArea);
        CandidateArea.setOrientation = () => {};
        gsettings.bind(Fields.ORIENTATION, this, 'orientation', Gio.SettingsBindFlags.GET);
    }

    set orientation(orientation) {
        this._originalSetOrientation(orientation ? IBus.Orientation.HORIZONTAL : IBus.Orientation.VERTICAL);
    }

    destroy() {
        CandidateArea.setOrientation = this._originalSetOrientation;
    }
});

const IBusPageButton = GObject.registerClass(
class IBusPageButton extends GObject.Object {
    _init() {
        super._init();
        CandidateArea._buttonBox.set_style('border-width: 0;');
        CandidateArea._previousButton.hide();
        CandidateArea._nextButton.hide();
    }

    destroy() {
        CandidateArea._previousButton.show();
        CandidateArea._nextButton.show();
        CandidateArea._buttonBox.set_style('');
    }
});

const IBusThemeManager = GObject.registerClass({
    Properties: {
        'night': GObject.ParamSpec.boolean('night', 'night', 'night', GObject.ParamFlags.READWRITE, false),
        'style': GObject.ParamSpec.uint('style', 'style', 'style', GObject.ParamFlags.WRITABLE, 0, 2, 0),
        'color': GObject.ParamSpec.uint('color', 'color', 'color', GObject.ParamFlags.WRITABLE, 0, 7, 3),
    },
}, class IBusThemeManager extends GObject.Object {
    _init() {
        super._init();
        this._replaceStyle();
        this._bindSettings();
        this._buildWidgets();
    }

    _bindSettings() {
        ngsettings.bind(System.LIGHT,       this, 'night', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.MSTHEMESTYLE, this, 'style', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.MSTHEMECOLOR, this, 'color', Gio.SettingsBindFlags.GET);
    }

    _buildWidgets() {
        this._proxy = new ColorProxy(Gio.DBus.session, System.BUS_NAME, System.OBJECT_PATH, (proxy, error) => {
            if(error) return;
            this._onProxyChanged();
            this._proxy.connect(System.PROPERTY, this._onProxyChanged.bind(this));
        });
    }

    _onProxyChanged() {
        this._light = this._proxy.NightLightActive;
        this._updateStyle();
    }

    set night(night) {
        this._night = night;
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
        return this._style === STYLE.AUTO ? this._night && this._light : this._style === STYLE.DARK;
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
            if(this._prevColor) CandidatePopup.remove_style_class_name('night-%s'.format(this._prevColor));
            CandidatePopup.add_style_class_name('night-%s'.format(this._color));
        } else {
            if(this._prevColor) CandidatePopup.remove_style_class_name(this._prevColor);
            CandidatePopup.add_style_class_name(this._color);
        }
        this._prevColor = this._color;
    }

    _updateStyle() {
        if([this._night, this._style, this._color].some(x => x === undefined)) return;
        if(this._dark !== this.dark) this.setDark(this.dark);
        if(this._prevColor !== this._color) this.toggleColor();
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
        delete this._proxy;
    }
});

const UpdatesIndicator = GObject.registerClass({
    Properties: {
        'updatescmd': GObject.ParamSpec.string('updatescmd', 'updatescmd', 'updates cmd', GObject.ParamFlags.READWRITE, 'checkupdates'),
        'updatesdir': GObject.ParamSpec.string('updatesdir', 'updatesdir', 'updates dir', GObject.ParamFlags.READWRITE, '/var/lib/pacman/local'),
    },
}, class UpdatesIndicator extends GObject.Object {
    _init() {
        super._init();
        this._bindSettings();
        this._addIndicator();
        this._checkUpdates();
        this._checkUpdatesId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3600, this._checkUpdates.bind(this));
    }

    _bindSettings() {
        gsettings.bind(Fields.UPDATESDIR,   this, 'updatesdir', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.CHECKUPDATES, this, 'updatescmd', Gio.SettingsBindFlags.GET);
    }

    _checkUpdates() {
        execute(this.updatescmd)
            .then(scc => { this._showUpdates(scc ? scc.split(/\r\n|\r|\n/).length : 0); })
            .catch(() => { this._showUpdates(0); });

        return GLib.SOURCE_CONTINUE;
    }

    _showUpdates(count) {
        this._checkUpdated();
        if(!this._button) return;
        if(count) {
            let dir = Gio.File.new_for_path(this.updatesdir);
            this._fileMonitor = dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._fileChangedId = this._fileMonitor.connect('changed', () => {
                GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
                    this._checkUpdates();
                    return GLib.SOURCE_REMOVE;
                });
            });
            this._button.label.set_text(count.toString());
            this._button.show();
        } else {
            this._button.hide();
        }
    }

    _addIndicator() {
        if(Main.panel.statusArea[Me.metadata.uuid]) return;
        this._button = new PanelMenu.Button(0, 'Updates Indicator', true);
        let box = new St.BoxLayout({
            vertical: false,
            style_class: 'panel-status-menu-box',
        });
        let icon = new St.Icon({
            y_expand: false,
            style_class: 'system-status-icon',
            icon_name: 'software-update-available-symbolic',
        });
        this._button.label = new St.Label({
            y_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(icon);
        box.add_child(this._button.label);
        this._button.add_actor(box);
        Main.panel.addToStatusArea(Me.metadata.name, this._button, 5, 'center');
        this._button.hide();
    }

    _checkUpdated() {
        if(!this._fileMonitor) return;
        if(this._fileChangedId) this._fileMonitor.disconnect(this._fileChangedId), delete this._fileChangedId;
        delete this._fileMonitor;
    }

    destroy() {
        if(this._checkUpdatesId) GLib.source_remove(this._checkUpdatesId), delete this._checkUpdatesId;
        this._checkUpdated();
        this._button.destroy();
        delete this._button;
    }
});

const IBusClipPad = GObject.registerClass({
    Signals: {
        'clip-pad-pressed': { param_types: [GObject.TYPE_UINT] },
    },
}, class IBusClipPad extends Clutter.Actor {
    _init() {
        super._init({ reactive: true });
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
});

const IBusClipPopup = GObject.registerClass(
class IBusClipPopup extends BoxPointer.BoxPointer {
    _init() {
        super._init(St.Side.TOP);
        this.visible = false;
        this.style_class = 'candidate-popup-boxpointer';
        Main.layoutManager.addChrome(this);
        let box = new St.BoxLayout({ style_class: 'candidate-popup-content', vertical: true });
        this.bin.set_child(box);
        this._preeditText = new St.Label({ style_class: 'candidate-popup-text', visible: true });
        box.add(this._preeditText);
        this._candidateArea = new IBusPopup.CandidateArea();
        this._candidateArea.setOrientation(IBus.Orientation.VERTICAL);
        box.add(this._candidateArea);
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

    get _area() {
        return this._candidateArea;
    }

    _show() {
        this._candidateArea.visible = true;
        this.setPosition(CandidatePopup._dummyCursor, 0);
        this.open(BoxPointer.PopupAnimation.NONE);
        this.get_parent().set_child_above_sibling(this, null);
    }
});

const IBusClipHistory = GObject.registerClass({
    Properties: {
        'shortcut':  GObject.ParamSpec.boolean('shortcut', 'shortcut', 'shortcut', GObject.ParamFlags.WRITABLE, false),
        'page-size': GObject.ParamSpec.uint('page-size', 'page-size', 'page-size', GObject.ParamFlags.READWRITE, 4, 10, 5),
    },
}, class IBusClipHistory extends GObject.Object {
    _init() {
        super._init();
        this.shortcut = true;
        gsettings.bind(Fields.CLIPPAGESIZE, this, 'page-size', Gio.SettingsBindFlags.GET);
        this._viewId = Main.overview.connect('showing', () => { this.dispel(); });
        this._clipId = global.display.get_selection().connect('owner-changed', this.clipboard_changed.bind(this));
        if(!ClipTable.length) this.clipboard_changed(null, St.ClipboardType.CLIPBOARD);
    }

    set shortcut(shortcut) {
        if(this._shortId) Main.wm.removeKeybinding(Fields.CLIPHISTCUT);
        this._shortId = shortcut ? Main.wm.addKeybinding(Fields.CLIPHISTCUT, gsettings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, this.show_lookup_table.bind(this)) : undefined;
    }

    clipboard_changed(_sel, type, _src) {
        if(type !== St.ClipboardType.CLIPBOARD) return;
        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, async (_clip, _text) => {
            let text = _text && _text.trim();
            if(!text) return;
            let index = ClipTable.findIndex(x => x[0] === text);
            if(index < 0) {
                ClipTable.unshift(await processText(text));
                while(ClipTable.length > 64) ClipTable.pop();
            } else if(index > 0) {
                [ClipTable[0], ClipTable[index]] = [ClipTable[index], ClipTable[0]];
            }
        });
    }

    summon() {
        if(!this._pad) {
            this._pad = new IBusClipPad();
            this._pad.connect('clip-pad-pressed', this.process_key_event.bind(this));
            this._pad.connect('button-press-event', this.dispel.bind(this));
        }
        if(!this._ptr) {
            this._ptr = new IBusClipPopup();
            this._ptr._area.connect('cursor-up', () => { this.cursor = -1; });
            this._ptr._area.connect('cursor-down', () => { this.cursor = 1; });
            this._ptr._area.connect('next-page', () => { this.cursor = this.page_size; });
            this._ptr._area.connect('candidate-clicked', this.candidate_clicked.bind(this));
            this._ptr._area.connect('previous-page', () => { this.cursor = -this.page_size; });
        }
    }

    set cursor(offset) {
        let cursor, pos = this._cursor + offset;
        if(pos >= 0 && pos < this._lookup.length) {
            cursor = pos;
        } else if(pos >= this._lookup.length) {
            let expection = (this._page + 1) * this.page_size;
            if(this._lookup.length > expection) cursor = expection;
        }
        if(cursor === undefined) return;
        this._cursor = cursor;
        this.update_lookup_table();
    }

    update_lookup_table() {
        this._page = Math.floor(this._cursor / this.page_size);
        this._start = this._page * this.page_size;
        this._size = Math.min(this.page_size, this._lookup.length - this._start);
        let indices = this._size ? INDICES.slice(0, this._size) : ['\u2205'];
        let candidates = this._size ? this._lookup.slice(this._start, this._start + this._size).map(x => x[1]) : [_('Empty history.')];
        this._ptr._area.setCandidates(indices, candidates, this._cursor % this.page_size, this._size);
        this._ptr._area.updateButtons(false, this._page, Math.ceil(this._lookup.length / this.page_size));
        this._ptr.preedit = this._preedit;
    }

    show_lookup_table() {
        this.summon();
        this._cursor = 0;
        this._preedit = '';
        this._lookup = [...ClipTable];
        this.update_lookup_table();
        this._ptr._show();
    }

    candidate_clicked(_area, index, _button, _state) {
        this.dispel();
        if(Meta.is_wayland_compositor()) GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => { this.commit_at(index); return GLib.SOURCE_REMOVE; });
        else this.commit_at(index);
    }

    commit_at(index) {
        let [text] = this._lookup[this._start + index] || [undefined];
        if(IBusManager._panelService && text) IBusManager._panelService.commit_text(IBus.Text.new_from_string(text));
    }

    process_key_event(_actor, keyval) {
        switch(keyval) {
        case Clutter.KEY_Up:
            this.cursor = -1; break;
        case Clutter.KEY_Down:
            this.cursor = 1; break;
        case Clutter.KEY_Left:
        case Clutter.KEY_Page_Up:
            this.cursor = -this.page_size; break;
        case Clutter.KEY_Right:
        case Clutter.KEY_Page_Down:
            this.cursor = this.page_size; break;
        case Clutter.KEY_space:
        case Clutter.KEY_Return:
            this.candidate_clicked(null, this._cursor - this._start, 1, 0); break;
        case Clutter.KEY_Delete:
            this.delete_current(); break;
        case Clutter.KEY_backslash:
            this.merge_current(); break;
        case Clutter.KEY_BackSpace:
            this.preedit = this._preedit.slice(0, -1); break;
        default:
            if(keyval < 33 || keyval > 126) this.dispel();
            else if(keyval > 47 && keyval < 58) this.select_at(keyval);
            else this.preedit = this._preedit + String.fromCharCode(keyval); break;
        }
    }

    delete_current() {
        let index = ClipTable.findIndex(x => x[0] === this._lookup[this._cursor][0]);
        if(index === -1) return;
        ClipTable.splice(index, 1);
        this._lookup.splice(this._cursor, 1);
        if(this._cursor >= this._lookup.length) this._cursor = Math.max(this._lookup.length - 1, 0);
        this.update_lookup_table();
    }

    merge_current() {
        let index = ClipTable.findIndex(x => x[0] === this._lookup[this._cursor][0]);
        if(index === -1 || index >= this._lookup.length - 1) return;
        this._lookup.splice(this._cursor, 1);
        let [clip] = ClipTable.splice(index, 1);
        let hays = ClipTable[index][2] + clip[2];
        let text = '%s %s'.format(ClipTable[index][0], clip[0]);
        this._lookup[this._cursor] = ClipTable[index] = [text, prune(text), hays];
        this.update_lookup_table();
    }

    select_at(code) {
        let index = INDICES.findIndex(x => x === String.fromCharCode(code));
        index >= 0 && index < this._size ? this.candidate_clicked(null, index, 1, 0) : this.dispel();
    }

    set preedit(preedit) {
        if(this._preedit === preedit) return;
        this._cursor = 0;
        this._preedit = preedit;
        this._lookup = ClipTable.filter(x => fuzzySearch(this._preedit, x[2]));
        this.update_lookup_table();
    }

    dispel() {
        if(this._pad) this._pad.destroy(), delete this._pad;
        if(this._ptr) this._ptr.destroy(), delete this._ptr;
    }

    destroy() {
        this.dispel();
        this.shortcut = false;
        if(this._viewId) Main.overview.disconnect(this._viewId), delete this._viewId;
        if(this._clipId) global.display.get_selection().disconnect(this._clipId), delete this._clipId;
    }
});

const IBUS_TWEAKS = {
    'font':   IBusFontSetting,
    'pgbtn':  IBusPageButton,
    'input':  IBusAutoSwitch,
    'orien':  IBusOrientation,
    'theme':  IBusThemeManager,
    'update': UpdatesIndicator,
    'clip':   IBusClipHistory,
};

const Extensions = GObject.registerClass({
    Properties: {
        'clip':   GObject.ParamSpec.boolean('clip', 'clip', 'clip', GObject.ParamFlags.WRITABLE, false),
        'font':   GObject.ParamSpec.boolean('font', 'font', 'font', GObject.ParamFlags.WRITABLE, false),
        'input':  GObject.ParamSpec.boolean('input', 'input', 'input', GObject.ParamFlags.WRITABLE, false),
        'orien':  GObject.ParamSpec.boolean('orien', 'orien', 'orien', GObject.ParamFlags.WRITABLE, false),
        'pgbtn':  GObject.ParamSpec.boolean('pgbtn', 'pgbtn', 'pgbtn', GObject.ParamFlags.WRITABLE, false),
        'theme':  GObject.ParamSpec.boolean('theme', 'theme', 'theme', GObject.ParamFlags.WRITABLE, false),
        'update': GObject.ParamSpec.boolean('update', 'update', 'update', GObject.ParamFlags.WRITABLE, false),
    },
}, class Extensions extends GObject.Object {
    _init() {
        super._init();
        this._tweaks = new Map();
        this._bindSettings();
    }

    _bindSettings() {
        gsettings.bind(Fields.PAGEBUTTON,    this, 'pgbtn',  Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.ENABLEORIEN,   this, 'orien',  Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.AUTOSWITCH,    this, 'input',  Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.USECUSTOMFONT, this, 'font',   Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.ENABLEMSTHEME, this, 'theme',  Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.ENABLEUPDATES, this, 'update', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.ENABLECLIP,    this, 'clip',   Gio.SettingsBindFlags.GET);
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
});

const Extension = class Extension {
    constructor() {
        ExtensionUtils.initTranslations();
    }

    enable() {
        this._ext = new Extensions();
    }

    disable() {
        this._ext.destroy();
        delete this._ext;
    }
};

function init() {
    return new Extension();
}

