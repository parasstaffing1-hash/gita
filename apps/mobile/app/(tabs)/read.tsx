import { FlashList } from '@shopify/flash-list';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Caption, EmptyState, Screen, useTheme, useTypeScale } from '@/components/ui';
import { listChapters, type LocalChapter } from '@/lib/db/content';
import { listReadingProgress } from '@/lib/db/user-data';

/**
 * The chapter list.
 *
 * FlashList rather than a plain map: 18 rows is small, but this is the screen
 * that grows when more scriptures are added, and the recycling behaviour is
 * worth having in place from the start.
 */
export default function ReadScreen() {
  const { colors } = useTheme();
  const type = useTypeScale();

  const chapters = useQuery({ queryKey: ['chapters'], queryFn: listChapters });
  const progress = useQuery({ queryKey: ['reading-progress'], queryFn: listReadingProgress });

  const progressByChapter = new Map(
    (progress.data ?? []).map((entry) => [entry.chapterNumber, entry]),
  );

  if ((chapters.data?.length ?? 0) === 0) {
    return (
      <Screen>
        <View style={{ paddingTop: 40 }}>
          <EmptyState
            title="No chapters yet"
            body="The text has not finished downloading. It will appear here once it has."
          />
        </View>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <FlashList
        data={chapters.data ?? []}
        estimatedItemSize={110}
        keyExtractor={(chapter) => String(chapter.number)}
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 12 }}
        renderItem={({ item }) => (
          <ChapterRow
            chapter={item}
            lastVerse={progressByChapter.get(item.number)?.lastVerseNumber}
          />
        )}
        ItemSeparatorComponent={() => (
          <View style={{ height: 1, backgroundColor: colors.border }} />
        )}
        ListHeaderComponent={
          <Caption style={{ marginBottom: 14 }}>
            Eighteen chapters, seven hundred verses.
          </Caption>
        }
      />
    </View>
  );
}

function ChapterRow({ chapter, lastVerse }: { chapter: LocalChapter; lastVerse?: number }) {
  const { colors } = useTheme();
  const type = useTypeScale();
  const percent = lastVerse ? Math.round((lastVerse / chapter.verseCount) * 100) : 0;

  return (
    <Link href={`/chapter/${chapter.number}`} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Chapter ${chapter.number}, ${chapter.nameEnglish}, ${chapter.verseCount} verses`}
        style={({ pressed }) => ({ paddingVertical: 16, opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16 }}>
          <Text
            style={{
              color: colors.accent,
              fontSize: type.title,
              fontVariant: ['tabular-nums'],
              width: 34,
            }}
          >
            {String(chapter.number).padStart(2, '0')}
          </Text>

          <View style={{ flex: 1 }}>
            {chapter.nameSanskrit ? (
              <Text
                style={{
                  color: colors.sanskrit,
                  fontSize: type.body * 1.15,
                  lineHeight: type.body * 1.9,
                }}
              >
                {chapter.nameSanskrit}
              </Text>
            ) : null}
            <Text style={{ color: colors.textSecondary, fontSize: type.body, marginTop: 2 }}>
              {chapter.nameEnglish}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: type.caption, marginTop: 4 }}>
              {chapter.verseCount} verses
              {percent > 0 ? ` · ${percent}% read` : ''}
            </Text>

            {percent > 0 ? (
              <View
                style={{
                  height: 3,
                  backgroundColor: colors.surfaceSunken,
                  borderRadius: 2,
                  marginTop: 8,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{ height: 3, width: `${percent}%`, backgroundColor: colors.accent }}
                />
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}
