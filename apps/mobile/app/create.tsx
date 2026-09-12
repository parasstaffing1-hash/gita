/**
 * The quote maker.
 *
 * The same composer as the website, on a phone. It shares the model, the
 * presets and the whole layout engine with `/create`; what differs is the
 * renderer — see `components/quote-card.tsx` — and the export, which goes to
 * the photo library and the share sheet rather than to a download.
 *
 * The rule that matters most is the one the web enforces: the verse text always
 * comes from the API. There is no field on this screen that puts scripture into
 * a card. The only thing a reader types is the caption, and that is set small,
 * after the citation, in a different voice.
 *
 * This is also the only screen in the app that needs the network. Reading is
 * served from SQLite and never spins; the wallpaper library is not mirrored
 * locally and there is nothing to compose onto without it, so every call here
 * degrades to an empty picker instead of an error.
 */
import { useLocalSearchParams } from 'expo-router';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  PixelRatio,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';

import {
  ACCENTS,
  DEFAULT_COMPOSITION,
  FORMATS,
  FORMAT_SPECS,
  LAYOUTS,
  LAYOUT_INFO,
  PRESETS,
  SCALE_RANGE,
  TONES,
  ZONE_LAYOUT,
  clampScale,
  type AccentName,
  type FormatName,
  type LayoutName,
  type QuoteComposition,
  type QuoteContent,
  type ToneName,
} from '@gita/quote-composer';
import { parseVerseRef } from '@gita/shared-utils';

import { QuoteCard } from '@/components/quote-card';
import { Body, Button, Caption, Screen, SectionHeader, useTheme, useTypeScale } from '@/components/ui';
import {
  availableSuggestions,
  fetchVerse,
  listMoods,
  listWallpapers,
  mediaUrl,
  recordWallpaperUse,
  searchVerses,
  type ComposerVerse,
  type VerseSuggestion,
  type WallpaperSummary,
} from '@/lib/composer';

const PAGE = 40;

/**
 * How large a bitmap the capture may allocate.
 *
 * Both 4K formats come in at 8.29M pixels, so nothing in the picker is clamped
 * in practice — this is a floor under the failure mode, not a quality setting.
 * Past it the offscreen card is laid out smaller and the snapshot is scaled up
 * to the requested size, which is soft but is at least a file rather than an
 * out-of-memory crash on a device that cannot allocate 33MB in one piece.
 */
const MAX_NATIVE_PIXELS = 8_400_000;

export default function CreateScreen() {
  const params = useLocalSearchParams<{ ref?: string }>();
  const { colors } = useTheme();
  const type = useTypeScale();
  const window = useWindowDimensions();

  const [composition, setComposition] = useState<QuoteComposition>(() => ({
    ...DEFAULT_COMPOSITION,
    layers: { ...DEFAULT_COMPOSITION.layers },
    // A verse can be handed in from the reader. It is validated before it is
    // trusted: a reference that does not exist would render a card with a
    // citation and no scripture under it.
    ref: params.ref && parseVerseRef(params.ref) ? params.ref : DEFAULT_COMPOSITION.ref,
  }));

  const [verse, setVerse] = useState<ComposerVerse | null>(null);
  const [wallpapers, setWallpapers] = useState<WallpaperSummary[]>([]);
  const [total, setTotal] = useState(0);
  // Held apart from the grid on purpose. The grid is a filtered view and the
  // chosen background has to survive filtering it out — narrowing to "night"
  // must not blank the card you are looking at.
  const [selected, setSelected] = useState<WallpaperSummary | null>(null);
  const [moods, setMoods] = useState<string[]>([]);
  const [mood, setMood] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<VerseSuggestion[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ComposerVerse[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [layoutTouched, setLayoutTouched] = useState(false);
  const [exporting, setExporting] = useState<'save' | 'share' | null>(null);
  const [exportMounted, setExportMounted] = useState(false);
  // The preview measures how far the type has to come down to fit; the export
  // card is handed the answer rather than measuring again, so the capture is
  // not racing a loop that takes several frames to settle.
  const [fit, setFit] = useState(1);

  const exportRef = useRef<View>(null);
  const firstPage = useRef(true);

  const spec = FORMAT_SPECS[composition.format];
  const wanted: 'portrait' | 'landscape' = spec.width > spec.height ? 'landscape' : 'portrait';

  const patch = useCallback((next: Partial<QuoteComposition>) => {
    setComposition((current) => ({ ...current, ...next }));
  }, []);

  /** Anything the reader sets by hand stops the automatic placement. */
  const set = useCallback(
    (next: Partial<QuoteComposition>) => {
      setLayoutTouched(true);
      patch(next);
    },
    [patch],
  );

  // --- Data ---------------------------------------------------------------

  useEffect(() => {
    const controller = new AbortController();
    void listMoods(controller.signal).then(setMoods);
    void availableSuggestions(controller.signal).then(setSuggestions);
    return () => controller.abort();
  }, []);

  // The verse is keyed off the composition, so choosing one is a single state
  // change and the card can never show a verse the share code disagrees with.
  useEffect(() => {
    const controller = new AbortController();
    void fetchVerse(composition.ref, controller.signal).then((found) => {
      // A failed fetch leaves the previous verse in place rather than blanking
      // the card; only a real answer replaces it.
      if (found) setVerse(found);
    });
    return () => controller.abort();
  }, [composition.ref]);

  useEffect(() => {
    const controller = new AbortController();

    void listWallpapers(
      { orientation: wanted, mood, limit: PAGE },
      controller.signal,
    ).then(({ items, total: count }) => {
      if (controller.signal.aborted) return;
      setWallpapers(items);
      setTotal(count);

      if (firstPage.current) {
        firstPage.current = false;
        // Open on an actual photograph rather than a black rectangle — the
        // point of the screen is the library, and an empty frame does not show
        // it. The layout follows the third of the image measured as quietest
        // at import, which is the whole reason that measurement was taken.
        const opener = items[0];
        if (opener) {
          setSelected(opener);
          setComposition((current) => ({
            ...current,
            wallpaperId: opener.slug,
            layout: ZONE_LAYOUT[opener.textZone] ?? current.layout,
          }));
        }
        return;
      }

      // Switching to a desktop card while a portrait photograph is chosen
      // would crop it past recognition, so the background moves to the first
      // image of the right shape.
      setSelected((current) => {
        if (current && current.orientation === wanted) return current;
        const replacement = items[0] ?? null;
        setComposition((c) => ({ ...c, wallpaperId: replacement?.slug ?? null }));
        return replacement;
      });
    });

    return () => controller.abort();
  }, [mood, wanted]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const { items, total: count } = await listWallpapers({
        orientation: wanted,
        mood,
        limit: PAGE,
        offset: wallpapers.length,
      });
      // Guard against a duplicate page if the ordering shifted between calls —
      // `use_count` changes as people export.
      setWallpapers((current) => {
        const seen = new Set(current.map((item) => item.slug));
        return [...current, ...items.filter((item) => !seen.has(item.slug))];
      });
      setTotal(count || total);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      void searchVerses(trimmed, controller.signal)
        .then((hits) => {
          if (!controller.signal.aborted) setResults(hits);
        })
        .finally(() => setSearching(false));
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  function chooseWallpaper(wallpaper: WallpaperSummary | null) {
    setSelected(wallpaper);
    const follow = !layoutTouched && wallpaper ? ZONE_LAYOUT[wallpaper.textZone] : undefined;
    patch({ wallpaperId: wallpaper?.slug ?? null, ...(follow ? { layout: follow } : {}) });
  }

  function chooseVerse(ref: string) {
    patch({ ref });
    setQuery('');
    setResults([]);
  }

  // --- What actually gets drawn -------------------------------------------

  const content: QuoteContent = useMemo(() => {
    const translation =
      composition.translationLanguage === 'hi'
        ? (verse?.translationHindi ?? verse?.translationEnglish ?? null)
        : (verse?.translationEnglish ?? null);

    return {
      // Every layer comes from the API. Nothing on this card is typed by the
      // person making it except the caption, which is set apart so it cannot
      // read as scripture.
      sanskrit: composition.layers.sanskrit ? (verse?.sanskrit ?? null) : null,
      transliteration: composition.layers.transliteration ? (verse?.transliteration ?? null) : null,
      translation: composition.layers.translation ? translation : null,
      reference: `Bhagavad Gita ${composition.ref}`,
      caption: composition.caption,
      unverified: (verse?.verificationStatus ?? 'draft') !== 'published',
    };
  }, [composition, verse]);

  const previewUrl = mediaUrl(selected?.previewUrl ?? selected?.thumbUrl);
  const fullUrl = mediaUrl(selected?.fullUrl ?? selected?.previewUrl);

  // The card is capped by height as well as width, or a 9:16 story fills the
  // screen and every control is below the fold.
  const previewWidth = Math.min(
    window.width - 40,
    window.height * 0.55 * (spec.width / spec.height),
  );

  /**
   * The size of the offscreen card the export is captured from.
   *
   * `captureRef` snapshots a view at its own native resolution and only then
   * resizes, so asking a 340dp preview for a 2160px file would upscale a small
   * bitmap. Laying the export card out at `pixels / density` dp instead makes
   * the snapshot land at the requested size with nothing to stretch.
   */
  const density = PixelRatio.get();
  const budget = Math.min(1, Math.sqrt(MAX_NATIVE_PIXELS / (spec.width * spec.height)));
  const exportWidth = (spec.width / density) * budget;

  async function runExport(mode: 'save' | 'share') {
    if (exporting) return;
    setExporting(mode);
    try {
      // Warm the full-resolution image first. The export card mounts and is
      // captured within a few frames, and an `Image` that has not resolved yet
      // captures as a hole in the middle of the card.
      if (fullUrl) await Image.prefetch(fullUrl).catch(() => false);

      setExportMounted(true);
      // One beat for layout and paint. There is no "drawn" callback to await on
      // a plain view hierarchy.
      await new Promise((resolve) => setTimeout(resolve, 180));

      const uri = await captureRef(exportRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        width: spec.width,
        height: spec.height,
      });

      if (mode === 'save') {
        // Write-only: saving a card is no reason to ask for read access to
        // somebody's whole camera roll.
        const permission = await MediaLibrary.requestPermissionsAsync(true);
        if (!permission.granted) {
          Alert.alert(
            'Photos access needed',
            'Allow access to your photo library to save the card. You can still use Share instead.',
          );
          return;
        }
        await MediaLibrary.saveToLibraryAsync(uri);
        Alert.alert('Saved', `${spec.label} card saved to your photos.`);
      } else {
        if (!(await Sharing.isAvailableAsync())) {
          Alert.alert('Sharing unavailable', 'This device has no share sheet. Try Save instead.');
          return;
        }
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          UTI: 'public.png',
          dialogTitle: `Bhagavad Gita ${composition.ref}`,
        });
      }

      // A bare counter, so the picker can lead with what people use.
      if (composition.wallpaperId) recordWallpaperUse(composition.wallpaperId);
    } catch {
      Alert.alert(
        'Could not render the card',
        'Rendering at this size failed. A smaller format usually works.',
      );
    } finally {
      setExportMounted(false);
      setExporting(null);
    }
  }

  const luminance = selected?.luminance ?? null;
  const bright = (luminance ?? 0) > 0.62;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Screen>
        <View style={{ paddingTop: 12, gap: 28 }}>
          <View style={{ alignItems: 'center' }}>
            <QuoteCard
              composition={composition}
              content={content}
              imageUrl={previewUrl}
              luminance={luminance}
              width={previewWidth}
              dominantColor={selected?.dominantColor}
              onFit={setFit}
            />
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              label={exporting === 'save' ? 'Rendering…' : `Save ${spec.label}`}
              onPress={() => void runExport('save')}
              disabled={exporting !== null}
              style={{ flex: 1, opacity: exporting ? 0.5 : 1 }}
            />
            <Button
              label={exporting === 'share' ? 'Rendering…' : 'Share'}
              variant="secondary"
              onPress={() => void runExport('share')}
              disabled={exporting !== null}
              style={{ opacity: exporting ? 0.5 : 1 }}
            />
          </View>

          {selected?.attribution || selected?.photographer ? (
            <Caption>Background: {selected.attribution ?? selected.photographer}</Caption>
          ) : null}

          {/* --- Verse ---------------------------------------------------- */}
          <View>
            <SectionHeader title="Verse" />
            <View
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                borderRadius: 12,
                padding: 14,
              }}
            >
              <Text style={{ color: colors.accent, fontSize: type.small, fontWeight: '600' }}>
                {composition.ref}
              </Text>
              {verse?.sanskrit ? (
                <Text
                  numberOfLines={2}
                  style={{
                    marginTop: 6,
                    color: colors.sanskrit,
                    fontSize: type.sanskrit,
                    lineHeight: type.sanskritLineHeight,
                  }}
                >
                  {verse.sanskrit.split('\n')[0]}
                </Text>
              ) : null}
            </View>

            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="2.47, karma, or a word from the verse"
              placeholderTextColor={colors.textMuted}
              returnKeyType="search"
              clearButtonMode="while-editing"
              style={{
                marginTop: 12,
                minHeight: 44,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                borderRadius: 10,
                paddingHorizontal: 14,
                color: colors.textPrimary,
                fontSize: type.body,
              }}
            />

            {searching ? <Caption style={{ marginTop: 8 }}>Searching…</Caption> : null}

            {results.length > 0 ? (
              <View style={{ marginTop: 8, gap: 2 }}>
                {results.map((hit) => (
                  <Pressable
                    key={hit.ref}
                    onPress={() => chooseVerse(hit.ref)}
                    style={{ minHeight: 44, justifyContent: 'center', paddingVertical: 6 }}
                  >
                    <Text style={{ color: colors.accent, fontSize: type.caption, fontWeight: '600' }}>
                      {hit.ref}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{ color: colors.textSecondary, fontSize: type.small }}
                    >
                      {hit.translationEnglish ?? hit.sanskrit ?? ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : suggestions.length > 0 ? (
              <View style={{ marginTop: 12 }}>
                <Caption style={{ marginBottom: 8 }}>Often quoted</Caption>
                <Row>
                  {suggestions.map((item) => (
                    <Chip
                      key={item.ref}
                      label={`${item.ref} · ${item.hint}`}
                      active={composition.ref === item.ref}
                      onPress={() => chooseVerse(item.ref)}
                    />
                  ))}
                </Row>
              </View>
            ) : null}
          </View>

          {/* --- Size ----------------------------------------------------- */}
          <View>
            <SectionHeader title="Size" />
            <Row>
              {FORMATS.map((format) => (
                <Chip
                  key={format}
                  label={FORMAT_SPECS[format as FormatName].label}
                  active={composition.format === format}
                  onPress={() => patch({ format: format as FormatName })}
                />
              ))}
            </Row>
            <Caption style={{ marginTop: 8 }}>
              {spec.width}×{spec.height} · {spec.hint}
            </Caption>
          </View>

          {/* --- Presets -------------------------------------------------- */}
          <View>
            <SectionHeader title="Start from" />
            <View style={{ gap: 8 }}>
              {PRESETS.map((preset) => (
                <Option
                  key={preset.id}
                  title={preset.name}
                  description={preset.description}
                  active={false}
                  onPress={() => set(preset.patch)}
                />
              ))}
            </View>
          </View>

          {/* --- Background ----------------------------------------------- */}
          <View>
            <SectionHeader
              title="Background"
              action={
                <Caption>
                  {total > wallpapers.length
                    ? `${wallpapers.length} of ${total}`
                    : `${total} available`}
                </Caption>
              }
            />
            <Row>
              <Chip label="All" active={mood === null} onPress={() => setMood(null)} />
              {moods.map((item) => (
                <Chip
                  key={item}
                  label={item}
                  active={mood === item}
                  onPress={() => setMood(mood === item ? null : item)}
                />
              ))}
            </Row>

            {/* A horizontal strip rather than the web's grid: it keeps the
                preview and the picker on screen together, which is the whole
                interaction on a phone. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginTop: 12 }}
              contentContainerStyle={{ gap: 8, paddingRight: 8 }}
            >
              <Thumb
                active={composition.wallpaperId === null}
                onPress={() => chooseWallpaper(null)}
                label="None"
              />
              {wallpapers.map((wallpaper) => (
                <Thumb
                  key={wallpaper.id}
                  active={composition.wallpaperId === wallpaper.slug}
                  onPress={() => chooseWallpaper(wallpaper)}
                  uri={mediaUrl(wallpaper.thumbUrl)}
                  tint={wallpaper.dominantColor}
                />
              ))}
            </ScrollView>

            {wallpapers.length < total ? (
              <Button
                label={loadingMore ? 'Loading…' : `Show ${Math.min(PAGE, total - wallpapers.length)} more`}
                variant="secondary"
                onPress={() => void loadMore()}
                disabled={loadingMore}
                style={{ marginTop: 12 }}
              />
            ) : null}
          </View>

          {/* --- Layout --------------------------------------------------- */}
          <View>
            <SectionHeader title="Layout" />
            <View style={{ gap: 8 }}>
              {LAYOUTS.map((layout) => (
                <Option
                  key={layout}
                  title={LAYOUT_INFO[layout as LayoutName].name}
                  description={LAYOUT_INFO[layout as LayoutName].description}
                  active={composition.layout === layout}
                  onPress={() => set({ layout: layout as LayoutName })}
                />
              ))}
            </View>
          </View>

          {/* --- Layers --------------------------------------------------- */}
          <View>
            <SectionHeader title="What to show" />
            <Row>
              <Chip
                label="Sanskrit"
                active={composition.layers.sanskrit}
                onPress={() =>
                  patch({ layers: { ...composition.layers, sanskrit: !composition.layers.sanskrit } })
                }
              />
              <Chip
                label="Transliteration"
                active={composition.layers.transliteration}
                onPress={() =>
                  patch({
                    layers: {
                      ...composition.layers,
                      transliteration: !composition.layers.transliteration,
                    },
                  })
                }
              />
              <Chip
                label="Translation"
                active={composition.layers.translation}
                onPress={() =>
                  patch({
                    layers: { ...composition.layers, translation: !composition.layers.translation },
                  })
                }
              />
            </Row>
            <Row style={{ marginTop: 8 }}>
              <Chip
                label="English"
                active={composition.translationLanguage === 'en'}
                onPress={() => patch({ translationLanguage: 'en' })}
              />
              <Chip
                label="हिन्दी"
                active={composition.translationLanguage === 'hi'}
                onPress={() => patch({ translationLanguage: 'hi' })}
              />
            </Row>
          </View>

          {/* --- Type size ------------------------------------------------ */}
          <View>
            <SectionHeader title="Type size" />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Stepper
                label="Smaller"
                glyph="−"
                onPress={() => patch({ scale: clampScale(composition.scale - SCALE_RANGE.step) })}
                disabled={composition.scale <= SCALE_RANGE.min}
              />
              <Text
                style={{
                  flex: 1,
                  textAlign: 'center',
                  color: colors.textSecondary,
                  fontSize: type.body,
                }}
              >
                {Math.round(composition.scale * 100)}%
              </Text>
              <Stepper
                label="Larger"
                glyph="+"
                onPress={() => patch({ scale: clampScale(composition.scale + SCALE_RANGE.step) })}
                disabled={composition.scale >= SCALE_RANGE.max}
              />
            </View>
          </View>

          {/* --- Tone and accent ------------------------------------------ */}
          <View>
            <SectionHeader title="Tone and accent" />
            <Row>
              {TONES.map((tone) => (
                <Chip
                  key={tone}
                  label={tone === 'auto' ? 'Auto' : tone === 'dark' ? 'Light type' : 'Dark type'}
                  active={composition.tone === tone}
                  onPress={() => patch({ tone: tone as ToneName })}
                />
              ))}
            </Row>
            <Row style={{ marginTop: 8 }}>
              {ACCENTS.map((accent) => (
                <Chip
                  key={accent}
                  label={accent}
                  active={composition.accent === accent}
                  onPress={() => patch({ accent: accent as AccentName })}
                />
              ))}
            </Row>
            {composition.tone === 'auto' && selected ? (
              <Caption style={{ marginTop: 8, lineHeight: type.caption * 1.5 }}>
                Reading this image as {bright ? 'bright' : 'dark'}, so the type is set{' '}
                {bright ? 'dark' : 'light'}.
              </Caption>
            ) : null}
          </View>

          {/* --- Caption -------------------------------------------------- */}
          <View>
            <SectionHeader title="Your line" action={<Caption>optional</Caption>} />
            <TextInput
              value={composition.caption ?? ''}
              onChangeText={(value) => patch({ caption: value.slice(0, 80) || null })}
              maxLength={80}
              placeholder="A name, a dedication, a handle"
              placeholderTextColor={colors.textMuted}
              style={{
                minHeight: 44,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                borderRadius: 10,
                paddingHorizontal: 14,
                color: colors.textPrimary,
                fontSize: type.body,
              }}
            />
            <Caption style={{ marginTop: 8, lineHeight: type.caption * 1.5 }}>
              Set small and apart from the verse, so it never reads as scripture. The verse itself
              comes from the library and cannot be edited here.
            </Caption>
          </View>

          <Pressable
            onPress={() => {
              // The card draws from `selected`, not from `composition`, so
              // resetting one without the other leaves a card showing a
              // photograph its own composition says is not there.
              setSelected(null);
              setLayoutTouched(false);
              setComposition({
                ...DEFAULT_COMPOSITION,
                layers: { ...DEFAULT_COMPOSITION.layers },
                wallpaperId: null,
                ref: composition.ref,
              });
            }}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Body muted>Reset</Body>
          </Pressable>
        </View>
      </Screen>

      {/*
        The card the export is actually captured from.
        It is laid out at full export size, which is wider than the screen on
        the large formats — that is fine, `captureRef` draws the view's own
        hierarchy rather than what the window happens to show. It is mounted
        only while exporting, and the overlay below covers it while it is.
      */}
      {exportMounted ? (
        <View style={{ position: 'absolute', top: 0, left: 0 }} pointerEvents="none">
          <View ref={exportRef} collapsable={false}>
            <QuoteCard
              composition={composition}
              content={content}
              imageUrl={fullUrl}
              luminance={luminance}
              width={exportWidth}
              dominantColor={selected?.dominantColor}
              fit={fit}
            />
          </View>
        </View>
      ) : null}

      {exporting ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.background,
            gap: 14,
          }}
        >
          <ActivityIndicator color={colors.accent} />
          <Body>
            Rendering at {spec.width}×{spec.height}
          </Body>
        </View>
      ) : null}
    </View>
  );
}

// --- Small controls --------------------------------------------------------
//
// Local rather than in `components/ui.tsx`: these are composer controls with a
// composer's density, and promoting them would push that density onto the
// reading screens, which are deliberately calmer.

function Row({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, style]}>{children}</View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const type = useTypeScale();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 40,
        justifyContent: 'center',
        paddingHorizontal: 14,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? colors.accent : colors.border,
        backgroundColor: active ? colors.accentMuted : 'transparent',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          color: active ? colors.accent : colors.textSecondary,
          fontSize: type.caption,
          textTransform: 'capitalize',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Option({
  title,
  description,
  active,
  onPress,
}: {
  title: string;
  description: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const type = useTypeScale();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: active ? colors.accent : colors.border,
        backgroundColor: active ? colors.accentMuted : 'transparent',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          color: active ? colors.accent : colors.textPrimary,
          fontSize: type.small,
          fontWeight: '600',
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: type.caption,
          lineHeight: type.caption * 1.5,
          marginTop: 2,
        }}
      >
        {description}
      </Text>
    </Pressable>
  );
}

function Stepper({
  label,
  glyph,
  onPress,
  disabled,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        width: 48,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ color: colors.textPrimary, fontSize: 20 }}>{glyph}</Text>
    </Pressable>
  );
}

function Thumb({
  active,
  onPress,
  uri,
  tint,
  label,
}: {
  active: boolean;
  onPress: () => void;
  uri?: string | null;
  tint?: string | null;
  label?: string;
}) {
  const { colors } = useTheme();
  const type = useTypeScale();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        width: 62,
        height: 110,
        borderRadius: 10,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: active ? colors.accent : 'transparent',
        // The dominant colour holds the strip steady while thumbs load.
        backgroundColor: tint ?? colors.surfaceSunken,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {uri ? (
        <Image source={{ uri }} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
      ) : label ? (
        <Text style={{ color: colors.textMuted, fontSize: type.caption }}>{label}</Text>
      ) : null}
    </Pressable>
  );
}
