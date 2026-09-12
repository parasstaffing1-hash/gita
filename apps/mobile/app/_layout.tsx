import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getDatabase } from '@/lib/db';
import { hasLocalContent, isContentCurrent, syncContent } from '@/lib/db/content-sync';
import { ensureDefaultCollections } from '@/lib/db/user-data';
import { useContentState, usePreferences } from '@/lib/store';
import { useTheme } from '@/components/ui';

import '../global.css';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden, or the splash module is unavailable in this environment.
});

/**
 * Reading is served from SQLite, so nothing here should be `retry`-happy: a
 * failed network call means the online extras are unavailable, not that the
 * app is broken.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function RootLayout() {
  const [booted, setBooted] = useState(false);
  const loadPreferences = usePreferences((state) => state.load);
  const { setReady, setSyncing, setProgress, setError } = useContentState();

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        await getDatabase();
        await loadPreferences();
        await ensureDefaultCollections();

        const hasContent = await hasLocalContent();
        if (!cancelled) setReady(hasContent);

        // Let the reader in as soon as the local copy is usable. A content
        // refresh then runs behind them rather than behind a spinner.
        if (!cancelled) {
          setBooted(true);
          await SplashScreen.hideAsync().catch(() => undefined);
        }

        const current = hasContent && (await isContentCurrent());
        if (!current && !cancelled) {
          setSyncing(true);
          const result = await syncContent((progress) => {
            setProgress(progress.chaptersDone, progress.chaptersTotal);
          });
          if (cancelled) return;
          setSyncing(false);
          if (result.phase === 'failed') {
            setError(result.message ?? 'Could not download the text.');
          } else {
            setReady(true);
            setError(null);
          }
        }
      } catch (error) {
        if (cancelled) return;
        setError(error instanceof Error ? error.message : 'The app could not start.');
        setBooted(true);
        await SplashScreen.hideAsync().catch(() => undefined);
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [loadPreferences, setError, setProgress, setReady, setSyncing]);

  if (!booted) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemedStack />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function ThemedStack() {
  const { colors, name } = useTheme();
  return (
    <>
      <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontWeight: '600' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="chapter/[chapter]" options={{ title: '' }} />
        <Stack.Screen name="verse/[chapter]/[verse]" options={{ title: '' }} />
        <Stack.Screen name="topic/[slug]" options={{ title: '' }} />
        <Stack.Screen name="glossary/[slug]" options={{ title: '' }} />
        <Stack.Screen name="plan/[slug]" options={{ title: '' }} />
        <Stack.Screen
          name="reader-settings"
          options={{ title: 'Reading preferences', presentation: 'modal' }}
        />
        <Stack.Screen name="memorize" options={{ title: 'Memorization' }} />
        <Stack.Screen name="create" options={{ title: 'Make a card' }} />
        <Stack.Screen name="start-here" options={{ title: 'Start here' }} />
      </Stack>
    </>
  );
}
