import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dock } from '@/features/home/dock';
import { SeersPill } from '@/features/home/seers-pill';
import { AddSheet } from '@/features/circles/add-sheet';
import { CirclesSheet } from '@/features/circles/circles-sheet';
import { useCircles } from '@/features/circles/queries';
import { MeSheet } from '@/features/home/sheets';
import { BarguMap } from '@/features/map/bargu-map';
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
  const [addOpen, setAddOpen] = useState(false);
  const motion = useMotion();
  const celebrating = useCelebration((state) => state.pending);
  const celebrated = useCelebration((state) => state.done);
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
        insets={{
          top: insets.top + PILL_HEIGHT,
          bottom: insets.bottom + DOCK_HEIGHT,
        }}
      />
      <MapCredit bottom={insets.bottom + DOCK_HEIGHT + space.sm} />
      <Animated.View
        entering={motion.enterDown}
        style={[styles.top, { top: insets.top + space.sm }]}
        pointerEvents="box-none"
      >
        <SeersPill seers={[]} onPress={() => circles.current?.present()} />
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
      <MeSheet ref={meSheet} me={me.data} onClose={() => meSheet.current?.dismiss()} />
      {celebrating ? <Confetti onDone={celebrated} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0 },
});
