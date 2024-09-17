// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import GLib from 'gi://GLib';
import IBus from 'gi://IBus';
import Shell from 'gi://Shell';
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';

import {Field} from './const.js';
import {str2py} from './pinyin.js';
import * as Util from './util.js';
import * as Fubar from './fubar.js';

const {_}  = Fubar;
const InputManager = Main.panel.statusArea.keyboard._inputSourceManager;
const IBusManager = InputManager._ibusManager;
const IBusPopup = IBusManager._candidatePopup;
const IBusArea = IBusPopup._candidateArea;

const ClipHist = [];
const Style = {SYSTEM: 0, LIGHT: 1, DARK: 2, AUTO: 3};
const Indices = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const PopupStyleClass = {
    styleClass: '',
    _candidateArea: {
        _candidateBoxes: Array(16).fill({
            styleClass: '',
            _indexLabel: {styleClass: ''},
            _candidateLabel: {styleClass: ''},
        }),
        _buttonBox: {styleClass: ''},
        _previousButton: {styleClass: ''},
        _nextButton: {styleClass: ''},
    },
    bin: {child: {styleClass: ''}},
    _preeditText: {styleClass: ''},
    _auxText: {styleClass: ''},
};

const ellipsize = (s, l = 20) => s.length > 2 * l ? `${s.slice(0, l)}\u2026${s.slice(-l)}` : s;
const visibilize = (s, t = [[/\n|\r/g, '\u21b5'], ['\t', '\u21e5']]) => t.reduce((p, x) => p.replaceAll(...x), s);

function syncStyleClass(aim, src, func = Util.id, obj = PopupStyleClass) {
    return Util.Y(f => (a, b, c) => Object.keys(c).forEach(k => c[k] instanceof Object
        ? a[k] && f(a[k], b[k], c[k]) : k === 'styleClass' && (a[k] = func(b[k]))))(aim, src, obj);
}

class IBusAutoSwitch extends Fubar.Mortal {
    constructor(set) {
        super();
        this.#bindSettings(set);
        this.#buildWidgets();
    }

    #bindSettings(set) {
        this.$set = set.attach({
            keys:  [Field.DLG,  'boolean', null, x => this.$src.keys.toggle(x)],
            modes: [Field.IPMS, 'value', x => new Map(Object.entries(x.recursiveUnpack())), null, true],
        }, this);
    }

    #buildWidgets() {
        Fubar.connect(this, global.display, 'notify::focus-window', () => this.toggleInputMode(),
            Main.overview, 'hidden', () => this.setEmpty(), 'shown', () => this.setEmpty('#overview'));
        this.$src = Fubar.Source.tie({keys: Fubar.Source.newKeys(this.$set.hub, Field.RKYS, () => this.openRunDialog(), this.keys)}, this);
    }

    *enumerateProps(props) {
        if(props) for(let p, i = 0; (p = props.get(i)); i++) if(p.key.startsWith('InputMode')) yield p;
    }

    getInputMode(props) {
        for(let {propType, symbol, label, state, subProps, key} of this.enumerateProps(props)) {
            switch(propType) {
            case IBus.PropType.NORMAL: return symbol?.get_text() ?? label.get_text(); // ibus-libpinyin
            case IBus.PropType.TOGGLE: return state.toString(); // ibus-hangul
            case IBus.PropType.MENU: return this.getInputMode(subProps); // ibus-typing-booster
            case IBus.PropType.RADIO: if(state) return key.split('.').at(-1); break; // ibus-typing-booster
            }
        }
        return '';
    }

    setInputMode(props, mode) {
        for(let {propType, key, state, subProps} of this.enumerateProps(props)) {
            switch(propType) {
            case IBus.PropType.NORMAL:
            case IBus.PropType.TOGGLE: return this.activate(key, !state);
            case IBus.PropType.MENU: return this.setInputMode(subProps, mode);
            case IBus.PropType.RADIO: if(key.endsWith(mode)) return this.activate(key, !state); break;
            }
        }
    }

    activate(key, state) {
        IBusManager.activateProperty(key, state ? 1 : 0);
    }

    setEmpty(empty) {
        this.$empty = empty;
        this.toggleInputMode();
    }

    saveInputMode(win, id, mode) {
        this.modes.set(win, [id, mode]);
        this.$set.set('modes', new GLib.Variant('a{s(ss)}', Object.fromEntries(this.modes)), this);
    }

    checkInputMode(win, id, mode) {
        if(!win) return false;
        if(!this.modes.has(win)) this.saveInputMode(win, id, mode);
        [this.id, this.mode] = this.modes.get(win);
        return this.id !== id || this.mode !== mode;
    }

    toggleInputMode() {
        let {id, properties} = InputManager.currentSource;
        let mode = this.getInputMode(properties);
        if(this.checkInputMode(this.win, id, mode)) this.saveInputMode(this.win, id, mode);
        let win = this.$empty || global.display.focus_window?.wm_class?.toLowerCase();
        if(this.checkInputMode(this.win = win, id, mode) && this.id === id) this.setInputMode(properties, this.mode);
    }

    openRunDialog() {
        if(Main.runDialog && this.dialogInited) {
            Main.openRunDialog();
        } else {
            Main.openRunDialog();
            Fubar.connect(this, Main.runDialog, 'notify::visible', () => this.setEmpty(Main.runDialog.visible && '#run-dialog'));
            this.setEmpty('#run-dialog');
            this.dialogInited = true;
        }
    }
}

class IBusFontSetting extends Fubar.Mortal {
    constructor(set) {
        super();
        let style = IBusPopup.get_style();
        this.$set = set.attach({fontName: [Field.FNTS, 'string', null, x => this.$src.font.summon(x)]}, this);
        this.$src = Fubar.Source.tie({font: new Fubar.Source(() => this.#setup(), () => IBusPopup.set_style(style), true)}, this);
    }

    #setup() {
        let desc = Pango.FontDescription.from_string(this.fontName);
        let weight = Fubar.essay(() => desc.get_weight(), e => parseInt(e.message)); // HACK: workaround for Pango.Weight enumeration exception (eg: 290)
        IBusPopup.set_style(`font-weight: ${weight};
 font-family: "${desc.get_family()}";
 font-style: ${Object.keys(Pango.Style)[desc.get_style()].toLowerCase()};
 font-size: ${desc.get_size() / Pango.SCALE}${desc.get_size_is_absolute() ? 'px' : 'pt'};`);
    }
}

class IBusPageButton extends Fubar.Mortal {
    constructor() {
        super();
        Fubar.Source.tie({
            page: new Fubar.Source(() => {
                IBusArea._buttonBox.set_style('border-width: 0;');
                IBusArea._previousButton.hide();
                IBusArea._nextButton.hide();
            }, () => {
                IBusArea._buttonBox.set_style('');
                IBusArea._previousButton.show();
                IBusArea._nextButton.show();
            }, true),
        }, this);
    }
}

class IBusThemeManager extends Fubar.Mortal {
    constructor(set) {
        super();
        this.#bindSettings(set);
        this.#buildSources();
    }

    #bindSettings(set) {
        this.$set = set.attach({style: [Field.TSTL, 'uint', null, () => this.#onLightOn()]}, this);
        this.$setIf = new Fubar.Setting('org.gnome.desktop.interface', {
            scheme: ['color-scheme', 'string', x => x === 'prefer-dark', () => this.#onLightOn()],
        }, this);
    }

    #buildSources() {
        let style = new Fubar.Source(() => this.#replaceStyle(), () => this.#restoreStyle(), true);
        let light = Fubar.Source.newLight(x => { this.night = x; this.#onLightOn(); }, true);
        this.$src = Fubar.Source.tie({style, light}, this);
    }

    #onLightOn() {
        let dark = this.style === Style.AUTO ? this.night
            : this.style === Style.SYSTEM ? this.scheme : this.style === Style.DARK;
        this.#updateStyle(dark);
    }

    #updateStyle(dark) {
        if(this.dark === dark) return;
        if((this.dark = dark)) IBusPopup.add_style_class_name('night');
        else IBusPopup.remove_style_class_name('night');
    }

    #replaceStyle() {
        syncStyleClass(IBusPopup, PopupStyleClass, x => x.replace(/candidate/g, 'ibus-tweaker-candidate'));
    }

    #restoreStyle() {
        if(this.dark) IBusPopup.remove_style_class_name('night');
        syncStyleClass(IBusPopup, PopupStyleClass);
    }
}

class IBusClipArea extends St.BoxLayout {
    // copy from js/ui/ibusCandidatePopup.js since it's private in 45.beta
    static {
        GObject.registerClass({
            Signals: {
                'cursor-up': {},
                'next-page': {},
                'cursor-down': {},
                'previous-page': {},
                'candidate-clicked': {param_types: [GObject.TYPE_UINT, GObject.TYPE_UINT, Clutter.ModifierType.$gtype]},
            },
        }, this);
    }

    constructor() {
        super({vertical: true, reactive: true, visible: false});
        this.add_style_class_name('vertical');
        this._candidateBoxes = [];
        let click = i => (_a, e) => this.emit('candidate-clicked', i, e.get_button(), e.get_state());
        Indices.forEach((_x, i) => {
            let box = Util.hook({'button-release-event': click(i)}, new St.BoxLayout({reactive: true, trackHover: true}));
            box._indexLabel = new St.Label();
            box.add_child(box._indexLabel);
            box._candidateLabel = new St.Label();
            box.add_child(box._candidateLabel);
            this._candidateBoxes.push(box);
            this.add_child(box);
        });
        this._buttonBox = new St.BoxLayout();
        this._previousButton = Util.hook({clicked: () => this.emit('previous-page')}, new St.Button({xExpand: true, iconName: 'go-up-symbolic'}));
        this._buttonBox.add_child(this._previousButton);
        this._nextButton = Util.hook({clicked: () => this.emit('next-page')}, new St.Button({xExpand: true, iconName: 'go-down-symbolic'}));
        this._buttonBox.add_child(this._nextButton);
        this.add_child(this._buttonBox);
        this._orientation = -1;
        this._cursorPosition = 0;
    }

    vfunc_scroll_event(event) {
        switch(event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP: this.emit('cursor-up'); break;
        case Clutter.ScrollDirection.DOWN: this.emit('cursor-down'); break;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    setCandidates(indexes, candidates, cursorPosition, cursorVisible) {
        Indices.forEach((x, i) => {
            let box = this._candidateBoxes[i];
            if(!(box.visible = i < candidates.length)) return;
            box._indexLabel.text = indexes && indexes[i] ? indexes[i] : x;
            box._candidateLabel.text = candidates[i];
        });
        this._candidateBoxes[this._cursorPosition].remove_style_pseudo_class('selected');
        this._cursorPosition = cursorPosition;
        if(cursorVisible) this._candidateBoxes[cursorPosition].add_style_pseudo_class('selected');
    }

    updateButtons(wrapsAround, page, nPages) {
        if(nPages < 2) {
            this._buttonBox.hide();
        } else {
            this._buttonBox.show();
            this._previousButton.reactive = wrapsAround || page > 0;
            this._nextButton.reactive = wrapsAround || page < nPages - 1;
        }
    }
}

class IBusClipPopup extends BoxPointer.BoxPointer {
    static {
        GObject.registerClass(this);
    }

    constructor(pageBtn, hooks) {
        super(St.Side.TOP);
        this.set({visible: false, reactive: true});
        this.#buildWidgets(pageBtn, hooks);
        Main.layoutManager.addChrome(this);
        global.focusManager.add_group(this);
        global.stage.set_key_focus(this);
    }

    #buildWidgets(pageBtn, hooks) {
        let box = new St.BoxLayout({vertical: true});
        this.bin.set_child(box);
        let hbox = new St.BoxLayout();
        box.add_child(hbox);
        this._preeditText = new St.Label({visible: true, x_expand: true});
        this._auxText = new St.Label({visible: true});
        [this._preeditText, this._auxText].forEach(x => hbox.add_child(x));
        this._candidateArea = Util.hook(hooks, new IBusClipArea());
        box.add_child(this._candidateArea);
        this.#replaceStyle(pageBtn);
    }

    #replaceStyle(pageBtn) {
        syncStyleClass(this, IBusPopup);
        this.set_style(IBusPopup.get_style());
        let [box] = IBusPopup._candidateArea._candidateBoxes,
            i_style = box._indexLabel.get_style(),
            c_style = box._candidateLabel.get_style();
        this._candidateArea._candidateBoxes.forEach(x => {
            x._indexLabel.set_style(i_style);
            x._candidateLabel.set_style(c_style);
        });
        if(!pageBtn) return;
        this._candidateArea._buttonBox.set_style('border-width: 0;');
        this._candidateArea._nextButton.hide();
        this._candidateArea._previousButton.hide();
    }

    setPreedit(text) {
        this._preeditText.set_text(`${_('📋：')}${text}`);
    }

    setAuxText(count) {
        this._auxText.set_text(_('%dC').format(count ?? 0));
    }

    summon(cursor) {
        this._candidateArea.visible = true;
        this.setPosition(cursor, 0);
        this.open(BoxPointer.PopupAnimation.NONE);
        this.get_parent().set_child_above_sibling(this, null);
        Main.pushModal(this, {actionMode: Shell.ActionMode.POPUP});
    }
}

class IBusClipHistory extends Fubar.Mortal {
    constructor(set) {
        super();
        this.#bindSettings(set);
        this.#buildSources();
        this.#buildWidgets();
    }

    #bindSettings(set) {
        this.$set = set.attach({pageSize: [Field.CLPS, 'uint'], pageBtn: [Field.PBTN, 'boolean']}, this);
    }

    #buildSources() {
        let ptr = new Clutter.Actor({opacity: 0, x: 1, y: 1}), // workaround for the cursor jumping
            pop = new Fubar.Source(() => Util.hook({
                'captured-event': (...xs) => this.#onCapture(...xs),
            }, new IBusClipPopup(this.pageBtn, {
                'cursor-up': () => this.setOffset(-1),
                'cursor-down': () => this.setOffset(1),
                'next-page': () => this.setOffset(this.pageSize),
                'previous-page': () => this.setOffset(-this.pageSize),
                'candidate-clicked': (...xs) => this.#onCandidateClick(...xs),
            }))),
            keys = Fubar.Source.newKeys(this.$set.hub, Field.CKYS,  () => this.summon(), true),
            commit = Fubar.Source.newTimer(x => [() => IBusManager._panelService?.commit_text(IBus.Text.new_from_string(x)), 30]);
        this.$src = Fubar.Source.tie({ptr, pop, keys, commit}, this);
    }

    #buildWidgets() {
        Fubar.connect(this, global.display.get_selection(), 'owner-changed', (...xs) => this.$onClipboardChange(...xs));
        Main.layoutManager.uiGroup.add_child(this.$src.ptr);
    }

    summon() {
        if(this.$src.pop.active || !IBusManager._ready || Main.overview._shown) return;
        this.$src.pop.summon();
        this.lookup = [...ClipHist];
        this.preedit = '';
        this.setCursor(0);
        this.$src.ptr.set_position(...IBusPopup._dummyCursor.get_transformed_position());
        this.$src.ptr.set_size(...IBusPopup._dummyCursor.get_transformed_size());
        this.$src.pop.hub.summon(this.$src.ptr);
    }

    async $onClipboardChange(_s, type) {
        if(type !== St.ClipboardType.CLIPBOARD) return;
        let text = await Fubar.paste();
        let index = ClipHist.findIndex(x => x[0] === text);
        if(index < 0) {
            ClipHist.unshift([text, visibilize(ellipsize(text)), str2py(text.toLowerCase())]);
            while(ClipHist.length > 64) ClipHist.pop();
        } else if(index > 0) {
            [ClipHist[0], ClipHist[index]] = [ClipHist[index], ClipHist[0]];
        }
    }

    #onCapture(actor, event) {
        let type = event.type();
        if(type === Clutter.EventType.KEY_PRESS) {
            let key = event.get_key_symbol();
            switch(key) {
            case Clutter.KEY_Up:        this.setOffset(-1); break;
            case Clutter.KEY_Down:      this.setOffset(1); break;
            case Clutter.KEY_Left:
            case Clutter.KEY_Page_Up:   this.setOffset(-this.pageSize); break;
            case Clutter.KEY_Right:
            case Clutter.KEY_Page_Down: this.setOffset(this.pageSize); break;
            case Clutter.KEY_space:
            case Clutter.KEY_Return:
            case Clutter.KEY_KP_Enter:
            case Clutter.KEY_ISO_Enter: this.#onCandidateClick(null, this.cursor - this.$start, 1, 0); break;
            case Clutter.KEY_Delete:    this.deleteCurrent(); break;
            case Clutter.KEY_backslash: this.mergeCurrent(); break;
            case Clutter.KEY_BackSpace: this.setPreedit(this.preedit.slice(0, -1)); break;
            default:
                if(key < 33 || key > 126) this.$src.pop.dispel();
                else if(key > 47 && key < 58) this.selectAt(String.fromCharCode(key));
                else this.setPreedit(this.preedit + String.fromCharCode(key)); break;
            }
            return Clutter.EVENT_STOP;
        } else if((type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) &&
                  !actor.contains(global.stage.get_event_actor(event))) {
            this.$src.pop.dispel();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    setOffset(offset) {
        let pos = this.cursor + offset;
        if(pos >= 0 && pos < this.lookup.length) {
            this.setCursor(pos);
        } else if(pos >= this.lookup.length) {
            let expectation = (this.$page + 1) * this.pageSize;
            if(this.lookup.length > expectation) this.setCursor(expectation);
        }
    }

    setCursor(cursor) {
        this.cursor = cursor;
        this.$page = Math.floor(this.cursor / this.pageSize);
        this.$start = this.$page * this.pageSize;
        this.$size = Math.min(this.pageSize, this.lookup.length - this.$start);
        let indices = this.$size ? Indices.slice(0, this.$size) : ['\u2205'],
            candidates = this.$size ? this.lookup.slice(this.$start, this.$start + this.$size).map(x => x[1]) : [_('Empty history.')],
            pop = this.$src.pop.hub;
        pop._candidateArea.setCandidates(indices, candidates, this.cursor % this.pageSize, this.$size);
        pop._candidateArea.updateButtons(false, this.$page, Math.ceil(this.lookup.length / this.pageSize));
        pop.setAuxText(this.lookup[this.cursor]?.[0].length);
        pop.setPreedit(this.preedit);
    }

    #onCandidateClick(_a, index) {
        this.$src.pop.dispel();
        this.$src.commit.revive(this.lookup[this.$start + index]?.at(0));
    }

    deleteCurrent() {
        let index = ClipHist.findIndex(x => x[0] === this.lookup[this.cursor][0]);
        if(index < 0) return;
        ClipHist.splice(index, 1);
        this.lookup.splice(this.cursor, 1);
        this.setCursor(this.cursor >= this.lookup.length ? Math.max(this.lookup.length - 1, 0) : this.cursor);
    }

    mergeCurrent() {
        let index = ClipHist.findIndex(x => x[0] === this.lookup[this.cursor][0]);
        if(index < 0 || index >= this.lookup.length - 1) return;
        this.lookup.splice(this.cursor, 1);
        let [clip] = ClipHist.splice(index, 1),
            hays = ClipHist[index][2] + clip[2],
            text = `${ClipHist[index][0]} ${clip[0]}`;
        this.lookup[this.cursor] = ClipHist[index] = [text, visibilize(ellipsize(text)), hays];
        this.setCursor(this.cursor);
    }

    selectAt(key) {
        let index = Indices.findIndex(x => x === key);
        if(index < 0 || index >= this.$size) this.$src.pop.dispel();
        else this.#onCandidateClick(null, index, 1, 0);
    }

    setPreedit(preedit) {
        if(this.preedit === preedit) return;
        this.preedit = preedit;
        this.lookup = ClipHist.filter(x => Util.search(this.preedit, x[2]));
        this.setCursor(0);
    }
}

class IBusTweaker extends Fubar.Mortal {
    constructor(gset) {
        super();
        IBusPopup._dummyCursor.set_position(1, 1); // HACK: workaround for the popup jumping
        syncStyleClass(PopupStyleClass, IBusPopup);
        let tweaks = {
            clip:  [Field.CLP,  IBusClipHistory],
            font:  [Field.FNT,  IBusFontSetting],
            input: [Field.ATSW, IBusAutoSwitch],
            page:  [Field.PBTN, IBusPageButton],
            theme: [Field.THM,  IBusThemeManager],
        };
        this.$set = new Fubar.Setting(gset, Util.omap(tweaks, ([k, [field]]) => [[k, [field, 'boolean', null, x => this.$src[k].toggle(x)]]]), this);
        this.$src = Fubar.Source.tie(Util.omap(tweaks, ([k, [, klass]]) => [[k, Fubar.Source.new(() => new klass(this.$set), this[k])]]), this);
    }
}

export default class Extension extends Fubar.Extension { $klass = IBusTweaker; }
