import { StyleSheet, Text, TouchableOpacity, ScrollView, SafeAreaView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useHabits, ScheduleDay } from './HabitsContext';

const PROJECTION_DAYS = 28;

function formatDayHeader(dateStr: string, today: string): string {
  if (dateStr === today) return 'Today';
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatWeekHeader(dateStr: string): string {
  const d = new Date(dateStr);
  return `Week of ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

function isMonday(dateStr: string): boolean {
  return new Date(dateStr).getDay() === 1;
}

export default function ScheduleScreen() {
  const router = useRouter();
  const { loaded, today, getScheduleProjection, getCategoryColor } = useHabits();

  if (!loaded) return null;

  const projection: ScheduleDay[] = getScheduleProjection(PROJECTION_DAYS);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.header}>Schedule</Text>
      </View>

      <Text style={styles.subheader}>
        A projection of what Auto mode would schedule over the next {PROJECTION_DAYS} days,
        assuming each day's picks get done. It's recalculated fresh every time you open this —
        nothing here is locked in.
      </Text>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {projection.map((day, index) => {
          const showWeekHeader = index === 0 || isMonday(day.date);

          return (
            <View key={day.date}>
              {showWeekHeader && (
                <Text style={styles.weekHeader}>
                  {index === 0 ? 'This week' : formatWeekHeader(day.date)}
                </Text>
              )}

              <View style={styles.dayCard}>
                <Text style={styles.dayLabel}>{formatDayHeader(day.date, today)}</Text>

                {day.scheduled.length === 0 ? (
                  <Text style={styles.emptyText}>Nothing scheduled</Text>
                ) : (
                  <View style={styles.chipRow}>
                    {day.scheduled.map(habit => (
                      <View
                        key={habit.id}
                        style={[styles.chip, { backgroundColor: getCategoryColor(habit.category) }]}
                      >
                        <Text style={styles.chipText}>{habit.name}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  backButton: { padding: 4 },
  backArrow: { fontSize: 20, color: '#333' },
  header: { fontSize: 28, fontWeight: 'bold' },
  subheader: { fontSize: 13, color: '#888', marginBottom: 16, lineHeight: 18 },
  scrollContent: { paddingBottom: 40 },
  weekHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
  },
  dayCard: {
    backgroundColor: '#f7f7f7',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  dayLabel: { fontSize: 14, fontWeight: '600', marginBottom: 6 },
  emptyText: { fontSize: 13, color: '#aaa' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipText: { fontSize: 12, color: '#333', fontWeight: '600' },
});
