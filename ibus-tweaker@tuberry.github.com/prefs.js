// vim:fdm=syntax
// by tuberry
/* exported init buildPrefsWidget */
'use strict';

const { Gio, Gtk, GObject } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const _ = ExtensionUtils.gettext;
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
        super._init({ hscrollbar_policy: Gtk.PolicyType.NEVER });
        this._palatte = [_('Red'), _('Green'), _('Orange'), _('Blue'), _('Purple'), _('Turquoise'), _('Grey')];

        this._buildWidgets();
        this._bindValues();
        this._buildUI();
    }

    _buildWidgets() {
        this._field_custom_font   = new Gtk.FontButton();
        this._field_theme_color   = new UI.Combo(this._palatte);
        this._field_enable_dialog = new UI.Check(_('Run dialog'));
        this._field_enable_theme  = new UI.Check(_('MS IME theme'));
        this._field_enable_font   = new UI.Check(_('Use custom font'));
        this._field_page_button   = new UI.Check(_('Hide page buttons'));
        this._field_enable_input  = new UI.Check(_('Autoswitch input mode'));
        this._field_enable_orien  = new UI.Check(_('Candidates orientation'));
        this._field_orientation   = new UI.Combo([_('Vertical'), _('Horizontal')]);
        this._field_unknown_mode  = new UI.Combo([_('On'), _('Off'), _('Default')]);
        this._field_theme_style   = new UI.Combo([_('Auto'), _('Light'), _('Dark')]);
        this._field_clip_history  = new UI.Shortcut(gsettings.get_strv(Fields.CLIPHISTCUT));
        this._field_run_dialog    = new UI.Shortcut(gsettings.get_strv(Fields.RUNSHORTCUT));
        this._field_clip_page     = new UI.Spin(4, 10, 1, { tooltip_text: _('Page size') });
        this._field_enable_clip   = new UI.Check(_('Clipboard history'), _('Depends on python-pinyin for Chinese search'));
    }

    _buildUI() {
        let grid = new UI.ListGrid();
        grid._add(this._field_page_button);
        grid._add(this._field_enable_orien,  this._field_orientation);
        grid._add(this._field_enable_input,  this._field_unknown_mode);
        grid._add(this._field_enable_dialog, this._field_run_dialog);
        grid._add(this._field_enable_theme,  this._field_theme_style, this._field_theme_color);
        grid._add(this._field_enable_clip,   this._field_clip_page,   this._field_clip_history);
        grid._add(this._field_enable_font,   this._field_custom_font);
        this.set_child(new UI.Frame(grid));
    }

    _bindValues() {
        gsettings.bind(Fields.AUTOSWITCH,    this._field_enable_input,  'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.ENABLEDIALOG,  this._field_enable_dialog, 'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.ENABLEMSTHEME, this._field_enable_theme,  'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.ENABLEORIEN,   this._field_enable_orien,  'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.MSTHEMECOLOR,  this._field_theme_color,   'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.MSTHEMESTYLE,  this._field_theme_style,   'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.ORIENTATION,   this._field_orientation,   'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.UNKNOWNMODE,   this._field_unknown_mode,  'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.PAGEBUTTON,    this._field_page_button,   'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.ENABLECLIP,    this._field_enable_clip,   'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.USECUSTOMFONT, this._field_enable_font,   'active', Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.CLIPPAGESIZE,  this._field_clip_page,     'value',  Gio.SettingsBindFlags.DEFAULT);
        gsettings.bind(Fields.CUSTOMFONT,    this._field_custom_font,   'font',   Gio.SettingsBindFlags.DEFAULT);
        this._field_enable_input.bind_property('active', this._field_enable_dialog, 'sensitive', GObject.BindingFlags.GET);
        this._field_enable_input.connect('notify::active', widget => {
            this._field_run_dialog.set_sensitive(widget.active && this._field_enable_dialog.active);
        });
        this._field_enable_dialog.set_sensitive(this._field_enable_input.active);
        this._field_run_dialog.set_sensitive(this._field_enable_input.active && this._field_enable_dialog.active);
        this._field_run_dialog.connect('changed', (widget, keys) => { gsettings.set_strv(Fields.RUNSHORTCUT, [keys]); });
        this._field_clip_history.connect('changed', (widget, keys) => { gsettings.set_strv(Fields.CLIPHISTCUT, [keys]); });
    }
});

