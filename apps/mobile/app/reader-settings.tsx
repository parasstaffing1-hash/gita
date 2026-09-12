import { Pressable, Switch, Text, View } from 'react-native';

import {
  Body,
  Caption,
  Divider,
  Screen,
  SectionHeader,
  useTheme,
  useTypeScale,
} from '@/components/ui';
import {
  FONT_SCALE_RANGE,
  usePreferences,
  type Density,
  type ReaderLayout,
} from '@/lib/store';
import type { ThemeName } from '@/lib/theme';

const LAYOUTS: Array<{ value: ReaderLayout; label: string }> = [
  { value: 'sanskrit_only', label: 'Sanskrit only' },
  { value: 'sanskrit_transliteration', label: 'Sanskrit + transliteration' },
  { value: 'sanskrit_english', label: 'Sanskrit + English' },
  { value: 'sanskrit_hindi', label: 'Sanskrit + Hindi' },
  { value: 'translation_focus', label: 'Translation focused' },
  { value: 'commentary_focus', label: 'Commentary focused' },
];

const THEME_CHOICES: Array<{ value: ThemeName | 'system'; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'dark', label: 'Dark' },
];

const DENSITIES: Array<{ value: Density; label: string }> = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'spacious', label: 'Spacious' },
];

/**
 * Reading preferences.
 *
 * Saved to SQLite immediately on change — there is no Save button, because
 * every control here previews itself the moment it is touched.
 */
export default function ReaderSettingsScreen() {
  const { colors } = useTheme();
  const type = useTypeScale();
  const { preferences, update } = usePreferences();

  return (
    <Screen>
      <View style={{ paddingTop: 12, gap: 26 }}>
        {/* A live sample, so a choice can be judged rather than guessed at. */}
        <View
          style={{
            backgroundColor: colors.surfaceRaised,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 14,
            padding: 18,
          }}
        >
          <Text
            style={{
              color: colors.sanskrit,
              fontSize: type.sanskrit,
              lineHeight: type.sanskritLineHeight,
            }}
          >
            कर्मण्येवाधिकारस्ते मा फलेषु कदाचन।
          </Text>
          <Text
            style={{
              color: colors.textSecondary,
              fontSize: type.body,
              lineHeight: type.bodyLineHeight,
              marginTop: 12,
            }}
          >
            You have a claim on the action alone, never on its fruits.
          </Text>
        </View>

        <View>
          <SectionHeader title="Layout" />
          <View style={{ gap: 8 }}>
            {LAYOUTS.map((layout) => (
              <Choice
                key={layout.value}
                label={layout.label}
                selected={preferences.layout === layout.value}
                onPress={() => void update({ layout: layout.value })}
              />
            ))}
          </View>
        </View>

        <View>
          <SectionHeader title="Theme" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {THEME_CHOICES.map((choice) => (
              <Pill
                key={choice.value}
                label={choice.label}
                selected={preferences.theme === choice.value}
                onPress={() => void update({ theme: choice.value })}
              />
            ))}
          </View>
        </View>

        <View>
          <SectionHeader title="Text size" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Stepper
              label="Smaller text"
              glyph="A−"
              onPress={() =>
                void update({ fontScale: preferences.fontScale - FONT_SCALE_RANGE.step })
              }
            />
            <Text
              style={{
                flex: 1,
                textAlign: 'center',
                color: colors.textSecondary,
                fontSize: type.body,
              }}
            >
              {Math.round(preferences.fontScale * 100)}%
            </Text>
            <Stepper
              label="Larger text"
              glyph="A+"
              onPress={() =>
                void update({ fontScale: preferences.fontScale + FONT_SCALE_RANGE.step })
              }
            />
          </View>
          <Caption style={{ marginTop: 8 }}>
            Between {Math.round(FONT_SCALE_RANGE.min * 100)}% and{' '}
            {Math.round(FONT_SCALE_RANGE.max * 100)}%.
          </Caption>
        </View>

        <View>
          <SectionHeader title="Line spacing" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[1.5, 1.75, 2.0, 2.2].map((value) => (
              <Pill
                key={value}
                label={value.toFixed(2)}
                selected={Math.abs(preferences.lineHeight - value) < 0.01}
                onPress={() => void update({ lineHeight: value })}
              />
            ))}
          </View>
        </View>

        <View>
          <SectionHeader title="Density" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {DENSITIES.map((density) => (
              <Pill
                key={density.value}
                label={density.label}
                selected={preferences.density === density.value}
                onPress={() => void update({ density: density.value })}
              />
            ))}
          </View>
        </View>

        <Divider />

        <View style={{ gap: 4 }}>
          <Toggle
            label="Word-by-word meanings"
            value={preferences.showWordMeanings}
            onChange={(value) => void update({ showWordMeanings: value })}
          />
          <Toggle
            label="Commentary"
            value={preferences.showCommentary}
            onChange={(value) => void update({ showCommentary: value })}
          />
          <Toggle
            label="Reduce motion"
            value={preferences.reduceMotion}
            onChange={(value) => void update({ reduceMotion: value })}
          />
        </View>

        <View>
          <SectionHeader title="Translation language" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pill
              label="English"
              selected={preferences.translationLanguage === 'en'}
              onPress={() => void update({ translationLanguage: 'en' })}
            />
            <Pill
              label="हिन्दी"
              selected={preferences.translationLanguage === 'hi'}
              onPress={() => void update({ translationLanguage: 'hi' })}
            />
          </View>
        </View>

        <Caption>
          These settings are stored on this device. Signing in syncs them across your devices.
        </Caption>
      </View>
    </Screen>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const type = useTypeScale();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: 48,
        justifyContent: 'center',
        paddingHorizontal: 16,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.accentMuted : 'transparent',
      }}
    >
      <Text
        style={{ color: selected ? colors.accent : colors.textSecondary, fontSize: type.small }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Pill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const type = useTypeScale();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        minHeight: 44,
        justifyContent: 'center',
        paddingHorizontal: 16,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.accentMuted : 'transparent',
      }}
    >
      <Text
        style={{ color: selected ? colors.accent : colors.textSecondary, fontSize: type.small }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Stepper({
  label,
  glyph,
  onPress,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        width: 56,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ color: colors.textPrimary, fontSize: 16 }}>{glyph}</Text>
    </Pressable>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const { colors } = useTheme();
  const type = useTypeScale();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 48,
      }}
    >
      <Text style={{ color: colors.textSecondary, fontSize: type.body }}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: colors.accent, false: colors.border }}
      />
    </View>
  );
}
