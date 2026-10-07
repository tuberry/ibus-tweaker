// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

#include <unicode/translit.h>

#include <algorithm>
#include <fstream>
#include <print>
#include <ranges>
#include <vector>

using namespace icu;
using namespace std;

constexpr array erratum = {
    pair<UChar32, char>{U'乐', 'y'}, // 音乐
};

int main(int argc, char **argv) {
  ofstream out(argv[1], ios::binary);
  out.exceptions(ios::failbit | ios::badbit);

  auto status = U_ZERO_ERROR;
  unique_ptr<Transliterator> tl(Transliterator::createInstance(
      "Any-Latin; Latin-ASCII; [^a-zA-Z] Remove", UTRANS_FORWARD, status));
  if (U_FAILURE(status))
    return 1;

  vector<char> tb(UCHAR_MAX_VALUE + 1);

  ranges::for_each(erratum, [&](auto &x) { tb[x.first] = x.second; });

  UnicodeString us;
  auto idx = ranges::fold_left(tb | views::enumerate, 0, [&](auto p, auto &&x) {
    auto &&[i, c] = x;

    if (i % 10000 == 0)
      print(stderr, "\rulaa > Scanning: {:2}% ", 100 * i / tb.size());

    tl->transliterate(us.setTo(c ? c : static_cast<UChar32>(i)));
    return us.isEmpty() ? p : (c = u_tolower(us[0]), i);
  });
  tb.resize(idx + 1);

  out.write(tb.data(), tb.size());

  println(stderr, "\rulaa > Scanned: {}", ranges::count_if(tb, identity{}));
}
