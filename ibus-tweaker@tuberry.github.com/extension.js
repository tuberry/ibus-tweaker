// vim:fdm=syntax
// by tuberry
'use strict';

const Main = imports.ui.main;
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu;
const { Shell, Clutter, Gio, GLib, Meta, IBus, Pango, St, GObject } = imports.gi;

const InputSourceManager = imports.ui.status.keyboard.getInputSourceManager();
const IBusManager = imports.misc.ibusManager.getIBusManager();
const CandidatePopup = IBusManager._candidatePopup;
const CandidateArea = CandidatePopup._candidateArea;

const ExtensionUtils = imports.misc.extensionUtils;
const gsettings = ExtensionUtils.getSettings();
const Me = ExtensionUtils.getCurrentExtension();
const Fields = Me.imports.fields.Fields;

const UNKNOWN = { 'ON': 0, 'OFF': 1, 'DEFAULT': 2 };
const STYLE = { 'AUTO': 0, 'LIGHT': 1, 'DARK': 2 };
const ASCIIMODES = ['en', 'A', '英'];
const INPUTMODE = 'InputMode';
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

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

const IBusAutoSwitch = GObject.registerClass({
    Properties: {
        'unknown':  GObject.ParamSpec.uint('unknown', 'unknown', 'unknown', GObject.ParamFlags.READWRITE, 0, 2, 2),
        'shortcut': GObject.ParamSpec.boolean('shortcut', 'shortcut', 'shortcut', GObject.ParamFlags.WRITABLE, false),
    },
}, class IBusAutoSwitch extends GObject.Object {
    _init() {
        super._init();
        this._bindSettings();
        this._overviewHiddenID = Main.overview.connect('hidden', this._onWindowChanged.bind(this));
        this._overviewShowingID = Main.overview.connect('showing', this._onWindowChanged.bind(this));
        this._onWindowChangedID = global.display.connect('notify::focus-window', this._onWindowChanged.bind(this));
    }

    get _state() {
        return ASCIIMODES.includes(Main.panel.statusArea.keyboard._indicatorLabels[InputSourceManager.currentSource.index].get_text());
    }

    get _toggle() {
        let win = InputSourceManager._getCurrentWindow();
        if(!win) return false;

        let state = this._state;
        let store = this._states.get(this._tmpWindow);
        if(state != store)
            this._states.set(this._tmpWindow, state);

        this._tmpWindow = win.wm_class ? win.wm_class.toLowerCase() : '';
        if(!this._states.has(this._tmpWindow)) {
            let unknown = this.unknown == UNKNOWN.DEFAULT ? state : this.unknown == UNKNOWN.ON;
            this._states.set(this._tmpWindow, unknown);
        }

        return state^this._states.get(this._tmpWindow);
    }

    set shortcut(shortcut) {
        if(shortcut) {
            this._shortId = Main.wm.addKeybinding(Fields.SHORTCUT, gsettings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => {
                if(!this._state) IBusManager.activateProperty(INPUTMODE, IBus.PropState.CHECKED);
                Main.openRunDialog();
            });
        } else {
            if(this._shortId !== undefined) Main.wm.removeKeybinding(Fields.SHORTCUT), delete this._shortId;
        }
    }

    _onWindowChanged() {
        if(this._toggle && IBusManager._panelService)
            IBusManager.activateProperty(INPUTMODE, IBus.PropState.CHECKED);
    }

    _bindSettings() {
        gsettings.bind(Fields.UNKNOWNSTATE, this, 'unknown', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.ENABLEHOTKEY, this, 'shortcut', Gio.SettingsBindFlags.GET);
        this._states = new Map(Object.entries(gsettings.get_value(Fields.INPUTLIST).deep_unpack()));
    }

    destroy() {
        this.shortcut = false;
        gsettings.set_value(Fields.INPUTLIST, new GLib.Variant('a{sb}', Object.fromEntries(this._states)));
        if(this._onWindowChangedID)
            global.display.disconnect(this._onWindowChangedID), delete this._onWindowChangedID;
        if(this._overviewShowingID)
            Main.overview.disconnect(this._overviewShowingID), delete this._overviewShowingID;
        if(this._overviewHiddenID)
            Main.overview.disconnect(this._overviewHiddenID), delete this._overviewHiddenID;
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
        let get_weight = () => { try { return desc.get_weight(); } catch(e) { return parseInt(e.message); } }; // hack for Pango.Weight enumeration exception (eg: 290) in some fonts
        CandidatePopup.set_style('font-weight: %d; font-family: "%s"; font-size: %dpt; font-style: %s;'.format(
            get_weight(),
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

    _bindSettings() { // order matters
        ngsettings.bind(System.LIGHT,       this, 'night', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.MSTHEMESTYLE, this, 'style', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.MSTHEMECOLOR, this, 'color', Gio.SettingsBindFlags.GET);
    }

    _buildWidgets() {
        this._proxy = new ColorProxy(Gio.DBus.session, System.BUS_NAME, System.OBJECT_PATH, (proxy, error) => {
            if(!error) {
                this._onProxyChanged();
                this._proxy.connect(System.PROPERTY, this._onProxyChanged.bind(this));
            }
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
        return this._style == STYLE.AUTO ? this._night && this._light : this._style == STYLE.DARK;
    }

    setDark(dark) {
        if(this._dark = dark) {
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

    set pgbutton(page) {
        if(page) {
            CandidateArea._previousButton.show();
            CandidateArea._nextButton.show();
        } else {
            CandidateArea._previousButton.hide();
            CandidateArea._nextButton.hide();
        }
    }

    _addStyleClass(src, aim, func) {
        for(let p in src) {
            if(typeof(src[p]) === 'object') {
                if(src[p] instanceof Array) {
                    src[p].forEach((x,i) => this._addStyleClass(x, aim[p][i], func));
                } else {
                    this._addStyleClass(src[p], aim[p], func);
                }
            } else {
                aim.remove_style_class_name(aim[p]);
                aim.add_style_class_name(func(src[p]));
            }
        }
    }

    _replaceStyle() {
        this._popup = {
            style_class: 'candidate-popup-boxpointer',
            _candidateArea: {
                _candidateBoxes: Array(16).fill({
                    style_class: 'candidate-box',
                    _indexLabel: { style_class: 'candidate-index' },
                    _candidateLabel: { style_class: 'candidate-label' }
                }),
                _buttonBox: { style_class: 'candidate-page-button-box' },
                // _previousButton: {
                //     style_class: 'candidate-page-button candidate-page-button-previous button',
                //     child: { style_class: 'candidate-page-button-icon' }
                // },
                // _nextButton: {
                //     style_class: 'candidate-page-button candidate-page-button-next button',
                //     child: { style_class: 'candidate-page-button-icon' }
                // }
            },
            bin: {
                child: { style_class: 'candidate-popup-content' }
            },
            _preeditText: { style_class: 'candidate-popup-text' },
            _auxText: { style_class: 'candidate-popup-text' }
        }
        this._palatte = ['red', 'green', 'orange', 'blue', 'purple', 'turquoise', 'grey'];
        this._addStyleClass(this._popup, CandidatePopup,  x => x.replace(/candidate/g, 'ibus-tweaker-candidate'));
        this.pgbutton = false;
    }

    _restoreStyle() {
        if(this.style) {
            CandidatePopup.remove_style_class_name('night');
            CandidatePopup.remove_style_class_name('night-%s'.format(this._color));
        } else {
            CandidatePopup.remove_style_class_name(this._color);
        }
        this._addStyleClass(this._popup, CandidatePopup, x => x);
        delete this._popup;
        delete this._palatte;
        this.pgbutton = true;
    }

    destroy() {
        this._restoreStyle();
        delete this._proxy;
    }
});

const UpdatesIndicator = GObject.registerClass({
    Properties: {
        'updatescmd': GObject.ParamSpec.string('updatescmd', 'updatescmd', 'updates cmd', GObject.ParamFlags.READWRITE, 'checkupdates | wc -l'),
        'updatesdir': GObject.ParamSpec.string('updatesdir', 'updatesdir', 'updates dir', GObject.ParamFlags.READWRITE, '/var/lib/pacman/local'),
    },
}, class UpdatesIndicator extends GObject.Object{
    _init() {
        super._init();
        this._bindSettings();
        this._addIndicator();
        this._checkUpdates();
        this._checkUpdatesId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60 * 60, this._checkUpdates.bind(this));
    }

    _bindSettings() {
        gsettings.bind(Fields.UPDATESDIR,   this, 'updatesdir', Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.CHECKUPDATES, this, 'updatescmd', Gio.SettingsBindFlags.GET);
    }

    async _execute(cmd) {
        let proc = new Gio.Subprocess({
            argv: GLib.shell_parse_argv(cmd)[1],
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });
        proc.init(null);
        let [stdout, stderr] = await proc.communicate_utf8_async(null, null);
        if(proc.get_exit_status()) throw new Error(stderr.trim());

        return stdout.trim();
    }

    _checkUpdates() {
        this._execute(this.updatescmd).then(scc => {
            this._showUpdates(scc ? scc.split(/\r\n|\r|\n/).length : 0);
        }).catch(err => {
            this._showUpdates(0);
        });

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
            style_class: 'panel-status-menu-box'
        });
        let icon = new St.Icon({
            y_expand: false,
            style_class: 'system-status-icon',
            icon_name: 'software-update-available-symbolic',
        });
        this._button.label = new St.Label({
            y_expand: false,
            y_align: Clutter.ActorAlign.CENTER
        });
        box.add_child(icon);
        box.add_child(this._button.label);
        this._button.add_actor(box);
        Main.panel.addToStatusArea(Me.metadata.name, this._button, 5, 'center');
        this._button.hide();
    }

    _checkUpdated() {
        if(!this._fileMonitor) return;
        if(this._fileChangedId)
            this._fileMonitor.disconnect(this._fileChangedId), delete this._fileChangedId;
        delete this._fileMonitor;
    }

    destroy() {
        if(this._checkUpdatesId)
            GLib.source_remove(this._checkUpdatesId), delete this._checkUpdatesId;
        this._checkUpdated();
        this._button.destroy();
        delete this._button;
    }
});

const Extensions = GObject.registerClass({
    Properties: {
        'font':   GObject.ParamSpec.boolean('font', 'font', 'font', GObject.ParamFlags.WRITABLE, false),
        'input':  GObject.ParamSpec.boolean('input', 'input', 'input', GObject.ParamFlags.WRITABLE, false),
        'orien':  GObject.ParamSpec.boolean('orien', 'orien', 'orien', GObject.ParamFlags.WRITABLE, false),
        'theme':  GObject.ParamSpec.boolean('theme', 'theme', 'theme', GObject.ParamFlags.WRITABLE, false),
        'update': GObject.ParamSpec.boolean('update', 'update', 'update', GObject.ParamFlags.WRITABLE, false),
    },
}, class Extensions extends GObject.Object{
    _init() {
        super._init();
        this._bindSettings();
    }

    _bindSettings() {
        gsettings.bind(Fields.AUTOSWITCH,    this, 'input',  Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.USECUSTOMFONT, this, 'font',   Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.ENABLEORIEN,   this, 'orien',  Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.ENABLEMSTHEME, this, 'theme',  Gio.SettingsBindFlags.GET);
        gsettings.bind(Fields.ENABLEUPDATES, this, 'update', Gio.SettingsBindFlags.GET);
    }

    set input(input) {
        if(input) {
            if(this._input) return;
            this._input = new IBusAutoSwitch();
        } else {
            if(!this._input) return;
            this._input.destroy();
            delete this._input;
        }
    }

    set font(font) {
        if(font) {
            if(this._font) return;
            this._font = new IBusFontSetting();
        } else {
            if(!this._font) return;
            this._font.destroy();
            delete this._font;
        }
    }

    set orien(orien) {
        if(orien) {
            if(this._orien) return;
            this._orien = new IBusOrientation();
        } else {
            if(!this._orien) return;
            this._orien.destroy();
            delete this._orien;
        }
    }

    set theme(theme) {
        if(theme) {
            if(this._theme) return;
            this._theme = new IBusThemeManager();
        } else {
            if(!this._theme) return;
            this._theme.destroy();
            delete this._theme;
        }
    }

    set update(update) {
        if(update) {
            if(this._update) return;
            this._update = new UpdatesIndicator();
        } else {
            if(!this._update) return;
            this._update.destroy();
            delete this._update;
        }
    }

    destroy() {
        this.font = false;
        this.input = false;
        this.orien = false;
        this.theme = false;
        this.update = false;
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
}

function init() {
    return new Extension();
}

