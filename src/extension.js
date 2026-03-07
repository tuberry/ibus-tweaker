// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import IBus from 'gi://IBus';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
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
const {$, $$, $_, $s} = T;

const InputManager = Main.panel.statusArea.keyboard._inputSourceManager;
const IBusManager = InputManager._ibusManager;
const IBusPopup = IBusManager._candidatePopup;
const IBusArea = IBusPopup._candidateArea;

const PopupStyleClass = {
    styleClass: '',
    _candidateArea: {
        _candidateBoxes: (box => Array(16).fill(box))({
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
}[$$](x => syncStyleClass(x, IBusPopup, T.id, x));

const charmap = () => T.fopen('resource:///org/gnome/shell/extensions/ibus-tweaker/alpha.txt').load_bytes(null)[0].get_data();
const slugify = (txt, map = charmap()) => [...txt].map(x => (y => y === 0 ? x : String.fromCodePoint(y))(map[x.codePointAt(0)])).join('');

function syncStyleClass(aim, src, func = T.id, tpl = PopupStyleClass) {
    return T.Y(f => (a, b, c) => Object.keys(c).forEach(k => c[k] instanceof Object
        ? a[k] && f(a[k], b[k], c[k]) : k === 'styleClass' && (a[k] = func(b[k]))))(aim, src, tpl);
}

class InputMode extends F.Mortal {
    $bindSettings(set) {
        this.$set = set.tie(this, [[K.IPMS, x => new Map(Object.entries(x)), null, true]]);
    }

    $buildSources() {
        F.Source.tie(this,
            F.Source.newHandler(global.display, 'notify::focus-window', () => this.toggle(),
                Main.overview, 'hidden', () => this.setDummyWMClass(), 'shown', () => this.setDummyWMClass('$overview')),
            F.Source.newInjector([ModalDialog.ModalDialog.prototype, {
                open: (a, f) => { this.setDummyWMClass('$modal-dialog'); return f.call(a); },
                close: (a, f) => { this.setDummyWMClass(Main.lookingGlass?.isOpen ? '$looking-glass' : ''); return f.call(a); },
            }, LookingGlass.LookingGlass.prototype, {
                open: (a, f) => { this.setDummyWMClass('$looking-glass'); return f.call(a); },
                close: (a, f) => { this.setDummyWMClass(); return f.call(a); },
            }], true));
    }

    *enumerate(props) {
        if(props) for(let p, i = 0; (p = props.get(i)); i++) if(p.key.startsWith('InputMode')) yield p;
    }

    get(props) {
        for(let {propType, symbol, label, state, subProps, key} of this.enumerate(props)) {
            switch(propType) {
            case IBus.PropType.NORMAL: return symbol?.get_text() ?? label.get_text(); // ibus-libpinyin
            case IBus.PropType.TOGGLE: return state.toString(); // ibus-hangul
            case IBus.PropType.MENU: return this.get(subProps); // ibus-typing-booster
            case IBus.PropType.RADIO: if(state) return key.split('.').at(-1); break; // ibus-typing-booster
            }
        }
        return '';
    }

    set(props, mode) {
        for(let {propType, key, state, subProps} of this.enumerate(props)) {
            switch(propType) {
            case IBus.PropType.NORMAL:
            case IBus.PropType.TOGGLE: return this.activate(key, !state);
            case IBus.PropType.MENU: return this.set(subProps, mode);
            case IBus.PropType.RADIO: if(key.endsWith(mode)) return this.activate(key, !state); break;
            }
        }
    }

    activate(key, state) {
        IBusManager.activateProperty(key, state ? 1 : 0);
    }

    setDummyWMClass(dummy) {
        this[$].dummy(dummy).toggle();
    }

    save(win, id, mode) {
        this[K.IPMS].set(win, [id, mode]);
        this.$set.set(K.IPMS, Object.fromEntries(this[K.IPMS]));
    }

    check(win, id, mode) {
        if(!win) return false;
        if(!this[K.IPMS].has(win)) this.save(win, id, mode);
        [this.id, this.mode] = this[K.IPMS].get(win);
        return this.id !== id || this.mode !== mode;
    }

    toggle() {
        let {id, properties} = InputManager.currentSource;
        let mode = this.get(properties);
        if(this.check(this.win, id, mode)) this.save(this.win, id, mode);
        let win = this.dummy || global.display.focus_window?.wm_class?.toLowerCase();
        if(this.check(this.win = win, id, mode) && this.id === id) this.set(properties, this.mode);
    }
}

class FontSetting extends F.Mortal {
    $bindSettings(set) {
        let {style} = IBusPopup;
        this.$set = set.tie(this, [[K.FNTS, null, x => this.$src.font.summon(x)]]);
        this.$src = F.Source.tie(this, {font: new F.Source(() => this.$setup(), () => IBusPopup.set_style(style), true)});
    }

    $setup() {
        let desc = Pango.FontDescription.from_string(this[K.FNTS]);
        let weight = T.essay(() => desc.get_weight(), e => parseInt(e.message)); // HACK: workaround for Pango.Weight enumeration exception (eg: 290)
        IBusPopup.set_style(`font-weight: ${weight};
font-family: "${desc.get_family()}";
font-style: ${Object.keys(Pango.Style)[desc.get_style()].toLowerCase()};
font-size: ${desc.get_size() / Pango.SCALE}${desc.get_size_is_absolute() ? 'px' : 'pt'};`);
    }
}

class PageButton extends F.Mortal { // HACK: workaround for css without `display: none` support
    $buildSources() {
        IBusArea._buttonBox.hide();
        F.Source.tie(this, F.Source.newInjector([IBusArea._buttonBox, {show: T.nop, hide: T.nop}], true));
    }
}

class PresetTheme extends F.Mortal {
    static Style = {SYSTEM: 0, LIGHT: 1, DARK: 2};

    $bindSettings(set) {
        this.$setIF = new F.Setting('org.gnome.desktop.interface', this, [
            [['scheme', 'color-scheme'], x => x === 'prefer-dark', () => this.$update()],
        ]);
        this.$set = set.tie(this, [K.STL], null, () => this.$update());
    }

    $buildSources() {
        F.Source.tie(this, new F.Source(() => syncStyleClass(IBusPopup, PopupStyleClass, x => x.replace(/candidate/g, 'ibus-tweaker-candidate')),
            () => syncStyleClass(IBusPopup[$_].remove_style_class_name(this.dark, 'night'), PopupStyleClass), true));
        this.$update();
    }

    $update() {
        let dark = this[K.STL] === PresetTheme.Style.SYSTEM ? this.scheme : this[K.STL] === PresetTheme.Style.DARK;
        if(this.dark === dark) return;
        if((this.dark = dark)) IBusPopup.add_style_class_name('night');
        else IBusPopup.remove_style_class_name('night');
    }
}

class ClipPopup extends BoxPointer.BoxPointer {
    static {
        T.enrol(this);
    }

    constructor(page, hooks) {
        super(St.Side.TOP)[$].set({visible: false, reactive: true}).$buildWidgets(page, hooks);
        Main.layoutManager.addChrome(this);
        global.focusManager.add_group(this);
        global.stage.set_key_focus(this);
    }

    $buildWidgets(page, hooks) {
        let box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL})[$$](w => this.bin.set_child(w));
        let hbox = new St.BoxLayout()[$$](w => box.add_child(w));
        [this._preeditText, this._auxText] = [true, false].map(x => new St.Label({visible: true, xExpand: x, opacity: x ? 255 : 160})[$$](w => hbox.add_child(w)));
        this._candidateArea = new IBusArea.constructor()[$s].connect(hooks)[$$](w => box.add_child(w));
        syncStyleClass(this[$].set_style(IBusPopup.style), IBusPopup);
        if(page) this._candidateArea._buttonBox[$].hide().set({show: T.nop, hide: T.nop});
        else this._candidateArea.setOrientation(IBus.Orientation.VERTICAL);
    }

    setPreedit(text) {
        this._preeditText.set_text(`${_('📋: ')}${text}`);
    }

    setAuxText(count) {
        this._auxText.set_text(_('%dC').format(count ?? 0));
    }

    summon(cursor) {
        this._candidateArea.visible = true;
        this[$].setPosition(cursor, 0)[$]
            .open(BoxPointer.PopupAnimation.NONE)
            .get_parent().set_child_above_sibling(this, null);
        Main.pushModal(this, {actionMode: Shell.ActionMode.POPUP});
    }
}

class ClipHistory extends F.Mortal {
    static DB = [];
    static Indices = '1234567890';

    $bindSettings(set) {
        this.$set = set.tie(this, [K.CLPS, K.PBTN]);
    }

    $buildSources() {
        let box = F.Source.new(() => new ClipPopup(this[K.PBTN], [
                ['cursor-up', () => this.navigate(-1)],
                ['cursor-down', () => this.navigate(1)],
                ['next-page', () => this.navigate(this[K.CLPS])],
                ['previous-page', () => this.navigate(-this[K.CLPS])],
                ['candidate-clicked', (_a, x) => this.commit(this.addr + x)],
            ])[$].connect('captured-event', (...xs) => this.$onCapture(...xs))),
            key = F.Source.newKeys(this.$set.hub, K.CKYS, () => this.summon(), true),
            csr = new Clutter.Actor({opacity: 0, x: 1, y: 1})[$$](x => Main.uiGroup.add_child(x)), // HACK: workaround for the cursor jumping
            put = F.Source.newTimer(x => [() => IBusManager._panelService?.commit_text(IBus.Text.new_from_string(F.bracket(x))), 30]),
            dog = F.Source.newHandler(global.display.get_selection(), 'owner-changed', (...xs) => this.$onClipboardChange(...xs));
        this.$src = F.Source.tie(this, {csr, box, put}, key, dog);
    }

    $shrink(txt, len = 20) {
        let ret = txt.length > 2 * len ? `${txt.slice(0, len)}\u{2026}${txt.slice(-len)}` : txt;
        return [[/\n|\r/g, '\u{21b5}'], ['\t', '\u{21e5}']].reduce((p, x) => p.replaceAll(...x), ret);
    }

    $onClipboardChange(_s, type, src) {
        if(type !== St.ClipboardType.CLIPBOARD || !src) return;
        F.paste().then(text => {
            let {db} = this;
            let index = db.findIndex(x => x[0] === text);
            if(index < 0) {
                db.unshift([text, this.$shrink(text), slugify(text)]);
                while(db.length > 32) db.pop();
            } else if(index > 0) {
                db.unshift(...db.splice(index, 1));
            }
        }).catch(T.nop);
    }

    $onCapture(actor, event) {
        let type = event.type();
        if(type === Clutter.EventType.KEY_PRESS) {
            let key = event.get_key_symbol();
            if(key >= Clutter.KEY_exclam && key <= Clutter.KEY_asciitilde) {
                if(key === Clutter.KEY_backslash) this.commit(this.pos, true);
                else if(key >= Clutter.KEY_0 && key <= Clutter.KEY_9) this.select(String.fromCodePoint(key));
                else this.updatePreedit(this.preedit + String.fromCodePoint(key).toLocaleLowerCase());
            } else if(key >= Clutter.KEY_KP_0 && key <= Clutter.KEY_KP_9) {
                this.updatePreedit(this.preedit + (key - Clutter.KEY_KP_0));
            } else {
                switch(key) {
                case Clutter.KEY_space:
                case Clutter.KEY_Return:
                case Clutter.KEY_KP_Enter:
                case Clutter.KEY_ISO_Enter: this.commit(this.pos); break;
                case Clutter.KEY_backslash: this.commit(this.pos, true); break;
                case Clutter.KEY_Left:
                case Clutter.KEY_Page_Up:   this.navigate(-this[K.CLPS]); break;
                case Clutter.KEY_Right:
                case Clutter.KEY_Page_Down: this.navigate(this[K.CLPS]); break;
                case Clutter.KEY_Up:        this.navigate(-1); break;
                case Clutter.KEY_Down:      this.navigate(1); break;
                case Clutter.KEY_Delete:    this.delete(event.get_state() & Clutter.ModifierType.SHIFT_MASK); break;
                case Clutter.KEY_BackSpace: this.updatePreedit(this.preedit.slice(0, -1)); break;
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
        if(this.$src.box.active || !IBusManager._ready) return;
        this.defocus = !Main.inputMethod.currentFocus;
        this.$src.box.summon();
        this.updatePreedit('');
        let x, y, width, height;
        if(this.defocus) [x, y] = global.get_pointer(), width = height = Meta.prefs_get_cursor_size();
        else ({origin: {x, y}, size: {width, height}} = IBusPopup._dummyCursor.get_transformed_extents());
        this.$src.box.hub.summon(this.$src.csr[$].set_position(x, y)[$].set_size(width, height));
    }

    navigate(offset) {
        let pos = this.pos + offset;
        if(pos >= 0 && pos < this.table.length) {
            this.updatePos(pos);
        } else if(pos >= this.table.length) {
            let target = (this.page + 1) * this[K.CLPS];
            if(this.table.length > target) this.updatePos(target);
        }
    }

    updatePos(pos) {
        this[$].pos(pos)[$].page(Math.floor(this.pos / this[K.CLPS]))[$]
            .addr(this.page * this[K.CLPS])[$].size(Math.min(this[K.CLPS], this.table.length - this.addr));
        let indices = this.size ? ClipHistory.Indices.slice(0, this.size) : ['\u{2205}'];
        let candidates = this.size ? this.table.slice(this.addr, this.addr + this.size).map(x => x[1]) : [_('Empty history.')];
        this.$src.box.hub[$].setAuxText(this.table[this.pos]?.[0].length)[$].setPreedit(this.preedit)
            ._candidateArea[$].setCandidates(indices, candidates, this.pos % this[K.CLPS], this.size)
            .updateButtons(false, this.page, Math.ceil(this.table.length / this[K.CLPS]));
    }

    commit(index, copy) {
        this.$src.box.dispel();
        let text = this.table[index]?.at(0);
        if(copy || this.defocus) text && F.copy(text);
        else this.$src.put.revive(text);
    }

    get db() {
        return ClipHistory.DB;
    }

    delete(all) {
        if(all) {
            this.table.splice(0);
            this.db.splice(0);
            this.updatePos(0);
        } else {
            let [frag] = this.table.splice(this.pos, 1);
            this.db.splice(this.db.indexOf(frag), 1);
            this.updatePos(this.pos >= this.table.length ? Math.max(this.table.length - 1, 0) : this.pos);
        }
    }

    select(key) {
        let nth = ClipHistory.Indices.indexOf(key);
        if(nth < 0 || nth >= this.size) this.$src.box.dispel();
        else this.commit(this.addr + nth);
    }

    updatePreedit(preedit) {
        this[$].preedit(preedit)[$]
            .table(preedit ? this.db.reduce((p, x) => {
                let seek = T.search(preedit, x[2]);
                return seek ? p[$].push([seek, x]) : p;
            }, []).sort(([[a, b]], [[m, n]]) => b - n || a - m).map(x => x[1]) : [...this.db]).updatePos(0);
    }
}

class SlugSearch extends F.Mortal {
    static Apps = Main.overview._overview._controls._appDisplay;

    $buildSources() {
        F.Source.tie(this, F.Source.newHandler(this, SlugSearch.Apps, 'view-loaded', () => this.$update()),
            F.Source.newInjector([AppDisplay.AppSearchProvider.prototype, {getInitialResultSet: (...xs) => this.search(...xs)}], true));
    }

    $buildWidgets(host) {
        let map = charmap();
        this.$update(map);
        this.acts = host._systemActions._actions.entries().flatMap(([k, {available, keywords}]) =>
            available ? [[k, keywords.flatMap(w => /[^\p{ASCII}]/u.test(w) ? [slugify(w, map)] : [])]] : []);
    }

    $update(map = charmap()) {
        let slug = x => x && /[^\p{ASCII}]/u.test(x) ? slugify(x, map) : '';
        this.apps = SlugSearch.Apps.getAppInfos().reduce((p, app) => {
            let names = ['Name', 'GenericName', 'X-GNOME-FullName'].map(x => slug(app.get_locale_string(x)))[$]
                .push(app.get_locale_string('Keywords')?.split(';').map(slug).filter(T.id).join(';') ?? '');
            if(names.some(T.id)) names[0] ||= app.get_string('Name').toLowerCase(), p.push([app.get_id(), names]);
            return p;
        }, []);
    }

    async search(host, func, args) {
        let ret = await func.apply(host, args);
        if(!this.acts) this.$buildWidgets(host);
        let neo = this.match([this.apps, this.acts], args[0]);
        return neo.length ? ret.concat(neo) : ret;
    }

    match(items, terms) {
        let i, j, k;
        return items.flatMap(xs => xs.reduce((p, [id, ws]) => {
            i = Infinity;
            if(terms.every(t => ws.findIndex(w => (k = w.indexOf(t)) >= 0)[$$](
                x => { if(x < i) i = x, j = k; }) >= 0)) (p[i] ??= []).push([j, id]);
            return p;
        }, []).reduce((p, x) => (x && x.sort(([a], [b]) => a - b).forEach(y => p.push(y[1])), p), []));
    }
}

class IBusTweaker extends F.Mortal {
    $bindSettings(gset) {
        let tweaks = [
            [K.APP,  SlugSearch],
            [K.ATSW, InputMode],
            [K.PBTN, PageButton],
            [K.CLP,  ClipHistory],
            [K.FNT,  FontSetting],
            [K.THM,  PresetTheme],
        ];
        this.$set = new F.Setting(gset, this, tweaks.map(([k]) => [k, null, x => this.$src[k].toggle(x)]));
        this.$src = F.Source.tie(this, Object.fromEntries(tweaks.map(([k, v]) => [k, F.Source.new(() => new v(this.$set), this[k])])));
    }
}

export default class extends F.Extension { $klass = IBusTweaker; }
