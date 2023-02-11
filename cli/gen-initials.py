# by tuberry
from pypinyin import pinyin, Style

s = '\''
t = {
    '兙': 's',
    '兡': 'b',
    '嗧': 'j',
    '桛': 'k',
    '烪': 'z',
    '瓧': 's',
    '瓰': 'f',
    '瓱': 'm',
    '瓼': 'l',
    '甅': 'l',
} # missing in pypinyin

for i in range(19968, 19968 + 20902):
    c = chr(i)
    s += t[c] if c in t else pinyin(c, style = Style.FIRST_LETTER)[0][0]
    if (i - 19967) % 128 == 0:
        s += '\',\n\''

print(s + '\'')
