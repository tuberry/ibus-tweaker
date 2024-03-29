// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import St from 'gi://St';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import IBus from 'gi://IBus';
import Shell from 'gi://Shell';
import Pango from 'gi://Pango';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';

import {Field} from './const.js';
import {s2py} from './pinyin.js';
import {noop, hook, id as echo, has} from './util.js';
import {Fulu, ExtensionBase, Destroyable, symbiose, omit, connect, bindNight, _} from './fubar.js';

const InputManager = Main.panel.statusArea.keyboard._inputSourceManager;
const IBusManager = InputManager._ibusManager;
const IBusPopup = IBusManager._candidatePopup;
const IBusArea = IBusPopup._candidateArea;

const ClipHist = [];
const Style = {AUTO: 0, LIGHT: 1, DARK: 2, SYSTEM: 3};
const Indices = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
const PopupStyleClass = {
    style_class: '',
    _candidateArea: {
        _candidateBoxes: Array(16).fill({
            style_class: '',
            _indexLabel: {style_class: ''},
            _candidateLabel: {style_class: ''},
        }),
        _buttonBox: {style_class: ''},
        _previousButton: {style_class: ''},
        _nextButton: {style_class: ''},
    },
    bin: {child: {style_class: ''}},
    _preeditText: {style_class: ''},
    _auxText: {style_class: ''},
};

const ellipsize = (s, l = 20) => s.length > 2 * l ? `${s.slice(0, l)}\u2026${s.slice(-l)}` : s;
const visibilize = (s, t = [[/\n|\r/g, '\u21b5'], ['\t', '\u21e5']]) => t.reduce((p, x) => p.replaceAll(...x), s);

function syncStyleClass(aim, src, func = echo, obj = PopupStyleClass) {
    Object.keys(obj).forEach(k => obj[k] instanceof Object
        ? aim[k] && syncStyleClass(aim[k], src[k], func, obj[k]) : k === 'style_class' && (aim[k] = func(src[k])));
}

function fuzzySearch(needle, haystack) {
    // Ref: https://github.com/bevacqua/fuzzysearch
    if(needle.length > haystack.length) return false;
    if(needle.length === haystack.length) return needle === haystack;
    outer: for(let i = 0, j = 0; i < needle.length; i++) {
        while(j < haystack.length) if(haystack[j++] === needle[i]) continue outer;
        return false;
    }
    return true;
}

class IBusAutoSwitch extends Destroyable {
    constructor(fulu) {
        super();
        this._buildWidgets(fulu);
        this._bindSettings();
    }

    _buildWidgets(fulu) {
        this._fulu = fulu;
        connect(this, [global.display, 'notify::focus-window', () => this.toggleInputMode()],
            [Main.overview, 'hidden', () => this.setEmpty(), 'shown', () => this.setEmpty('#overview')]);
        this._sbt = symbiose(this, null, {
            keys: [x => x && Main.wm.removeKeybinding(Field.RKYS),
                x => x && Main.wm.addKeybinding(Field.RKYS, this._fulu.gset, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => this.openRunDialog())],
        });
    }

    _bindSettings() {
        this._fulu.attach({
            modes:    [Field.IPMS, 'value'],
            shortcut: [Field.DLG, 'boolean'],
        }, this);
    }

    set modes(modes) {
        this._modes ??= new Map(Object.entries(modes.recursiveUnpack()));
    }

    getInputMode(props) {
        if(!props) return '';
        for(let p, i = 0; (p = props.get(i)); i++) {
            if(!p.key.startsWith('InputMode')) continue;
            switch(p.prop_type) {
            case IBus.PropType.NORMAL: return p.symbol?.get_text() ?? p.label.get_text(); // ibus-libpinyin
            case IBus.PropType.TOGGLE: return p.state.toString(); // ibus-hangul
            case IBus.PropType.MENU: return this.getInputMode(p.sub_props); // ibus-typing-booster
            case IBus.PropType.RADIO: if(p.state) return p.key.split('.').at(-1); break; // ibus-typing-booster
            }
        }
    }

    setInputMode(props, mode) {
        if(!props) return;
        for(let p, i = 0; (p = props.get(i)); i++) {
            if(!p.key.startsWith('InputMode')) continue;
            switch(p.prop_type) {
            case IBus.PropType.NORMAL:
            case IBus.PropType.TOGGLE: return this.activate(p.key, !p.state);
            case IBus.PropType.MENU: return this.setInputMode(p.sub_props, mode);
            case IBus.PropType.RADIO: if(p.key.endsWith(mode)) return this.activate(p.key, !p.state); break;
            }
        }
    }

    activate(key, state) {
        IBusManager.activateProperty(key, state ? 1 : 0);
    }

    setEmpty(empty) {
        this._empty = empty;
        this.toggleInputMode();
    }

    saveInputMode(win, id, mode) {
        this._modes.set(win, [id, mode]);
        this._fulu.set('modes', new GLib.Variant('a{s(ss)}', Object.fromEntries(this._modes)), this);
    }

    checkInputMode(win, id, mode) {
        if(!win) return false;
        if(!this._modes.has(win)) this.saveInputMode(win, id, mode);
        [this._id, this._mode] = this._modes.get(win);
        return this._id !== id || this._mode !== mode;
    }

    toggleInputMode() {
        let {id, properties} = InputManager.currentSource;
        let mode = this.getInputMode(properties);
        if(this.checkInputMode(this._win, id, mode)) this.saveInputMode(this._win, id, mode);
        let win = this._empty || global.display.focus_window?.wm_class?.toLowerCase();
        if(this.checkInputMode(this._win = win, id, mode) && this._id === id) this.setInputMode(properties, this._mode);
    }

    set shortcut(shortcut) {
        this._sbt.keys.revive(shortcut);
    }

    openRunDialog() {
        if(Main.runDialog && this._dialogInited) {
            Main.openRunDialog();
        } else {
            Main.openRunDialog();
            connect(this, [Main.runDialog, 'notify::visible', () => this.setEmpty(Main.runDialog.visible && '#run-dialog')]);
            this.setEmpty('#run-dialog');
            this._dialogInited = true;
        }
    }
}

class IBusFontSetting extends Destroyable {
    constructor(fulu) {
        super();
        this._original_style = IBusPopup.get_style();
        symbiose(this, () => IBusPopup.set_style(this._original_style));
        this._fulu = fulu.attach({fontname: [Field.FNTS, 'string']}, this);
    }

    set fontname(fontname) {
        let desc = Pango.FontDescription.from_string(fontname);
        let getWeight = () => { try { return desc.get_weight(); } catch(e) { return parseInt(e.message); } }; // HACK: workaround for Pango.Weight enumeration exception (eg: 290)
        IBusPopup.set_style(`font-weight: ${getWeight()};
                             font-family: "${desc.get_family()}";
                             font-style: ${Object.keys(Pango.Style)[desc.get_style()].toLowerCase()};
                             font-size: ${desc.get_size() / Pango.SCALE}${desc.get_size_is_absolute() ? 'px' : 'pt'};`);
    }
}

class IBusOrientation extends Destroyable {
    constructor(fulu) {
        super();
        symbiose(this, () => { IBusArea.setOrientation = this._originalSetOrientation; });
        this._originalSetOrientation = IBusArea.setOrientation.bind(IBusArea);
        this._fulu = fulu.attach({orientation: [Field.ORNS, 'uint']}, this);
        IBusArea.setOrientation = noop;
    }

    set orientation(orientation) {
        this._originalSetOrientation(orientation ? IBus.Orientation.HORIZONTAL : IBus.Orientation.VERTICAL);
    }
}

class IBusPageButton extends Destroyable {
    constructor() {
        super();
        IBusArea._buttonBox.set_style('border-width: 0;');
        IBusArea._previousButton.hide();
        IBusArea._nextButton.hide();
        symbiose(this, () => {
            IBusArea._buttonBox.set_style('');
            IBusArea._previousButton.show();
            IBusArea._nextButton.show();
        });
    }
}

class IBusThemeManager extends Destroyable {
    constructor(fulu) {
        super();
        this._replaceStyle();
        this._bindSettings(fulu);
        symbiose(this, () => this._restoreStyle());
    }

    _bindSettings(fulu) {
        this._fulu_if = new Fulu({
            scheme: ['color-scheme', 'string', x => x === 'prefer-dark'],
        }, 'org.gnome.desktop.interface', this, 'murkey');
        this._fulu = fulu.attach({
            style: [Field.TSTL, 'uint'],
            paint: [Field.THMS, 'uint', x => this._palette[x]],
        }, this, 'murkey');
        bindNight(x => ['_night', x], this, 'murkey');
    }

    set murkey([k, v, cb]) {
        this[k] = cb?.(v) ?? v;
        if(!has(this, '_night')) return;
        let dark = this.style === Style.AUTO ? this._night
            : this.style === Style.SYSTEM ? this.scheme : this.style === Style.DARK;
        this._updateStyle(dark);
        this._updateColor(dark);
    }

    _updateStyle(dark) {
        if(this.dark === dark) return;
        if((this.dark = dark)) IBusPopup.add_style_class_name('night');
        else IBusPopup.remove_style_class_name('night');
    }

    _updateColor(dark) {
        let color = dark ? `night-${this.paint}` : this.paint;
        if(this.color === color) return;
        if(this.color) IBusPopup.remove_style_class_name(this.color);
        IBusPopup.add_style_class_name(this.color = color);
    }

    _replaceStyle() {
        this._palette = ['red', 'green', 'orange', 'blue', 'purple', 'turquoise', 'grey'];
        syncStyleClass(IBusPopup, PopupStyleClass, x => x.replace(/candidate/g, 'ibus-tweaker-candidate'));
    }

    _restoreStyle() {
        if(this.dark) IBusPopup.remove_style_class_name('night');
        if(this.color) IBusPopup.remove_style_class_name(this.color);
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
        let onClick = i => (_a, event) => {
            this.emit('candidate-clicked', i, event.get_button(), event.get_state());
            return Clutter.EVENT_PROPAGATE;
        };
        Indices.forEach((_x, i) => {
            let box = hook({'button-release-event': onClick(i)}, new St.BoxLayout({reactive: true, track_hover: true}));
            box._indexLabel = new St.Label();
            box.add_child(box._indexLabel);
            box._candidateLabel = new St.Label();
            box.add_child(box._candidateLabel);
            this._candidateBoxes.push(box);
            this.add_child(box);
        });
        this._buttonBox = new St.BoxLayout();
        this._previousButton = hook({clicked: () => this.emit('previous-page')}, new St.Button({x_expand: true, icon_name: 'go-up-symbolic'}));
        this._buttonBox.add_child(this._previousButton);
        this._nextButton = hook({clicked: () => this.emit('next-page')}, new St.Button({x_expand: true, icon_name: 'go-down-symbolic'}));
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
        for(let i = 0; i < Indices.length; ++i) {
            let visible = i < candidates.length;
            let box = this._candidateBoxes[i];
            box.visible = visible;
            if(!visible) continue;
            box._indexLabel.text = indexes && indexes[i] ? indexes[i] : Indices[i];
            box._candidateLabel.text = candidates[i];
        }

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

    constructor(page_btn, hooks) {
        super(St.Side.TOP);
        this.visible = false;
        this.reactive = true;
        this._buildWidgets(page_btn, hooks);
        Main.layoutManager.addChrome(this);
        global.focus_manager.add_group(this);
        global.stage.set_key_focus(this);
    }

    _buildWidgets(page_btn, hooks) {
        let box = new St.BoxLayout({vertical: true});
        this.bin.set_child(box);
        let hbox = new St.BoxLayout();
        box.add_child(hbox);
        this._preeditText = new St.Label({visible: true, x_expand: true});
        this._auxText = new St.Label({visible: true});
        [this._preeditText, this._auxText].forEach(x => hbox.add_child(x));
        this._candidateArea = hook(hooks, new IBusClipArea());
        box.add_child(this._candidateArea);
        this._replaceStyle(page_btn);
    }

    _replaceStyle(page_btn) {
        syncStyleClass(this, IBusPopup);
        this.set_style(IBusPopup.get_style());
        let [box] = IBusPopup._candidateArea._candidateBoxes,
            i_style = box._indexLabel.get_style(),
            c_style = box._candidateLabel.get_style();
        this._candidateArea._candidateBoxes.forEach(x => {
            x._indexLabel.set_style(i_style);
            x._candidateLabel.set_style(c_style);
        });
        if(!page_btn) return;
        this._candidateArea._buttonBox.set_style('border-width: 0;');
        this._candidateArea._nextButton.hide();
        this._candidateArea._previousButton.hide();
    }

    set preedit(text) {
        this._preeditText.set_text(`${_('📋：')}${text}`);
    }

    set aux(num) {
        this._auxText.set_text(_('%dC').format(num ?? 0));
    }

    get _area() {
        return this._candidateArea;
    }

    summon(cursor) {
        this._candidateArea.visible = true;
        this.setPosition(cursor, 0);
        this.open(BoxPointer.PopupAnimation.NONE);
        this.get_parent().set_child_above_sibling(this, null);
        Main.pushModal(this, {actionMode: Shell.ActionMode.POPUP});
    }
}

class IBusClipHistory extends Destroyable {
    constructor(fulu) {
        super();
        this._buildWidgets(fulu);
        this._bindSettings();
        this._sbt.keys.revive(true);
    }

    _buildWidgets(fulu) {
        this._fulu = fulu;
        this._ptr = new Clutter.Actor({opacity: 0, x: 1, y: 1}); // workaround for the cursor jumping
        Main.layoutManager.uiGroup.add_child(this._ptr);
        this._sbt = symbiose(this, () => omit(this, '_ptr', '_pop'), {
            keys: [x => x && Main.wm.removeKeybinding(Field.CKYS),
                x => x && Main.wm.addKeybinding(Field.CKYS, this._fulu.gset, Meta.KeyBindingFlags.NONE, Shell.ActionMode.ALL, () => this.summon())],
            commit: [clearTimeout, x => x && setTimeout(() => IBusManager._panelService?.commit_text(IBus.Text.new_from_string(x)), 30)],
        });
        connect(this, [global.display.get_selection(), 'owner-changed', this.onClipboardChange.bind(this)]);
    }

    _bindSettings() {
        this._fulu.attach({
            page_size: [Field.CLPS, 'uint'],
            page_btn:  [Field.PBTN, 'boolean'],
        }, this);
    }

    summon() {
        if(this._pop || !IBusManager._ready || Main.overview._shown) return;
        this._pop = hook({'captured-event': this.onCapturedEvent.bind(this)}, new IBusClipPopup(this.page_btn, {
            'cursor-up': () => { this.offset = -1; },
            'cursor-down': () => { this.offset = 1; },
            'next-page': () => { this.offset = this.page_size; },
            'candidate-clicked': this.onCandidateClick.bind(this),
            'previous-page': () => { this.offset = -this.page_size; },
        }));
        this._lookup = [...ClipHist];
        this._preedit = '';
        this.cursor = 0;
        let {x, y, width, height} = IBusPopup._dummyCursor;
        this._ptr.set_position(x, y);
        this._ptr.set_size(width, height);
        this._pop.summon(this._ptr);
    }

    onClipboardChange(_sel, type) {
        if(type !== St.ClipboardType.CLIPBOARD) return;
        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_clip, text) => {
            if(!text) return;
            let index = ClipHist.findIndex(x => x[0] === text);
            if(index < 0) {
                ClipHist.unshift([text, visibilize(ellipsize(text)), s2py(text.toLowerCase())]);
                while(ClipHist.length > 64) ClipHist.pop();
            } else if(index > 0) {
                [ClipHist[0], ClipHist[index]] = [ClipHist[index], ClipHist[0]];
            }
        });
    }

    onCapturedEvent(actor, event) {
        let type = event.type();
        if(type === Clutter.EventType.KEY_PRESS) {
            let key = event.get_key_symbol();
            switch(key) {
            case Clutter.KEY_Up:        this.offset = -1; break;
            case Clutter.KEY_Down:      this.offset = 1; break;
            case Clutter.KEY_Left:
            case Clutter.KEY_Page_Up:   this.offset = -this.page_size; break;
            case Clutter.KEY_Right:
            case Clutter.KEY_Page_Down: this.offset = this.page_size; break;
            case Clutter.KEY_space:
            case Clutter.KEY_Return:
            case Clutter.KEY_KP_Enter:
            case Clutter.KEY_ISO_Enter: this.onCandidateClick(null, this._cursor - this._start, 1, 0); break;
            case Clutter.KEY_Delete:    this.deleteCurrent(); break;
            case Clutter.KEY_backslash: this.mergeCurrent(); break;
            case Clutter.KEY_BackSpace: this.preedit = this._preedit.slice(0, -1); break;
            default:
                if(key < 33 || key > 126) this.dispel();
                else if(key > 47 && key < 58) this.selectAt(String.fromCharCode(key));
                else this.preedit = this._preedit + String.fromCharCode(key); break;
            }
            return Clutter.EVENT_STOP;
        } else if((type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN) &&
                  !actor.contains(global.stage.get_event_actor(event))) {
            this.dispel();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    set offset(offset) {
        let pos = this._cursor + offset;
        if(pos >= 0 && pos < this._lookup.length) {
            this.cursor = pos;
        } else if(pos >= this._lookup.length) {
            let expectation = (this._page + 1) * this.page_size;
            if(this._lookup.length > expectation) this.cursor = expectation;
        }
    }

    set cursor(cursor) {
        this._cursor = cursor;
        this.updateLookupTable();
    }

    updateLookupTable() {
        this._page = Math.floor(this._cursor / this.page_size);
        this._start = this._page * this.page_size;
        this._size = Math.min(this.page_size, this._lookup.length - this._start);
        let indices = this._size ? Indices.slice(0, this._size) : ['\u2205'];
        let candidates = this._size ? this._lookup.slice(this._start, this._start + this._size).map(x => x[1]) : [_('Empty history.')];
        this._pop._area.setCandidates(indices, candidates, this._cursor % this.page_size, this._size);
        this._pop._area.updateButtons(false, this._page, Math.ceil(this._lookup.length / this.page_size));
        this._pop.aux = this._lookup[this._cursor]?.[0].length;
        this._pop.preedit = this._preedit;
    }

    onCandidateClick(_area, index) {
        this.dispel();
        this.commitAt(index);
    }

    commitAt(index) {
        this._sbt.commit.revive(this._lookup[this._start + index]?.at(0));
    }

    deleteCurrent() {
        let index = ClipHist.findIndex(x => x[0] === this._lookup[this._cursor][0]);
        if(index === -1) return;
        ClipHist.splice(index, 1);
        this._lookup.splice(this._cursor, 1);
        this.cursor = this._cursor >= this._lookup.length ? Math.max(this._lookup.length - 1, 0) : this._cursor;
    }

    mergeCurrent() {
        let index = ClipHist.findIndex(x => x[0] === this._lookup[this._cursor][0]);
        if(index === -1 || index >= this._lookup.length - 1) return;
        this._lookup.splice(this._cursor, 1);
        let [clip] = ClipHist.splice(index, 1),
            hays = ClipHist[index][2] + clip[2],
            text = `${ClipHist[index][0]} ${clip[0]}`;
        this._lookup[this._cursor] = ClipHist[index] = [text, visibilize(ellipsize(text)), hays];
        this.cursor = this._cursor;
    }

    selectAt(key) {
        let index = Indices.findIndex(x => x === key);
        if(index < 0 || index >= this._size) this.dispel();
        else this.onCandidateClick(null, index, 1, 0);
    }

    set preedit(preedit) {
        if(this._preedit === preedit) return;
        this._preedit = preedit;
        this._lookup = ClipHist.filter(x => fuzzySearch(this._preedit, x[2]));
        this.cursor = 0;
    }

    dispel() {
        omit(this, '_pop');
    }
}

class IBusTweaker extends Destroyable {
    constructor(gset) {
        super();
        this._buildWidgets(gset);
        this._bindSettings();
    }

    _buildWidgets(gset) {
        this._tweaks = {};
        this._fulu = new Fulu({}, gset, this);
        IBusPopup._dummyCursor.set_position(1, 1); // HACK: workaround for popup jumping
        syncStyleClass(PopupStyleClass, IBusPopup);
        symbiose(this, () => omit(this._tweaks, ...Object.keys(this._tweaks)));
    }

    _bindSettings() {
        this._fulu.attach({
            clip:   [Field.CLP,  'boolean', IBusClipHistory],
            font:   [Field.FNT,  'boolean', IBusFontSetting],
            input:  [Field.ATSW, 'boolean', IBusAutoSwitch],
            orient: [Field.ORN,  'boolean', IBusOrientation],
            pgbtn:  [Field.PBTN, 'boolean', IBusPageButton],
            theme:  [Field.THM,  'boolean', IBusThemeManager],
        }, this, 'tweaks');
    }

    set tweaks([k, v, klass]) {
        if(v) this._tweaks[k] ??= new klass(this._fulu);
        else omit(this._tweaks, k);
    }
}

export default class Extension extends ExtensionBase { $klass = IBusTweaker; }
