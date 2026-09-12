import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { useTheme } from '@/components/ui';

/**
 * Five tabs, reachable one-handed.
 *
 * Read and Ask are the two things people open the app to do, so they sit
 * either side of centre where a thumb naturally lands.
 */
export default function TabsLayout() {
  const { colors } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.textPrimary,
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 60,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11 },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: ({ color }) => <TabGlyph glyph="◈" color={color} /> }}
      />
      <Tabs.Screen
        name="read"
        options={{ title: 'Read', tabBarIcon: ({ color }) => <TabGlyph glyph="☰" color={color} /> }}
      />
      <Tabs.Screen
        name="explore"
        options={{ title: 'Explore', tabBarIcon: ({ color }) => <TabGlyph glyph="✦" color={color} /> }}
      />
      <Tabs.Screen
        name="ask"
        options={{ title: 'Ask', tabBarIcon: ({ color }) => <TabGlyph glyph="?" color={color} /> }}
      />
      <Tabs.Screen
        name="library"
        options={{ title: 'Library', tabBarIcon: ({ color }) => <TabGlyph glyph="❍" color={color} /> }}
      />
    </Tabs>
  );
}

function TabGlyph({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;
}
