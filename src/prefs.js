// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';

import * as UI from './ui.js';
import {Field} from './const.js';

const {_} = UI;

class IBusTweakerPrefs extends Adw.PreferencesGroup {
    static {
        GObject.registerClass(this);
    }

    constructor(gset) {
        super();
        this.$buildWidgets(gset);
        this.$buildUI();
    }

    $buildWidgets(gset) {
        this.$blk = UI.block({
            FNTS: new UI.Font(),
            CLP:  new UI.Check(),
            FNT:  new UI.Check(),
            ATSW: new UI.Check(),
            DLG:  new UI.Check(),
            THM:  new UI.Check(),
            ORN:  new UI.Check(),
            PBTN: new UI.Check(),
            CLPS: new UI.Spin(4, 10, 1, _('Page size')),
            ORNS: new UI.Drop([_('Vertical'), _('Horizontal')]),
            TSTL: new UI.Drop([_('Auto'), _('Light'), _('Dark'), _('System')]),
            THMS: new UI.Drop([_('Red'), _('Green'), _('Orange'), _('Blue'), _('Purple'), _('Turquoise'), _('Grey')]),
        }, gset);
        this.$blk.CKYS = new UI.Keys({gset, key: Field.CKYS});
        this.$blk.RKYS = new UI.Keys({gset, key: Field.RKYS});
        this.$blk.ATSW.bind_property('active', this.$blk.DLG, 'sensitive', GObject.BindingFlags.DEFAULT);
        this.$blk.ATSW.connect('notify::active', w => this.$blk.RKYS.set_sensitive(w.active && this.$blk.DLG.active));
        this.$blk.RKYS.set_sensitive(this.$blk.ATSW.active && this.$blk.DLG.active);
        this.$blk.DLG.set_sensitive(this.$blk.ATSW.active);
    }

    $buildUI() {
        [
            [this.$blk.PBTN, [_('Hide page buttons')]],
            [this.$blk.ATSW, [_('Autoswitch input mode')]],
            [this.$blk.DLG,  [_('Run dialog')], this.$blk.RKYS],
            [this.$blk.ORN,  [_('Candidates orientation')], this.$blk.ORNS],
            [this.$blk.THM,  [_('MS IME theme')], this.$blk.TSTL, this.$blk.THMS],
            [this.$blk.FNT,  [_('Use custom font')], this.$blk.FNTS],
            [this.$blk.CLP,  [_('Clipboard history')], this.$blk.CLPS, this.$blk.CKYS],
        ].forEach(xs => this.add(new UI.PrefRow(...xs)));
    }
}

export default class PrefsWidget extends UI.Prefs { $klass = IBusTweakerPrefs; }
