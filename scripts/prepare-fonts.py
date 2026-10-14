"""Optional asset preparation: pip install 'fonttools[woff]'.
The existing font faces use the default 400 instance with browser-synthesized
bold. Keep that appearance while removing unused variable interpolation data.
"""
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'public/assets/fonts'
for source, target in [('golostext.ttf', 'golos-latin-cyrillic.woff2'),
                       ('unbounded.ttf', 'unbounded-latin-cyrillic.woff2')]:
    font = instantiateVariableFont(TTFont(root / source), {'wght': 400}, inplace=True)
    options = subset.Options()
    options.flavor = 'woff2'
    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=subset.parse_unicodes('0020-007E,00A0-00FF,0400-045F,2000-206F,20BD,2190-21FF,2713'))
    sub.subset(font)
    font.flavor = 'woff2'
    font.save(root / target)
    print(target, (root / target).stat().st_size)
