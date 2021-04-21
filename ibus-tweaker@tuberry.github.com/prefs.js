// vim:fdm=syntax
// by: tuberry@github
'use strict';

const { Gio, Gtk, GObject } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const _ = imports.gettext.domain(Me.metadata['gettext-domain']).gettext;
const gsettings = ExtensionUtils.getSettings();
const Fields = Me.imports.fields.Fields;
const UI = Me.imports.ui;

function buildPrefsWidget() {
    return new IBusTweakerPrefs();
}

function init() {
    ExtensionUtils.initTranslations();
}

const IBusTweakerPrefs = GObject.registerClass(
class IBusTweakerPrefs extends Gtk.ScrolledWindow {
    _init() {
        super._init({ hscrollbar_policy: Gtk.PolicyType.NEVER, });
        this._palatte = [_('Red'), _('Green'), _('Orange'), _('Blue'), _('Purple'), _('Turquoise'), _('Grey')];

        this._buildWidgets();
        this._bindValues();
        this._buildUI();
    }

    _buildWidgets() {
        this._field_custom_font     = new Gtk.FontButton();
        this._field_theme_color     = new UI.Combo(this._palatte);
        this._field_enable_hotkey   = new UI.Check(_('Run dialog'));
        this._field_enable_ms_theme = new UI.Check(_('MS IME theme'));
        this._field_use_custom_font = new UI.Check(_('Use custom font'));
        this._field_enable_ascii    = new UI.Check(_('Auto switch ASCII mode'));
        this._field_enable_orien    = new UI.Check(_('Candidates orientation'));
        this._field_orientation     = new UI.Combo([_('Vertical'), _('Horizontal')]);
        this._field_unkown_state    = new UI.Combo([_('On'), _('Off'), _('Default')]);
        this._field_variant         = new UI.Combo([_('Auto'), _('Light'), _('Dark')]);
        this._field_run_dialog      = new UI.Shortcut(gsettings.get_strv(Fields.SHORTCUT));
    }

    _buildUI() {
        let grid = new UI.ListGrid();
        grid._add(this._field_enable_hotkey,   this._field_run_dialog);
        grid._add(this._field_enable_orien,    this._field_orientation);
        grid._add(this._field_use_custom_font, this._field_custom_font);
        grid._add(this._field_enable_ascii,    this._field_unkown_state);
        grid._add(this._field_enable_ms_theme, this._field_variant, this._field_theme_color);
        this.set_child(new UI.Frame(grid));
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
        this._field_run_dialog.connect('changed', (widget, keys) => { gsettings.set_strv(Fields.SHORTCUT, [keys]); });
    }
});

