import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dock } from '@/features/home/dock';
import { SeersPill } from '@/features/home/seers-pill';
import { AddSheet } from '@/features/circles/add-sheet';
import { CirclesSheet } from '@/features/circles/circles-sheet';
import { useCircles } from '@/features/circles/queries';
import { useAuth } from '@/features/auth/auth-store';
import { useNow } from '@/features/location/clock';
import { useMyFix } from '@/features/location/engine';
import { LocationBanner } from '@/features/location/location-banner';
import { SwarmLayer, SwarmPanel } from '@/features/dev/swarm-panel';
import { DEV_TOOLS_ENABLED } from '@/config/env';
import { seersOf, useSharing } from '@/features/location/sharing';
import { useWatchCircles } from '@/features/location/use-location';
import { memberName } from '@/features/circles/names';
import { PeopleLayer } from '@/features/map/people-layer';
import { PlacesLayer } from '@/features/places/places-layer';
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
        <PlacesLayer />
        <PeopleLayer
          me={me.data}
          circles={circleList.data ?? []}
          handlersFor={people.handlersFor}
          onCluster={(lat, lng) => {
            map.current?.zoomIn([lng, lat]);
          }}
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
          onPress={() => circles.current?.present()}
        />
        {weather === null ? null : <WeatherChip here={weather} />}
        <LocationBanner />
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
