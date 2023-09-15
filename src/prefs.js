// vim:fdm=syntax
// by tuberry

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';

import * as UI from './ui.js';
import { Field } from './const.js';

const { _ } = UI;

class IBusTweakerPrefs extends Adw.PreferencesGroup {
    static {
        GObject.registerClass(this);
    }

    constructor(gset) {
        super();
        this._buildWidgets(gset);
        this._buildUI();
    }

    _buildWidgets(gset) {
        this._blk = UI.block({
            FNTS: ['value',    new UI.Font()],
            CLP:  ['active',   new Gtk.CheckButton()],
            FNT:  ['active',   new Gtk.CheckButton()],
            ATSW: ['active',   new Gtk.CheckButton()],
            DLG:  ['active',   new Gtk.CheckButton()],
            THM:  ['active',   new Gtk.CheckButton()],
            ORN:  ['active',   new Gtk.CheckButton()],
            PBTN: ['active',   new Gtk.CheckButton()],
            CLPS: ['value',    new UI.Spin(4, 10, 1, _('Page size'))],
            ORNS: ['selected', new UI.Drop([_('Vertical'), _('Horizontal')])],
            TSTL: ['selected', new UI.Drop([_('Auto'), _('Light'), _('Dark'), _('System')])],
            THMS: ['selected', new UI.Drop([_('Red'), _('Green'), _('Orange'), _('Blue'), _('Purple'), _('Turquoise'), _('Grey')])],
        }, gset);
        this._blk.CKYS = new UI.Keys({ gset, key: Field.CKYS });
        this._blk.RKYS = new UI.Keys({ gset, key: Field.RKYS });
        this._blk.ATSW.bind_property('active', this._blk.DLG, 'sensitive', GObject.BindingFlags.DEFAULT);
        this._blk.ATSW.connect('notify::active', w => this._blk.RKYS.set_sensitive(w.active && this._blk.DLG.active));
        this._blk.DLG.set_sensitive(this._blk.ATSW.active);
        this._blk.RKYS.set_sensitive(this._blk.ATSW.active && this._blk.DLG.active);
    }

    _buildUI() {
        [
            [this._blk.PBTN, [_('Hide page buttons')]],
            [this._blk.ATSW, [_('Autoswitch input mode')]],
            [this._blk.DLG,  [_('Run dialog')], this._blk.RKYS],
            [this._blk.ORN,  [_('Candidates orientation')], this._blk.ORNS],
            [this._blk.THM,  [_('MS IME theme')], this._blk.TSTL, this._blk.THMS],
            [this._blk.CLP,  [_('Clipboard history')], this._blk.CLPS, this._blk.CKYS],
            [this._blk.FNT,  [_('Use custom font')], this._blk.FNTS],
        ].forEach(xs => this.add(new UI.PrefRow(...xs)));
    }
}

export default class PrefsWidget extends UI.Prefs { $klass = IBusTweakerPrefs; }
