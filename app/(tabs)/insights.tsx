import { useState } from 'react';
import { StyleSheet, Text, SafeAreaView, View, ScrollView, Pressable, useWindowDimensions } from 'react-native';
import Svg, { Polygon, Polyline, Line, Circle, Text as SvgText } from 'react-native-svg';
import { useHabits, CategoryScore, CategoryScoreHistoryPoint, Habit, HistorySquare, CompletionRate, DayScore, Period, PeriodComparison } from '../HabitsContext';

const GRID_LEVELS = [0.25, 0.5, 0.75, 1.0];
const CHART_ACCENT = '#7c3aed';
const SCORE_ACCENT = '#D97706';

function polarPoint(cx: number, cy: number, radius: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
}

function RadarChart({ data, size }: { data: CategoryScore[]; size: number }) {
  const center = size / 2;
  const labelPadding = 36;
  const maxRadius = center - labelPadding;
  const numAxes = data.length;

  if (numAxes < 3) {
    return (
      <View style={{ padding: 20 }}>
        <Text style={styles.notice}>
          Add habits in at least 3 categories to see the radar chart.
        </Text>
      </View>
    );
  }

  const angleStep = 360 / numAxes;

  const gridPolygons = GRID_LEVELS.map(level =>
    data
      .map((_, i) => {
        const p = polarPoint(center, center, maxRadius * level, i * angleStep);
        return `${p.x},${p.y}`;
      })
      .join(' ')
  );

  const axisLines = data.map((_, i) => polarPoint(center, center, maxRadius, i * angleStep));

  const dataPoints = data
    .map((d, i) => {
      const r = maxRadius * (Math.max(0, Math.min(100, d.score)) / 100);
      const p = polarPoint(center, center, r, i * angleStep);
      return `${p.x},${p.y}`;
    })
    .join(' ');

  const labels = data.map((d, i) => {
    const p = polarPoint(center, center, maxRadius + 20, i * angleStep);
    return { ...p, category: d.category };
  });

  return (
    <Svg width={size} height={size}>
      {gridPolygons.map((points, i) => (
        <Polygon key={i} points={points} fill="none" stroke="#e5e5e5" strokeWidth={1} />
      ))}

      {axisLines.map((p, i) => (
        <Line key={i} x1={center} y1={center} x2={p.x} y2={p.y} stroke="#e5e5e5" strokeWidth={1} />
      ))}

      <Polygon
        points={dataPoints}
        fill={CHART_ACCENT}
        fillOpacity={0.25}
        stroke={CHART_ACCENT}
        strokeWidth={2}
      />

      {data.map((d, i) => {
        const r = maxRadius * (Math.max(0, Math.min(100, d.score)) / 100);
        const p = polarPoint(center, center, r, i * angleStep);
        return <Circle key={i} cx={p.x} cy={p.y} r={4} fill={CHART_ACCENT} />;
      })}

      {labels.map((l, i) => (
        <SvgText key={i} x={l.x} y={l.y} fontSize={12} fontWeight="600" fill="#555" textAnchor="middle">
          {l.category}
        </SvgText>
      ))}
    </Svg>
  );
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function TrendLineChart({
  history,
  categories,
  width,
  height,
}: {
  history: CategoryScoreHistoryPoint[];
  categories: string[];
  width: number;
  height: number;
}) {
  const { getCategoryAccentColor } = useHabits();
  const paddingLeft = 32;
  const paddingRight = 12;
  const paddingTop = 12;
  const paddingBottom = 24;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  if (history.length === 0) {
    return null;
  }

  function xFor(index: number): number {
    return paddingLeft + (index / (history.length - 1)) * chartWidth;
  }

  function yFor(score: number): number {
    const clamped = Math.max(0, Math.min(100, score));
    return paddingTop + (1 - clamped / 100) * chartHeight;
  }

  const gridLevels = [0, 25, 50, 75, 100];

  return (
    <Svg width={width} height={height}>
      {gridLevels.map(level => (
        <Line
          key={level}
          x1={paddingLeft}
          y1={yFor(level)}
          x2={width - paddingRight}
          y2={yFor(level)}
          stroke="#eee"
          strokeWidth={1}
        />
      ))}
      {gridLevels.map(level => (
        <SvgText key={level} x={4} y={yFor(level) + 4} fontSize={10} fill="#999">
          {level}
        </SvgText>
      ))}

      {categories.map(category => {
        const points = history
          .map((point, i) => `${xFor(i)},${yFor(point.scores[category] ?? 50)}`)
          .join(' ');
        return (
          <Polyline
            key={category}
            points={points}
            fill="none"
            stroke={getCategoryAccentColor(category)}
            strokeWidth={3}
          />
        );
      })}

      <SvgText x={paddingLeft} y={height - 4} fontSize={10} fill="#999">
        {formatShortDate(history[0].date)}
      </SvgText>
      <SvgText x={width - paddingRight - 44} y={height - 4} fontSize={10} fill="#999">
        {formatShortDate(history[history.length - 1].date)}
      </SvgText>
    </Svg>
  );
}

type ChartLine = { key: string; color: string; values: number[] };

// Draws any combination of lines on a shared, auto-scaled axis — used for
// both the combined total and per-category series, since they're really
// the same kind of data (a daily points number) just filtered differently.
// Replaces the two separate chart components that used to exist for
// "combined" vs "per-category" — now that both can be shown together,
// duplicating the axis/scaling logic across two components stopped
// making sense.
function PointsTrendChart({
  dates,
  lines,
  width,
  height,
}: {
  dates: string[];
  lines: ChartLine[];
  width: number;
  height: number;
}) {
  const paddingLeft = 32;
  const paddingRight = 12;
  const paddingTop = 12;
  const paddingBottom = 24;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  if (dates.length === 0 || lines.length === 0) {
    return null;
  }

  const maxObserved = Math.max(50, ...lines.flatMap(l => l.values));
  const roundedMax = Math.ceil(maxObserved / 25) * 25;

  function xFor(index: number): number {
    return paddingLeft + (index / (dates.length - 1)) * chartWidth;
  }

  function yFor(value: number): number {
    const clamped = Math.max(0, Math.min(roundedMax, value));
    return paddingTop + (1 - clamped / roundedMax) * chartHeight;
  }

  const gridLevels = [0, roundedMax / 4, roundedMax / 2, (roundedMax * 3) / 4, roundedMax];

  return (
    <Svg width={width} height={height}>
      {gridLevels.map(level => (
        <Line
          key={level}
          x1={paddingLeft}
          y1={yFor(level)}
          x2={width - paddingRight}
          y2={yFor(level)}
          stroke="#eee"
          strokeWidth={1}
        />
      ))}
      {gridLevels.map(level => (
        <SvgText key={level} x={4} y={yFor(level) + 4} fontSize={10} fill="#999">
          {Math.round(level)}
        </SvgText>
      ))}

      {lines.map(line => {
        const points = line.values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ');
        return <Polyline key={line.key} points={points} fill="none" stroke={line.color} strokeWidth={3} />;
      })}

      <SvgText x={paddingLeft} y={height - 4} fontSize={10} fill="#999">
        {formatShortDate(dates[0])}
      </SvgText>
      <SvgText x={width - paddingRight - 44} y={height - 4} fontSize={10} fill="#999">
        {formatShortDate(dates[dates.length - 1])}
      </SvgText>
    </Svg>
  );
}

const COMPARISON_LABELS: Record<Period, string> = {
  day: 'yesterday',
  week: 'last week',
  month: 'last month',
};

function formatComparisonLine(comparison: PeriodComparison): string {
  const diff = comparison.current - comparison.previous;
  const arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '—';
  const diffText = diff === 0 ? 'even' : `${arrow} ${Math.abs(diff)}`;
  return `${diffText} vs ${COMPARISON_LABELS[comparison.period]} · avg ${comparison.average}`;
}

function ScoreCard({
  label,
  value,
  bonus,
  comparison,
}: {
  label: string;
  value: number;
  bonus?: number;
  comparison: PeriodComparison;
}) {
  return (
    <View style={styles.scoreCard}>
      <Text style={styles.scoreCardLabel}>{label}</Text>
      <Text style={styles.scoreCardValue}>{value}</Text>
      {!!bonus && bonus > 0 && <Text style={styles.scoreCardBonus}>+{bonus} bonus</Text>}
      <Text style={styles.scoreCardComparison}>{formatComparisonLine(comparison)}</Text>
    </View>
  );
}

function buildWeekColumns(squares: HistorySquare[]): (HistorySquare | null)[][] {
  if (squares.length === 0) return [];

  const firstDate = new Date(squares[0].date);
  const startDow = firstDate.getDay(); // 0 = Sunday

  const padded: (HistorySquare | null)[] = [];
  for (let i = 0; i < startDow; i++) padded.push(null);
  padded.push(...squares);

  const weeks: (HistorySquare | null)[][] = [];
  for (let i = 0; i < padded.length; i += 7) {
    weeks.push(padded.slice(i, i + 7));
  }
  return weeks;
}

function HabitHeatmap({ habit, squares }: { habit: Habit; squares: HistorySquare[] }) {
  const { getCategoryAccentColor } = useHabits();
  const weeks = buildWeekColumns(squares);
  const accent = getCategoryAccentColor(habit.category);

  if (weeks.length === 0) {
    return <Text style={styles.notice}>No completions logged yet.</Text>;
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={{ flexDirection: 'row', gap: 3 }}>
        {weeks.map((week, wi) => (
          <View key={wi} style={{ gap: 3 }}>
            {week.map((sq, di) => (
              <View
                key={di}
                style={[
                  styles.heatSquare,
                  sq === null
                    ? styles.heatSquareEmpty
                    : sq.done
                    ? { backgroundColor: accent }
                    : styles.heatSquareMiss,
                ]}
              />
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const PERIOD_NOUNS: Record<string, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
};

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count !== 1 ? 's' : ''}`;
}

export default function InsightsScreen() {
  const {
    habits, loaded, today, getCategoryScores, getCategoryScoreHistory,
    getLongestStreak, getHabitHistorySquares, getStreak, getPeriodStreak, getCompletionRate,
    getCategoryColor, getCategoryAccentColor, getDayScore, getScoreComparison,
    getScoreHistory, getPointsHistoryByCategory,
  } = useHabits();
  const { width } = useWindowDimensions();

  // Every chip — "All" and each category — toggles independently, so any
  // combination can be shown together (e.g. the combined total alongside
  // one category, for direct comparison). The only rule: at least one
  // series must stay selected, so clearing the last one falls back to All
  // rather than leaving the chart empty.
  const [selectedSeries, setSelectedSeries] = useState<string[]>(['All']);
  const [chartWindowDays, setChartWindowDays] = useState(90);

  function toggleSeries(key: string) {
    setSelectedSeries(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      return next.length === 0 ? ['All'] : next;
    });
  }

  if (!loaded) return null;

  const categoryScores = getCategoryScores();
  const categories = categoryScores.map(c => c.category);
  const history = getCategoryScoreHistory();

  const includesAll = selectedSeries.includes('All');
  const selectedCategoryNames = selectedSeries.filter(s => s !== 'All');
  // If "All" is among the selected chips, the cards show the true
  // unfiltered total (it's a superset of anything else selected anyway).
  // Otherwise they're scoped to just the chosen categories.
  const cardCategoriesFilter = includesAll ? undefined : selectedCategoryNames;
  const todayScore = getDayScore(today, cardCategoriesFilter);
  const dayComparison = getScoreComparison('day', cardCategoriesFilter);
  const weekComparison = getScoreComparison('week', cardCategoriesFilter);
  const monthComparison = getScoreComparison('month', cardCategoriesFilter);

  const scoreHistory = getScoreHistory(chartWindowDays);
  const categoryPointsHistory = getPointsHistoryByCategory(chartWindowDays);
  const scoreDates = scoreHistory.map(s => s.date);
  const chartLines: ChartLine[] = [
    ...(includesAll
      ? [{ key: 'All', color: SCORE_ACCENT, values: scoreHistory.map(s => s.totalPoints) }]
      : []),
    ...categories
      .filter(category => selectedSeries.includes(category))
      .map(category => ({
        key: category,
        color: getCategoryAccentColor(category),
        values: categoryPointsHistory.map(p => p.scores[category] ?? 0),
      })),
  ];

  const chartSize = Math.min(width - 32, 340);
  const trendWidth = width - 32;

  // "Target streaks" — week/month habits, ranked by consecutive periods
  // met. "Day streaks" — day habits, ranked by consecutive days done.
  // Kept separate rather than merged into one ranking since a 3-week
  // streak and a 3-day streak aren't really comparable numbers.
  const targetStreakHabits = habits
    .filter(h => h.targetPeriod !== 'day')
    .map(h => ({ habit: h, streak: getPeriodStreak(h) }))
    .filter(x => x.streak > 0)
    .sort((a, b) => b.streak - a.streak);

  const dayStreakHabits = habits
    .filter(h => h.targetPeriod === 'day')
    .map(h => ({ habit: h, streak: getStreak(h) }))
    .filter(x => x.streak > 0)
    .sort((a, b) => b.streak - a.streak);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.header}>Insights</Text>

        {categoryScores.length === 0 && (
          <Text style={styles.empty}>No habits yet — add some to see insights here.</Text>
        )}

        {categoryScores.length > 0 && (
          <>
            <Text style={styles.subheader}>Score</Text>

            <View style={styles.categoryToggleRow}>
              <Pressable
                onPress={() => toggleSeries('All')}
                style={[styles.categoryChip, includesAll && styles.categoryChipActiveAll]}
              >
                <Text style={[styles.categoryChipText, includesAll && styles.categoryChipTextActive]}>
                  All
                </Text>
              </Pressable>
              {categories.map(category => {
                const active = selectedSeries.includes(category);
                return (
                  <Pressable
                    key={category}
                    onPress={() => toggleSeries(category)}
                    style={[
                      styles.categoryChip,
                      active && { backgroundColor: getCategoryAccentColor(category) },
                    ]}
                  >
                    <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                      {category}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.scoreCardsRow}>
              <ScoreCard
                label={`Today${!includesAll ? ` · ${selectedCategoryNames.join(', ')}` : ''}`}
                value={todayScore.totalPoints}
                bonus={todayScore.bonusPoints}
                comparison={dayComparison}
              />
              <ScoreCard
                label={`Week${!includesAll ? ` · ${selectedCategoryNames.join(', ')}` : ''}`}
                value={weekComparison.current}
                comparison={weekComparison}
              />
              <ScoreCard
                label={`Month${!includesAll ? ` · ${selectedCategoryNames.join(', ')}` : ''}`}
                value={monthComparison.current}
                comparison={monthComparison}
              />
            </View>

            <View style={styles.chartWindowRow}>
              {[30, 90, 365].map(days => (
                <Pressable
                  key={days}
                  onPress={() => setChartWindowDays(days)}
                  style={[styles.windowChip, chartWindowDays === days && styles.windowChipActive]}
                >
                  <Text
                    style={[
                      styles.windowChipText,
                      chartWindowDays === days && styles.windowChipTextActive,
                    ]}
                  >
                    {days}d
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.chartWrap}>
              <PointsTrendChart dates={scoreDates} lines={chartLines} width={trendWidth} height={160} />
            </View>

            <Text style={[styles.subheader, { marginTop: 24 }]}>Active streaks</Text>
            {targetStreakHabits.length === 0 && dayStreakHabits.length === 0 && (
              <Text style={styles.notice}>No active streaks yet — complete a habit to start one.</Text>
            )}
            {targetStreakHabits.length > 0 && (
              <>
                <Text style={styles.streakGroupLabel}>Target streaks</Text>
                {targetStreakHabits.map(({ habit, streak }) => (
                  <View
                    key={habit.id}
                    style={[styles.row, { backgroundColor: getCategoryColor(habit.category) }]}
                  >
                    <Text style={styles.categoryName}>{habit.name}</Text>
                    <Text style={styles.streakValue}>
                      🔥 {pluralize(streak, PERIOD_NOUNS[habit.targetPeriod])}
                    </Text>
                  </View>
                ))}
              </>
            )}
            {dayStreakHabits.length > 0 && (
              <>
                <Text style={[styles.streakGroupLabel, { marginTop: targetStreakHabits.length > 0 ? 12 : 0 }]}>
                  Day streaks
                </Text>
                {dayStreakHabits.map(({ habit, streak }) => (
                  <View
                    key={habit.id}
                    style={[styles.row, { backgroundColor: getCategoryColor(habit.category) }]}
                  >
                    <Text style={styles.categoryName}>{habit.name}</Text>
                    <Text style={styles.streakValue}>🔥 {pluralize(streak, 'day')}</Text>
                  </View>
                ))}
              </>
            )}

            <Text style={[styles.subheader, { marginTop: 24 }]}>Category momentum (today)</Text>
            <View style={styles.chartWrap}>
              <RadarChart data={categoryScores} size={chartSize} />
            </View>

            {categoryScores.map(({ category, score }) => (
              <View
                key={category}
                style={[styles.row, { backgroundColor: getCategoryColor(category) }]}
              >
                <Text style={styles.categoryName}>{category}</Text>
                <Text style={styles.score}>{score}</Text>
              </View>
            ))}

            <Text style={[styles.subheader, { marginTop: 24 }]}>Trend (last 90 days)</Text>
            <View style={styles.chartWrap}>
              <TrendLineChart
                history={history}
                categories={categories}
                width={trendWidth}
                height={200}
              />
            </View>

            <View style={styles.legend}>
              {categories.map(category => (
                <View key={category} style={styles.legendItem}>
                  <View style={[styles.legendSwatch, { backgroundColor: getCategoryAccentColor(category) }]} />
                  <Text style={styles.legendText}>{category}</Text>
                </View>
              ))}
            </View>

            <Text style={[styles.subheader, { marginTop: 24 }]}>Habit history</Text>
            {habits.map(habit => {
              const squares = getHabitHistorySquares(habit);
              const longest = getLongestStreak(habit);
              const periodStreak = getPeriodStreak(habit);
              const completionRate = getCompletionRate(habit);
              const periodNoun = PERIOD_NOUNS[habit.targetPeriod];

              return (
                <View
                  key={habit.id}
                  style={[styles.habitHistoryCard, { backgroundColor: getCategoryColor(habit.category) }]}
                >
                  <View style={styles.habitHistoryHeader}>
                    <Text style={styles.habitHistoryName}>{habit.name}</Text>
                    <Text style={styles.habitHistoryStreak}>
                      🏆 {longest} day{longest !== 1 ? 's' : ''} best
                    </Text>
                  </View>

                  <View style={styles.statsRow}>
                    <Text style={styles.statText}>
                      🔥 {pluralize(periodStreak, periodNoun)} in a row
                    </Text>
                    {completionRate.total > 0 ? (
                      <Text style={styles.statText}>
                        {completionRate.rate}% of {periodNoun}s met ({completionRate.met}/{completionRate.total})
                      </Text>
                    ) : (
                      <Text style={styles.statText}>Not enough history yet</Text>
                    )}
                  </View>

                  <HabitHeatmap habit={habit} squares={squares} />
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 20 },
  header: { fontSize: 28, fontWeight: 'bold', marginBottom: 4 },
  subheader: { fontSize: 14, color: '#888', marginBottom: 8 },
  empty: { fontSize: 15, color: '#888', marginTop: 20 },
  notice: { fontSize: 14, color: '#888', textAlign: 'center' },
  chartWrap: { alignItems: 'center', marginVertical: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 10,
  },
  categoryName: { fontSize: 17, fontWeight: '600' },
  score: { fontSize: 20, fontWeight: '700', color: '#333' },
  streakGroupLabel: { fontSize: 12, color: '#aaa', fontWeight: '600', marginBottom: 6, textTransform: 'uppercase' },
  streakValue: { fontSize: 14, fontWeight: '700', color: '#333' },
  scoreCardsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  categoryToggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  categoryChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#F2F2F2',
  },
  categoryChipActiveAll: { backgroundColor: SCORE_ACCENT },
  categoryChipText: { fontSize: 13, fontWeight: '600', color: '#666' },
  categoryChipTextActive: { color: '#fff' },
  chartWindowRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  windowChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: '#F2F2F2',
  },
  windowChipActive: { backgroundColor: '#333' },
  windowChipText: { fontSize: 11, fontWeight: '600', color: '#888' },
  windowChipTextActive: { color: '#fff' },
  scoreCard: {
    flex: 1,
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  scoreCardLabel: { fontSize: 11, color: '#92700C', fontWeight: '600', marginBottom: 4 },
  scoreCardValue: { fontSize: 20, fontWeight: '700', color: '#92700C' },
  scoreCardBonus: { fontSize: 10, color: '#B45309', fontWeight: '600', marginTop: 2 },
  scoreCardComparison: { fontSize: 10, color: '#A8895A', marginTop: 4 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 12, height: 12, borderRadius: 3 },
  legendText: { fontSize: 12, color: '#666' },
  habitHistoryCard: {
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  habitHistoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  habitHistoryName: { fontSize: 16, fontWeight: '600' },
  habitHistoryStreak: { fontSize: 13, color: '#555', fontWeight: '600' },
  statsRow: { marginBottom: 8, gap: 2 },
  statText: { fontSize: 12, color: '#666' },
  heatSquare: { width: 11, height: 11, borderRadius: 2 },
  heatSquareEmpty: { backgroundColor: 'transparent' },
  heatSquareMiss: { backgroundColor: 'rgba(0,0,0,0.08)' },
});
