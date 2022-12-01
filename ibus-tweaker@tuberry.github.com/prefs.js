// vim:fdm=syntax
// by tuberry
/* exported init buildPrefsWidget */
'use strict';

const { Adw, Gtk, GObject } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const _ = ExtensionUtils.gettext;
const { Fields, Block } = Me.imports.fields;
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
        this._block = new Block({
            en_clip: [Fields.ENABLECLIP,    'active',   new Gtk.CheckButton()],
            en_font: [Fields.USECUSTOMFONT, 'active',   new Gtk.CheckButton()],
            switch:  [Fields.AUTOSWITCH,    'active',   new Gtk.CheckButton()],
            en_dlg:  [Fields.ENABLEDIALOG,  'active',   new Gtk.CheckButton()],
            en_thm:  [Fields.ENABLEMSTHEME, 'active',   new Gtk.CheckButton()],
            en_ori:  [Fields.ENABLEORIEN,   'active',   new Gtk.CheckButton()],
            page:    [Fields.PAGEBUTTON,    'active',   new Gtk.CheckButton()],
            size:    [Fields.CLIPPAGESIZE,  'value',    new UI.Spin(4, 10, 1, _('Page size'))],
            orient:  [Fields.ORIENTATION,   'selected', new UI.Drop([_('Vertical'), _('Horizontal')])],
            font:    [Fields.CUSTOMFONT,    'font',     new Gtk.FontButton({ valign: Gtk.Align.CENTER })],
            style:   [Fields.MSTHEMESTYLE,  'selected', new UI.Drop([_('Auto'), _('Light'), _('Dark'), _('System')])],
            color:   [Fields.MSTHEMECOLOR,  'selected', new UI.Drop([_('Red'), _('Green'), _('Orange'), _('Blue'), _('Purple'), _('Turquoise'), _('Grey')])],
        });
        this._block.c_keys = new UI.Keys(this._block.gset, Fields.CLIPHISTCUT);
        this._block.d_keys = new UI.Keys(this._block.gset, Fields.RUNSHORTCUT);
        this._block.switch.bind_property('active', this._block.en_dlg, 'sensitive', GObject.BindingFlags.DEFAULT);
        this._block.switch.connect('notify::active', w => this._block.d_keys.set_sensitive(w.active && this._block.en_dlg.active));
        this._block.en_dlg.set_sensitive(this._block.switch.active);
        this._block.d_keys.set_sensitive(this._block.switch.active && this._block.en_dlg.active);
    }

    _buildUI() {
        [
            [this._block.page,    [_('Hide page buttons')]],
            [this._block.switch,  [_('Autoswitch input mode')]],
            [this._block.en_ori,  [_('Candidates orientation')], this._block.orient],
            [this._block.en_dlg,  [_('Run dialog')], this._block.d_keys],
            [this._block.en_thm,  [_('MS IME theme')], this._block.style, this._block.color],
            [this._block.en_clip, [_('Clipboard history')], this._block.size, this._block.c_keys],
            [this._block.en_font, [_('Use custom font')], this._block.font],
        ].forEach(xs => this.add(new UI.PrefRow(...xs)));
    }
}
