# SPDX-FileCopyrightText: tuberry
# SPDX-License-Identifier: GPL-3.0-or-later

configure_file(
  input: 'metadata.json.in',
  output: 'metadata.json',
  configuration: me,
  install_dir: target_dir,
)

_gres = {'path': me['path'], 'alpha': 'alpha.txt'}

_deps = [] + custom_target(
  output: _gres['alpha'],
  command: [
    subproject('ulaa').get_variable('gen'),
    '@OUTDIR@' / _gres['alpha'] # NOTE: -5kb if https://gitlab.gnome.org/GNOME/glib/-/issues/2850
  ],
  console: true,
)

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
