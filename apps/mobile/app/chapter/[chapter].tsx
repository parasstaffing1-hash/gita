import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Heading,
  useTheme,
  useTypeScale,
} from '@/components/ui';
import { VerseRow } from '@/components/verse';
import { getChapter, listChapterVerses } from '@/lib/db/content';
import { router } from 'expo-router';

export default function ChapterScreen() {
  const params = useLocalSearchParams<{ chapter: string }>();
  const number = Number.parseInt(params.chapter ?? '', 10);
  const { colors } = useTheme();
  const type = useTypeScale();

  const chapter = useQuery({
    queryKey: ['chapter', number],
    queryFn: () => getChapter(number),
    enabled: Number.isInteger(number),
  });
  const verses = useQuery({
    queryKey: ['chapter-verses', number],
    queryFn: () => listChapterVerses(number),
    enabled: Number.isInteger(number),
  });

  if (!chapter.data) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: 20, paddingTop: 40 }}>
        <EmptyState title="Chapter not available offline yet" />
      </View>
    );
  }

  const data = chapter.data;
  const loaded = verses.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: `Chapter ${data.number}` }} />
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <FlashList
          data={loaded}
          estimatedItemSize={92}
          keyExtractor={(verse) => verse.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          renderItem={({ item }) => <VerseRow verse={item} />}
          ItemSeparatorComponent={() => (
            <View style={{ height: 1, backgroundColor: colors.border }} />
          )}
          ListHeaderComponent={
            <View style={{ paddingTop: 8, paddingBottom: 20, gap: 16 }}>
              <View>
                <Caption>
                  Chapter {data.number} of 18 · {data.verseCount} verses
                </Caption>
                {data.nameSanskrit ? (
                  <Text
                    style={{
                      color: colors.sanskrit,
                      fontSize: type.heading,
                      lineHeight: type.heading * 1.6,
                      marginTop: 6,
                    }}
                  >
                    {data.nameSanskrit}
                  </Text>
                ) : null}
                <Heading level={3} style={{ marginTop: 2 }}>
                  {data.nameEnglish}
                </Heading>
              </View>

              {data.summary ? <Body>{data.summary}</Body> : null}

              {data.majorTeachings.length > 0 ? (
                <Card>
                  <Caption style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                    Major teachings
                  </Caption>
                  <View style={{ gap: 10 }}>
                    {data.majorTeachings.map((teaching) => (
                      <View key={teaching} style={{ flexDirection: 'row', gap: 10 }}>
                        <Text style={{ color: colors.accent }}>❦</Text>
                        <Body style={{ flex: 1, fontSize: type.small }}>{teaching}</Body>
                      </View>
                    ))}
                  </View>
                </Card>
              ) : null}

              {data.keyConcepts.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {data.keyConcepts.map((concept) => (
                    <Badge key={concept}>{concept}</Badge>
                  ))}
                </View>
              ) : null}

              <Button
                label="Start reading"
                onPress={() => router.push(`/verse/${data.number}/1`)}
              />

              {loaded.length < data.verseCount ? (
                <Caption>
                  {loaded.length} of {data.verseCount} verses are on this device so far.
                </Caption>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <EmptyState
              title="No verses downloaded yet"
              body="They will appear here once the text has finished downloading."
            />
          }
        />
      </View>
    </>
  );
}
