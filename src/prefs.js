// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import * as UI from './ui.js';
import * as T from './util.js';
import {Key as K} from './const.js';

const {_} = UI;

class IBusTweakerPrefs extends UI.Page {
    static {
        T.enrol(this);
    }

    $buildWidgets() {
        return [
            [K.CKYS, new UI.Keys()],
            [K.FNTS, new UI.Font()],
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
            [K.FGA, [_('_Fgcolor attribute'), _('Support for candidate styles such as comments')]],
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
