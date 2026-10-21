import type { LngLat } from '@maplibre/maplibre-react-native';
import { Profiler, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dock } from '@/features/home/dock';
import { router, useFocusEffect } from 'expo-router';

import { MapShortcuts } from '@/features/home/map-shortcuts';
import { MeetingChip } from '@/features/home/meeting-chip';
import { SeersPill, sharingNow } from '@/features/home/seers-pill';
import { isAway, nextMeeting } from '@/features/home/shortcuts-model';
import { useOnScreen } from '@/features/home/use-on-screen';
import { AddSheet } from '@/features/circles/add-sheet';
import { CirclesSheet } from '@/features/circles/circles-sheet';
import { useCircles } from '@/features/circles/queries';
import { useAuth } from '@/features/auth/auth-store';
import { useNow } from '@/features/location/clock';
import { useMyFix } from '@/features/location/engine';
import { LocationBanner } from '@/features/location/location-banner';
import { useMapOpen } from '@/features/location/map-open';
import { useFirstPosition, useMyCell } from '@/features/location/my-position';
import { reportRender } from '@/features/location/probe';
import { useLocationPermission } from '@/features/location/tracker';
import { NewPhoneCard } from '@/features/location/new-phone-card';
import { SwarmLayer, SwarmPanel } from '@/features/dev/swarm-panel';
import { useDevSlots } from '@/features/dev/slots';
import { useBackgroundLiveSlots } from '@/features/location/background-live/slot';
import { DEV_TOOLS_ENABLED } from '@/config/env';
import { seersOf, useSharing } from '@/features/location/sharing';
import { useWatchCircles } from '@/features/location/use-location';
import { memberName } from '@/features/circles/names';
import { PeopleLayer } from '@/features/map/people-layer';
import { SharingReminderCard } from '@/features/location/sharing-reminder-card';
import { NotificationCard } from '@/features/notifications/notification-card';
import { PlacesLayer } from '@/features/places/places-layer';
import { usePlaces } from '@/features/places/places';
import { useDocs } from '@/features/plan/docs';
import { meetingPoints } from '@/features/plan/meeting-points';
import { MeetingPointsLayer } from '@/features/plan/meeting-points-layer';
import { MeSheet } from '@/features/home/sheets';
import { takeReturn } from '@/features/home/sheet-return';
import { StatusSheet } from '@/features/social/status-sheet';
import { BarguMap, type BarguMapHandle } from '@/features/map/bargu-map';
import { usePeopleUi } from '@/features/map/people-ui';
import { townIn } from '@/features/map/place-name';
import { usePersonFocus } from '@/features/map/person-focus';
import { useWeatherHere, WeatherChip } from '@/features/weather/use-weather';
import { WeatherLayer } from '@/features/weather/weather-layer';
import { MapCredit } from '@/features/map/map-credit';
import { useMe } from '@/features/profile/queries';
import { space, touchTarget } from '@/theme';
import { EffectsPaused } from '@/theme/effects';
import { useMotion } from '@/theme/use-motion';
import { Confetti, useCelebration } from '@/ui/confetti';
import type { SheetRef } from '@/ui/sheet';

/** Height the dock and pill cover, so the map keeps its centre and credits in the open area. */
const DOCK_HEIGHT = touchTarget + space.md + space.lg * 2;
const PILL_HEIGHT = touchTarget + space.lg;

/** Map-first home: the map, "who sees me" on top, the dock below, everything else in sheets. */
export default function HomeScreen() {
  const me = useMe();
  const circleList = useCircles();
  const requests = circleList.data?.filter((circle) => circle.myStatus === 'invited').length ?? 0;
  const insets = useSafeAreaInsets();
  const circles = useRef<SheetRef>(null);
  const add = useRef<SheetRef>(null);
  const meSheet = useRef<SheetRef>(null);
  const statusSheet = useRef<SheetRef>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [meOpen, setMeOpen] = useState(false);
  const motion = useMotion();
  const celebrating = useCelebration((state) => state.pending);
  const celebrated = useCelebration((state) => state.done);
  const myUserId = useAuth((state) => state.userId);
  const sharing = useSharing();
  // Not the position itself: with the map open it comes every second, and this screen (the map,
  // the sheets, everything on it) was drawn again for each one. What it needs of it is below.
  const focus = useFirstPosition();
  const cell = useMyCell();
  const now = useNow();
  const map = useRef<BarguMapHandle>(null);
  const people = usePeopleUi(map, circleList.data ?? [], insets.top, () => {
    statusSheet.current?.present();
  });
  const weather = useWeatherHere();
  // Meetings: their own look and screen, never a saved place's (the project owner's request,
  // docs/ADR/0026). An event's places are its meeting's, so none of them is drawn as a place.
  const docs = useDocs();
  const places = usePlaces();
  const points = meetingPoints(circleList.data ?? [], docs, places, now, myUserId);
  const eventIds = new Set(
    (circleList.data ?? []).filter((circle) => circle.kind === 'event').map((circle) => circle.id),
  );
  const meetingPlaces = new Set([
    ...points.map((point) => point.place.id),
    ...Object.values(places)
      .filter((place) => eventIds.has(place.circleId))
      .map((place) => place.id),
  ]);
  // The shortcuts at the right edge (docs/ADR/0026 §8): out of the way while a person's card is open.
  const [view, setView] = useState<{ center: LngLat; zoom: number } | null>(null);
  // Whether the map looks away from this phone: a yes or no, so the position's every-second
  // changes redraw this screen only when the answer changes.
  const away = useMyFix((state) => view !== null && isAway(view.center, view.zoom, state.fix));
  // Nothing moves while the map is not seen (another page over it, the app in the background);
  // a touch or a move wakes the weather for a while (docs/ADR/0027).
  const onScreen = useOnScreen();
  // Back from a screen a sheet opened: that sheet opens again where it was (UX düzeni 8).
  useFocusEffect(
    useCallback(() => {
      const back = takeReturn();
      if (back === 'me') {
        meSheet.current?.present();
        setMeOpen(true);
      } else if (back === 'circles') {
        circles.current?.present();
      }
    }, []),
  );
  const devOverlay = useDevSlots((state) => state.mapOverlay);
  // The one-time explanation of background live mode, in builds that have it (ADR 0028 step 3).
  const backgroundLiveCard = useBackgroundLiveSlots((state) => state.mapCard);
  // While the map is seen, this phone's own pin follows the GPS every second (use-location.ts).
  useEffect(() => {
    useMapOpen.setState({ open: onScreen });
    return () => {
      useMapOpen.setState({ open: false });
    };
  }, [onScreen]);
  const [wake, setWake] = useState(0);
  // The weather card names the town around this phone from the map's own labels (ADR 0013), for
  // the square kilometre it is in: looked up again when that changes or the map settles.
  const { i18n } = useTranslation();
  const permission = useLocationPermission((state) => state.state);
  // Kept with the square it was found for: moved on to another, the old name no longer shows, and
  // none at all where the map names nothing (QA 24 B-3).
  const [found, setFound] = useState<{ cell: string; name: string } | null>(null);
  const [lookups, setLookups] = useState(0);
  useEffect(() => {
    if (cell === null) return;
    const [lng = 0, lat = 0] = cell.split(':').map(Number);
    void map.current?.townName([lng, lat], i18n.language).then((name) => {
      if (name !== null) setFound({ cell, name });
    });
  }, [cell, i18n.language, lookups]);
  const cardOpen = usePersonFocus((state) => state.selected !== null);
  const next = nextMeeting(points, now);
  const nextCircle =
    next === null
      ? undefined
      : circleList.data?.find((circle) => circle.id === next.point.circleId);
  const onChip =
    next === null || nextCircle === undefined
      ? null
      : { circle: nextCircle, meetAt: next.point.meetAt, place: next.point.place };
  // While the map is on screen, the circles' phones send live updates.
  useWatchCircles();
  const seers = seersOf(circleList.data ?? [], sharing, myUserId, now).map((member) => ({
    id: member.userId,
    name: memberName(member),
    avatar: member.avatar,
  }));
  const toggleAdd = () => {
    if (addOpen) {
      add.current?.dismiss();
      return;
    }
    add.current?.present();
    setAddOpen(true);
  };

  // The root layout only shows this group once the profile is loaded and complete.
  if (me.data === undefined) return null;

  return (
    <EffectsPaused.Provider value={!onScreen}>
      <View style={styles.screen}>
        {/* Preview builds time each drawing of the map (probe.ts reportRender). */}
        <Profiler id="map" onRender={reportRender}>
          <BarguMap
            ref={map}
            onPress={() => {
              people.onMapPress();
              setWake((count) => count + 1);
            }}
            insets={{
              top: insets.top + PILL_HEIGHT,
              bottom: insets.bottom + DOCK_HEIGHT,
            }}
            focus={focus}
            onSettle={(settled) => {
              setView(settled);
              setWake((count) => count + 1);
              setLookups((count) => count + 1);
            }}
          >
            <PlacesLayer except={meetingPlaces} />
            <MeetingPointsLayer points={points} now={now} />
            <PeopleLayer
              me={me.data}
              circles={circleList.data ?? []}
              handlersFor={people.handlersFor}
              onGroup={people.openGroup}
            />
            {DEV_TOOLS_ENABLED ? <SwarmLayer /> : null}
          </BarguMap>
        </Profiler>
        {weather === null ? null : <WeatherLayer here={weather} wake={wake} />}
        <MapCredit bottom={insets.bottom + DOCK_HEIGHT + space.sm} />
        <Animated.View
          entering={motion.enterDown}
          style={[styles.top, { top: insets.top + space.sm }]}
          pointerEvents="box-none"
        >
          <View style={styles.topRow} pointerEvents="box-none">
            <SeersPill
              seers={seers}
              ghost={sharing.ghost}
              permission={permission}
              onPress={() => {
                router.push('/seers');
              }}
            />
            {weather === null ? null : <WeatherChip here={weather} town={townIn(found, cell)} />}
          </View>
          <MeetingChip circles={circleList.data ?? []} points={points} now={now} me={myUserId} />

          <LocationBanner />
          <NotificationCard />
          <NewPhoneCard onChoose={() => circles.current?.present()} />
          <SharingReminderCard />
          {backgroundLiveCard}
          {DEV_TOOLS_ENABLED ? <SwarmPanel /> : null}
        </Animated.View>
        <Animated.View
          entering={motion.enterUpAt(1)}
          style={[styles.bottom, { bottom: insets.bottom + space.md }]}
          pointerEvents="box-none"
        >
          <Dock
            me={me.data}
            addOpen={addOpen}
            requests={requests}
            onCircles={() => circles.current?.present()}
            onAdd={toggleAdd}
            onMe={() => {
              meSheet.current?.present();
              setMeOpen(true);
            }}
            active={meOpen ? 'me' : 'circles'}
          />
        </Animated.View>
        {cardOpen ? null : (
          <MapShortcuts
            circles={circleList.data ?? []}
            away={away}
            onRecenter={() => {
              const fix = useMyFix.getState().fix;
              if (fix !== null) map.current?.focusOn([fix.lng, fix.lat], 0);
            }}
            meeting={onChip}
            me={myUserId}
            now={now}
            bottom={insets.bottom + DOCK_HEIGHT + space.md}
            shared={
              sharingNow({ ghost: sharing.ghost, seers: seers.length, permission }) === 'shared'
            }
          />
        )}
        {people.overlay}
        {devOverlay}
        <CirclesSheet
          ref={circles}
          onAdd={() => {
            circles.current?.dismiss();
            add.current?.present();
            setAddOpen(true);
          }}
          onClose={() => circles.current?.dismiss()}
        />
        <AddSheet
          ref={add}
          onDismiss={() => {
            setAddOpen(false);
          }}
          onClose={() => add.current?.dismiss()}
        />
        <MeSheet
          ref={meSheet}
          me={me.data}
          onDismiss={() => {
            setMeOpen(false);
          }}
          onClose={() => meSheet.current?.dismiss()}
          onStatus={() => {
            meSheet.current?.dismiss();
            statusSheet.current?.present();
          }}
        />
        <StatusSheet ref={statusSheet} onClose={() => statusSheet.current?.dismiss()} />
        {celebrating ? <Confetti onDone={celebrated} /> : null}
      </View>
    </EffectsPaused.Provider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    alignItems: 'center',
    gap: space.sm,
  },
  bottom: { position: 'absolute', left: 0, right: 0 },
  // "Who sees me" and the weather side by side; on a narrow screen or with large text the weather
  // goes under.
  topRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
});
