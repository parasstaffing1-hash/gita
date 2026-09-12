import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Stack, router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { nextVerse, previousVerse, transliterationSkeleton } from '@gita/shared-utils';

import {
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Heading,
  IconButton,
  Screen,
  useTheme,
  useTypeScale,
} from '@/components/ui';
import { VerseBody } from '@/components/verse';
import { findGlossaryBySearchKey, getVerse } from '@/lib/db/content';
import {
  isBookmarked,
  listHighlights,
  listNotes,
  recordVerseRead,
  saveNote,
  setHighlight,
  startMemorizing,
  toggleBookmark,
  type HighlightColor,
} from '@/lib/db/user-data';

const HIGHLIGHT_CHOICES: HighlightColor[] = ['saffron', 'gold', 'sage', 'sky', 'rose'];

/**
 * The verse reader.
 *
 * Everything on this screen comes from SQLite. Bookmarking, highlighting and
 * note-taking all write locally and work signed out; they are marked dirty and
 * pushed later if there is an account.
 */
export default function VerseScreen() {
  const params = useLocalSearchParams<{ chapter: string; verse: string }>();
  const chapter = Number.parseInt(params.chapter ?? '', 10);
  const verseNumber = Number.parseInt(params.verse ?? '', 10);

  const { colors } = useTheme();
  const type = useTypeScale();
  const queryClient = useQueryClient();

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [glossaryHit, setGlossaryHit] = useState<{
    slug: string;
    termSanskrit: string;
    termTransliteration: string;
    simpleDefinition: string;
  } | null>(null);

  const verse = useQuery({
    queryKey: ['verse', chapter, verseNumber],
    queryFn: () => getVerse(chapter, verseNumber),
    enabled: Number.isInteger(chapter) && Number.isInteger(verseNumber),
  });

  const bookmarked = useQuery({
    queryKey: ['bookmarked', chapter, verseNumber],
    queryFn: () => isBookmarked(`${chapter}.${verseNumber}`),
  });

  const highlights = useQuery({
    queryKey: ['highlights', chapter, verseNumber],
    queryFn: () => listHighlights(`${chapter}.${verseNumber}`),
  });

  const notes = useQuery({
    queryKey: ['notes', chapter, verseNumber],
    queryFn: () => listNotes(`${chapter}.${verseNumber}`),
  });

  // Reading position is what powers "continue reading" on the home screen.
  useEffect(() => {
    if (verse.data) void recordVerseRead(chapter, verseNumber);
  }, [chapter, verseNumber, verse.data]);

  const onWordPress = useCallback(async (word: string) => {
    const hit = await findGlossaryBySearchKey(transliterationSkeleton(word));
    if (hit) setGlossaryHit(hit);
  }, []);

  if (verse.isLoading) {
    return <Screen><View style={{ paddingTop: 40 }}><Caption>Loading…</Caption></View></Screen>;
  }

  if (!verse.data) {
    return (
      <Screen>
        <View style={{ paddingTop: 40 }}>
          <EmptyState
            title="This verse is not on the device yet"
            body="It will appear once the text has finished downloading."
          />
        </View>
      </Screen>
    );
  }

  const data = verse.data;
  const ref = `${chapter}.${verseNumber}`;
  const previous = previousVerse(chapter, verseNumber);
  const next = nextVerse(chapter, verseNumber);

  const highlightMap = Object.fromEntries(
    (highlights.data ?? []).map((entry) => [entry.target, entry.color]),
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['bookmarked', chapter, verseNumber] });
    void queryClient.invalidateQueries({ queryKey: ['highlights', chapter, verseNumber] });
    void queryClient.invalidateQueries({ queryKey: ['notes', chapter, verseNumber] });
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: `Gita ${ref}`,
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <IconButton
                label={bookmarked.data ? 'Remove bookmark' : 'Bookmark this verse'}
                glyph={bookmarked.data ? '★' : '☆'}
                active={bookmarked.data}
                onPress={async () => {
                  await toggleBookmark(ref);
                  invalidate();
                }}
              />
              <IconButton
                label="Reading preferences"
                glyph="Aa"
                onPress={() => router.push('/reader-settings')}
              />
            </View>
          ),
        }}
      />

      <Screen>
        <View style={{ paddingTop: 8, gap: 20 }}>
          <View>
            <Heading level={2}>Bhagavad Gita {ref}</Heading>
            {data.speaker ? (
              <Caption style={{ marginTop: 4 }}>Spoken by {data.speaker}</Caption>
            ) : null}
          </View>

          <VerseBody verse={data} highlights={highlightMap} onWordPress={onWordPress} />

          {/* Highlight colours. Tapping the active one clears it. */}
          <View>
            <Caption style={{ marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
              Highlight
            </Caption>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {HIGHLIGHT_CHOICES.map((color) => {
                const active = highlightMap.translation === color;
                return (
                  <Pressable
                    key={color}
                    accessibilityRole="button"
                    accessibilityLabel={`${color} highlight`}
                    accessibilityState={{ selected: active }}
                    onPress={async () => {
                      await setHighlight(ref, 'translation', active ? null : color);
                      invalidate();
                    }}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: active ? 2 : 1,
                      borderColor: active ? colors.accent : colors.border,
                    }}
                  >
                    <View
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        backgroundColor: HIGHLIGHT_SWATCHES[color],
                      }}
                    />
                  </Pressable>
                );
              })}
            </View>
          </View>

          {(notes.data?.length ?? 0) > 0 ? (
            <View>
              <Caption style={{ marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                Your notes
              </Caption>
              <View style={{ gap: 10 }}>
                {(notes.data ?? []).map((note) => (
                  <Card key={note.id} style={{ backgroundColor: colors.surfaceSunken }}>
                    <Body>{note.body}</Body>
                  </Card>
                ))}
              </View>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <Button label="Add a note" variant="secondary" onPress={() => setNoteOpen(true)} />
            <Button
              label="Memorize"
              variant="secondary"
              onPress={async () => {
                await startMemorizing(ref);
                Alert.alert('Added', `${ref} is now in your memorization list.`);
              }}
            />
            <Link href={{ pathname: '/ask', params: { verse: ref } }} asChild>
              <Button label="Ask about this verse" variant="secondary" />
            </Link>
            {/* The composer opens on this verse. It fetches the text itself
                rather than carrying it in the route — the card must show what
                the library holds, not what this screen happened to have. */}
            <Link href={{ pathname: '/create', params: { ref } }} asChild>
              <Button label="Make a card" variant="secondary" />
            </Link>
          </View>

          {/* Previous / next. Crosses chapter boundaries. */}
          <View
            style={{
              flexDirection: 'row',
              gap: 12,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              paddingTop: 18,
            }}
          >
            {previous ? (
              <Link href={`/verse/${previous.chapter}/${previous.verse}`} asChild>
                <Pressable
                  style={{
                    flex: 1,
                    minHeight: 56,
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                    paddingHorizontal: 14,
                  }}
                >
                  <Caption>Previous</Caption>
                  <Text style={{ color: colors.textPrimary, fontSize: type.small }}>
                    {previous.chapter}.{previous.verse}
                  </Text>
                </Pressable>
              </Link>
            ) : (
              <View style={{ flex: 1 }} />
            )}

            {next ? (
              <Link href={`/verse/${next.chapter}/${next.verse}`} asChild>
                <Pressable
                  style={{
                    flex: 1,
                    minHeight: 56,
                    justifyContent: 'center',
                    alignItems: 'flex-end',
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                    paddingHorizontal: 14,
                  }}
                >
                  <Caption>Next</Caption>
                  <Text style={{ color: colors.textPrimary, fontSize: type.small }}>
                    {next.chapter}.{next.verse}
                  </Text>
                </Pressable>
              </Link>
            ) : (
              <View style={{ flex: 1 }} />
            )}
          </View>
        </View>
      </Screen>

      {/* Note editor */}
      <Modal visible={noteOpen} animationType="slide" transparent onRequestClose={() => setNoteOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: 20,
              gap: 14,
            }}
          >
            <Heading level={3}>Note on {ref}</Heading>
            <Caption>Notes stay on this device unless you sign in. They are never sent to an AI provider.</Caption>
            <TextInput
              value={noteText}
              onChangeText={setNoteText}
              multiline
              numberOfLines={5}
              maxLength={10000}
              placeholder="What do you want to remember about this verse?"
              placeholderTextColor={colors.textMuted}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                padding: 12,
                minHeight: 120,
                textAlignVertical: 'top',
                color: colors.textPrimary,
                fontSize: type.body,
              }}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button
                label="Save"
                style={{ flex: 1 }}
                onPress={async () => {
                  if (!noteText.trim()) return;
                  await saveNote({ verseRef: ref, body: noteText });
                  setNoteText('');
                  setNoteOpen(false);
                  invalidate();
                }}
              />
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => {
                  setNoteText('');
                  setNoteOpen(false);
                }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Glossary popover, from tapping a word in the Sanskrit */}
      <Modal
        visible={glossaryHit !== null}
        animationType="fade"
        transparent
        onRequestClose={() => setGlossaryHit(null)}
      >
        <Pressable
          style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.4)' }}
          onPress={() => setGlossaryHit(null)}
        >
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 20, gap: 10 }}>
            <Text style={{ color: colors.sanskrit, fontSize: type.heading }}>
              {glossaryHit?.termSanskrit}
            </Text>
            <Text style={{ color: colors.accent, fontSize: type.body, fontStyle: 'italic' }}>
              {glossaryHit?.termTransliteration}
            </Text>
            <Body>{glossaryHit?.simpleDefinition}</Body>
            {glossaryHit ? (
              <Link href={`/glossary/${glossaryHit.slug}`} asChild>
                <Button label="Full entry" variant="secondary" onPress={() => setGlossaryHit(null)} />
              </Link>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/** Swatch colours for the picker. Light-theme values read correctly as dots. */
const HIGHLIGHT_SWATCHES: Record<HighlightColor, string> = {
  saffron: '#F9DCB4',
  gold: '#F1E4B8',
  sage: '#D5E3D0',
  sky: '#CFDEEA',
  rose: '#EFD5DA',
};
