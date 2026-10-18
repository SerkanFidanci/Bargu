import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { elevation, radius, space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';

import { GlidingMarker } from '../map/gliding-marker';
import { activityOf } from '../map/activity';
import { MapAvatar } from '../map/map-avatar';
import { LOW_BATTERY } from '../map/people-layer';
import { useFrameMeter } from './frame-meter';
import { stopSwarm, useSwarm } from './map-swarm';

/** How long the frame rate is measured with the swarm on the map. */
const MEASURE_SECONDS = 10;

/** The fake people on the map (dev builds only, see map-swarm.ts). */
export function SwarmLayer() {
  const people = useSwarm((state) => state.people);
  return (
    <>
      {people.map((person) => (
        <GlidingMarker key={person.id} id={person.id} fix={person.fix}>
          <MapAvatar
            name={person.name}
            avatar={person.avatar}
            spd={person.fix.spd}
            hdg={person.fix.hdg}
            activity={activityOf(person.fix.spd, 0)}
            charging={person.fix.chg}
            lowBattery={!person.fix.chg && person.fix.bat < LOW_BATTERY}
          />
        </GlidingMarker>
      ))}
    </>
  );
}

/** Measure / stop controls while the swarm is on (Faz 6 DoD: 50 avatars at 60 fps). */
export function SwarmPanel() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const count = useSwarm((state) => state.people.length);
  const meter = useFrameMeter(MEASURE_SECONDS);
  if (count === 0) return null;
  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: colors.surfaceRaised, boxShadow: elevation.floating },
      ]}
    >
      <Text variant="footnote" color="textMuted">
        {t('dev.swarm.title', { count })}
      </Text>
      {meter.report === null ? null : (
        <Text variant="bodyStrong" accessibilityLiveRegion="polite">
          {t('dev.ui.fpsResult', {
            avg: meter.report.averageFps,
            worst: meter.report.worstFrameMs,
            dropped: meter.report.dropped,
          })}
        </Text>
      )}
      <View style={styles.row}>
        <View style={styles.half}>
          <Button
            label={meter.running ? t('dev.crypto.running') : t('dev.swarm.measure')}
            onPress={meter.start}
            disabled={meter.running}
          />
        </View>
        <View style={styles.half}>
          <Button label={t('dev.swarm.stop')} variant="secondary" onPress={stopSwarm} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space.sm, padding: space.md, borderRadius: radius.lg, alignSelf: 'stretch' },
  row: { flexDirection: 'row', gap: space.sm },
  half: { flex: 1 },
});
