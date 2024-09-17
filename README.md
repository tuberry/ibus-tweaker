# ibus-tweaker

Tweaker of IBus in GNOME Shell for theme, font, input mode and clipboard history.
> 狙公赋芧曰朝三而暮四。众狙皆怒。曰然则朝四而暮三。众狙皆悦。 —— *《庄子·齐物论》*\
[![license]](/LICENSE.md)

## Installation

### Manual

The latest and supported version should only work on the most current stable version of GNOME Shell.

```bash
git clone https://github.com/tuberry/ibus-tweaker.git && cd ibus-tweaker
meson setup build && meson install -C build
# meson setup build -Dtarget=system && meson install -C build # system-wide, default --prefix=/usr/local
```

For older versions, it's recommended to install via:

### E.G.O

[<img src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true" alt="Get it on GNOME Extensions" height="100" align="middle">][EGO]

## Features

![itpref](https://github.com/user-attachments/assets/fb5573ae-f1f9-44fd-a01d-f1fab5bcefda)

**Clipboard history**:

https://user-images.githubusercontent.com/17917040/139533759-a5ebe54c-2fca-4006-9257-850877268499.mp4

*Tips*: press <kbd>DELETE</kbd> to delete and <kbd>\\</kbd> to merge entries.

## Contributions

Feel free to open an issue or PR in the repo for any question or idea.

### Translations

To update the po file from sources:

```bash
bash ./cli/update-po.sh [your_lang_code] # like zh_CN, default to $LANG
```

### Developments

To install GJS TypeScript type [definitions](https://www.npmjs.com/package/@girs/gnome-shell):

```bash
npm install @girs/gnome-shell --save-dev
```

## Acknowledgements

* [ibus-font-setting](https://extensions.gnome.org/extension/1121/ibus-font-setting/): font setting
* [python-pinyin](https://github.com/mozillazg/python-pinyin): gen pinyin [initials](/gen-initials.py)

[EGO]:https://extensions.gnome.org/extension/2820/ibus-tweaker/
[license]:https://img.shields.io/badge/license-GPLv3+-green.svg
