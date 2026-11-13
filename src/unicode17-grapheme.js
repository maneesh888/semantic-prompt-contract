import {
  unicode17EmojiPresentationRanges,
  unicode17ExtendedPictographicRanges,
  unicode17GraphemeControlRanges,
  unicode17GraphemeCrRanges,
  unicode17GraphemeExtendRanges,
  unicode17GraphemeLfRanges,
  unicode17GraphemeLRanges,
  unicode17GraphemeLvRanges,
  unicode17GraphemeLvTRanges,
  unicode17GraphemePrependRanges,
  unicode17GraphemeRegionalIndicatorRanges,
  unicode17GraphemeSpacingMarkRanges,
  unicode17GraphemeTRanges,
  unicode17GraphemeVRanges,
  unicode17GraphemeZwjRanges,
  unicode17InCbConsonantRanges,
  unicode17InCbExtendRanges,
  unicode17InCbLinkerRanges,
} from './unicode17-grapheme-data.generated.js';

const categories = Object.freeze({
  any: 'Any',
  control: 'Control',
  cr: 'Cr',
  extend: 'Extend',
  l: 'L',
  lf: 'Lf',
  lv: 'Lv',
  lvt: 'LvT',
  prepend: 'Prepend',
  regionalIndicator: 'RegionalIndicator',
  spacingMark: 'SpacingMark',
  t: 'T',
  v: 'V',
  zwj: 'Zwj',
});

function isInRanges(codePoint, ranges) {
  let lowerBound = 0;
  let upperBound = ranges.length / 2;
  while (lowerBound < upperBound) {
    const middle = Math.floor((lowerBound + upperBound) / 2);
    const rangeStart = ranges[middle * 2];
    const rangeEnd = ranges[middle * 2 + 1];
    if (codePoint < rangeStart) {
      upperBound = middle;
    } else if (codePoint > rangeEnd) {
      lowerBound = middle + 1;
    } else {
      return true;
    }
  }
  return false;
}

function unicode17GraphemeCategory(codePoint) {
  if (isInRanges(codePoint, unicode17GraphemeCrRanges)) return categories.cr;
  if (isInRanges(codePoint, unicode17GraphemeLfRanges)) return categories.lf;
  if (isInRanges(codePoint, unicode17GraphemeControlRanges)) return categories.control;
  if (isInRanges(codePoint, unicode17GraphemeExtendRanges)) return categories.extend;
  if (isInRanges(codePoint, unicode17GraphemeRegionalIndicatorRanges)) return categories.regionalIndicator;
  if (isInRanges(codePoint, unicode17GraphemePrependRanges)) return categories.prepend;
  if (isInRanges(codePoint, unicode17GraphemeSpacingMarkRanges)) return categories.spacingMark;
  if (isInRanges(codePoint, unicode17GraphemeLRanges)) return categories.l;
  if (isInRanges(codePoint, unicode17GraphemeVRanges)) return categories.v;
  if (isInRanges(codePoint, unicode17GraphemeTRanges)) return categories.t;
  if (isInRanges(codePoint, unicode17GraphemeLvRanges)) return categories.lv;
  if (isInRanges(codePoint, unicode17GraphemeLvTRanges)) return categories.lvt;
  if (isInRanges(codePoint, unicode17GraphemeZwjRanges)) return categories.zwj;
  return categories.any;
}

function unicodeScalarSpans(value) {
  const spans = [];
  let start = 0;
  for (const scalar of value) {
    const end = start + scalar.length;
    const codePoint = scalar.codePointAt(0);
    spans.push({ codePoint, start, end, category: unicode17GraphemeCategory(codePoint) });
    start = end;
  }
  return spans;
}

function isControl(category) {
  return category === categories.control || category === categories.cr || category === categories.lf;
}

function hasUnicode17InCbConsonantContext(scalars, index) {
  if (!isInRanges(scalars[index].codePoint, unicode17InCbConsonantRanges)) return false;
  let foundLinker = false;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const codePoint = scalars[cursor].codePoint;
    if (isInRanges(codePoint, unicode17InCbLinkerRanges)) {
      foundLinker = true;
    } else if (!isInRanges(codePoint, unicode17InCbExtendRanges)) {
      return foundLinker && isInRanges(codePoint, unicode17InCbConsonantRanges);
    }
  }
  return false;
}

function hasUnicode17ExtendedPictographicContext(scalars, index) {
  let cursor = index - 2;
  while (cursor >= 0 && scalars[cursor].category === categories.extend) cursor -= 1;
  return cursor >= 0 && isInRanges(scalars[cursor].codePoint, unicode17ExtendedPictographicRanges);
}

function isUnicode17GraphemeBoundary(scalars, index) {
  const before = scalars[index - 1];
  const after = scalars[index];

  // GB3
  if (before.category === categories.cr && after.category === categories.lf) return false;
  // GB4 and GB5
  if (isControl(before.category) || isControl(after.category)) return true;
  // GB6
  if (before.category === categories.l
      && [categories.l, categories.v, categories.lv, categories.lvt].includes(after.category)) return false;
  // GB7
  if ([categories.lv, categories.v].includes(before.category)
      && [categories.v, categories.t].includes(after.category)) return false;
  // GB8
  if ([categories.lvt, categories.t].includes(before.category) && after.category === categories.t) return false;
  // GB9, GB9a, and GB9b
  if (after.category === categories.extend
      || after.category === categories.zwj
      || after.category === categories.spacingMark
      || before.category === categories.prepend) return false;
  // GB9c
  if (hasUnicode17InCbConsonantContext(scalars, index)) return false;
  // GB11
  if (before.category === categories.zwj
      && isInRanges(after.codePoint, unicode17ExtendedPictographicRanges)
      && hasUnicode17ExtendedPictographicContext(scalars, index)) return false;
  // GB12 and GB13
  if (before.category === categories.regionalIndicator && after.category === categories.regionalIndicator) {
    let regionalIndicatorCount = 0;
    let cursor = index - 1;
    while (cursor >= 0 && scalars[cursor].category === categories.regionalIndicator) {
      regionalIndicatorCount += 1;
      cursor -= 1;
    }
    return regionalIndicatorCount % 2 === 0;
  }
  // GB999
  return true;
}

/** Unicode 17 extended-grapheme segmentation (UAX #29, revision 47). */
export function unicode17ExtendedGraphemeClusters(value) {
  const scalars = unicodeScalarSpans(value);
  if (scalars.length === 0) return [];
  const clusters = [];
  let clusterStart = 0;
  for (let index = 1; index < scalars.length; index += 1) {
    if (isUnicode17GraphemeBoundary(scalars, index)) {
      clusters.push(value.slice(scalars[clusterStart].start, scalars[index].start));
      clusterStart = index;
    }
  }
  clusters.push(value.slice(scalars[clusterStart].start));
  return clusters;
}

export function containsUnicode17EmojiPresentation(value) {
  return [...value].some((scalar) => isInRanges(scalar.codePointAt(0), unicode17EmojiPresentationRanges));
}
