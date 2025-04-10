# SPDX-FileCopyrightText: tuberry
# SPDX-License-Identifier: GPL-3.0-or-later

configure_file(
  input: 'metadata.json.in',
  output: 'metadata.json',
  configuration: metadata,
  install_dir: target_dir,
)

alpha = 'alpha.txt' # NOTE: -5kb if https://gitlab.gnome.org/GNOME/glib/-/issues/2850
chars = custom_target(
  output: alpha,
  build_by_default: true,
  build_always_stale: true,
  command: [
    find_program('gjs'),
    '-m',
    '@SOURCE_ROOT@'/ 'cli/gen-charmap.js',
    '@CURRENT_SOURCE_DIR@' / 'anyascii.tsv',
    '@OUTDIR@' / alpha,
  ],
)

foreach name: ['extension']
  gres = configure_file(
    input: f'@name@.gresource.xml.in',
    output: f'@name@.gresource.xml',
    configuration: {'path': metadata['path'], 'alpha': alpha},
  )
  gnome.compile_resources(
    name, gres,
    source_dir: '@OUTDIR@',
    dependencies: [chars],
    gresource_bundle: true,
    install: true,
    install_dir: target_dir / 'resource',
  )
endforeach
