import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Dock } from '@/features/home/dock';
import { SeersPill } from '@/features/home/seers-pill';
import { AddSheet, CirclesSheet, MeSheet } from '@/features/home/sheets';
import { BarguMap } from '@/features/map/bargu-map';
import { useMe } from '@/features/profile/queries';
import { space, touchTarget } from '@/theme';
import type { SheetRef } from '@/ui/sheet';

/** Height the dock and pill cover, so the map keeps its centre and credits in the open area. */
const DOCK_HEIGHT = touchTarget + space.md + space.lg * 2;
const PILL_HEIGHT = touchTarget + space.lg;

/** Map-first home: the map, "who sees me" on top, the dock below, everything else in sheets. */
export default function HomeScreen() {
  const me = useMe();
  const insets = useSafeAreaInsets();
  const circles = useRef<SheetRef>(null);
  const add = useRef<SheetRef>(null);
  const meSheet = useRef<SheetRef>(null);

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
      <View style={[styles.top, { top: insets.top + space.sm }]} pointerEvents="box-none">
        <SeersPill seers={[]} onPress={() => circles.current?.present()} />
      </View>
      <View style={[styles.bottom, { bottom: insets.bottom + space.md }]} pointerEvents="box-none">
        <Dock
          me={me.data}
          onCircles={() => circles.current?.present()}
          onAdd={() => add.current?.present()}
          onMe={() => meSheet.current?.present()}
        />
      </View>
      <CirclesSheet
        ref={circles}
        onAdd={() => {
          circles.current?.dismiss();
          add.current?.present();
        }}
      />
      <AddSheet ref={add} />
      <MeSheet ref={meSheet} me={me.data} onClose={() => meSheet.current?.dismiss()} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0 },
});
