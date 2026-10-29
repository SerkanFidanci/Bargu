import { router } from 'expo-router';
import { Eye, History as HistoryIcon, Trash2, Upload, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePlan } from '@/features/billing/plan';
import { useCircles } from '@/features/circles/queries';
import { boundsOf, DaySegments, placeOf } from '@/features/history/day-segments';
import { HistoryLayer } from '@/features/history/history-layer';
import {
  dayKey,
  dayStartOf,
  entitledUntil,
  KEEP_CHOICES,
  type OwnSettings,
} from '@/features/history/own/own-model';
import { ownTrail, ownTrailTick } from '@/features/history/own/own-session';
import { prepareTrailKey } from '@/features/history/own/own-files';
import { nameStays } from '@/features/history/stay-names';
import { segments, type TracePoint } from '@/features/history/trail-model';
import { useNow } from '@/features/location/clock';
import { sharedCircles, useSharing } from '@/features/location/sharing';
import { saveExport } from '@/features/account/export';
import { BarguMap, type BarguMapHandle } from '@/features/map/bargu-map';
import { usePlaces } from '@/features/places/places';
import { isVaultOpen } from '@/features/storage/vault';
import { radius, space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { Hint } from '@/ui/hint';
import { IconButton } from '@/ui/icon-button';
import { ListRow } from '@/ui/list-row';
import { PressableScale } from '@/ui/pressable-scale';
import { Segmented } from '@/ui/segmented';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';
import { Toggle } from '@/ui/toggle';

/** What is kept: the days with a record and the points of one day (what waits too). */
function load(day: string): { day: string; days: string[]; points: TracePoint[] } {
  return isVaultOpen()
    ? { day, days: ownTrail.days(), points: ownTrail.read(day) }
    : { day, days: [], points: [] };
}

const DAY_MS = 24 * 60 * 60_000;
/** The calendar days the strip always shows, even without a record (faded). */
const STRIP_DAYS = 14;

/**
 * "Konum geçmişim" (docs/ADR/0030 §4): one's own days on the map and as stays and trips, kept on
 * this phone alone. Off until turned on and a Bargu+ feature; with the phone locked what was
 * already kept waits. Choosing how long, deleting it all and taking it out are at the bottom.
 */
export default function MyHistoryScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const plan = usePlan().data;
  const sharing = useSharing();
  const circles = useCircles().data ?? [];
  const places = Object.values(usePlaces());
  const map = useRef<BarguMapHandle>(null);

  const [settings, setSettings] = useState<OwnSettings>(() =>
    isVaultOpen() ? ownTrail.settings() : { on: false, keep: 30 },
  );
  const today = dayKey(now);
  // What is kept and shown, read when it can change (a choice, a change, the files' key): never at
  // every redraw, which would open a month file each time and refit the camera.
  const [view, setView] = useState(() => load(today));
  const [version, setVersion] = useState(0);
  const day = view.day;
  const reload = () => {
    setView((current) => load(current.day));
    setVersion((count) => count + 1);
  };
  // Read once the files' key could be read (the phone unlocked); until then only what waits shows.
  useEffect(() => {
    let alive = true;
    void ownTrailTick().then(() => {
      if (!alive) return;
      setView((current) => load(current.day));
      setVersion((count) => count + 1);
    });
    return () => {
      alive = false;
    };
  }, []);

  const entitled =
    plan !== undefined && (entitledUntil(plan) === null || now <= (entitledUntil(plan) ?? 0));
  const recording = sharedCircles(circles, sharing, now).length > 0;

  const recorded = view.days;
  const strip = useMemo(() => {
    const calendar = Array.from({ length: STRIP_DAYS }, (_, back) =>
      dayKey(dayStartOf(today) - back * DAY_MS + DAY_MS / 2),
    );
    return [...new Set([...calendar, ...recorded])].sort().reverse();
  }, [today, recorded]);
  const points = view.points;
  const timeline = useMemo(() => segments(points), [points]);

  const [named, setNamed] = useState<{ key: string; names: Record<number, string> }>({
    key: '',
    names: {},
  });
  const key = `${day}:${String(version)}`;
  const names = named.key === key ? named.names : {};
  const nameUnplaced = () => {
    const handle = map.current;
    const stays = timeline.flatMap((segment) =>
      segment.kind === 'stay' && placeOf(segment, places) === undefined ? [segment] : [],
    );
    if (handle === null || stays.length === 0) return;
    const asked = key;
    void nameStays(stays, names, (stay) =>
      handle.placeName([stay.lng, stay.lat], i18n.language),
    ).then((next) => {
      setNamed({ key: asked, names: next });
    });
  };
  const [panel, setPanel] = useState(0);
  useEffect(() => {
    const bounds = boundsOf(points);
    if (bounds !== null) map.current?.fitTo(bounds, panel);
  }, [points, panel]);

  const change = (next: OwnSettings) => {
    ownTrail.setSettings(next);
    setSettings(next);
    reload();
  };

  const turn = (on: boolean) => {
    if (!on) {
      change({ ...settings, on: false });
      return;
    }
    if (!entitled) {
      // A Bargu+ feature (ADR 0030 §5): the store, not a switch that does nothing.
      router.push({ pathname: '/store', params: { shelf: 'plus' } });
      return;
    }
    void prepareTrailKey(true).then((ready) => {
      if (!ready) {
        toast.error(t('history.mine.locked'));
        return;
      }
      change({ ...settings, on: true });
      toast.info(t('history.mine.lockAdvice'));
    });
  };

  const keep = (days: 30 | 365) => {
    const apply = () => {
      change({ ...settings, keep: days });
      if (days === 30) ownTrail.prune();
      reload();
    };
    if (days === 365 || settings.keep === 30 || recorded.length === 0) {
      apply();
      return;
    }
    Alert.alert(t('history.mine.shortenTitle'), t('history.mine.shortenBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('history.mine.shortenConfirm'), style: 'destructive', onPress: apply },
    ]);
  };

  const wipe = () => {
    Alert.alert(t('history.mine.deleteTitle'), t('history.mine.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('history.mine.deleteConfirm'),
        style: 'destructive',
        onPress: () => {
          ownTrail.clear();
          setView(load(today));
          setVersion((count) => count + 1);
          toast.success(t('history.mine.deleted'));
        },
      },
    ]);
  };

  const takeOut = () => {
    void (async () => {
      await prepareTrailKey(false);
      const file = {
        format: 'bargu-own-history',
        version: 1,
        exportedAt: new Date(now).toISOString(),
        days: ownTrail.exported().map((entry) => ({
          day: entry.day,
          points: entry.points.map((point) => ({
            at: new Date(point.at).toISOString(),
            lat: point.lat,
            lng: point.lng,
            accuracyM: point.acc,
          })),
        })),
      };
      const saved = await saveExport(
        `bargu-konum-gecmisim-${new Date(now).toISOString().slice(0, 10)}.json`,
        JSON.stringify(file, null, 2),
      );
      if (saved) toast.success(t('privacy.exported'));
    })().catch(() => {
      toast.error(t('history.mine.exportFailed'));
    });
  };

  const dayLabel = (key: string) => {
    if (key === today) return t('history.today');
    if (key === dayKey(dayStartOf(today) - DAY_MS / 2)) return t('history.yesterday');
    return new Date(dayStartOf(key)).toLocaleDateString(i18n.language, {
      weekday: 'short',
      day: 'numeric',
    });
  };
  const viewers = Object.values(sharing.circles).filter((circle) => circle.history === true).length;
  const approximate = points.length > 0 && points.every((point) => point.acc > 100);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]} testID="my-history">
      <View style={styles.map}>
        <BarguMap ref={map} overlay insets={{ top: insets.top }} onSettle={nameUnplaced}>
          <HistoryLayer points={points} timeline={timeline} />
        </BarguMap>
        <View style={[styles.close, { top: insets.top + space.sm }]}>
          <IconButton
            icon={X}
            label={t('common.close')}
            onPress={() => {
              router.back();
            }}
          />
        </View>
      </View>
      <View
        style={[styles.panel, { backgroundColor: colors.surface }]}
        onLayout={(event) => {
          setPanel(event.nativeEvent.layout.height);
        }}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.lg }]}
        >
          <Text variant="title2">{t('history.mine.title')}</Text>
          <Toggle
            testID="mine-on"
            label={t('history.mine.record')}
            description={entitled ? t('history.mine.recordNote') : t('history.mine.plusNote')}
            value={settings.on}
            onChange={turn}
          />
          {settings.on && !recording ? (
            <Hint testID="mine-idle">{t('history.mine.notSharing')}</Hint>
          ) : null}
          {settings.on && !entitled ? (
            <Hint testID="mine-ended">{t('history.mine.planEnded')}</Hint>
          ) : null}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.days}
          >
            {strip.map((key) => {
              const has = recorded.includes(key);
              const on = key === day;
              return (
                <PressableScale
                  key={key}
                  testID={`mine-day-${key}`}
                  haptic="select"
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${dayLabel(key)}${has ? '' : `, ${t('history.mine.noRecord')}`}`}
                  onPress={() => {
                    setView(load(key));
                  }}
                  style={[
                    styles.day,
                    { backgroundColor: on ? colors.primary : colors.surfaceRaised },
                    has || on ? null : styles.faded,
                  ]}
                >
                  <Text variant="subhead" style={{ color: on ? colors.onPrimary : colors.text }}>
                    {dayLabel(key)}
                  </Text>
                </PressableScale>
              );
            })}
          </ScrollView>

          {timeline.length === 0 ? (
            <EmptyState
              icon={HistoryIcon}
              title={t('history.mine.noRecord')}
              body={settings.on ? t('history.mine.emptyOn') : t('history.mine.emptyOff')}
            />
          ) : (
            <View testID="mine-timeline">
              {approximate ? <Hint>{t('history.mine.approximate')}</Hint> : null}
              <DaySegments timeline={timeline} places={places} names={names} />
            </View>
          )}

          <Text variant="subhead" color="textMuted">
            {t('history.mine.keepTitle')}
          </Text>
          <Segmented
            testID="mine-keep"
            label={t('history.mine.keepTitle')}
            value={String(settings.keep) as '30' | '365'}
            onChange={(value) => {
              keep(value === '30' ? 30 : 365);
            }}
            options={KEEP_CHOICES.map((days) => ({
              value: String(days) as '30' | '365',
              label: t(days === 30 ? 'history.mine.keep30' : 'history.mine.keep365'),
            }))}
          />

          <ListRow
            testID="mine-viewers"
            leading={<Eye color={colors.primary} size={20} strokeWidth={2.25} />}
            title={t('history.mine.viewers')}
            subtitle={t('history.mine.viewersCount', { count: viewers })}
            onPress={() => {
              router.push('/history/viewers');
            }}
          />
          <View style={styles.buttons}>
            <Button
              testID="mine-export"
              variant="secondary"
              icon={Upload}
              label={t('history.mine.export')}
              onPress={takeOut}
            />
            <Button
              testID="mine-delete"
              variant="secondary"
              icon={Trash2}
              label={t('history.mine.delete')}
              onPress={wipe}
            />
          </View>
          <Text variant="caption" color="textMuted">
            {t('history.mine.note')}
          </Text>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  map: { flex: 1 },
  close: { position: 'absolute', left: space.lg },
  panel: {
    maxHeight: '65%',
    paddingTop: space.lg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  content: { paddingHorizontal: space.xl, gap: space.md },
  days: { gap: space.sm },
  day: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill },
  faded: { opacity: 0.5 },
  buttons: { gap: space.sm },
});
