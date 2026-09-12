import { useLocalSearchParams } from 'expo-router';
import { Link } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import type { AskMode, AskResponse } from '@gita/types';

import {
  Body,
  Button,
  Caption,
  Card,
  Heading,
  Screen,
  SectionHeader,
  useTheme,
  useTypeScale,
} from '@/components/ui';
import { api } from '@/lib/api';

const MODES: Array<{ value: AskMode; label: string }> = [
  { value: 'simple', label: 'Simply' },
  { value: 'deep', label: 'In depth' },
  { value: 'beginner', label: 'For a beginner' },
  { value: 'sources_only', label: 'Sources only' },
];

const EXAMPLES = [
  'What does the Gita say about duty?',
  'How do I deal with fear of failure?',
  'gusse ko kaise control karein',
];

/**
 * Ask the Gita.
 *
 * The one screen that genuinely needs the network — retrieval and generation
 * both happen server-side. It says so when the device is offline rather than
 * silently failing, because everything else in the app works without it.
 */
export default function AskScreen() {
  const params = useLocalSearchParams<{ verse?: string }>();
  const { colors } = useTheme();
  const type = useTypeScale();

  const [question, setQuestion] = useState('');
  const [mode, setMode] = useState<AskMode>('default');
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(text: string, nextMode: AskMode = mode) {
    const trimmed = text.trim();
    if (trimmed.length < 3) return;

    setLoading(true);
    setError(null);
    try {
      const result = await api.ask({
        question: trimmed,
        mode: nextMode,
        verseRef: params.verse ?? null,
      });
      setAnswer(result);
    } catch (cause) {
      const message =
        cause && typeof cause === 'object' && 'isOffline' in cause && cause.isOffline
          ? 'You are offline. Reading, search and your notes all still work — Ask needs a connection.'
          : 'That did not work. Please try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  const refusal = answer?.groundingStatus === 'insufficient_evidence';

  return (
    <Screen>
      <View style={{ paddingTop: 12, gap: 18 }}>
        <View>
          <Heading level={2}>Ask the Gita</Heading>
          <Caption style={{ marginTop: 6, lineHeight: type.caption * 1.6 }}>
            Answers are built only from verses stored in this library, and show which ones they
            used. If there is not enough here, it will say so.
          </Caption>
          {params.verse ? (
            <Caption style={{ marginTop: 6, color: colors.accent }}>
              Anchored to verse {params.verse}
            </Caption>
          ) : null}
        </View>

        <TextInput
          value={question}
          onChangeText={setQuestion}
          multiline
          maxLength={1000}
          placeholder={params.verse ? `Ask about ${params.verse}…` : 'What would you like to understand?'}
          placeholderTextColor={colors.textMuted}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            minHeight: 96,
            textAlignVertical: 'top',
            color: colors.textPrimary,
            fontSize: type.body,
            lineHeight: type.bodyLineHeight,
            backgroundColor: colors.surface,
          }}
        />

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Button
            label={loading ? 'Finding verses…' : 'Ask'}
            disabled={loading || question.trim().length < 3}
            onPress={() => void submit(question)}
          />
          {MODES.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => {
                setMode(item.value);
                if (answer) void submit(question, item.value);
              }}
              style={{
                minHeight: 44,
                justifyContent: 'center',
                paddingHorizontal: 14,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: mode === item.value ? colors.accent : colors.border,
                backgroundColor: mode === item.value ? colors.accentMuted : 'transparent',
              }}
            >
              <Text
                style={{
                  color: mode === item.value ? colors.accent : colors.textSecondary,
                  fontSize: type.small,
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {!answer && !loading ? (
          <View>
            <SectionHeader title="Try" />
            <View style={{ gap: 8 }}>
              {EXAMPLES.map((example) => (
                <Pressable
                  key={example}
                  onPress={() => {
                    setQuestion(example);
                    void submit(example);
                  }}
                  style={{
                    minHeight: 44,
                    justifyContent: 'center',
                    paddingHorizontal: 14,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ color: colors.textSecondary, fontSize: type.small }}>
                    {example}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {loading ? <ActivityIndicator color={colors.accent} /> : null}

        {error ? (
          <Card style={{ backgroundColor: colors.surfaceSunken }}>
            <Body>{error}</Body>
          </Card>
        ) : null}

        {answer ? (
          <View style={{ gap: 18 }}>
            {/* A refusal is a plain statement, not an error state. */}
            <Card style={{ backgroundColor: refusal ? colors.surfaceSunken : colors.surface }}>
              <Body>{answer.answer}</Body>
            </Card>

            {answer.citations.length > 0 ? (
              <View>
                <SectionHeader title={`Sources — ${answer.citations.length} verses`} />
                <View style={{ gap: 12 }}>
                  {answer.citations.map((citation) => (
                    <Link
                      key={citation.verse.id}
                      href={`/verse/${citation.verse.chapterNumber}/${citation.verse.verseNumber}`}
                      asChild
                    >
                      <Pressable>
                        <Card>
                          <Text
                            style={{
                              color: colors.accent,
                              fontSize: type.caption,
                              marginBottom: 6,
                            }}
                          >
                            {citation.verse.ref}
                          </Text>
                          {citation.verse.sanskrit ? (
                            <Text
                              numberOfLines={2}
                              style={{
                                color: colors.sanskrit,
                                fontSize: type.body * 1.1,
                                lineHeight: type.body * 1.9,
                              }}
                            >
                              {citation.verse.sanskrit.split('\n')[0]}
                            </Text>
                          ) : null}
                          {/* Quoted from the stored record, never from the model. */}
                          <Body style={{ marginTop: 8 }}>{citation.quotedText}</Body>
                        </Card>
                      </Pressable>
                    </Link>
                  ))}
                </View>
              </View>
            ) : null}

            {answer.rejectedCitations.length > 0 ? (
              <Card style={{ backgroundColor: colors.surfaceSunken }}>
                <Caption>
                  {answer.rejectedCitations.length} reference
                  {answer.rejectedCitations.length === 1 ? ' was' : 's were'} removed because they
                  could not be matched to a verse in the library.
                </Caption>
              </Card>
            ) : null}

            {answer.followUpSuggestions.length > 0 ? (
              <View>
                <SectionHeader title="Follow up" />
                <View style={{ gap: 8 }}>
                  {answer.followUpSuggestions.map((suggestion) => (
                    <Pressable
                      key={suggestion}
                      onPress={() => {
                        setQuestion(suggestion);
                        void submit(suggestion);
                      }}
                      style={{
                        minHeight: 44,
                        justifyContent: 'center',
                        paddingHorizontal: 14,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: colors.border,
                      }}
                    >
                      <Text style={{ color: colors.textSecondary, fontSize: type.small }}>
                        {suggestion}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {answer.disclaimer ? <Caption>{answer.disclaimer}</Caption> : null}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
