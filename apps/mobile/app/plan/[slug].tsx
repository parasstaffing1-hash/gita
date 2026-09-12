import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import {
  Badge,
  Body,
  Caption,
  Card,
  EmptyState,
  Heading,
  Screen,
  useTheme,
  useTypeScale,
} from '@/components/ui';
import { VerseRow } from '@/components/verse';
import { getPlan, getVersesByRefs } from '@/lib/db/content';

export default function PlanScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { colors } = useTheme();
  const type = useTypeScale();

  const plan = useQuery({ queryKey: ['plan', slug], queryFn: () => getPlan(slug ?? '') });
  const allRefs = (plan.data?.days ?? []).flatMap((day: any) => day.verseRefs ?? []);
  const verses = useQuery({
    queryKey: ['plan-verses', slug, allRefs.length],
    queryFn: () => getVersesByRefs(allRefs),
    enabled: allRefs.length > 0,
  });

  if (!plan.data) {
    return (
      <Screen>
        <View style={{ paddingTop: 40 }}>
          <EmptyState title="Plan not available offline yet" />
        </View>
      </Screen>
    );
  }

  const data = plan.data;
  const byRef = new Map((verses.data ?? []).map((verse) => [verse.ref, verse]));

  return (
    <>
      <Stack.Screen options={{ title: data.title }} />
      <Screen>
        <View style={{ paddingTop: 8, gap: 22 }}>
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Badge tone="accent">{`${data.durationDays} days`}</Badge>
              <Badge>{data.level}</Badge>
            </View>
            <Heading level={2}>{data.title}</Heading>
            {data.subtitle ? <Caption>{data.subtitle}</Caption> : null}
            {data.description ? <Body>{data.description}</Body> : null}
          </View>

          <View style={{ gap: 16 }}>
            {data.days.map((day: any) => (
              <Card key={day.dayNumber}>
                <Caption>
                  Day {String(day.dayNumber).padStart(2, '0')} · {day.estimatedMinutes} min
                </Caption>
                <Body style={{ color: colors.textPrimary, marginTop: 4, fontSize: type.title }}>
                  {day.title}
                </Body>
                {day.intro ? <Body style={{ marginTop: 8 }}>{day.intro}</Body> : null}

                {(day.verseRefs ?? []).length > 0 ? (
                  <View style={{ marginTop: 10 }}>
                    {(day.verseRefs ?? []).map((ref: string) => {
                      const verse = byRef.get(ref);
                      return verse ? <VerseRow key={ref} verse={verse} /> : null;
                    })}
                  </View>
                ) : null}

                {day.reflection ? (
                  <View
                    style={{
                      marginTop: 12,
                      borderLeftWidth: 2,
                      borderLeftColor: colors.accent,
                      paddingLeft: 12,
                    }}
                  >
                    <Body style={{ fontStyle: 'italic', fontSize: type.small }}>
                      {day.reflection}
                    </Body>
                  </View>
                ) : null}
              </Card>
            ))}
          </View>
        </View>
      </Screen>
    </>
  );
}
