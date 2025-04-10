// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import Gio from 'gi://Gio';
import IBus from 'gi://IBus';
import Shell from 'gi://Shell';
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as LookingGlass from 'resource:///org/gnome/shell/ui/lookingGlass.js';

import * as T from './util.js';
import * as F from './fubar.js';
import {Key as K} from './const.js';

const {_} = F;

const InputManager = Main.panel.statusArea.keyboard._inputSourceManager;
const IBusManager = InputManager._ibusManager;
const IBusPopup = IBusManager._candidatePopup;
const IBusArea = IBusPopup._candidateArea;

const ClipHist = [];
const Style = {SYSTEM: 0, LIGHT: 1, DARK: 2};
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

const charmap = () => T.fopen('resource://org/gnome/shell/extensions/ibus-tweaker/alpha.txt').load_bytes(null)[0].get_data();
const slugify = (txt, map = charmap()) => [...txt].map(x => (y => y === 0 ? x : String.fromCodePoint(y))(map[x.codePointAt(0)])).join('');

function syncStyleClass(aim, src, func = T.id, tpl = PopupStyleClass) {
    return T.Y(f => (a, b, c) => Object.keys(c).forEach(k => c[k] instanceof Object
        ? a[k] && f(a[k], b[k], c[k]) : k === 'styleClass' && (a[k] = func(b[k]))))(aim, src, tpl);
}

class IBusAutoSwitch extends F.Mortal {
    constructor(set) {
        super();
        this.#bindSettings(set);
        this.#buildWidgets();
    }

    #bindSettings(set) {
        this.$set = set.tie([[K.IPMS, x => new Map(Object.entries(x)), null, true]], this);
    }

    #buildWidgets() {
        F.connect(this, global.display, 'notify::focus-window', () => this.toggleInputMode(),
            Main.overview, 'hidden', () => this.setDummy(), 'shown', () => this.setDummy('#overview'));
        this.$src = F.Source.tie({
            run: F.Source.newInjector([ModalDialog.ModalDialog.prototype, {
                open: (a, f) => { this.setDummy('#modal-dialog'); return f.call(a); },
                close: (a, f) => { this.setDummy(Main.lookingGlass?.isOpen ? '#looking-glass' : ''); return f.call(a); },
            }, LookingGlass.LookingGlass.prototype, {
                open: (a, f) => { this.setDummy('#looking-glass'); return f.call(a); },
                close: (a, f) => { this.setDummy(); return f.call(a); },
            }], true),
        }, this);
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

    setDummy(dummy) {
        this.$dummy = dummy;
        this.toggleInputMode();
    }

    saveInputMode(win, id, mode) {
        this[K.IPMS].set(win, [id, mode]);
        this.$set.set(K.IPMS, Object.fromEntries(this[K.IPMS]));
    }

    checkInputMode(win, id, mode) {
        if(!win) return false;
        if(!this[K.IPMS].has(win)) this.saveInputMode(win, id, mode);
        [this.id, this.mode] = this[K.IPMS].get(win);
        return this.id !== id || this.mode !== mode;
    }

    toggleInputMode() {
        let {id, properties} = InputManager.currentSource;
        let mode = this.getInputMode(properties);
        if(this.checkInputMode(this.win, id, mode)) this.saveInputMode(this.win, id, mode);
        let win = this.$dummy || global.display.focus_window?.wm_class?.toLowerCase();
        if(this.checkInputMode(this.win = win, id, mode) && this.id === id) this.setInputMode(properties, this.mode);
    }
}

class IBusFontSetting extends F.Mortal {
    constructor(set) {
        super();
        let {style} = IBusPopup;
        this.$set = set.tie([[K.FNTS, null, x => this.$src.font.summon(x)]], this);
        this.$src = F.Source.tie({font: new F.Source(() => this.#setup(), () => IBusPopup.set_style(style), true)}, this);
    }

    #setup() {
        let desc = Pango.FontDescription.from_string(this[K.FNTS]);
        let weight = T.essay(() => desc.get_weight(), e => parseInt(e.message)); // HACK: workaround for Pango.Weight enumeration exception (eg: 290)
        IBusPopup.set_style(`font-weight: ${weight};
font-family: "${desc.get_family()}";
font-style: ${Object.keys(Pango.Style)[desc.get_style()].toLowerCase()};
font-size: ${desc.get_size() / Pango.SCALE}${desc.get_size_is_absolute() ? 'px' : 'pt'};`);
    }
}

class IBusPageButton extends F.Mortal { // HACK: workaround for css without `display: none` support
    constructor() {
        super();
        IBusArea._buttonBox.hide();
        F.Source.tie({btn: F.Source.newInjector([IBusArea._buttonBox, {show: T.nop, hide: T.nop}], true)}, this);
    }
}

class IBusPresetTheme extends F.Mortal {
    constructor(set) {
        super();
        this.#buildSources();
        this.#bindSettings(set);
    }

    #buildSources() {
        this.$src = F.Source.tie({
            style: new F.Source(() => syncStyleClass(IBusPopup, PopupStyleClass, x => x.replace(/candidate/g, 'ibus-tweaker-candidate')), () => {
                if(this.dark) IBusPopup.remove_style_class_name('night');
                syncStyleClass(IBusPopup, PopupStyleClass);
            }, true),
        }, this);
    }

    #bindSettings(set) {
        this.$setIF = new F.Setting('org.gnome.desktop.interface', [[['scheme', 'color-scheme'],
            x => x === 'prefer-dark', () => this.#onStyleSet()]], this);
        this.$set = set.tie([K.STL], this, () => this.#onStyleSet());
    }

    #onStyleSet() {
        let dark = this[K.STL] === Style.SYSTEM ? this.scheme : this[K.STL] === Style.DARK;
        if(this.dark === dark) return;
        if((this.dark = dark)) IBusPopup.add_style_class_name('night');
        else IBusPopup.remove_style_class_name('night');
    }
}

class IBusClipPopup extends BoxPointer.BoxPointer {
    static {
        T.enrol(this);
    }

    constructor(page, hooks) {
        super(St.Side.TOP);
        this.set({visible: false, reactive: true});
        this.#buildWidgets(page, hooks);
        Main.layoutManager.addChrome(this);
        global.focusManager.add_group(this);
        global.stage.set_key_focus(this);
    }

    #buildWidgets(page, hooks) {
        let box = T.seq(w => this.bin.set_child(w), new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL}));
        let hbox = T.seq(w => box.add_child(w), new St.BoxLayout());
        [this._preeditText, this._auxText] = [true, false].map(x => T.seq(w => hbox.add_child(w), new St.Label({visible: true, xExpand: x})));
        this._candidateArea = T.seq(w => box.add_child(w), T.hook(hooks, new IBusArea.constructor()));
        syncStyleClass(this, IBusPopup);
        this.set_style(IBusPopup.style);
        if(page) {
            let btn = this._candidateArea._buttonBox;
            btn.hide(); btn.show = btn.hide = T.nop;
        } else {
            this._candidateArea.setOrientation(IBus.Orientation.VERTICAL);
        }
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

class IBusClipHistory extends F.Mortal {
    constructor(set) {
        super();
        this.#bindSettings(set);
        this.#buildSources();
        this.#buildWidgets();
    }

    #bindSettings(set) {
        this.$set = set.tie([K.CLPS, K.PBTN], this);
    }

    #buildSources() {
        let box = new F.Source(() => T.hook({
                'captured-event': (...xs) => this.#onCapture(...xs),
            }, new IBusClipPopup(this[K.PBTN], {
                'cursor-up': () => this.navigate(-1),
                'cursor-down': () => this.navigate(1),
                'next-page': () => this.navigate(this[K.CLPS]),
                'previous-page': () => this.navigate(-this[K.CLPS]),
                'candidate-clicked': (...xs) => this.#onCandidateClick(...xs),
            }))),
            keys = F.Source.newKeys(this.$set.hub, K.CKYS, () => this.summon(), true),
            csr = T.seq(x => Main.uiGroup.add_child(x), new Clutter.Actor({opacity: 0, x: 1, y: 1})), // HACK: workaround for the cursor jumping
            put = F.Source.newTimer(x => [() => IBusManager._panelService?.commit_text(IBus.Text.new_from_string(x)), 30]);
        this.$src = F.Source.tie({csr, box, keys, put}, this);
    }

    #buildWidgets() {
        F.connect(this, global.display.get_selection(), 'owner-changed', (...xs) => this.#onClipboardChange(...xs));
    }

    #shrink(txt, len = 20) {
        let ret = txt.length > 2 * len ? `${txt.slice(0, len)}\u{2026}${txt.slice(-len)}` : txt;
        return [[/\n|\r/g, '\u{21b5}'], ['\t', '\u{21e5}']].reduce((p, x) => p.replaceAll(...x), ret);
    }

    #onClipboardChange(_s, type, src) {
        if(type !== St.ClipboardType.CLIPBOARD || !src) return;
        F.paste().then(text => {
            let index = ClipHist.findIndex(x => x[0] === text);
            if(index < 0) {
                ClipHist.unshift([text, this.#shrink(text), slugify(text)]);
                while(ClipHist.length > 64) ClipHist.pop();
            } else if(index > 0) {
                [ClipHist[0], ClipHist[index]] = [ClipHist[index], ClipHist[0]];
            }
        }).catch(T.nop);
    }

    #onCapture(actor, event) {
        let type = event.type();
        if(type === Clutter.EventType.KEY_PRESS) {
            let key = event.get_key_symbol();
            if(key >= Clutter.KEY_exclam && key <= Clutter.KEY_asciitilde) {
                if(key >= Clutter.KEY_0 && key <= Clutter.KEY_9) this.select(String.fromCodePoint(key));
                else this.setPreedit(this.preedit + String.fromCodePoint(key));
            } else if(key >= Clutter.KEY_KP_0 && key <= Clutter.KEY_KP_9) {
                this.setPreedit(this.preedit + (key - Clutter.KEY_KP_0));
            } else {
                switch(key) {
                case Clutter.KEY_space:
                case Clutter.KEY_Return:
                case Clutter.KEY_KP_Enter:
                case Clutter.KEY_ISO_Enter: this.#onCandidateClick(null, this.cursor - this.$addr, 1, 0); break;
                case Clutter.KEY_Left:
                case Clutter.KEY_Page_Up:   this.navigate(-this[K.CLPS]); break;
                case Clutter.KEY_Right:
                case Clutter.KEY_Page_Down: this.navigate(this[K.CLPS]); break;
                case Clutter.KEY_Up:        this.navigate(-1); break;
                case Clutter.KEY_Down:      this.navigate(1); break;
                case Clutter.KEY_backslash: this.merge(); break;
                case Clutter.KEY_Delete:    this.delete(event.get_state() & Clutter.ModifierType.SHIFT_MASK); break;
                case Clutter.KEY_BackSpace: this.setPreedit(this.preedit.slice(0, -1)); break;
                case Clutter.KEY_Shift_L: break;
                default: this.$src.box.dispel(); break;
                }
            }
            return Clutter.EVENT_STOP;
        } else if((type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) &&
                  !actor.contains(global.stage.get_event_actor(event))) {
            this.$src.box.dispel();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    summon() {
        if(this.$src.box.active || !IBusManager._ready || Main.overview._shown) return;
        this.$src.box.summon();
        this.setPreedit('');
        this.$src.csr.set_position(...IBusPopup._dummyCursor.get_transformed_position());
        this.$src.csr.set_size(...IBusPopup._dummyCursor.get_transformed_size());
        this.$src.box.hub.summon(this.$src.csr);
    }

    navigate(offset) {
        let pos = this.cursor + offset;
        if(pos >= 0 && pos < this.table.length) {
            this.setCursor(pos);
        } else if(pos >= this.table.length) {
            let target = (this.$page + 1) * this[K.CLPS];
            if(this.table.length > target) this.setCursor(target);
        }
    }

    setCursor(cursor) {
        this.cursor = cursor;
        this.$page = Math.floor(this.cursor / this[K.CLPS]);
        this.$addr = this.$page * this[K.CLPS];
        this.$size = Math.min(this[K.CLPS], this.table.length - this.$addr);
        let box = this.$src.box.hub,
            indices = this.$size ? Indices.slice(0, this.$size) : ['\u{2205}'],
            candidates = this.$size ? this.table.slice(this.$addr, this.$addr + this.$size).map(x => x[1]) : [_('Empty history.')];
        box._candidateArea.setCandidates(indices, candidates, this.cursor % this[K.CLPS], this.$size);
        box._candidateArea.updateButtons(false, this.$page, Math.ceil(this.table.length / this[K.CLPS]));
        box.setAuxText(this.table[this.cursor]?.[0].length);
        box.setPreedit(this.preedit);
    }

    #onCandidateClick(_a, index) {
        this.$src.box.dispel();
        this.$src.put.revive(this.table[this.$addr + index]?.at(0));
    }

    delete(all) {
        if(all) {
            ClipHist.splice(0);
            this.table.splice(0);
            this.setCursor(0);
        } else {
            let index = ClipHist.findIndex(x => x === this.table[this.cursor]);
            if(index < 0) return;
            ClipHist.splice(index, 1);
            this.table.splice(this.cursor, 1);
            this.setCursor(this.cursor >= this.table.length ? Math.max(this.table.length - 1, 0) : this.cursor);
        }
    }

    merge() {
        let index = ClipHist.findIndex(x => x === this.table[this.cursor]);
        if(index < 0 || index >= this.table.length - 1) return;
        this.table.splice(this.cursor, 1);
        let [clip] = ClipHist.splice(index, 1),
            hays = ClipHist[index][2] + clip[2],
            text = `${ClipHist[index][0]} ${clip[0]}`;
        this.table[this.cursor] = ClipHist[index] = [text, this.#shrink(text), hays];
        this.setCursor(this.cursor);
    }

    select(key) {
        let index = Indices.findIndex(x => x === key);
        if(index < 0 || index >= this.$size) this.$src.box.dispel();
        else this.#onCandidateClick(null, index, 1, 0);
    }

    setPreedit(preedit) {
        this.preedit = preedit;
        this.table = preedit ? ClipHist.filter(x => T.search(this.preedit, x[2])) : [...ClipHist];
        this.setCursor(0);
    }
}

export class IBusSlugSearch extends F.Mortal {
    constructor() {
        super();
        this.$src = F.Source.tie({
            app: F.Source.newInjector([AppDisplay.AppSearchProvider.prototype, {getInitialResultSet: (...xs) => this.search(...xs)}], true),
        }, this);
        F.connect(this, Gio.AppInfoMonitor.get(), 'changed', () => this.$parental && this.#update());
    }

    #init(host) {
        let map = charmap();
        this.$acts = Array.from(host._systemActions._actions, ([k, {available: a, keywords: ws}]) =>
            a ? [[k, ws.flatMap(w => /[^\p{ASCII}]/u.test(w) ? [slugify(w, map)] : [])]] : []).flat();
        this.$parental = host._parentalControlsManager;
        this.#update(map);
    }

    async search(host, search, [terms, ...args]) {
        let ret = await search.call(host, terms, ...args);
        if(ret.length) return ret;
        if(!this.$parental) this.#init(host);
        return this.match([this.$apps, this.$acts], terms);
    }

    match(items, terms) {
        let i, j, k;
        return items.flatMap(xs => xs.reduce((p, [id, ws]) => {
            i = Infinity;
            if(terms.every(t => T.seq(x => { if(x < i) i = x, j = k; },
                ws.findIndex(w => (k = w.indexOf(t)) >= 0)) >= 0)) (p[i] ??= []).push([j, id]);
            return p;
        }, []).reduce((p, x) => (x && x.sort(([a], [b]) => a - b).forEach(y => p.push(y[1])), p), []));
    }

    #update(map = charmap()) {
        let slug = x => x && /[^\p{ASCII}]/u.test(x) ? slugify(x, map) : '';
        this.$apps = Gio.AppInfo.get_all().reduce((p, app) => {
            if(!app.should_show() || !this.$parental.shouldShowApp(app)) return p;
            let words = app.get_locale_string('Keywords')?.split(';').map(slug).filter(T.id).join(';') ?? '';
            let names = ['Name', 'GenericName', 'X-GNOME-FullName'].map(x => slug(app.get_locale_string(x)));
            if(words || names.some(T.id)) names[0] ||= app.get_string('Name').toLowerCase(), p.push([app.get_id(), names.concat(words)]);
            return p;
        }, []);
    }
}

class IBusTweaker extends F.Mortal {
    constructor(gset) {
        super();
        IBusPopup._dummyCursor.set_position(1, 1); // HACK: workaround for the popup jumping
        syncStyleClass(PopupStyleClass, IBusPopup);
        let tweaks = [
            [K.APP,  IBusSlugSearch],
            [K.ATSW, IBusAutoSwitch],
            [K.PBTN, IBusPageButton],
            [K.CLP,  IBusClipHistory],
            [K.FNT,  IBusFontSetting],
            [K.THM,  IBusPresetTheme],
        ];
        this.$set = new F.Setting(gset, tweaks.map(([k]) => [k, null, x => this.$src[k].toggle(x)]), this);
        this.$src = F.Source.tie(Object.fromEntries(tweaks.map(([k, v]) => [k, F.Source.new(() => new v(this.$set), this[k])])), this);
    }
}

export default class extends F.Extension { $klass = IBusTweaker; }
