import { StyleSheet, Text, TouchableOpacity, SectionList, SafeAreaView, View } from 'react-native';
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

export default function HomeScreen() {
  const {
    habits, loaded, today, selectedDate,
    goToPreviousDay, goToNextDay, goToToday, isViewingToday,
    toggleHabit, getStreak, getPeriodInfo, getCategoryColor,
  } = useHabits();

  if (!loaded) return null;

  const sections = TIME_ORDER
    .map(timeOfDay => ({
      title: TIME_LABELS[timeOfDay],
      data: habits
        .filter(h => h.timeOfDay === timeOfDay)
        .sort((a, b) => a.order - b.order),
    }))
    .filter(section => section.data.length > 0);

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

      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeaderWrap}>
            <View style={styles.dividerLine} />
            <Text style={styles.sectionHeaderText}>{section.title}</Text>
            <View style={styles.dividerLine} />
          </View>
        )}
        renderItem={({ item }) => {
          const doneThatDay = item.completions[selectedDate] === true;
          const streak = getStreak(item);
          const periodInfo = getPeriodInfo(item);
          const isDaily = item.targetPeriod === 'day';
          const rowColor = doneThatDay ? '#d9f2d9' : getCategoryColor(item.category);

          return (
            <TouchableOpacity
              style={[styles.habitRow, { backgroundColor: rowColor }]}
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
          );
        }}
      />
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
    marginBottom: 20,
    gap: 24,
  },
  navButton: { padding: 8 },
  navArrow: { fontSize: 20, color: '#333' },
  navArrowDisabled: { color: '#ccc' },
  dateLabel: { fontSize: 17, fontWeight: '600', minWidth: 140, textAlign: 'center' },
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 10,
  },
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
