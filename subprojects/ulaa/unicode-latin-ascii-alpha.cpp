// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

#include <unicode/translit.h>

#include <algorithm>
#include <fstream>
#include <vector>

using namespace icu;
using namespace std;

constexpr pair<UChar32, char> erratum[] = {
    {U'乐', 'y'}, // 音乐
};

int main(int argc, char **argv) {
  ofstream out(argv[1], ios::binary);
  if (!out)
    return 1;

  auto status = U_ZERO_ERROR;
  auto tr = LocalPointer<Transliterator>(Transliterator::createInstance(
      "Any-Latin; Latin-ASCII", UTRANS_FORWARD, status));
  if (U_FAILURE(status))
    return 2;

  vector<char> tb(UCHAR_MAX_VALUE + 1);

  UnicodeString us;
  for (UChar32 cp = 0; cp <= UCHAR_MAX_VALUE; ++cp) {
    if (cp % 0x10000 == 0)
      fprintf(stderr, "\rscanning %2zu%%: %d/%zu", 100 * cp / tb.size(), cp,
              tb.size());

    char ch = 0;

    if (!U_IS_SURROGATE(cp)) {
      us.setTo(cp);
      tr->transliterate(us);

      if (auto it = find_if(us.begin(), us.end(),
                            [](auto c) { return c < 128 && u_isalpha(c); });
          it != us.end())
        ch = u_tolower(*it);
    }

    tb[cp] = ch;
  }

  for (auto [cp, ch] : erratum)
    tb[cp] = ch;

  // if (any_of(tb.begin() + 'A', tb.begin() + 'Z' + 1,
  //            [i = 0](auto c) mutable { return c - 'a' - i++; }))
  //   return 3;

  out.write(tb.data(),
            find_if(tb.rbegin(), tb.rend(), identity{}).base() - tb.begin());
}
