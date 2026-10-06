# SPDX-FileCopyrightText: tuberry
# SPDX-License-Identifier: GPL-3.0-or-later

project(
  'ulaa', 'cpp',
  version: '1.0',
  default_options: [
    'cpp_std=c++20',
    'buildtype=release'
  ],
)

gen = executable(
  'unicode-latin-ascii-alpha',
  'unicode-latin-ascii-alpha.cpp',
  dependencies: [
    dependency('icu-uc'),
    dependency('icu-i18n'),
  ],
)
