# ibus-tweaker

Tweaker of IBus in GNOME Shell for orientation, theme, font, input mode and clipboard history.
> 狙公赋芧曰朝三而暮四。众狙皆怒。曰然则朝四而暮三。众狙皆悦。 —— *《庄子·齐物论》*<br>
[![license]](/LICENSE)
</br>

![dj](https://user-images.githubusercontent.com/17917040/92872878-0e647800-f439-11ea-9c14-781b4d3191ed.gif)


## Installation

### Recommended

[<img src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true" alt="Get it on GNOME Extensions" height="100" align="middle">][EGO]

### Manual

The latest and supported version should only work on the most current stable version of GNOME Shell.

```bash
git clone https://github.com/tuberry/ibus-tweaker.git && cd ibus-tweaker
make && make install
# make LANG=your_language_code mergepo # for translation
```

For older versions, it's necessary to switch the git tag before `make`:

```bash
# git tag # to see available versions
git checkout your_gnome_shell_version
```

### Dependencies

**Clipboard history**: The Chinese search function depends on [python-pinyin], which can be used to filter results by pinyin initials:

```bash
yay -S pypinyin # use your distro's package manager instead
```

https://user-images.githubusercontent.com/17917040/139533759-a5ebe54c-2fca-4006-9257-850877268499.mp4

*Tips*: press <kbd>DELETE</kbd> to delete and <kbd>\\</kbd> to merge entries.

## Features

![itprefs](https://user-images.githubusercontent.com/17917040/139532873-6b21d9de-2878-45ad-b143-12e5e8ae417c.png)

## Acknowledgements

* [ibus-font-setting](https://extensions.gnome.org/extension/1121/ibus-font-setting/): font setting

[python-pinyin]:https://github.com/mozillazg/python-pinyin
[EGO]:https://extensions.gnome.org/extension/2820/ibus-tweaker/
[license]:https://img.shields.io/badge/license-GPLv3-green.svg
