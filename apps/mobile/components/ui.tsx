/**
 * Mobile primitives.
 *
 * Styles come from the resolved theme rather than utility classes, because the
 * reader can switch between three surfaces at runtime and every text colour has
 * to follow. Touch targets are 44pt minimum throughout.
 */
import { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  View,
  useColorScheme,
  type PressableProps,
  type TextProps,
  type ViewProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { THEMES, resolveTheme, type ThemeName } from '@/lib/theme';
import { usePreferences } from '@/lib/store';

export function useTheme() {
  const scheme = useColorScheme();
  const preference = usePreferences((state) => state.preferences.theme);
  const name: ThemeName = resolveTheme(preference, scheme === 'dark');
  return useMemo(() => ({ name, colors: THEMES[name] }), [name]);
}

/** Font sizes scaled by the reader's preference, clamped in the store. */
export function useTypeScale() {
  const { fontScale, lineHeight, density } = usePreferences((state) => state.preferences);
  return useMemo(() => {
    const gap = density === 'compact' ? 12 : density === 'spacious' ? 26 : 18;
    return {
      caption: 12 * fontScale,
      small: 14 * fontScale,
      body: 16 * fontScale,
      title: 20 * fontScale,
      heading: 26 * fontScale,
      display: 32 * fontScale,
      // Devanagari needs a larger optical size and much more leading.
      sanskrit: 21 * fontScale,
      sanskritLineHeight: 21 * fontScale * 1.9,
      bodyLineHeight: 16 * fontScale * lineHeight,
      gap,
    };
  }, [fontScale, lineHeight, density]);
}

export function Screen({
  children,
  scroll = true,
  padded = true,
  ...rest
}: ViewProps & { scroll?: boolean; padded?: boolean }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const content = (
    <View
      style={[
        padded ? { paddingHorizontal: 20 } : null,
        // Leave room for the tab bar so the last row is never cut off.
        { paddingBottom: insets.bottom + 24 },
      ]}
      {...rest}
    >
      {children}
    </View>
  );

  if (!scroll) {
    return <View style={{ flex: 1, backgroundColor: colors.background }}>{content}</View>;
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
    >
      {content}
    </ScrollView>
  );
}

export function Heading({ children, level = 1, style, ...rest }: TextProps & { level?: 1 | 2 | 3 }) {
  const { colors } = useTheme();
  const type = useTypeScale();
  const size = level === 1 ? type.display : level === 2 ? type.heading : type.title;
  return (
    <Text
      accessibilityRole="header"
      style={[{ color: colors.textPrimary, fontSize: size, fontWeight: '600' }, style]}
      {...rest}
    >
      {children}
    </Text>
  );
}

export function Body({ children, muted, style, ...rest }: TextProps & { muted?: boolean }) {
  const { colors } = useTheme();
  const type = useTypeScale();
  return (
    <Text
      style={[
        {
          color: muted ? colors.textMuted : colors.textSecondary,
          fontSize: type.body,
          lineHeight: type.bodyLineHeight,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </Text>
  );
}

export function Caption({ children, style, ...rest }: TextProps) {
  const { colors } = useTheme();
  const type = useTypeScale();
  return (
    <Text style={[{ color: colors.textMuted, fontSize: type.caption }, style]} {...rest}>
      {children}
    </Text>
  );
}

export function Card({ children, style, ...rest }: ViewProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 14,
          padding: 18,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

export function Button({
  label,
  variant = 'primary',
  style,
  ...rest
}: PressableProps & { label: string; variant?: 'primary' | 'secondary' | 'ghost' }) {
  const { colors } = useTheme();
  const type = useTypeScale();

  const background =
    variant === 'primary' ? colors.accent : variant === 'secondary' ? colors.surface : 'transparent';
  const textColor = variant === 'primary' ? colors.accentContrast : colors.textPrimary;

  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        {
          // 44pt is the accessibility floor, not a suggestion.
          minHeight: 44,
          paddingHorizontal: 18,
          borderRadius: 10,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: background,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor: colors.border,
          opacity: pressed ? 0.75 : 1,
        },
        style as object,
      ]}
      {...rest}
    >
      <Text style={{ color: textColor, fontSize: type.small, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

/** A round icon-only control. Always at least 44pt across. */
export function IconButton({
  label,
  glyph,
  active,
  style,
  ...rest
}: PressableProps & { label: string; glyph: string; active?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [
        {
          minWidth: 44,
          minHeight: 44,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 22,
          backgroundColor: active ? colors.accentMuted : 'transparent',
          opacity: pressed ? 0.6 : 1,
        },
        style as object,
      ]}
      {...rest}
    >
      <Text style={{ fontSize: 20, color: active ? colors.accent : colors.textMuted }}>
        {glyph}
      </Text>
    </Pressable>
  );
}

export function Divider({ spacing = 20 }: { spacing?: number }) {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing }} />;
}

export function Badge({ children, tone = 'neutral' }: { children: string; tone?: 'neutral' | 'accent' | 'warning' }) {
  const { colors } = useTheme();
  const type = useTypeScale();
  const background =
    tone === 'accent' ? colors.accentMuted : tone === 'warning' ? '#F5E0C0' : colors.surfaceSunken;
  const textColor = tone === 'accent' ? colors.accent : colors.textMuted;
  return (
    <View
      style={{
        backgroundColor: background,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ color: textColor, fontSize: type.caption, fontWeight: '500' }}>{children}</Text>
    </View>
  );
}

/**
 * Shown wherever unverified content appears.
 *
 * The reader should never have to guess whether the text in front of them has
 * been checked, so this is deliberately hard to miss.
 */
export function UnverifiedNotice() {
  const { colors, name } = useTheme();
  const type = useTypeScale();
  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: name === 'dark' ? '#3A2A16' : '#FFF6E5',
        borderColor: name === 'dark' ? '#5A431F' : '#F0DDB8',
        borderWidth: 1,
        borderRadius: 10,
        padding: 12,
      }}
    >
      <Text style={{ color: colors.textSecondary, fontSize: type.caption, lineHeight: type.caption * 1.5 }}>
        This is development placeholder content and has not been verified against a printed
        edition. Do not rely on it.
      </Text>
    </View>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  const { colors } = useTheme();
  const type = useTypeScale();
  return (
    <View
      style={{
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.border,
        borderRadius: 14,
        paddingVertical: 40,
        paddingHorizontal: 24,
        alignItems: 'center',
      }}
    >
      <Text style={{ color: colors.textSecondary, fontSize: type.title, textAlign: 'center' }}>
        {title}
      </Text>
      {body ? (
        <Text
          style={{
            color: colors.textMuted,
            fontSize: type.small,
            textAlign: 'center',
            marginTop: 8,
            lineHeight: type.small * 1.5,
          }}
        >
          {body}
        </Text>
      ) : null}
    </View>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  const { colors } = useTheme();
  const type = useTypeScale();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
      }}
    >
      <Text
        style={{
          color: colors.textMuted,
          fontSize: type.caption,
          fontWeight: '600',
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}
      >
        {title}
      </Text>
      {action}
    </View>
  );
}
