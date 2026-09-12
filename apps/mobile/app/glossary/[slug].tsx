import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import {
  Badge,
  Body,
  Caption,
  EmptyState,
  Screen,
  SectionHeader,
  useTheme,
  useTypeScale,
} from '@/components/ui';
import { VerseRow } from '@/components/verse';
import { getGlossaryTerm, getVersesByRefs } from '@/lib/db/content';

export default function GlossaryTermScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { colors } = useTheme();
  const type = useTypeScale();

  const term = useQuery({ queryKey: ['glossary', slug], queryFn: () => getGlossaryTerm(slug ?? '') });
  const verses = useQuery({
    queryKey: ['glossary-verses', slug, term.data?.relatedVerseRefs?.length],
    queryFn: () => getVersesByRefs(term.data?.relatedVerseRefs ?? []),
    enabled: (term.data?.relatedVerseRefs?.length ?? 0) > 0,
  });

  if (!term.data) {
    return (
      <Screen>
        <View style={{ paddingTop: 40 }}>
          <EmptyState title="Term not available offline yet" />
        </View>
      </Screen>
    );
  }

  const data = term.data;

  return (
    <>
      <Stack.Screen options={{ title: data.termTransliteration }} />
      <Screen>
        <View style={{ paddingTop: 8, gap: 20 }}>
          <View>
            <Text
              style={{
                color: colors.sanskrit,
                fontSize: type.display,
                lineHeight: type.display * 1.5,
              }}
            >
              {data.termSanskrit}
            </Text>
            <Text
              style={{
                color: colors.accent,
                fontSize: type.title,
                fontStyle: 'italic',
                marginTop: 4,
              }}
            >
              {data.termTransliteration}
            </Text>
            {data.termEnglish ? <Caption style={{ marginTop: 4 }}>{data.termEnglish}</Caption> : null}
          </View>

          <View style={{ borderLeftWidth: 2, borderLeftColor: colors.accent, paddingLeft: 14 }}>
            <Body style={{ color: colors.textPrimary }}>{data.simpleDefinition}</Body>
          </View>

          {data.detailedDefinition ? (
            <View>
              <SectionHeader title="In more depth" />
              <Body>{data.detailedDefinition}</Body>
            </View>
          ) : null}

          {data.variants.length > 0 ? (
            <View>
              <SectionHeader title="Also written" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {data.variants.map((variant) => (
                  <Badge key={variant}>{variant}</Badge>
                ))}
              </View>
            </View>
          ) : null}

          {(verses.data?.length ?? 0) > 0 ? (
            <View>
              <SectionHeader title="Where it appears" />
              <View>
                {(verses.data ?? []).map((verse) => (
                  <VerseRow key={verse.id} verse={verse} />
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </Screen>
    </>
  );
}
