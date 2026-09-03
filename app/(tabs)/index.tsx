import { StyleSheet, Text, TouchableOpacity, ScrollView, SafeAreaView, View, Switch } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { LinearTransition, FadeIn, FadeOut, Easing } from 'react-native-reanimated';
import { useHabits, PeriodStatus, TimeOfDay } from '../HabitsContext';

function formatDateLabel(dateStr: string, today: string): string {
  if (dateStr === today) return 'Today';

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  if (dateStr === yesterdayStr) return 'Yesterday';

  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

const STATUS_LABELS: Record<PeriodStatus, string> = {
  met: 'Target met',
  onTrack: 'On track',
  dueSoon: 'Due soon',
  behind: 'Behind',
};

const STATUS_COLORS: Record<PeriodStatus, string> = {
  met: '#27ae60',
  onTrack: '#888',
  dueSoon: '#e67e22',
  behind: '#c0392b',
};

const TIME_ORDER: TimeOfDay[] = ['morning', 'afternoon', 'evening'];
const TIME_LABELS: Record<TimeOfDay, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
};

// Short labels for the per-section count steppers — the full labels above
// are a bit wide for a small stacked card, so this trims them further.
const TIME_SHORT_LABELS: Record<TimeOfDay, string> = {
  morning: 'AM',
  afternoon: 'Aft',
  evening: 'Eve',
};

// Shared transition used for reordering. Ease-in-out (slow start, faster
// middle, slow finish) rather than ease-out — a pure ease-out launches at
// full speed immediately, which reads as snappy no matter how gentle the
// landing is. The slow start is what actually sells "floaty."
const REORDER_TRANSITION = LinearTransition
  .duration(1500)
  .easing(Easing.bezier(0.83, 0, 0.17, 1));

export default function HomeScreen() {
  const router = useRouter();
  const {
    habits, loaded, today, selectedDate,
    goToPreviousDay, goToNextDay, goToToday, isViewingToday,
    toggleHabit, getStreak, getPeriodInfo, getCategoryColor,
    viewMode, setViewMode, getOrderedHabits,
    hideCompleted, setHideCompleted, shouldShowHabit,
    swapHabit, addOneMore, getNextCandidate,
    sectionScheduleCounts, setSectionScheduleCount, getSectionDemand,
  } = useHabits();

  if (!loaded) return null;

  const sections = TIME_ORDER
    .map(timeOfDay => {
      const group = habits.filter(h => h.timeOfDay === timeOfDay);
      const ordered = getOrderedHabits(group);
      const visible = ordered.filter(shouldShowHabit);
      // Computed from `ordered` (pre hide-completed filter), not `visible` —
      // otherwise, once hide-completed empties the section, we'd never know
      // it was actually "all done" and the One more? button couldn't appear.
      const allDone = viewMode === 'auto' && ordered.length > 0 && ordered.every(h => h.completions[selectedDate] === true);
      return { timeOfDay, title: TIME_LABELS[timeOfDay], data: visible, allDone };
    })
    .filter(section => section.data.length > 0 || section.allDone);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Habits</Text>

      <View style={styles.dateNav}>
        <TouchableOpacity onPress={goToPreviousDay} style={styles.navButton}>
          <Text style={styles.navArrow}>←</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={goToToday}>
          <Text style={styles.dateLabel}>{formatDateLabel(selectedDate, today)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={goToNextDay}
          disabled={isViewingToday}
          style={styles.navButton}
        >
          <Text style={[styles.navArrow, isViewingToday && styles.navArrowDisabled]}>→</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.controlsRow}>
        <View style={styles.modeToggle}>
          <TouchableOpacity
            style={[styles.modeButton, viewMode === 'static' && styles.modeButtonActive]}
            onPress={() => setViewMode('static')}
          >
            <Text style={[styles.modeButtonText, viewMode === 'static' && styles.modeButtonTextActive]}>
              Static
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, viewMode === 'dynamic' && styles.modeButtonActive]}
            onPress={() => setViewMode('dynamic')}
          >
            <Text style={[styles.modeButtonText, viewMode === 'dynamic' && styles.modeButtonTextActive]}>
              Dynamic
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, viewMode === 'auto' && styles.modeButtonActive]}
            onPress={() => setViewMode('auto')}
          >
            <Text style={[styles.modeButtonText, viewMode === 'auto' && styles.modeButtonTextActive]}>
              Auto
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.hideRow}>
          <Text style={styles.hideLabel}>Hide completed</Text>
          <Switch value={hideCompleted} onValueChange={setHideCompleted} />
        </View>
      </View>

      {viewMode === 'auto' && (
        <>
          <View style={styles.sectionCountsRow}>
            {TIME_ORDER.map(timeOfDay => {
              const count = sectionScheduleCounts[timeOfDay];
              const demand = getSectionDemand(timeOfDay);
              const isOverCapacity = demand > count;

              return (
                <View key={timeOfDay} style={styles.sectionCountCard}>
                  <Text style={styles.sectionCountLabel}>{TIME_SHORT_LABELS[timeOfDay]}</Text>
                  <View style={styles.stepperRow}>
                    <TouchableOpacity
                      style={styles.stepperButton}
                      onPress={() => setSectionScheduleCount(timeOfDay, count - 1)}
                    >
                      <Text style={styles.stepperButtonText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.stepperValue}>{count}</Text>
                    <TouchableOpacity
                      style={styles.stepperButton}
                      onPress={() => setSectionScheduleCount(timeOfDay, count + 1)}
                    >
                      <Text style={styles.stepperButtonText}>+</Text>
                    </TouchableOpacity>
                  </View>
                  {isOverCapacity && (
                    <Text style={styles.capacityWarning}>
                      ⚠ needs ~{demand.toFixed(1)}/day
                    </Text>
                  )}
                </View>
              );
            })}
          </View>

          <TouchableOpacity style={styles.scheduleButton} onPress={() => router.push('/schedule')}>
            <Text style={styles.scheduleButtonText}>📅 View 4-week schedule</Text>
          </TouchableOpacity>
        </>
      )}

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {sections.map(section => {
          const nextCandidate = section.allDone ? getNextCandidate(section.timeOfDay) : null;

          return (
            <View key={section.title}>
              <View style={styles.sectionHeaderWrap}>
                <View style={styles.dividerLine} />
                <Text style={styles.sectionHeaderText}>{section.title}</Text>
                <View style={styles.dividerLine} />
              </View>

              {section.data.map(item => {
              const doneThatDay = item.completions[selectedDate] === true;
              const streak = getStreak(item);
              const periodInfo = getPeriodInfo(item);
              const isDaily = item.targetPeriod === 'day';
              const rowColor = doneThatDay ? '#d9f2d9' : getCategoryColor(item.category);

              return (
                // The Animated.View (not the TouchableOpacity inside it) is what
                // needs the stable `key` and the `layout` prop — Reanimated uses
                // the key to recognize "this is the same row, just moved" across
                // renders, and animates the position change instead of snapping.
                <Animated.View
                  key={item.id}
                  layout={REORDER_TRANSITION}
                  entering={FadeIn}
                  exiting={FadeOut}
                >
                  <View style={[styles.habitRow, { backgroundColor: rowColor }]}>
                    <TouchableOpacity
                      style={styles.habitRowTouchable}
                      onPress={() => toggleHabit(item.id)}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={styles.titleRow}>
                          <Text style={styles.habitText}>{item.name}</Text>
                          <View style={styles.categoryTag}>
                            <Text style={styles.categoryTagText}>{item.category}</Text>
                          </View>
                        </View>

                        <Text style={styles.habitMeta}>
                          {item.targetCount}× per {item.targetPeriod}
                        </Text>

                        {!isDaily && (
                          <>
                            <View style={styles.squaresRow}>
                              {periodInfo.squares.map(sq => (
                                <View
                                  key={sq.date}
                                  style={[styles.square, sq.done ? styles.squareDone : styles.squareEmpty]}
                                />
                              ))}
                            </View>
                            <Text style={[styles.statusText, { color: STATUS_COLORS[periodInfo.status] }]}>
                              {STATUS_LABELS[periodInfo.status]} · {periodInfo.completedCount}/{periodInfo.targetCount}
                            </Text>
                          </>
                        )}

                        {isViewingToday && streak > 0 && (
                          <Text style={styles.streakText}>🔥 {streak} day{streak !== 1 ? 's' : ''}</Text>
                        )}
                      </View>
                      <Text style={styles.checkmark}>{doneThatDay ? '✅' : '⬜️'}</Text>
                    </TouchableOpacity>

                    {viewMode === 'auto' && (
                      <TouchableOpacity
                        style={styles.swapButton}
                        onPress={() => swapHabit(item.id)}
                      >
                        <Text style={styles.swapButtonText}>⇄</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </Animated.View>
              );
            })}

              {nextCandidate && (
                <TouchableOpacity
                  style={styles.oneMoreButton}
                  onPress={() => addOneMore(section.timeOfDay)}
                >
                  <Text style={styles.oneMoreButtonText}>+ One more?</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 20 },
  header: { fontSize: 28, fontWeight: 'bold', marginBottom: 16 },
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    gap: 24,
  },
  navButton: { padding: 8 },
  navArrow: { fontSize: 20, color: '#333' },
  navArrowDisabled: { color: '#ccc' },
  dateLabel: { fontSize: 17, fontWeight: '600', minWidth: 140, textAlign: 'center' },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modeToggle: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    padding: 2,
  },
  modeButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  modeButtonActive: { backgroundColor: '#333' },
  modeButtonText: { fontSize: 13, color: '#666', fontWeight: '600' },
  modeButtonTextActive: { color: '#fff' },
  hideRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hideLabel: { fontSize: 13, color: '#666' },
  sectionCountsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 12,
  },
  sectionCountCard: {
    alignItems: 'center',
    backgroundColor: '#f7f7f7',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    minWidth: 84,
  },
  sectionCountLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepperButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#e5e5e5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonText: { fontSize: 16, fontWeight: '700', color: '#333', lineHeight: 18 },
  stepperValue: { fontSize: 15, fontWeight: '700', color: '#333', minWidth: 18, textAlign: 'center' },
  capacityWarning: {
    fontSize: 10,
    color: '#c0392b',
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
  },
  scrollContent: { paddingBottom: 40 },
  sectionHeaderWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 10,
    gap: 10,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e5e5e5' },
  sectionHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  habitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 10,
  },
  habitRowTouchable: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  swapButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginLeft: 6,
  },
  swapButtonText: { fontSize: 20, color: '#555' },
  scheduleButton: {
    alignSelf: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  scheduleButtonText: { fontSize: 13, color: '#333', fontWeight: '600' },
  oneMoreButton: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: '#ccc',
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 2,
    marginBottom: 10,
  },
  oneMoreButtonText: { fontSize: 13, color: '#666', fontWeight: '600' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  habitText: { fontSize: 18 },
  categoryTag: {
    backgroundColor: 'rgba(0,0,0,0.06)',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  categoryTagText: { fontSize: 11, color: '#555', fontWeight: '600' },
  habitMeta: { fontSize: 13, color: '#888', marginTop: 2, textTransform: 'capitalize' },
  squaresRow: { flexDirection: 'row', gap: 4, marginTop: 6, flexWrap: 'wrap' },
  square: { width: 12, height: 12, borderRadius: 3 },
  squareDone: { backgroundColor: '#27ae60' },
  squareEmpty: { backgroundColor: 'rgba(0,0,0,0.12)' },
  statusText: { fontSize: 12, marginTop: 4, fontWeight: '600' },
  streakText: { fontSize: 13, color: '#e67e22', marginTop: 2 },
  checkmark: { fontSize: 20 },
});
