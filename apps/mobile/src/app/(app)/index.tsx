import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dock } from '@/features/home/dock';
import { router } from 'expo-router';

import { SeersPill } from '@/features/home/seers-pill';
import { AddSheet } from '@/features/circles/add-sheet';
import { CirclesSheet } from '@/features/circles/circles-sheet';
import { useCircles } from '@/features/circles/queries';
import { useAuth } from '@/features/auth/auth-store';
import { useNow } from '@/features/location/clock';
import { useMyFix } from '@/features/location/engine';
import { LocationBanner } from '@/features/location/location-banner';
import { NewPhoneCard } from '@/features/location/new-phone-card';
import { SwarmLayer, SwarmPanel } from '@/features/dev/swarm-panel';
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
import { StatusSheet } from '@/features/social/status-sheet';
import { BarguMap, type BarguMapHandle } from '@/features/map/bargu-map';
import { usePeopleUi } from '@/features/map/people-ui';
import { useWeatherHere, WeatherChip } from '@/features/weather/use-weather';
import { WeatherLayer } from '@/features/weather/weather-layer';
import { MapCredit } from '@/features/map/map-credit';
import { useMe } from '@/features/profile/queries';
import { space, touchTarget } from '@/theme';
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
  const motion = useMotion();
  const celebrating = useCelebration((state) => state.pending);
  const celebrated = useCelebration((state) => state.done);
  const myUserId = useAuth((state) => state.userId);
  const sharing = useSharing();
  const myFix = useMyFix((state) => state.fix);
  const now = useNow();
  const map = useRef<BarguMapHandle>(null);
  const people = usePeopleUi(map, circleList.data ?? [], insets.top);
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
    <View style={styles.screen}>
      <BarguMap
        ref={map}
        onPress={people.onMapPress}
        insets={{
          top: insets.top + PILL_HEIGHT,
          bottom: insets.bottom + DOCK_HEIGHT,
        }}
        focus={myFix === null ? null : [myFix.lng, myFix.lat]}
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
      {weather === null ? null : <WeatherLayer here={weather} />}
      <MapCredit bottom={insets.bottom + DOCK_HEIGHT + space.sm} />
      <Animated.View
        entering={motion.enterDown}
        style={[styles.top, { top: insets.top + space.sm }]}
        pointerEvents="box-none"
      >
        <SeersPill
          seers={seers}
          ghost={sharing.ghost !== 'off'}
          onPress={() => {
            router.push('/seers');
          }}
        />
        {weather === null ? null : <WeatherChip here={weather} />}
        <LocationBanner />
        <NotificationCard />
        <NewPhoneCard onChoose={() => circles.current?.present()} />
        <SharingReminderCard />
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
          onMe={() => meSheet.current?.present()}
        />
      </Animated.View>
      {people.overlay}
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
        onClose={() => meSheet.current?.dismiss()}
        onStatus={() => {
          meSheet.current?.dismiss();
          statusSheet.current?.present();
        }}
      />
      <StatusSheet ref={statusSheet} onClose={() => statusSheet.current?.dismiss()} />
      {celebrating ? <Confetti onDone={celebrated} /> : null}
    </View>
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
});
