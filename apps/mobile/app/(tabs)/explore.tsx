import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { transliterationSkeleton } from '@gita/shared-utils';

import {
  Body,
  Caption,
  Card,
  EmptyState,
  Heading,
  Screen,
  SectionHeader,
  useTheme,
  useTypeScale,
} from '@/components/ui';
import { VerseRow } from '@/components/verse';
import { listGlossary, listTopics, searchVerses } from '@/lib/db/content';

const GROUPS = [
  { key: 'emotion', title: 'Emotions' },
  { key: 'life', title: 'Life' },
  { key: 'practice', title: 'Practice' },
  { key: 'concept', title: 'Concepts' },
] as const;

/**
 * Explore: offline search, curated topics, and the glossary.
 *
 * Search runs against the local FTS index using the same folding the server
 * uses, so "krsna" behaves identically online and off.
 */
export default function ExploreScreen() {
  const { colors } = useTheme();
  const type = useTypeScale();
  const [query, setQuery] = useState('');

  const results = useQuery({
    queryKey: ['local-search', query],
    queryFn: () => searchVerses(query, transliterationSkeleton(query), 30),
    enabled: query.trim().length > 1,
  });

  const topics = useQuery({ queryKey: ['topics', 'all'], queryFn: () => listTopics() });
  const glossary = useQuery({ queryKey: ['glossary'], queryFn: listGlossary });

  const searching = query.trim().length > 1;

  return (
    <Screen>
      <View style={{ paddingTop: 12, gap: 26 }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="2.47, कर्म, karma, or a question"
          placeholderTextColor={colors.textMuted}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search verses"
          style={{
            minHeight: 48,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            paddingHorizontal: 16,
            color: colors.textPrimary,
            fontSize: type.body,
            backgroundColor: colors.surface,
          }}
        />

        {searching ? (
          <View>
            <SectionHeader title={`${results.data?.length ?? 0} results`} />
            {(results.data?.length ?? 0) === 0 ? (
              <EmptyState
                title="Nothing matched"
                body="Try a single word, or a reference such as 2.47."
              />
            ) : (
              <View>
                {(results.data ?? []).map((verse) => (
                  <VerseRow key={verse.id} verse={verse} />
                ))}
              </View>
            )}
          </View>
        ) : (
          <>
            {GROUPS.map((group) => {
              const items = (topics.data ?? []).filter((topic) => topic.category === group.key);
              if (items.length === 0) return null;
              return (
                <View key={group.key}>
                  <SectionHeader title={group.title} />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {items.map((topic) => (
                      <Link key={topic.slug} href={`/topic/${topic.slug}`} asChild>
                        <Pressable
                          style={{
                            minHeight: 44,
                            justifyContent: 'center',
                            paddingHorizontal: 16,
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: colors.border,
                          }}
                        >
                          <Text style={{ color: colors.textSecondary, fontSize: type.small }}>
                            {topic.name}
                          </Text>
                        </Pressable>
                      </Link>
                    ))}
                  </View>
                </View>
              );
            })}

            {(glossary.data?.length ?? 0) > 0 ? (
              <View>
                <SectionHeader title="Glossary" />
                <View style={{ gap: 10 }}>
                  {(glossary.data ?? []).slice(0, 6).map((term) => (
                    <Link key={term.slug} href={`/glossary/${term.slug}`} asChild>
                      <Pressable>
                        <Card>
                          <Text
                            style={{
                              color: colors.sanskrit,
                              fontSize: type.title,
                              lineHeight: type.title * 1.6,
                            }}
                          >
                            {term.termSanskrit}
                          </Text>
                          <Text
                            style={{
                              color: colors.accent,
                              fontSize: type.small,
                              fontStyle: 'italic',
                              marginTop: 2,
                            }}
                          >
                            {term.termTransliteration}
                          </Text>
                          <Body style={{ marginTop: 8 }} numberOfLines={2}>
                            {term.simpleDefinition}
                          </Body>
                        </Card>
                      </Pressable>
                    </Link>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
      </View>
    </Screen>
  );
}
