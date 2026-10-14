import { Bell, Heart, Inbox, MapPin } from 'lucide-react-native';
import { Redirect, Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { DEV_TOOLS_ENABLED } from '@/config/env';
import { useFrameMeter } from '@/features/dev/frame-meter';
import { space, type TypographyVariant, typography, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { AvatarMarker } from '@/ui/avatar-marker';
import { AvatarStack } from '@/ui/avatar-stack';
import { Button } from '@/ui/button';
import { CodeInput } from '@/ui/code-input';
import { EmptyState } from '@/ui/empty-state';
import { IconButton } from '@/ui/icon-button';
import { Pill } from '@/ui/pill';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Skeleton } from '@/ui/skeleton';
import { StepSlider } from '@/ui/step-slider';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';
import { toast } from '@/ui/toast';
import { Toggle } from '@/ui/toggle';

const PEOPLE = [
  { id: '1', name: 'Ayşe', avatar: { color: 0, emoji: null } },
  { id: '2', name: 'İlker', avatar: { color: 7, emoji: '🦊' } },
  { id: '3', name: 'Zeynep', avatar: { color: 4, emoji: null } },
  { id: '4', name: 'Can', avatar: { color: 10, emoji: '🎸' } },
  { id: '5', name: 'Deniz', avatar: { color: 5, emoji: null } },
] as const;

/** Dev-only gallery of every component, plus the frame-rate meter for the Faz 3 DoD. */
export default function UiGalleryScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const meter = useFrameMeter(5);
  const sheet = useRef<SheetRef>(null);
  const [toggle, setToggle] = useState(true);
  const [precision, setPrecision] = useState<'exact' | 'neighbourhood' | 'city'>('neighbourhood');
  const [code, setCode] = useState('');
  const [field, setField] = useState('');

  if (!DEV_TOOLS_ENABLED) return <Redirect href="/" />;

  return (
    <>
      <Stack.Screen options={{ title: t('dev.ui.title') }} />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.content}
      >
        <Section title={t('dev.ui.fps')}>
          <Text variant="footnote" color="textMuted">
            {t('dev.ui.reduceMotion', { state: reduced ? t('dev.ui.on') : t('dev.ui.off') })}
          </Text>
          <Button
            label={meter.running ? t('dev.crypto.running') : t('dev.ui.fpsStart')}
            onPress={meter.start}
            disabled={meter.running}
          />
          {meter.report === null ? null : (
            <Text variant="bodyStrong" accessibilityLiveRegion="polite">
              {t('dev.ui.fpsResult', {
                avg: meter.report.averageFps,
                worst: meter.report.worstFrameMs,
                dropped: meter.report.dropped,
              })}
            </Text>
          )}
          <Button
            label={t('dev.ui.openSheet')}
            variant="secondary"
            onPress={() => sheet.current?.present()}
          />
          <Button
            label={t('dev.ui.showToast')}
            variant="secondary"
            onPress={() => {
              toast.success(t('dev.ui.toastText'));
            }}
          />
        </Section>

        <Section title="Typography">
          {(Object.keys(typography) as TypographyVariant[]).map((variant) => (
            <Text key={variant} variant={variant}>
              {`${variant} · ${t('dev.ui.sample')} ğüşiöçİ`}
            </Text>
          ))}
        </Section>

        <Section title="Buttons">
          <Button label="Primary" onPress={() => undefined} haptic="select" />
          <Button label="Secondary" variant="secondary" icon={Heart} onPress={() => undefined} />
          <Button label="Ghost" variant="ghost" onPress={() => undefined} />
          <Button label="Danger" variant="danger" onPress={() => undefined} />
          <Button label="Loading" loading onPress={() => undefined} />
          <View style={styles.row}>
            <IconButton icon={MapPin} label="Raised" onPress={() => undefined} />
            <IconButton icon={Bell} label="Primary" tone="primary" onPress={() => undefined} />
            <IconButton icon={Heart} label="Plain" tone="plain" onPress={() => undefined} />
          </View>
        </Section>

        <Section title="Avatars">
          <View style={styles.row}>
            {(['sm', 'md', 'lg', 'xl'] as const).map((size) => (
              <Avatar key={size} size={size} name="İlker" avatar={{ color: 7, emoji: null }} />
            ))}
            <Avatar size="lg" name="Can" avatar={{ color: 10, emoji: '🎸' }} />
            <Avatar size="lg" name="Ghost" avatar={null} muted />
          </View>
          <AvatarStack people={PEOPLE} />
          <View style={[styles.row, styles.markers, { backgroundColor: colors.surface }]}>
            <AvatarMarker name="Ayşe" avatar={PEOPLE[0].avatar} />
            <AvatarMarker name="Can" avatar={PEOPLE[3].avatar} staleMinutes={12} />
          </View>
          {/* Every activity drawing, moving as on the map (east-bound; the runner west-bound). */}
          <View style={[styles.row, styles.markers, { backgroundColor: colors.surface }]}>
            <AvatarMarker name="Ayşe" avatar={PEOPLE[0].avatar} activity="walking" heading={90} />
            <AvatarMarker name="Bora" avatar={PEOPLE[1].avatar} activity="running" heading={270} />
            <AvatarMarker name="Can" avatar={PEOPLE[2].avatar} activity="cycling" heading={90} />
          </View>
          <View style={[styles.row, styles.markers, { backgroundColor: colors.surface }]}>
            <AvatarMarker name="Deniz" avatar={PEOPLE[3].avatar} activity="driving" heading={90} />
            <AvatarMarker name="Ece" avatar={PEOPLE[0].avatar} activity="settled" />
          </View>
        </Section>

        <Section title="Controls">
          <Pill accessibilityLabel="Pill" onPress={() => undefined}>
            <AvatarStack people={PEOPLE.slice(0, 2)} />
            <Text variant="subhead">Pill</Text>
          </Pill>
          <Toggle value={toggle} onChange={setToggle} label="Toggle" description="Description" />
          <StepSlider
            label={t('sheets.me.precision')}
            value={precision}
            onChange={setPrecision}
            steps={[
              { value: 'exact', label: t('sheets.me.precisionExact') },
              { value: 'neighbourhood', label: t('sheets.me.precisionNeighbourhood') },
              { value: 'city', label: t('sheets.me.precisionCity') },
            ]}
          />
          <TextField label="TextField" value={field} onChangeText={setField} helper="Helper" />
          <TextField label="Error" value="x" error="Error message" />
          <CodeInput label="Code" length={8} value={code} onChange={setCode} />
        </Section>

        <Section title="Loading & empty">
          <View style={styles.row}>
            <Skeleton width={48} height={48} round />
            <View style={styles.skeletonLines}>
              <Skeleton width="80%" height={14} />
              <Skeleton width="50%" height={14} />
            </View>
          </View>
          <EmptyState
            icon={Inbox}
            title="EmptyState"
            body="Body"
            action={{ label: 'Action', onPress: () => undefined }}
          />
        </Section>
      </ScrollView>
      <Sheet ref={sheet} title={t('dev.ui.openSheet')}>
        <Text variant="body">{t('dev.ui.sample')}</Text>
        <Toggle value={toggle} onChange={setToggle} label="Toggle" />
      </Sheet>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text variant="title2" accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.xl, gap: space.xxl },
  section: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap' },
  markers: { justifyContent: 'space-around', padding: space.xl, borderRadius: space.lg },
  skeletonLines: { flex: 1, gap: space.sm },
});
