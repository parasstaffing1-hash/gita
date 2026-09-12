/**
 * Verse rendering on device.
 *
 * The layout preference decides which layers appear and in what order. Sanskrit
 * always comes first when it is shown: someone who reads Devanagari should not
 * have to scroll past a translation to reach the verse.
 */
import { Link } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { LocalVerse } from '@/lib/db/content';
import { usePreferences } from '@/lib/store';
import { HIGHLIGHT_COLORS } from '@/lib/theme';

import { Badge, Body, Caption, Card, UnverifiedNotice, useTheme, useTypeScale } from './ui';

export function SanskritText({
  text,
  highlighted,
  onWordPress,
}: {
  text: string;
  highlighted?: string | null;
  onWordPress?: (word: string) => void;
}) {
  const { colors, name } = useTheme();
  const type = useTypeScale();

  const style = {
    color: colors.sanskrit,
    fontSize: type.sanskrit,
    lineHeight: type.sanskritLineHeight,
    backgroundColor: highlighted ? HIGHLIGHT_COLORS[name][highlighted] : undefined,
  };

  // Tapping a word opens its glossary entry, so the reader can look something
  // up without leaving the verse.
  if (onWordPress) {
    return (
      <Text style={style}>
        {text.split(/(\s+)/).map((token, index) =>
          token.trim() ? (
            <Text key={index} onPress={() => onWordPress(token.trim())} suppressHighlighting>
              {token}
            </Text>
          ) : (
            token
          ),
        )}
      </Text>
    );
  }
  return <Text style={style}>{text}</Text>;
}

export function TransliterationText({ text }: { text: string }) {
  const { colors } = useTheme();
  const type = useTypeScale();
  return (
    <Text
      style={{
        color: colors.transliteration,
        fontSize: type.small,
        lineHeight: type.small * 1.7,
        fontStyle: 'italic',
      }}
    >
      {text}
    </Text>
  );
}

export function TranslationText({ text, highlighted }: { text: string; highlighted?: string | null }) {
  const { colors, name } = useTheme();
  const type = useTypeScale();
  return (
    <Text
      style={{
        color: colors.textSecondary,
        fontSize: type.body,
        lineHeight: type.bodyLineHeight,
        backgroundColor: highlighted ? HIGHLIGHT_COLORS[name][highlighted] : undefined,
      }}
    >
      {text}
    </Text>
  );
}

/** Compact row used in lists, search results and collections. */
export function VerseRow({ verse }: { verse: LocalVerse }) {
  const { colors } = useTheme();
  const type = useTypeScale();

  return (
    <Link href={`/verse/${verse.chapterNumber}/${verse.verseNumber}`} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Bhagavad Gita ${verse.ref}`}
        style={({ pressed }) => ({
          paddingVertical: 14,
          opacity: pressed ? 0.6 : 1,
          flexDirection: 'row',
          gap: 14,
        })}
      >
        <Text
          style={{
            color: colors.textMuted,
            fontSize: type.small,
            fontVariant: ['tabular-nums'],
            width: 46,
          }}
        >
          {verse.ref}
        </Text>
        <View style={{ flex: 1 }}>
          {verse.sanskrit ? (
            <Text
              numberOfLines={1}
              style={{
                color: colors.sanskrit,
                fontSize: type.body * 1.1,
                lineHeight: type.body * 1.9,
              }}
            >
              {verse.sanskrit.split('\n')[0]}
            </Text>
          ) : null}
          {verse.translationEn ? (
            <Text
              numberOfLines={2}
              style={{
                color: colors.textMuted,
                fontSize: type.small,
                lineHeight: type.small * 1.5,
                marginTop: 2,
              }}
            >
              {verse.translationEn}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </Link>
  );
}

export function VerseCard({ verse }: { verse: LocalVerse }) {
  const { colors } = useTheme();
  const type = useTypeScale();
  return (
    <Link href={`/verse/${verse.chapterNumber}/${verse.verseNumber}`} asChild>
      <Pressable style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
        <Card>
          <Text
            style={{
              color: colors.accent,
              fontSize: type.caption,
              fontVariant: ['tabular-nums'],
              marginBottom: 8,
            }}
          >
            {verse.ref}
          </Text>
          {verse.sanskrit ? (
            <Text
              numberOfLines={2}
              style={{
                color: colors.sanskrit,
                fontSize: type.sanskrit * 0.85,
                lineHeight: type.sanskrit * 1.6,
              }}
            >
              {verse.sanskrit.split('\n')[0]}
            </Text>
          ) : null}
          {verse.translationEn ? (
            <Text
              numberOfLines={3}
              style={{
                color: colors.textSecondary,
                fontSize: type.small,
                lineHeight: type.small * 1.6,
                marginTop: 10,
              }}
            >
              {verse.translationEn}
            </Text>
          ) : null}
        </Card>
      </Pressable>
    </Link>
  );
}

/**
 * The full verse.
 *
 * `layout` decides which layers render. `commentary_focus` still shows the
 * Sanskrit — the commentary is *about* the verse, so hiding it would make the
 * commentary harder to follow, not easier.
 */
export function VerseBody({
  verse,
  highlights,
  onWordPress,
}: {
  verse: LocalVerse;
  highlights?: Record<string, string>;
  onWordPress?: (word: string) => void;
}) {
  const { colors } = useTheme();
  const type = useTypeScale();
  const { layout, showWordMeanings, showCommentary, translationLanguage } = usePreferences(
    (state) => state.preferences,
  );

  const showSanskrit = layout !== 'translation_focus';
  const showTransliteration =
    layout === 'sanskrit_transliteration' || layout === 'sanskrit_only' ? true : layout !== 'sanskrit_hindi';
  const showTranslation = layout !== 'sanskrit_only';

  const translation =
    translationLanguage === 'hi'
      ? (verse.translationHi ?? verse.translationEn)
      : (verse.translationEn ?? verse.translationHi);

  return (
    <View style={{ gap: type.gap }}>
      {verse.verificationStatus !== 'published' ? <UnverifiedNotice /> : null}

      {showSanskrit && verse.sanskrit ? (
        <Card style={{ backgroundColor: colors.surfaceRaised }}>
          <SanskritText
            text={verse.sanskrit}
            highlighted={highlights?.sanskrit}
            onWordPress={onWordPress}
          />
          {showTransliteration && verse.transliteration ? (
            <View
              style={{
                marginTop: 16,
                paddingTop: 16,
                borderTopWidth: 1,
                borderTopColor: colors.border,
              }}
            >
              <TransliterationText text={verse.transliteration} />
            </View>
          ) : null}
        </Card>
      ) : null}

      {showTranslation && translation ? (
        <View>
          <Caption style={{ marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
            {translationLanguage === 'hi' ? 'अनुवाद' : 'Translation'}
          </Caption>
          <TranslationText text={translation} highlighted={highlights?.translation} />
        </View>
      ) : null}

      {showWordMeanings && verse.words.length > 0 ? (
        <View>
          <Caption style={{ marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
            Word by word
          </Caption>
          <View style={{ gap: 10 }}>
            {verse.words.map((word) => (
              <View
                key={word.position}
                style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8 }}
              >
                <Text style={{ color: colors.textPrimary, fontSize: type.body }}>
                  {word.wordDevanagari}
                  {word.wordTransliteration ? (
                    <Text style={{ color: colors.textMuted, fontSize: type.small, fontStyle: 'italic' }}>
                      {'  '}
                      {word.wordTransliteration}
                    </Text>
                  ) : null}
                </Text>
                {word.meaningEnglish ? (
                  <Text style={{ color: colors.textSecondary, fontSize: type.small, marginTop: 2 }}>
                    {word.meaningEnglish}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {showCommentary && verse.commentaries.length > 0 ? (
        <View>
          <Caption style={{ marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
            Commentary
          </Caption>
          <View style={{ gap: 16 }}>
            {verse.commentaries.map((commentary, index) => (
              <View
                key={index}
                style={{ borderLeftWidth: 2, borderLeftColor: colors.accent, paddingLeft: 14 }}
              >
                {commentary.commentatorName ? (
                  <Text
                    style={{
                      color: colors.textPrimary,
                      fontSize: type.small,
                      fontWeight: '600',
                      marginBottom: 4,
                    }}
                  >
                    {commentary.commentatorName}
                  </Text>
                ) : null}
                <Body>{commentary.text}</Body>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {verse.topics.length > 0 ? (
        <View>
          <Caption style={{ marginBottom: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
            Topics
          </Caption>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {verse.topics.map((topic) => (
              <Link key={topic.slug} href={`/topic/${topic.slug}`} asChild>
                <Pressable>
                  <Badge tone="accent">{topic.name}</Badge>
                </Pressable>
              </Link>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
