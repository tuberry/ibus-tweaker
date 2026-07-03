# SPDX-FileCopyrightText: tuberry
# SPDX-License-Identifier: GPL-3.0-or-later

configure_file(
  input: 'metadata.json.in',
  output: 'metadata.json',
  configuration: me,
  install_dir: target_dir,
)

_alpha = 'alpha.txt' # NOTE: -5kb if https://gitlab.gnome.org/GNOME/glib/-/issues/2850
_gres = {'path': me['path'], 'alpha': _alpha}

_deps = [custom_target(
  input: ['../../cli/gen-charmap.js', 'anyascii.tsv'],
  output: _alpha,
  command: [
    find_program('gjs'),
    '-m',
    '@INPUT@',
    '@OUTDIR@' / _alpha,
  ],
)]

foreach x: ['extension']
  gnome.compile_resources(
    x, configure_file(
      input: f'@x@.gresource.xml.in',
      output: f'@x@.gresource.xml',
      configuration: _gres,
    ),
    source_dir: '@OUTDIR@',
    dependencies: _deps,
    gresource_bundle: true,
    install: true,
    install_dir: target_dir / 'resource',
  )
endforeach
