// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import IBus from 'gi://IBus';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';

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
        this.$set = set.tie(this, [[['modes', K.IPMS], x => new Map(Object.entries(x)), null, true]]);
    }

    $buildSources() {
        F.Source.tie(this,
            F.Source.newHandler(global, 'shutdown', () => this.save(), this, 'destroy', () => this.save(),
                global.display, 'notify::focus-window', () => this.toggle(), GObject.ConnectFlags.AFTER,
                Main.overview, 'hidden', () => this.setDummy(), 'shown', () => this.setDummy('$overview')),
            F.Source.newInjector([ModalDialog.ModalDialog.prototype, {
                open: (a, f, xs) => { this.setDummy('$modal-dialog'); return f.apply(a, xs); },
                close: (a, f, xs) => { this.setDummy(Main.lookingGlass?.isOpen ? '$looking-glass' : ''); return f.apply(a, xs); },
            }, LookingGlass.LookingGlass.prototype, {
                open: (a, f, xs) => { this.setDummy('$looking-glass'); return f.apply(a, xs); },
                close: (a, f, xs) => { this.setDummy(); return f.apply(a, xs); },
            }], true));
    }

    save() {
        this.$set.set(K.IPMS, Object.fromEntries(this.modes));
    }

    *enumerate(props) {
        if(props) for(let i = 0, p; (p = props.get(i)); i++) if(p.key.startsWith('InputMode')) yield p;
    }

    get(props) {
        for(let p of this.enumerate(props)) {
            switch(p.propType) {
            case IBus.PropType.NORMAL: // ibus-libpinyin
            case IBus.PropType.TOGGLE: return p.symbol?.get_text(); // ibus-hangul
            case IBus.PropType.RADIO: if(p.state) return p.key.split('.').at(-1); break; // ibus-typing-booster
            case IBus.PropType.MENU: return this.get(p.subProps); // ibus-typing-booster
            }
        }
    }

    set(props, mode) {
        for(let p of this.enumerate(props)) {
            switch(p.propType) {
            case IBus.PropType.NORMAL:
            case IBus.PropType.TOGGLE: this.activate(p); break;
            case IBus.PropType.MENU: return this.set(p.subProps, mode);
            case IBus.PropType.RADIO: if(p.key.endsWith(mode)) this.activate(p); break;
            }
        }
    }

    activate(prop) {
        IBusManager.activateProperty(prop.key, prop.state ? IBus.PropState.UNCHECKED : IBus.PropState.CHECKED);
    }

    setDummy(dummy) {
        this[$].dummy(dummy).toggle();
    }

    check(id, mode, set) {
        if(!this.win) return false;
        if(!this.modes.has(this.win)) this.modes.set(this.win, [id, mode]);
        [this.id, this.mode] = this.modes.get(this.win);
        return set ? this.mode !== mode && this.id === id : this.mode !== mode || this.id !== id;
    }

    toggle() {
        let {id, properties} = InputManager.currentSource;
        let mode = this.get(properties) ?? '';
        if(this.check(id, mode)) this.modes.set(this.win, [id, mode]);
        this.win = this.dummy || global.display.focus_window?.wm_class;
        if(this.check(id, mode, true)) this.set(properties, this.mode);
    }
}

class FgAttribute extends F.Mortal {
    $buildSources() {
        this.$src = F.Source.tie(this, F.Source.newInjector([
            IBusArea, {setCandidates: (...xs) => this.setCandidates(...xs)},
            IBus.LookupTable.prototype, {is_cursor_visible: (a, f, xs) => [f.apply(a, xs), a]},
        ], true));
    }

    setCandidates(a, f, xs) {
        let [cursor, table] = xs.at(-1);
        f.apply(a, xs.with(-1, cursor));
        let pos = table.get_cursor_pos();
        let start = pos - (pos % table.get_page_size());
        for(let n = xs[1].length, i = 0; i < n; i++) {
            let box = IBusArea._candidateBoxes[i];
            this.sync(box._indexLabel, table.get_label(i));
            this.sync(box._candidateLabel, table.get_candidate(start + i));
        }
    }

    sync(label, ibus_text) {
        let attrs = ibus_text?.get_attributes();
        if(!attrs) return;
        let mark = '';
        let utf8 = Iterator.from(ibus_text.get_text()); // String.slice - UTF-16 & IBus.Text - g_utf8_strlen, so iter codepoints here
        for(let cursor = 0, i = 0, attr; (attr = attrs.get(i)); i++) {
            let start = attr.get_start_index();
            if(attr.get_attr_type() !== IBus.AttrType.FOREGROUND || start < cursor) continue;
            let end = attr.get_end_index(),
                color = attr.get_value().toString(16).padStart(6, '0'),
                text = T.esc(utf8.take(start - cursor).toArray().join('')),
                span = T.esc(utf8.take((cursor = end) - start).toArray().join(''));
            mark += `${text}<span fgcolor="#${color}">${span}</span>`;
        }
        if(mark) F.marks(label, mark + T.esc(utf8.toArray().join('')));
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

    aligned = new WeakSet();

    $bindSettings(set) {
        this.$setIF = new F.Setting('org.gnome.desktop.interface', this,
            [[['scheme', 'color-scheme'], x => x === 'prefer-dark', () => this.$update()]]);
        this.$set = set.tie(this, [K.STL], null, () => this.$update());
    }

    $buildSources() {
        F.Source.tie(this, F.Source.newInjector([IBusPopup, {get_theme_node: (...xs) => this.$align(...xs)}], true),
            new F.Source(() => syncStyleClass(IBusPopup, PopupStyleClass, x => x.replace(/candidate/g, 'ibus-tweaker-candidate')),
                () => syncStyleClass(IBusPopup[$_].remove_style_class_name(this.dark, 'night'), PopupStyleClass), true));
        this.$update();
    }

    $update() {
        let dark = this[K.STL] === PresetTheme.Style.SYSTEM ? this.scheme : this[K.STL] === PresetTheme.Style.DARK;
        if(this.dark === dark) return;
        if((this.dark = dark)) IBusPopup.add_style_class_name('night');
        else IBusPopup.remove_style_class_name('night');
    }

    $align(a, f, xs) {
        let theme = f.apply(a, xs);
        if(!this.aligned.has(theme)) {
            this.aligned.add(theme);
            T.inject(theme, 'get_length', (o, k) => (...ys) => {
                if(ys[0] === '-arrow-border-radius') {
                    let {x} = IBusArea._candidateBoxes[0]._candidateLabel.apply_relative_transform_to_point(IBusPopup, Graphene.point3d_zero());
                    if(Number.isFinite(x)) return x / 2;
                }
                return k.apply(o, ys);
            });
        }
        return theme;
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
        syncStyleClass(this[$].set_style(`max-width: ${ClipHistory.WIDTH / 2}em; ${IBusPopup.style}`), IBusPopup);
        if(page) this._candidateArea._buttonBox[$].hide().set({show: T.nop, hide: T.nop});
        else this._candidateArea.setOrientation(IBus.Orientation.VERTICAL);
    }

    setPreedit(text, count) {
        this._preeditText.set_text(`📋: ${text}`);
        this._auxText.set_text(count ? _('%dC').format(count) : null);
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
    static WIDTH = 50; // max display chars
    static Indices = '1234567890';

    $bindSettings(set) {
        this.$set = set.tie(this, [K.CLPS, K.BTN]);
    }

    $buildSources() {
        let box = F.Source.new(() => new ClipPopup(this[K.BTN], [
                ['cursor-up', () => this.navigate(-1)],
                ['cursor-down', () => this.navigate(1)],
                ['next-page', () => this.navigate(this[K.CLPS])],
                ['previous-page', () => this.navigate(-this[K.CLPS])],
                ['candidate-clicked', (_a, x) => this.commit(this.addr + x)],
            ])[$].connect('captured-event', (...xs) => this.$onCapture(...xs))),
            kbd = F.Source.newKeyboard(),
            put = F.Source.newTimer(x => [() => kbd.commit(x, this.focused), 30]),
            key = F.Source.newKeys(this.$set.hub, K.CKYS, () => this.summon(), true),
            csr = new Clutter.Actor({opacity: 0, x: 1, y: 1})[$$](x => Main.uiGroup.add_child(x)), // HACK: workaround for the cursor jumping
            dog = F.Source.newHandler(global.display.get_selection(), 'owner-changed', (...xs) => this.$onClipboardChange(...xs));
        this.$src = F.Source.tie(this, {csr, box, put, kbd}, key, dog);
    }

    $onClipboardChange(_s, type, src) {
        if(type !== St.ClipboardType.CLIPBOARD || !src) return;
        F.paste().then(text => {
            let {db} = this;
            let index = db.findIndex(x => x[0] === text);
            if(index < 0) {
                db.unshift(new Proxy({text}, {
                    get(t, p, r) {
                        switch(p) {
                        case 'search': return (t[p] ??= (x => x === text ? '' : x)(slugify(text))) || text;
                        case 'shrink': return (t[p] ??= (x => x === text ? '' : `${x}...`)(text
                                .slice(0, ClipHistory.WIDTH).replace(/\n|\r/g, '\u{21b5}'))) || text;
                        default: return Reflect.get(t, p, r);
                        }
                    },
                }));
                while(db.length > 50) db.pop();
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
        if(this.$src.box.active) return;
        this.focused = this.$src.kbd.focused();
        this.$src.box.summon();
        this.updatePreedit('');
        let x, y, width, height;
        if(this.focused) ({origin: {x, y}, size: {width, height}} = IBusPopup._dummyCursor.get_transformed_extents());
        else [x, y] = global.get_pointer(), width = height = Meta.prefs_get_cursor_size();
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
        let candidates = this.size ? this.table.slice(this.addr, this.addr + this.size).map(x => x.shrink) : [_('Empty history.')];
        this.$src.box.hub[$].setPreedit(this.preedit, this.table[this.pos]?.text.length)
            ._candidateArea[$].setCandidates(indices, candidates, this.pos % this[K.CLPS], this.size)
            .updateButtons(false, this.page, Math.ceil(this.table.length / this[K.CLPS]));
    }

    commit(index, copy) {
        this.$src.box.dispel();
        let text = this.table[index]?.text;
        if(!text) return;
        if(copy) F.copy(text);
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
        this[$].preedit(preedit)[$].table(preedit ? this.db.reduce((p, x) => {
            let seek = T.search(preedit, x.search);
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
            [K.IPM, InputMode],
            [K.APP, SlugSearch],
            [K.BTN, PageButton],
            [K.CLP, ClipHistory],
            [K.FNT, FontSetting],
            [K.FGA, FgAttribute],
            [K.THM, PresetTheme],
        ];
        this.$set = new F.Setting(gset, this, tweaks.map(([k]) => [k, null, x => this.$src[k].toggle(x)]));
        this.$src = F.Source.tie(this, Object.fromEntries(tweaks.map(([k, v]) => [k, F.Source.new(() => new v(this.$set), this[k])])));
    }
}

export default class extends F.Extension { $klass = IBusTweaker; }
