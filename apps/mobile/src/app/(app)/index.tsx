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
import { InviteCard } from '@/features/home/invite-card';
import { QuickSheet } from '@/features/home/quick-sheet';
import { TipBubble } from '@/features/home/tip-bubble';
import { markTipSeen } from '@/features/home/tips';
import { SafeButton } from '@/features/home/safe-button';
import { SeersPill, sharingNow } from '@/features/home/seers-pill';
import { isAway, nextMeeting } from '@/features/home/shortcuts-model';
import { useOnScreen } from '@/features/home/use-on-screen';
import { AddSheet } from '@/features/circles/add-sheet';
import { CirclesSheet } from '@/features/circles/circles-sheet';
import { useCircles } from '@/features/circles/queries';
import { useAuth } from '@/features/auth/auth-store';
import { useNow } from '@/features/location/clock';
import { useMyFix } from '@/features/location/engine';
import { CardsWaiting } from '@/features/location/cards-waiting';
import { LocationBanner } from '@/features/location/location-banner';
import { useMapOpen } from '@/features/location/map-open';
import { useFirstPosition, useMyCell } from '@/features/location/my-position';
import { reportRender } from '@/features/location/probe';
import { useLocationPermission } from '@/features/location/tracker';
import { NewPhoneCard } from '@/features/location/new-phone-card';
import { useDevSlots } from '@/features/dev/slots';
import { useBackgroundLiveSlots } from '@/features/location/background-live/slot';
import { seersOf, useSharing } from '@/features/location/sharing';
import { useWatchCircles } from '@/features/location/use-location';
import { memberName } from '@/features/circles/names';
import { PeopleLayer } from '@/features/map/people-layer';
import { SharingReminderCard } from '@/features/location/sharing-reminder-card';
import { NotificationCard } from '@/features/notifications/notification-card';
import { openPlace } from '@/features/places/open-place';
import { placeAt } from '@/features/places/place-model';
import { PlacesLayer } from '@/features/places/places-layer';
import { usePlaces } from '@/features/places/places';
import { useDocs } from '@/features/plan/docs';
import { meetingPoints } from '@/features/plan/meeting-points';
import { MeetingPointsLayer, openMeeting } from '@/features/plan/meeting-points-layer';
import { MeSheet } from '@/features/home/sheets';
import { takeReturn } from '@/features/home/sheet-return';
import { clearSpot, spotBounds, useSafeSpot } from '@/features/social/safe-spot';
import { SafeSpotLayer } from '@/features/social/safe-spot-layer';
import { SafeSheet } from '@/features/social/safe-sheet';
import { StatusSheet } from '@/features/social/status-sheet';
import { BarguMap, type BarguMapHandle } from '@/features/map/bargu-map';
import { usePeopleUi } from '@/features/map/people-ui';
import { townIn } from '@/features/map/place-name';
import { usePersonFocus } from '@/features/map/person-focus';
import { useWeatherHere, WeatherChip } from '@/features/weather/use-weather';
import { WeatherLayer } from '@/features/weather/weather-layer';
import { MapCredit } from '@/features/map/map-credit';
import { useMe } from '@/features/profile/queries';
import { unreadTotal, useMessages } from '@/features/messages/messages';
import { useRulesGate } from '@/features/messages/rules';
import { space, touchTarget } from '@/theme';
import { EffectsPaused } from '@/theme/effects';
import { useMotion } from '@/theme/use-motion';
import { Confetti, useCelebration } from '@/ui/confetti';
import type { SheetRef } from '@/ui/sheet';
import { ClearOfToast } from '@/ui/toast';

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
  const quick = useRef<SheetRef>(null);
  const meSheet = useRef<SheetRef>(null);
  const statusSheet = useRef<SheetRef>(null);
  const safeSheet = useRef<SheetRef>(null);
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
  // Unread items of messages and moments (docs/ADR/0035): a number, so only its change redraws.
  const unread = useMessages((state) => (myUserId === null ? 0 : unreadTotal(state, myUserId)));
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
  // Developer tools of development and preview builds (features/dev/tools.ts); empty in production.
  const devOverlay = useDevSlots((state) => state.mapOverlay);
  const swarmLayer = useDevSlots((state) => state.swarmLayer);
  const swarmPanel = useDevSlots((state) => state.swarmPanel);
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
  // A tapped "Güvendeyim" (a notification, or its line): the map looks at where they are, the
  // circle whole or a street round the dot (docs/ADR/0029 §5). Also when it opened the app.
  const spotRequest = useSafeSpot((state) => state.request);
  useEffect(() => {
    const spot = useSafeSpot.getState().spot;
    if (spot !== null) map.current?.fitTo(spotBounds(spot), 0);
  }, [spotRequest]);
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
  // The + opens the quick things (T2); a photo first needs the community rules (K14).
  const rules = useRulesGate();
  const toggleAdd = () => {
    if (addOpen) {
      quick.current?.dismiss();
      return;
    }
    quick.current?.present();
    setAddOpen(true);
    // Found the + on their own: its tip is not needed (T6).
    markTipSeen('plus');
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
            onPress={(at) => {
              // With a person's card open the tap only closes it; otherwise a tap inside a
              // meeting's area opens the meeting, and one inside a saved place's circle opens that
              // place (the smallest one there). People and the tags take their taps before the
              // map sees one.
              const closing = usePersonFocus.getState().selected !== null;
              people.onMapPress();
              clearSpot();
              setWake((count) => count + 1);
              if (closing) return;
              const meeting = placeAt(
                points.map((point) => point.place),
                at,
              );
              if (meeting !== null) {
                openMeeting(meeting.circleId, meeting.id);
                return;
              }
              const shown = Object.values(places).filter((place) => !meetingPlaces.has(place.id));
              const place = placeAt(shown, at);
              if (place !== null) openPlace(place);
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
            <SafeSpotLayer />
            <PeopleLayer
              me={me.data}
              circles={circleList.data ?? []}
              handlersFor={people.handlersFor}
              onGroup={people.openGroup}
            />
            {swarmLayer}
          </BarguMap>
        </Profiler>
        {weather === null ? null : <WeatherLayer here={weather} wake={wake} />}
        <MapCredit bottom={insets.bottom + DOCK_HEIGHT + space.sm} />
        <Animated.View
          entering={motion.enterDown}
          style={[styles.top, { top: insets.top + space.sm }]}
          pointerEvents="box-none"
        >
          <ClearOfToast style={styles.topStack}>
            <View style={styles.topRow} pointerEvents="box-none">
              <View style={styles.seers} pointerEvents="box-none">
                <SeersPill
                  seers={seers}
                  ghost={sharing.ghost}
                  permission={permission}
                  onPress={() => {
                    router.push('/seers');
                  }}
                />
              </View>
              {weather === null ? null : <WeatherChip here={weather} town={townIn(found, cell)} />}
            </View>
            <MeetingChip circles={circleList.data ?? []} points={points} now={now} me={myUserId} />

            <LocationBanner />
            <NotificationCard />
            <NewPhoneCard onChoose={() => circles.current?.present()} />
            <SharingReminderCard />
            {backgroundLiveCard}
            <InviteCard />
            <CardsWaiting />
            {swarmPanel}
          </ClearOfToast>
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
            onMessages={() => {
              router.push('/messages');
            }}
            onStore={() => {
              router.push('/store');
            }}
            unread={unread}
            active={meOpen ? 'me' : 'circles'}
          />
        </Animated.View>
        {cardOpen ? null : (
          <>
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
            {/* First-use tips (T6), one at a time, above the dock. */}
            <TipBubble me={myUserId} bottom={insets.bottom + DOCK_HEIGHT + space.sm} />
            {/* "Güvendeyim", one tap away on the left (docs/ADR/0029); above the map credit. */}
            <SafeButton
              bottom={insets.bottom + DOCK_HEIGHT + space.md + space.xxl}
              onPress={() => safeSheet.current?.present()}
            />
          </>
        )}
        {people.overlay}
        {devOverlay}
        <CirclesSheet
          ref={circles}
          onAdd={() => {
            circles.current?.dismiss();
            add.current?.present();
          }}
          onClose={() => circles.current?.dismiss()}
        />
        <QuickSheet
          ref={quick}
          onDismiss={() => {
            setAddOpen(false);
          }}
          onPhoto={() => {
            quick.current?.dismiss();
            rules.ensure(() => {
              router.push('/camera');
            });
          }}
          onAddFriend={() => {
            quick.current?.dismiss();
            add.current?.present();
          }}
          onMeeting={() => {
            quick.current?.dismiss();
            router.push('/meeting/new');
          }}
          onSafe={() => {
            quick.current?.dismiss();
            safeSheet.current?.present();
          }}
        />
        <AddSheet ref={add} onDismiss={() => undefined} onClose={() => add.current?.dismiss()} />
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
          onSafe={() => {
            meSheet.current?.dismiss();
            safeSheet.current?.present();
          }}
        />
        <StatusSheet ref={statusSheet} onClose={() => statusSheet.current?.dismiss()} />
        <SafeSheet ref={safeSheet} onClose={() => safeSheet.current?.dismiss()} />
        {rules.sheet}
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
  },
  topStack: { alignItems: 'center', gap: space.sm },
  bottom: { position: 'absolute', left: 0, right: 0 },
  // "Who sees me" and the weather always side by side (the owner, 2026-10-23: the weather had gone
  // under it); on a narrow screen or with large text "who sees me" gives way, its text shortened.
  topRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  seers: { flexShrink: 1 },
});
