// vim:fdm=syntax
// by tuberry
/* exported init buildPrefsWidget */
'use strict';

const { Adw, Gtk, GObject } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const { Field } = Me.imports.const;
const { _ } = Me.imports.util;
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
        this._blk = new UI.Block({
            en_clip: [Field.ENABLECLIP,    'active',   new Gtk.CheckButton()],
            en_font: [Field.USECUSTOMFONT, 'active',   new Gtk.CheckButton()],
            switch:  [Field.AUTOSWITCH,    'active',   new Gtk.CheckButton()],
            en_dlg:  [Field.ENABLEDIALOG,  'active',   new Gtk.CheckButton()],
            en_thm:  [Field.ENABLEMSTHEME, 'active',   new Gtk.CheckButton()],
            en_ori:  [Field.ENABLEORIEN,   'active',   new Gtk.CheckButton()],
            page:    [Field.PAGEBUTTON,    'active',   new Gtk.CheckButton()],
            size:    [Field.CLIPPAGESIZE,  'value',    new UI.Spin(4, 10, 1, _('Page size'))],
            orient:  [Field.ORIENTATION,   'selected', new UI.Drop([_('Vertical'), _('Horizontal')])],
            font:    [Field.CUSTOMFONT,    'font',     new Gtk.FontButton({ valign: Gtk.Align.CENTER })],
            style:   [Field.MSTHEMESTYLE,  'selected', new UI.Drop([_('Auto'), _('Light'), _('Dark'), _('System')])],
            color:   [Field.MSTHEMECOLOR,  'selected', new UI.Drop([_('Red'), _('Green'), _('Orange'), _('Blue'), _('Purple'), _('Turquoise'), _('Grey')])],
        });
        this._blk.c_keys = new UI.Keys(this._blk.gset, Field.CLIPHISTCUT);
        this._blk.d_keys = new UI.Keys(this._blk.gset, Field.RUNSHORTCUT);
        this._blk.switch.bind_property('active', this._blk.en_dlg, 'sensitive', GObject.BindingFlags.DEFAULT);
        this._blk.switch.connect('notify::active', w => this._blk.d_keys.set_sensitive(w.active && this._blk.en_dlg.active));
        this._blk.en_dlg.set_sensitive(this._blk.switch.active);
        this._blk.d_keys.set_sensitive(this._blk.switch.active && this._blk.en_dlg.active);
    }

    _buildUI() {
        [
            [this._blk.page,    [_('Hide page buttons')]],
            [this._blk.switch,  [_('Autoswitch input mode')]],
            [this._blk.en_ori,  [_('Candidates orientation')], this._blk.orient],
            [this._blk.en_dlg,  [_('Run dialog')], this._blk.d_keys],
            [this._blk.en_thm,  [_('MS IME theme')], this._blk.style, this._blk.color],
            [this._blk.en_clip, [_('Clipboard history')], this._blk.size, this._blk.c_keys],
            [this._blk.en_font, [_('Use custom font')], this._blk.font],
        ].forEach(xs => this.add(new UI.PrefRow(...xs)));
    }
}
