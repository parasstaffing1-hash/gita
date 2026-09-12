import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { Body, Caption, EmptyState, Heading, Screen, SectionHeader } from '@/components/ui';
import { VerseRow } from '@/components/verse';
import { getTopic } from '@/lib/db/content';

export default function TopicScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const topic = useQuery({ queryKey: ['topic', slug], queryFn: () => getTopic(slug ?? '') });

  if (!topic.data) {
    return (
      <Screen>
        <View style={{ paddingTop: 40 }}>
          <EmptyState title="Topic not available offline yet" />
        </View>
      </Screen>
    );
  }

  const data = topic.data;

  return (
    <>
      <Stack.Screen options={{ title: data.name }} />
      <Screen>
        <View style={{ paddingTop: 8, gap: 20 }}>
          <View>
            <Heading level={2}>What the Gita says about {data.name.toLowerCase()}</Heading>
            {data.nameHindi ? <Caption style={{ marginTop: 4 }}>{data.nameHindi}</Caption> : null}
          </View>

          {data.introduction ? <Body>{data.introduction}</Body> : null}

          <View>
            <SectionHeader title={`${data.verses.length} verses`} />
            {data.verses.length === 0 ? (
              <Caption>
                No verses have been mapped to this topic yet. These lists are curated by hand, not
                generated, so they fill in as the verified text is imported.
              </Caption>
            ) : (
              <View>
                {data.verses.map((verse) => (
                  <VerseRow key={verse.id} verse={verse} />
                ))}
              </View>
            )}
          </View>
        </View>
      </Screen>
    </>
  );
}
