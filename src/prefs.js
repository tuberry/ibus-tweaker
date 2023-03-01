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
        this._blk = new Block({
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
        this._blk.c_keys = new UI.Keys(this._blk.gset, Fields.CLIPHISTCUT);
        this._blk.d_keys = new UI.Keys(this._blk.gset, Fields.RUNSHORTCUT);
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
