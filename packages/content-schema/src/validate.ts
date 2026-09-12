import { contentBundleSchema, type ContentBundle } from './schema';

export interface BundleValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * Cross-record validation.
 *
 * Zod covers shapes; this covers the rules that actually keep the canon honest:
 * every source key resolves, every license resolves, no duplicate verses, and
 * nothing claims verified status without provenance.
 */
export function validateBundle(bundle: ContentBundle): BundleValidationIssue[] {
  const issues: BundleValidationIssue[] = [];
  const licenseCodes = new Set(bundle.licenses.map((l) => l.code));
  const sourceKeys = new Set(bundle.sources.map((s) => s.key));
  const commentatorSlugs = new Set(bundle.commentators.map((c) => c.slug));

  const error = (path: string, message: string) =>
    issues.push({ path, message, severity: 'error' });
  const warn = (path: string, message: string) =>
    issues.push({ path, message, severity: 'warning' });

  const requireSource = (key: string, path: string) => {
    if (!sourceKeys.has(key)) error(path, `Unknown source key "${key}"`);
  };

  for (const source of bundle.sources) {
    if (!licenseCodes.has(source.licenseCode)) {
      error(`sources.${source.key}.licenseCode`, `Unknown license "${source.licenseCode}"`);
    }
    if (bundle.authoritative && source.copyrightStatus === 'unknown') {
      error(
        `sources.${source.key}.copyrightStatus`,
        'An authoritative bundle cannot contain a source with unknown copyright status',
      );
    }
    if (source.copyrightStatus === 'proprietary') {
      warn(
        `sources.${source.key}.copyrightStatus`,
        'Proprietary source: confirm written permission before importing its text',
      );
    }
  }

  for (const chapter of bundle.chapters) {
    requireSource(chapter.sourceKey, `chapters.${chapter.number}.sourceKey`);
  }

  const seen = new Set<string>();
  for (const verse of bundle.verses) {
    const ref = `${verse.chapter}.${verse.verse}`;
    if (seen.has(ref)) error(`verses.${ref}`, 'Duplicate verse in bundle');
    seen.add(ref);

    if (!verse.texts.some((t) => t.script === 'devanagari')) {
      error(`verses.${ref}.texts`, 'Every verse needs a Devanagari text');
    }
    if (verse.texts.filter((t) => t.isPrimary).length > 1) {
      error(`verses.${ref}.texts`, 'Only one text version may be primary');
    }
    for (const text of verse.texts) requireSource(text.sourceKey, `verses.${ref}.texts.sourceKey`);
    for (const tr of verse.translations) {
      requireSource(tr.sourceKey, `verses.${ref}.translations.sourceKey`);
    }
    for (const c of verse.commentaries) {
      requireSource(c.sourceKey, `verses.${ref}.commentaries.sourceKey`);
      if (!commentatorSlugs.has(c.commentatorSlug)) {
        error(
          `verses.${ref}.commentaries.commentatorSlug`,
          `Unknown commentator "${c.commentatorSlug}"`,
        );
      }
    }

    const claimsVerified =
      verse.verificationStatus === 'verified' || verse.verificationStatus === 'published';
    if (!bundle.authoritative && claimsVerified) {
      error(
        `verses.${ref}.verificationStatus`,
        'A non-authoritative bundle may not mark verses verified or published. ' +
          'Keep them "draft" until checked against a printed edition.',
      );
    }
  }

  const verseRefs = new Set(bundle.verses.map((v) => `${v.chapter}.${v.verse}`));
  for (const topic of bundle.topics) {
    requireSource(topic.sourceKey, `topics.${topic.slug}.sourceKey`);
    for (const tv of topic.verses) {
      if (!verseRefs.has(tv.ref)) {
        warn(
          `topics.${topic.slug}.verses`,
          `Topic references verse ${tv.ref}, which is not in this bundle`,
        );
      }
    }
  }

  for (const rel of bundle.relatedVerses) {
    if (rel.fromRef === rel.toRef) {
      error(`relatedVerses.${rel.fromRef}`, 'A verse cannot be related to itself');
    }
  }

  for (const plan of bundle.readingPlans) {
    const days = plan.days.map((d) => d.dayNumber).sort((a, b) => a - b);
    const contiguous = days.every((day, index) => day === index + 1);
    if (!contiguous) {
      error(
        `readingPlans.${plan.slug}.days`,
        'Plan days must be a contiguous sequence starting at 1',
      );
    }
  }

  for (const track of bundle.audio) {
    if (!licenseCodes.has(track.licenseCode)) {
      error(`audio.${track.objectKey}.licenseCode`, `Unknown license "${track.licenseCode}"`);
    }
    if (track.isSynthetic && track.kind === 'verse') {
      warn(
        `audio.${track.objectKey}`,
        'Synthetic verse audio must be surfaced to users as synthesised, not as recitation',
      );
    }
  }

  return issues;
}

export function parseBundle(raw: unknown): {
  bundle: ContentBundle | null;
  issues: BundleValidationIssue[];
} {
  const parsed = contentBundleSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      bundle: null,
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        severity: 'error' as const,
      })),
    };
  }
  return { bundle: parsed.data, issues: validateBundle(parsed.data) };
}

export function hasErrors(issues: BundleValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
