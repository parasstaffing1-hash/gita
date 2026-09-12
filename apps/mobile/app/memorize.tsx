import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Heading,
  Screen,
  SectionHeader,
  useTheme,
  useTypeScale,
} from '@/components/ui';
import { getVersesByRefs } from '@/lib/db/content';
import { listMemorization, recordMemorizationReview } from '@/lib/db/user-data';

/**
 * Memorisation practice.
 *
 * Words are hidden progressively rather than all at once: `hideLevel` rises
 * with each successful review, so the verse thins out as it is learned instead
 * of flipping between fully visible and fully blank.
 *
 * Which words disappear is chosen deterministically from the verse reference,
 * so the same verse hides the same words every time and the reader is
 * practising recall rather than adapting to a new puzzle each round.
 */
export default function MemorizeScreen() {
  const { colors } = useTheme();
  const type = useTypeScale();
  const queryClient = useQueryClient();

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const entries = useQuery({ queryKey: ['memorization'], queryFn: listMemorization });
  const verses = useQuery({
    queryKey: ['memorization-verses', entries.data?.length],
    queryFn: () => getVersesByRefs((entries.data ?? []).map((entry) => entry.verseRef)),
    enabled: (entries.data?.length ?? 0) > 0,
  });

  const list = entries.data ?? [];
  if (list.length === 0) {
    return (
      <Screen>
        <View style={{ paddingTop: 40 }}>
          <EmptyState
            title="Nothing to practise yet"
            body="Open a verse and tap Memorize to add it here."
          />
        </View>
      </Screen>
    );
  }

  const current = list[Math.min(index, list.length - 1)];
  const verse = (verses.data ?? []).find((item) => item.ref === current?.verseRef);

  async function review(outcome: 'again' | 'good') {
    if (!current) return;
    await recordMemorizationReview(current.verseRef, outcome);
    await queryClient.invalidateQueries({ queryKey: ['memorization'] });
    setRevealed(false);
    setIndex((value) => (value + 1) % list.length);
  }

  return (
    <Screen>
      <View style={{ paddingTop: 12, gap: 20 }}>
        <View>
          <Heading level={2}>Memorization</Heading>
          <Caption style={{ marginTop: 4 }}>
            {index + 1} of {list.length} · {current?.stage} · {current?.repetitions} repetitions
          </Caption>
        </View>

        {verse ? (
          <Card style={{ backgroundColor: colors.surfaceRaised, minHeight: 200 }}>
            <Text style={{ color: colors.accent, fontSize: type.caption, marginBottom: 12 }}>
              {verse.ref}
            </Text>

            {verse.sanskrit ? (
              <Text
                style={{
                  color: colors.sanskrit,
                  fontSize: type.sanskrit,
                  lineHeight: type.sanskritLineHeight,
                }}
              >
                {revealed
                  ? verse.sanskrit
                  : maskWords(verse.sanskrit, current?.hideLevel ?? 0, verse.ref)}
              </Text>
            ) : null}

            {/* The translation is the prompt, so it stays hidden until asked for. */}
            {revealed && verse.translationEn ? (
              <Text
                style={{
                  color: colors.textSecondary,
                  fontSize: type.small,
                  lineHeight: type.small * 1.6,
                  marginTop: 16,
                  paddingTop: 16,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                }}
              >
                {verse.translationEn}
              </Text>
            ) : null}
          </Card>
        ) : (
          <Caption>That verse is not on this device yet.</Caption>
        )}

        <Caption>
          {current?.hideLevel ?? 0}% of the words are hidden. It rises as you recall it correctly.
        </Caption>

        {!revealed ? (
          <Button label="Reveal" onPress={() => setRevealed(true)} />
        ) : (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              label="Again"
              variant="secondary"
              style={{ flex: 1 }}
              onPress={() => void review('again')}
            />
            <Button label="Got it" style={{ flex: 1 }} onPress={() => void review('good')} />
          </View>
        )}

        <View>
          <SectionHeader title="Your list" />
          <View style={{ gap: 6 }}>
            {list.map((entry, position) => (
              <Pressable
                key={entry.id}
                onPress={() => {
                  setIndex(position);
                  setRevealed(false);
                }}
                style={{
                  minHeight: 44,
                  justifyContent: 'center',
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: position === index ? colors.accent : colors.border,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.textPrimary, fontSize: type.small }}>
                    {entry.verseRef}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: type.caption }}>
                    {entry.stage}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Screen>
  );
}

/**
 * Hide a proportion of the words, keeping the line shape intact.
 *
 * The choice of which words is seeded from the reference, so it is stable
 * across sessions — the reader is recalling the same gaps, not learning a new
 * arrangement each time.
 */
function maskWords(text: string, hideLevel: number, seedSource: string): string {
  if (hideLevel <= 0) return text;

  let seed = 0;
  for (let index = 0; index < seedSource.length; index += 1) {
    seed = (seed * 31 + seedSource.charCodeAt(index)) >>> 0;
  }

  return text
    .split('\n')
    .map((line) =>
      line
        .split(' ')
        .map((word, position) => {
          if (!word.trim()) return word;
          // A stable pseudo-random value per word position.
          const value = ((seed + position * 2654435761) >>> 0) % 100;
          if (value >= hideLevel) return word;
          return '·'.repeat(Math.max(2, Math.min(word.length, 6)));
        })
        .join(' '),
    )
    .join('\n');
}
