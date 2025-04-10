<!--
SPDX-FileCopyrightText: tuberry
SPDX-License-Identifier: CC-BY-SA-4.0
-->
# ibus-tweaker

Tweaker of IBus in GNOME Shell for theme, font, input mode and clipboard history.
> 狙公赋芧曰朝三而暮四。众狙皆怒。曰然则朝四而暮三。众狙皆悦。 —— *《庄子·齐物论》*\
[![license]](/LICENSE.md)

## Installation

### Manual

The latest and supported version should only work on the [current stable version](https://release.gnome.org/calendar/#branches) of GNOME Shell.

```bash
git clone https://github.com/tuberry/ibus-tweaker.git && cd ibus-tweaker
meson setup build && meson install -C build
# meson setup build -Dtarget=system && meson install -C build # system-wide, default --prefix=/usr/local
```

For older versions, it's recommended to install via:

```bash
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
          --method org.gnome.Shell.Extensions.InstallRemoteExtension 'ibus-tweaker@tuberry.github.com'
```

It's quite the same as installing from:

### E.G.O

[<img src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true" alt="Get it on GNOME Extensions" height="100" align="middle">][EGO]

## Features

![itpref](https://github.com/user-attachments/assets/fb5573ae-f1f9-44fd-a01d-f1fab5bcefda)

**Clipboard history**:

https://user-images.githubusercontent.com/17917040/139533759-a5ebe54c-2fca-4006-9257-850877268499.mp4

## Contributions

Feel free to open an issue or PR in the repo for any question or idea.

### Translations

To initialize or update the po file from sources:

```bash
bash ./cli/update-po.sh [your_lang_code] # like zh_CN, default to $LANG
```

### Developments

To install GJS TypeScript type [definitions](https://www.npmjs.com/package/@girs/gnome-shell):

```bash
npm install @girs/gnome-shell --save-dev
```

## Acknowledgements

* [anyascii](https://github.com/anyascii/anyascii/): Unicode to ASCII transliteration [table.tsv](/res/data/anyascii.tsv)
* [ibus-font-setting](https://extensions.gnome.org/extension/1121/ibus-font-setting/): font setting

[EGO]:https://extensions.gnome.org/extension/2820/ibus-tweaker/
[license]:https://img.shields.io/badge/license-GPLv3+-green.svg
