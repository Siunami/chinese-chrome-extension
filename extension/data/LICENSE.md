# Licenses for the bundled data

The three files beside this one are not original work and are **not** covered by
the MIT license in the repository root. They are derived from third-party
datasets published under share-alike terms, which follow the data into every
copy of it — including the copies inside a packaged `.crx`, a Chrome Web Store
listing, and `pwa/data/`.

If you fork this project, redistribute the extension, or publish your own
build, these terms are the ones you have to keep. Attribution is also carried
in the product itself, on the extension's options page, so that someone who
installs from a store and never sees this repository is still told where the
dictionary came from.

---

## `dict.tsv` — CC-CEDICT

- **Source:** [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cedict),
  published by MDBG.
- **License:** [Creative Commons Attribution-ShareAlike 4.0 International
  (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/).
- **Attribution:** CC-CEDICT, https://www.mdbg.net/chinese/dictionary?page=cedict

**Changes made.** `scripts/build-data.mjs` reads the published CC-CEDICT text
and rewrites it as a tab-separated table of `trad \t simp \t pinyin \t
def/def/def`. The entries, their readings and their definitions are CC-CEDICT's;
what changed is the container. No definitions were rewritten and no entries were
added.

Because this is an adaptation of a BY-SA work, `dict.tsv` and anything derived
from it must be distributed under CC BY-SA 4.0 (or a compatible license), with
the attribution above and an indication that it was changed.

## `sentences.tsv` — Tatoeba

- **Source:** [Tatoeba](https://tatoeba.org), obtained through the
  Mandarin–English sentence pairs at
  [manythings.org/anki](https://www.manythings.org/anki/).
- **License:** [Creative Commons Attribution 2.0 France (CC BY
  2.0 FR)](https://creativecommons.org/licenses/by/2.0/fr/).
- **Attribution:** per sentence, preserved in the file. Column 4 of every row
  carries the original Tatoeba sentence IDs and contributor usernames exactly as
  they were published, so credit stays attached to the individual sentence
  rather than being collapsed into a single project-level line.

**Changes made.** `scripts/build-data.mjs` keeps one English translation per
distinct Chinese sentence, drops rows with no Chinese in them, sorts the
remainder by sentence length, and adds a generated pinyin column (column 2).
The pinyin is computed here from CC-CEDICT readings and is not Tatoeba's work.
The Chinese and English text is unmodified.

## `hsk.tsv` — HSK 3.0 vocabulary + CC-CEDICT

- **Vocabulary source:** the 11,092-row transcription in
  [ivankra/hsk30](https://github.com/ivankra/hsk30), derived from the vocabulary
  appendix of the Ministry of Education's 2021
  *Standard for Chinese Proficiency in International Chinese Language
  Education* (国际中文教育中文水平等级标准, GF 0025-2021).
- **Vocabulary transcription license:** MIT; copyright © 2023 Ivan Krasilnikov,
  © 2021 Shawky, and © 2021 Pleco Inc. The full MIT notice is in the source
  repository linked above.
- **Readings and definitions:** CC-CEDICT, under CC BY-SA 4.0 as described in
  the `dict.tsv` section above.

**Changes made.** `scripts/build-hsk.mjs` keeps each source row's stable id,
level, spelling, part of speech, and official notation; chooses a primary
simplified/traditional form for entries that give alternates or usage examples;
and joins that identity to this project's bundled CC-CEDICT. The generated file
adds display pinyin, tone numbers, and definitions. For 28 constructions
without a complete dictionary headword, it supplies a short curated English
definition; segmentation remains a last-resort build fallback. Because the
remaining readings and definitions are an adaptation of CC-CEDICT, `hsk.tsv`
is distributed under CC BY-SA 4.0 with the attribution above; the MIT
attribution for the list transcription must also be kept.

---

## A note on the boundary

The MIT license in the repository root covers the code. These datasets are
distributed alongside that code rather than mixed into it, which is why the
share-alike terms above are not treated as reaching the source files. That is
the ordinary reading of a collection under CC BY-SA, but it is a reading rather
than a settled question — so the boundary is stated here explicitly instead of
being left to inference.

None of this is legal advice. If you intend to build something commercial on
top of the dictionary data, read CC BY-SA 4.0 yourself.
