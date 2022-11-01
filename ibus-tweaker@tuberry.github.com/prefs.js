// vim:fdm=syntax
// by tuberry
/* exported init buildPrefsWidget */
'use strict';

const { Adw, Gio, Gtk, GObject } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const _ = ExtensionUtils.gettext;
const { Fields } = Me.imports.fields;
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
        this._buildUI();
    }

    _buildWidgets() {
        let gsettings = ExtensionUtils.getSettings();
        this._field_clip_history = new UI.Short(gsettings, Fields.CLIPHISTCUT);
        this._field_run_dialog   = new UI.Short(gsettings, Fields.RUNSHORTCUT);
        this._field = {
            ENABLECLIP:    ['active',   new Gtk.CheckButton()],
            USECUSTOMFONT: ['active',   new Gtk.CheckButton()],
            AUTOSWITCH:    ['active',   new Gtk.CheckButton()],
            ENABLEDIALOG:  ['active',   new Gtk.CheckButton()],
            ENABLEMSTHEME: ['active',   new Gtk.CheckButton()],
            ENABLEORIEN:   ['active',   new Gtk.CheckButton()],
            PAGEBUTTON:    ['active',   new Gtk.CheckButton()],
            CLIPPAGESIZE:  ['value',    new UI.Spin(4, 10, 1, _('Page size'))],
            ORIENTATION:   ['selected', new UI.Drop([_('Vertical'), _('Horizontal')])],
            UNKNOWNMODE:   ['selected', new UI.Drop([_('On'), _('Off'), _('Default')])],
            CUSTOMFONT:    ['font',     new Gtk.FontButton({ valign: Gtk.Align.CENTER })],
            MSTHEMESTYLE:  ['selected', new UI.Drop([_('Auto'), _('Light'), _('Dark'), _('System')])],
            MSTHEMECOLOR:  ['selected', new UI.Drop([_('Red'), _('Green'), _('Orange'), _('Blue'), _('Purple'), _('Turquoise'), _('Grey')])],
        };
        Object.entries(this._field).forEach(([x, [y, z]]) => gsettings.bind(Fields[x], z, y, Gio.SettingsBindFlags.DEFAULT));
        this._field.AUTOSWITCH[1].bind_property('active', this._field.ENABLEDIALOG[1], 'sensitive', GObject.BindingFlags.DEFAULT);
        this._field.AUTOSWITCH[1].connect('notify::active', w => this._field_run_dialog.set_sensitive(w.active && this._field.ENABLEDIALOG[1].active));
        this._field.ENABLEDIALOG[1].set_sensitive(this._field.AUTOSWITCH[1].active);
        this._field_run_dialog.set_sensitive(this._field.AUTOSWITCH[1].active && this._field.ENABLEDIALOG[1].active);
    }

    _buildUI() {
        [
            [this._field.PAGEBUTTON[1],    [_('Hide page buttons')]],
            [this._field.ENABLEORIEN[1],   [_('Candidates orientation')], this._field.ORIENTATION[1]],
            [this._field.AUTOSWITCH[1],    [_('Autoswitch input mode')], this._field.UNKNOWNMODE[1]],
            [this._field.ENABLEDIALOG[1],  [_('Run dialog')], this._field_run_dialog],
            [this._field.ENABLEMSTHEME[1], [_('MS IME theme')], this._field.MSTHEMESTYLE[1], this._field.MSTHEMECOLOR[1]],
            [this._field.ENABLECLIP[1],    [_('Clipboard history')], this._field.CLIPPAGESIZE[1], this._field_clip_history],
            [this._field.USECUSTOMFONT[1], [_('Use custom font')], this._field.CUSTOMFONT[1]],
        ].forEach(xs => this.add(new UI.PrefRow(...xs)));
    }
}
