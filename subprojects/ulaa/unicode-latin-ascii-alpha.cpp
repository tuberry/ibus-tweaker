// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

#include <unicode/translit.h>

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

  vector<char> table(UCHAR_MAX_VALUE + 1);

  UnicodeString us;
  for (UChar32 cp = 0; cp <= UCHAR_MAX_VALUE; ++cp) {
    char ch = 0;

    if (!U_IS_SURROGATE(cp)) {
      us.setTo(cp);
      tr->transliterate(us);

      for (auto i = 0; i < us.length(); ++i) {
        auto c = us[i];
        if (c < 128 && u_isalpha(c)) {
          ch = u_tolower(c);
          break;
        }
      }
    }

    table[cp] = ch;

    if (cp % 0x10000 == 0)
      fprintf(stderr, "\rscanning %2zu%%: %d/%zu", 100 * cp / table.size(), cp,
              table.size());
  }

  for (auto [cp, ch] : erratum)
    table[cp] = ch;

  for (UChar32 cp = 'A'; cp <= 'Z'; ++cp)
    if (table[cp] != u_tolower(cp))
      return 3;

  out.write(table.data(), table.size());
}
