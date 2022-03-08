// vim:fdm=syntax
// by tuberry
/* exported init buildPrefsWidget */
'use strict';

const { Adw, Gio, Gtk, GObject } = imports.gi;

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

class IBusTweakerPrefs extends Adw.PreferencesGroup {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super();
        this._buildWidgets();
        this._bindValues();
        this._buildUI();
    }

    _buildWidgets() {
        this._field_enable_clip   = new Gtk.CheckButton();
        this._field_enable_dialog = new Gtk.CheckButton();
        this._field_enable_font   = new Gtk.CheckButton();
        this._field_enable_input  = new Gtk.CheckButton();
        this._field_enable_orien  = new Gtk.CheckButton();
        this._field_enable_theme  = new Gtk.CheckButton();
        this._field_page_button   = new Gtk.CheckButton();
        this._field_clip_page     = new UI.Spin(4, 10, 1, _('Page size'));
        this._field_clip_history  = new UI.Short(gsettings, Fields.CLIPHISTCUT);
        this._field_orientation   = new UI.Drop(_('Vertical'), _('Horizontal'));
        this._field_run_dialog    = new UI.Short(gsettings, Fields.RUNSHORTCUT);
        this._field_unknown_mode  = new UI.Drop(_('On'), _('Off'), _('Default'));
        this._field_custom_font   = new Gtk.FontButton({ valign: Gtk.Align.CENTER });
        this._field_theme_style   = new UI.Drop(_('Auto'), _('Light'), _('Dark'), _('System'));
        this._field_theme_color   = new UI.Drop(_('Red'), _('Green'), _('Orange'), _('Blue'), _('Purple'), _('Turquoise'), _('Grey'));
    }

    _buildUI() {
        [
            [this._field_page_button, [_('Hide page buttons')]],
            [this._field_enable_orien, [_('Candidates orientation')], this._field_orientation],
            [this._field_enable_input, [_('Autoswitch input mode')], this._field_unknown_mode],
            [this._field_enable_dialog, [_('Run dialog')], this._field_run_dialog],
            [this._field_enable_theme, [_('MS IME theme')], this._field_theme_style, this._field_theme_color],
            [this._field_enable_clip, [_('Clipboard history'), _('Depends on python-pinyin for Chinese search')], this._field_clip_page, this._field_clip_history],
            [this._field_enable_font, [_('Use custom font')], this._field_custom_font],
        ].forEach(xs => this.add(new UI.PrefRow(...xs)));
    }

    _bindValues() {
        [
            [Fields.AUTOSWITCH,    this._field_enable_input,  'active'],
            [Fields.ENABLEDIALOG,  this._field_enable_dialog, 'active'],
            [Fields.ENABLEMSTHEME, this._field_enable_theme,  'active'],
            [Fields.ENABLEORIEN,   this._field_enable_orien,  'active'],
            [Fields.MSTHEMECOLOR,  this._field_theme_color,   'selected'],
            [Fields.MSTHEMESTYLE,  this._field_theme_style,   'selected'],
            [Fields.ORIENTATION,   this._field_orientation,   'selected'],
            [Fields.UNKNOWNMODE,   this._field_unknown_mode,  'selected'],
            [Fields.PAGEBUTTON,    this._field_page_button,   'active'],
            [Fields.ENABLECLIP,    this._field_enable_clip,   'active'],
            [Fields.USECUSTOMFONT, this._field_enable_font,   'active'],
            [Fields.CLIPPAGESIZE,  this._field_clip_page,     'value'],
            [Fields.CUSTOMFONT,    this._field_custom_font,   'font'],
        ].forEach(xs => gsettings.bind(...xs, Gio.SettingsBindFlags.DEFAULT));
        this._field_enable_input.bind_property('active', this._field_enable_dialog, 'sensitive', GObject.BindingFlags.DEFAULT);
        this._field_enable_input.connect('notify::active', widget => {
            this._field_run_dialog.set_sensitive(widget.active && this._field_enable_dialog.active);
        });
        this._field_enable_dialog.set_sensitive(this._field_enable_input.active);
        this._field_run_dialog.set_sensitive(this._field_enable_input.active && this._field_enable_dialog.active);
    }
}

