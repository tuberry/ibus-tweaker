# SPDX-FileCopyrightText: tuberry
# SPDX-License-Identifier: GPL-3.0-or-later

sassc = find_program('sassc', required: true)
_sheet = 'stylesheet.css'
custom_target(
  input: fs.replace_suffix(_sheet, '.scss'),
  output: _sheet,
  command: [sassc, '-t', 'expanded', '-a', '@INPUT@', '@OUTPUT@'],
  install: true,
  install_dir: target_dir,
)
