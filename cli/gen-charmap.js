// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';
import * as Util from '../src/util.js';

let [input, output] = ARGV,
    [table] = await Util.fread(input),
    end = 0, txt = '', map = new Map();
Util.decode(table).split('\n').forEach(line => {
    let [char, ascii] = line.split('\t');
    let alpha = ascii?.match(/[a-zA-Z]/)?.pop()?.toLowerCase();
    if(!alpha) return;
    let code = char.codePointAt(0);
    end = Math.max(code, end);
    map.set(code, alpha);
});
for(let x of GLib.CSET_A_2_Z) map.set(x.codePointAt(0), x.toLowerCase());
for(let i = 0; i <= end; i++) txt += map.get(i) ?? '\0';
await Util.fwrite(output, txt);
