// vim:fdm=syntax
// by:tuberry@github
//
const { Gio, Gtk, GObject } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const _ = imports.gettext.domain(Me.metadata['gettext-domain']).gettext;
const gsettings = ExtensionUtils.getSettings();
const UI = Me.imports.ui;

var Fields = {
    ASCIIMODE:     'ascii-mode',
    SHORTCUT:      'run-dialog',
    CUSTOMFONT:    'custom-font',
    UPDATESDIR:    'updates-dir',
    CHECKUPDATES:  'check-updates',
    ENABLEHOTKEY:  'enable-hotkey',
    INPUTONLIST:   'input-on-list',
    ENABLEUPDATES: 'enable-updates',
    INPUTOFFLIST:  'input-off-list',
    MSTHEMECOLOR:  'ms-theme-color',
    ENABLEMSTHEME: 'enable-ms-theme',
    INPUTLIST:     'input-mode-list',
    MSTHEMESTYLE:  'default-variant',
    USECUSTOMFONT: 'use-custom-font',
    AUTOSWITCH:    'enable-auto-switch',
    ENABLEORIEN:   'enable-orientation',
    UNKNOWNSTATE:  'unkown-ascii-state',
    ORIENTATION:   'candidate-orientation',
};

function buildPrefsWidget() {
    return new IBusTweakerPrefs();
}

function init() {
    ExtensionUtils.initTranslations();
}

const IBusTweakerPrefs = GObject.registerClass(
class IBusTweakerPrefs extends Gtk.ScrolledWindow {
    _init() {
        super._init({
            hscrollbar_policy: Gtk.PolicyType.NEVER,
        });

        this._palatte = [_('Red'), _('Green'), _('Orange'), _('Blue'), _('Purple'), _('Turquoise'), _('Grey')];

        this._bulidUI();
        this._bindValues();
        this.show_all();
    }

    _bulidUI() {
        this._field_custom_font     = new Gtk.FontButton();
        this._field_theme_color     = new UI.Combo(this._palatte);
        this._field_enable_hotkey   = new UI.Check(_('Run dialog'));
        this._field_enable_ms_theme = new UI.Check(_('MS IME theme'));
        this._field_activities      = new UI.Check(_('Hide Activities'));
        this._field_use_custom_font = new UI.Check(_('Use custom font'));
        this._field_run_dialog      = this._shortcutMaker(Fields.SHORTCUT);
        this._field_enable_ascii    = new UI.Check(_('Auto switch ASCII mode'));
        this._field_enable_orien    = new UI.Check(_('Candidates orientation'));
        this._field_orientation     = new UI.Combo([_('Vertical'), _('Horizontal')]);
        this._field_unkown_state    = new UI.Combo([_('On'), _('Off'), _('Default')]);
        this._field_variant         = new UI.Combo([_('Auto'), _('Light'), _('Dark')]);

        let ibus = new UI.ListGrid();
        ibus._add(this._field_enable_hotkey,   this._field_run_dialog);
        ibus._add(this._field_enable_orien,    this._field_orientation);
        ibus._add(this._field_use_custom_font, this._field_custom_font);
        ibus._add(this._field_enable_ascii,    this._field_unkown_state);
        ibus._add(this._field_enable_ms_theme, this._field_variant, this._field_theme_color);

        this.add(new UI.Frame(ibus));
    }

    _bindValues() {
        gsettings.bind(Fields.AUTOSWITCH,    this._field_enable_ascii,    'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.ENABLEHOTKEY,  this._field_enable_hotkey,   'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.ENABLEMSTHEME, this._field_enable_ms_theme, 'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.ENABLEORIEN,   this._field_enable_orien,    'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.MSTHEMECOLOR,  this._field_theme_color,     'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.MSTHEMESTYLE,  this._field_variant,         'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.ORIENTATION,   this._field_orientation,     'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.UNKNOWNSTATE,  this._field_unkown_state,    'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.USECUSTOMFONT, this._field_use_custom_font, 'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.CUSTOMFONT,    this._field_custom_font,     'font',   Gio.SettingsBindFlags.DEFAULT);

        this._field_enable_hotkey.bind_property('active',   this._field_run_dialog,   'sensitive', GObject.BindingFlags.GET);
        this._field_enable_ascii.bind_property('active',    this._field_unkown_state, 'sensitive', GObject.BindingFlags.GET);
        this._field_enable_orien.bind_property('active',    this._field_orientation,  'sensitive', GObject.BindingFlags.GET);
        this._field_use_custom_font.bind_property('active', this._field_custom_font,  'sensitive', GObject.BindingFlags.GET);
        this._field_enable_ms_theme.bind_property('active', this._field_variant,      'sensitive', GObject.BindingFlags.GET);
        this._field_enable_ms_theme.bind_property('active', this._field_theme_color,  'sensitive', GObject.BindingFlags.GET);

        this._field_run_dialog.set_sensitive(this._field_enable_hotkey.active);
        this._field_unkown_state.set_sensitive(this._field_enable_ascii.active);
        this._field_orientation.set_sensitive(this._field_enable_orien.active);
        this._field_custom_font.set_sensitive(this._field_use_custom_font.active);
        this._field_theme_color.set_sensitive(this._field_enable_ms_theme.active);
        this._field_variant.set_sensitive(this._field_enable_ms_theme.active);
    }

    _shortcutMaker(shortcut) {
        let model = new Gtk.ListStore();
        model.set_column_types([GObject.TYPE_INT, GObject.TYPE_INT]);
        let [key, mods] = Gtk.accelerator_parse(gsettings.get_strv(shortcut)[0]);
        model.set(model.insert(0), [0, 1], [mods, key]);
        let tree = new Gtk.TreeView({ model: model, headers_visible: false });
        let acc = new Gtk.CellRendererAccel({ 'editable': true, 'accel-mode': Gtk.CellRendererAccelMode.GTK });
        let column = new Gtk.TreeViewColumn();
        column.pack_start(acc, false);
        column.add_attribute(acc, 'accel-mods', 0);
        column.add_attribute(acc, 'accel-key', 1);
        tree.append_column(column);

        acc.connect('accel-edited', (row, iter, key, mods) => {
            let value = Gtk.accelerator_name(key, mods);
            let [ok, iterator] = model.get_iter_from_string(iter);
            model.set(iterator, [0, 1], [mods, key]);
            if(key) gsettings.set_strv(shortcut, [value]);
        });

        return tree;
    }
});

