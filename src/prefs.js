// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import * as UI from './ui.js';
import * as T from './util.js';
import {Key as K} from './const.js';

const {_, _G, Box, enrol, getv, setv} = UI;

class Color extends Box {
    static {
        enrol(this, '');
        this.RE = /^#[\da-f]{6}$/i;
    }

    constructor(param) {
        let color = new Gtk.ColorDialogButton({
                dialog: new Gtk.ColorDialog(),
                tooltipText: _('Custom foreground color'),
                valign: Gtk.Align.CENTER,
                ...param,
            }),
            reset = new Gtk.Button({iconName: 'edit-undo-symbolic', tooltipText: _G('Reset')}),
            sep = new Gtk.Separator({orientation: Gtk.Orientation.VERTICAL});
        super([color, sep, reset]);
        Object.assign(this, {$color: color, $reset: reset, $sep: sep});
        this.$syncColor();
        this.connect(`notify::${getv}`, () => this.$syncColor());
        color.connect('notify::rgba', () => this.$rgbaLock || this[setv](Color.stringify(color.rgba)));
        reset.connect('clicked', () => this[setv](''));
    }

    $syncColor() {
        this.$rgbaLock = true;
        this.$color.rgba = Color.parse(this[getv]);
        this.$rgbaLock = false;
        this.$reset.visible = this.$sep.visible = !!this[getv];
        this.$color.tooltipText = this[getv] || _('Use original foreground color');
    }

    static parse(value) {
        let rgba = new Gdk.RGBA();
        if(!this.RE.test(value) || !rgba.parse(value)) rgba.alpha = 0;
        return rgba;
    }

    static stringify({red, green, blue}) {
        return `#${[red, green, blue].map(x => Math.max(0, Math.min(255, Math.round(x * 255))).toString(16).padStart(2, '0')).join('')}`;
    }
}

class IBusTweakerPrefs extends UI.Page {
    static {
        T.enrol(this);
    }

    $buildWidgets() {
        return [
            [K.CKYS, new UI.Keys()],
            [K.FNTS, new UI.Font()],
            [K.FGC,  new Color()],
            [K.APP,  new UI.Check()],
            [K.IPM,  new UI.Check()],
            [K.CLP,  new UI.Check()],
            [K.FNT,  new UI.Check()],
            [K.BTN,  new UI.Check()],
            [K.THM,  new UI.Check()],
            [K.FGA,  new UI.Check()],
            [K.CLPS, new UI.Spin(4, 10, 1, '', _('Page size'))],
            [K.STL,  new UI.Drop([_('System'), _('Light'), _('Dark')])],
        ];
    }

    $buildUI() {
        return [
            [K.BTN, [_('_Hide page buttons')]],
            [K.IPM, [_('_Autoswitch input mode'), _('Remember the input mode for each application')]],
            [K.APP, [_('_Slug app search'), _('Also search for localized apps in Romanized acronyms')]],
            [K.FGA, [_('_Fgcolor attribute'), _('Support for candidate styles such as comments')], K.FGC],
            [K.THM, [_('_Preset theme'), _('Compact mode applicable mimetic theme')], K.STL],
            [K.FNT, [_('_Custom font')], K.FNTS],
            [K.CLP, [_('C_lipboard history')], new UI.Help(({h, k}) => [h(_('Help')), [
                [_('input digits'), _('numeric keypad')],
                [_('copy current entry'), k('backslash')],
                [_('delete current entry'), k('Delete')],
                [_('delete all entries'), k('<shift>Delete')],
            ]]), K.CLPS, K.CKYS],
        ];
    }
}

export default class extends UI.Prefs { $klass = IBusTweakerPrefs; }
