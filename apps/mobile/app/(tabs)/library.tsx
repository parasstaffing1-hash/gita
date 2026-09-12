import { useQuery } from '@tanstack/react-query';
import { Link, router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

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
import { getVersesByRefs, listPlans } from '@/lib/db/content';
import {
  listBookmarks,
  listCollections,
  listMemorization,
  listNotes,
} from '@/lib/db/user-data';
import { useSession } from '@/lib/store';

/**
 * Library: everything the reader has made, plus their plans and settings.
 *
 * All of it works signed out. Signing in adds cross-device sync and nothing
 * else, which is what the copy on this screen says.
 */
export default function LibraryScreen() {
  const { colors } = useTheme();
  const type = useTypeScale();
  const userId = useSession((state) => state.userId);
  const [refreshKey, setRefreshKey] = useState(0);

  useFocusEffect(
    useCallback(() => {
      setRefreshKey((value) => value + 1);
    }, []),
  );

  const bookmarks = useQuery({ queryKey: ['bookmarks', refreshKey], queryFn: listBookmarks });
  const bookmarkVerses = useQuery({
    queryKey: ['bookmark-verses', bookmarks.data?.length, refreshKey],
    queryFn: () => getVersesByRefs((bookmarks.data ?? []).map((b) => b.verseRef)),
    enabled: (bookmarks.data?.length ?? 0) > 0,
  });
  const notes = useQuery({ queryKey: ['all-notes', refreshKey], queryFn: () => listNotes() });
  const collections = useQuery({ queryKey: ['collections', refreshKey], queryFn: listCollections });
  const memorization = useQuery({ queryKey: ['memorization', refreshKey], queryFn: listMemorization });
  const plans = useQuery({ queryKey: ['plans'], queryFn: listPlans });

  return (
    <Screen>
      <View style={{ paddingTop: 12, gap: 26 }}>
        <Heading level={2}>Library</Heading>

        {!userId ? (
          <Card style={{ backgroundColor: colors.surfaceSunken }}>
            <Body style={{ color: colors.textPrimary }}>Everything here is on this device</Body>
            <Caption style={{ marginTop: 6, lineHeight: type.caption * 1.5 }}>
              Reading, search, bookmarks and notes all work without an account. Signing in adds
              sync across your devices — nothing else.
            </Caption>
          </Card>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <StatTile label="Bookmarks" value={bookmarks.data?.length ?? 0} />
          <StatTile label="Notes" value={notes.data?.length ?? 0} />
          <StatTile label="Memorizing" value={memorization.data?.length ?? 0} />
        </View>

        {(collections.data?.length ?? 0) > 0 ? (
          <View>
            <SectionHeader title="Collections" />
            <View style={{ gap: 8 }}>
              {(collections.data ?? []).map((collection) => (
                <View
                  key={collection.id}
                  style={{
                    minHeight: 52,
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                    paddingHorizontal: 16,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ color: colors.textPrimary, fontSize: type.body }}>
                      {collection.name}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: type.small }}>
                      {collection.itemCount}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View>
          <SectionHeader
            title="Memorization"
            action={
              <Pressable onPress={() => router.push('/memorize')}>
                <Caption style={{ color: colors.accent }}>Practise</Caption>
              </Pressable>
            }
          />
          {(memorization.data?.length ?? 0) === 0 ? (
            <Caption>
              Nothing yet. Open a verse and tap Memorize to add it.
            </Caption>
          ) : (
            <View style={{ gap: 6 }}>
              {(memorization.data ?? []).slice(0, 5).map((entry) => (
                <View
                  key={entry.id}
                  style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 }}
                >
                  <Text style={{ color: colors.textPrimary, fontSize: type.small }}>
                    {entry.verseRef}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: type.caption }}>
                    {entry.stage} · {entry.repetitions} reps
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {(plans.data?.length ?? 0) > 0 ? (
          <View>
            <SectionHeader title="Reading plans" />
            <View style={{ gap: 10 }}>
              {(plans.data ?? []).slice(0, 4).map((plan) => (
                <Link key={plan.slug} href={`/plan/${plan.slug}`} asChild>
                  <Pressable>
                    <Card>
                      <Caption>
                        {plan.durationDays} days · {plan.level}
                      </Caption>
                      <Body style={{ color: colors.textPrimary, marginTop: 4 }}>{plan.title}</Body>
                      {plan.subtitle ? <Caption style={{ marginTop: 2 }}>{plan.subtitle}</Caption> : null}
                    </Card>
                  </Pressable>
                </Link>
              ))}
            </View>
          </View>
        ) : null}

        {(bookmarkVerses.data?.length ?? 0) > 0 ? (
          <View>
            <SectionHeader title="Bookmarks" />
            <View>
              {(bookmarkVerses.data ?? []).map((verse) => (
                <VerseRow key={verse.id} verse={verse} />
              ))}
            </View>
          </View>
        ) : null}

        {(notes.data?.length ?? 0) > 0 ? (
          <View>
            <SectionHeader title="Notes" />
            <View style={{ gap: 10 }}>
              {(notes.data ?? []).slice(0, 6).map((note) => (
                <Card key={note.id} style={{ backgroundColor: colors.surfaceSunken }}>
                  {note.verseRef ? <Caption>{note.verseRef}</Caption> : null}
                  <Body style={{ marginTop: 4 }} numberOfLines={3}>
                    {note.body}
                  </Body>
                </Card>
              ))}
            </View>
          </View>
        ) : null}

        <View>
          <SectionHeader title="Settings" />
          <Pressable
            onPress={() => router.push('/reader-settings')}
            style={{
              minHeight: 52,
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 10,
              paddingHorizontal: 16,
            }}
          >
            <Text style={{ color: colors.textPrimary, fontSize: type.body }}>
              Reading preferences
            </Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  const { colors } = useTheme();
  const type = useTypeScale();
  return (
    <View
      style={{
        flex: 1,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        padding: 14,
      }}
    >
      <Text
        style={{ color: colors.textPrimary, fontSize: type.heading, fontVariant: ['tabular-nums'] }}
      >
        {value}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: type.caption, marginTop: 2 }}>{label}</Text>
    </View>
  );
}
