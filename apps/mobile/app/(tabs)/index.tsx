import { useQuery } from '@tanstack/react-query';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';

import {
  Badge,
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
import { VerseCard } from '@/components/verse';
import { greetingKey, localDateKey } from '@gita/shared-utils';
import { getDailyVerse, getVersesByRefs, listTopics } from '@/lib/db/content';
import { getContinueReading, listBookmarks } from '@/lib/db/user-data';
import { useContentState } from '@/lib/store';

const GREETINGS = {
  morning: 'Good morning',
  afternoon: 'Good afternoon',
  evening: 'Good evening',
  night: 'Peaceful night',
} as const;

/**
 * Home.
 *
 * Everything here reads from SQLite, so the screen is fully populated with no
 * network. Nothing on it spins.
 */
export default function HomeScreen() {
  const { colors } = useTheme();
  const type = useTypeScale();
  const { ready, syncing, progress, error } = useContentState();
  const [refreshKey, setRefreshKey] = useState(0);

  // User data changes while the reader is elsewhere in the app, so refresh it
  // when this screen comes back into focus.
  useFocusEffect(
    useCallback(() => {
      setRefreshKey((value) => value + 1);
    }, []),
  );

  const today = localDateKey();
  const daily = useQuery({
    queryKey: ['daily', today, ready],
    queryFn: () => getDailyVerse(today),
    enabled: ready,
  });
  const continueReading = useQuery({
    queryKey: ['continue', refreshKey],
    queryFn: getContinueReading,
  });
  const bookmarks = useQuery({
    queryKey: ['bookmarks', refreshKey],
    queryFn: listBookmarks,
  });
  const bookmarkedVerses = useQuery({
    queryKey: ['bookmarked-verses', bookmarks.data?.length, refreshKey],
    queryFn: () => getVersesByRefs((bookmarks.data ?? []).slice(0, 4).map((b) => b.verseRef)),
    enabled: (bookmarks.data?.length ?? 0) > 0,
  });
  const topics = useQuery({
    queryKey: ['topics', 'emotion', ready],
    queryFn: () => listTopics('emotion'),
    enabled: ready,
  });

  if (!ready) {
    return (
      <Screen>
        <View style={{ paddingTop: 60, gap: 20 }}>
          <Heading level={2}>Preparing the text</Heading>
          {syncing ? (
            <>
              <Body>
                Downloading the Gita so it is available offline. This happens once.
              </Body>
              <View
                style={{
                  height: 4,
                  backgroundColor: colors.surfaceSunken,
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <View
                  style={{
                    height: 4,
                    width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%`,
                    backgroundColor: colors.accent,
                  }}
                />
              </View>
              <Caption>
                {progress.done} of {progress.total} chapters
              </Caption>
            </>
          ) : (
            <Body>{error ?? 'Waiting for the first download.'}</Body>
          )}
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ paddingTop: 12, gap: 32 }}>
        <View>
          <Caption>{GREETINGS[greetingKey()]}</Caption>
          <Heading style={{ marginTop: 4 }}>Gita</Heading>
        </View>

        {continueReading.data ? (
          <View>
            <SectionHeader title="Continue reading" />
            <Link
              href={`/verse/${continueReading.data.chapter}/${continueReading.data.verse}`}
              asChild
            >
              <Pressable>
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: colors.accentMuted,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Body style={{ color: colors.accent, fontWeight: '600' }}>
                      {continueReading.data.chapter}
                    </Body>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Body style={{ color: colors.textPrimary }}>
                      Chapter {continueReading.data.chapter}, verse{' '}
                      {continueReading.data.verse}
                    </Body>
                    <Caption>Pick up where you stopped</Caption>
                  </View>
                </Card>
              </Pressable>
            </Link>
          </View>
        ) : null}

        {daily.data ? (
          <View>
            <SectionHeader title="Shloka of the day" />
            <VerseCard verse={daily.data} />
          </View>
        ) : null}

        <View>
          <SectionHeader title="Ask the Gita" />
          <Link href="/ask" asChild>
            <Pressable>
              <Card style={{ backgroundColor: colors.surfaceSunken }}>
                <Body style={{ color: colors.textPrimary }}>
                  Ask a question in English, Hindi or Hinglish.
                </Body>
                <Caption style={{ marginTop: 6, lineHeight: type.caption * 1.5 }}>
                  Every answer cites the verses it came from, and says so plainly when there is
                  not enough in the library to answer well.
                </Caption>
              </Card>
            </Pressable>
          </Link>
        </View>

        <View>
          <SectionHeader title="Make a card" />
          <Link
            href={daily.data ? `/create?ref=${daily.data.ref}` : '/create'}
            asChild
          >
            <Pressable>
              <Card>
                <Body style={{ color: colors.textPrimary }}>
                  Set a verse on a wallpaper and save it to your photos.
                </Body>
                <Caption style={{ marginTop: 6, lineHeight: type.caption * 1.5 }}>
                  The verse comes from the library, never typed — so a card can only carry
                  scripture the text actually holds.
                </Caption>
              </Card>
            </Pressable>
          </Link>
        </View>

        {(topics.data?.length ?? 0) > 0 ? (
          <View>
            <SectionHeader
              title="Explore by life situation"
              action={
                <Link href="/explore" asChild>
                  <Pressable>
                    <Caption style={{ color: colors.accent }}>See all</Caption>
                  </Pressable>
                </Link>
              }
            />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(topics.data ?? []).slice(0, 8).map((topic) => (
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
                    <Body style={{ fontSize: type.small }}>{topic.name}</Body>
                  </Pressable>
                </Link>
              ))}
            </View>
          </View>
        ) : null}

        {(bookmarkedVerses.data?.length ?? 0) > 0 ? (
          <View>
            <SectionHeader title="Recently bookmarked" />
            <View style={{ gap: 12 }}>
              {(bookmarkedVerses.data ?? []).map((verse) => (
                <VerseCard key={verse.id} verse={verse} />
              ))}
            </View>
          </View>
        ) : null}

        <View>
          <SectionHeader title="New to the Gita" />
          <Link href="/start-here" asChild>
            <Pressable>
              <Card>
                <Body style={{ color: colors.textPrimary }}>Start here</Body>
                <Caption style={{ marginTop: 4 }}>
                  What the Gita is, who is speaking, and how to begin.
                </Caption>
              </Card>
            </Pressable>
          </Link>
        </View>

        {syncing ? (
          <Badge tone="neutral">
            {`Updating content — ${progress.done}/${progress.total} chapters`}
          </Badge>
        ) : null}
      </View>
    </Screen>
  );
}
