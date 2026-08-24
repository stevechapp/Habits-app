import { StyleSheet, Text, SafeAreaView, View, ScrollView, useWindowDimensions } from 'react-native';
import Svg, { Polygon, Polyline, Line, Circle, Text as SvgText } from 'react-native-svg';
import { useHabits, CategoryScore, CategoryScoreHistoryPoint, Habit, HistorySquare, CompletionRate, DayScore } from '../HabitsContext';

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

// Same padding/grid conventions as TrendLineChart, but a single line
// instead of one-per-category, and a y-axis that auto-scales to the data
// (points totals aren't bounded to 0-100 like momentum scores are).
function ScoreTrendChart({ history, width, height }: { history: DayScore[]; width: number; height: number }) {
  const paddingLeft = 32;
  const paddingRight = 12;
  const paddingTop = 12;
  const paddingBottom = 24;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  if (history.length === 0) {
    return null;
  }

  // Floor of 50 keeps the chart from looking broken when everything's still
  // at 0 (e.g. right after adding the feature), rounded up to a clean
  // multiple of 25 so the gridlines land on tidy numbers.
  const maxObserved = Math.max(50, ...history.map(h => h.totalPoints));
  const roundedMax = Math.ceil(maxObserved / 25) * 25;

  function xFor(index: number): number {
    return paddingLeft + (index / (history.length - 1)) * chartWidth;
  }

  function yFor(value: number): number {
    const clamped = Math.max(0, Math.min(roundedMax, value));
    return paddingTop + (1 - clamped / roundedMax) * chartHeight;
  }

  const gridLevels = [0, roundedMax / 4, roundedMax / 2, (roundedMax * 3) / 4, roundedMax];

  const points = history.map((h, i) => `${xFor(i)},${yFor(h.totalPoints)}`).join(' ');

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

      <Polyline points={points} fill="none" stroke={SCORE_ACCENT} strokeWidth={3} />

      <SvgText x={paddingLeft} y={height - 4} fontSize={10} fill="#999">
        {formatShortDate(history[0].date)}
      </SvgText>
      <SvgText x={width - paddingRight - 44} y={height - 4} fontSize={10} fill="#999">
        {formatShortDate(history[history.length - 1].date)}
      </SvgText>
    </Svg>
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
    getLongestStreak, getHabitHistorySquares, getPeriodStreak, getCompletionRate,
    getCategoryColor, getCategoryAccentColor, getDayScore, getWeekScore, getScoreHistory,
  } = useHabits();
  const { width } = useWindowDimensions();

  if (!loaded) return null;

  const categoryScores = getCategoryScores();
  const categories = categoryScores.map(c => c.category);
  const history = getCategoryScoreHistory();
  const todayScore = getDayScore(today);
  const weekScore = getWeekScore();
  const scoreHistory = getScoreHistory();
  const chartSize = Math.min(width - 32, 340);
  const trendWidth = width - 32;

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
            <View style={styles.scoreCardsRow}>
              <View style={styles.scoreCard}>
                <Text style={styles.scoreCardLabel}>Today</Text>
                <Text style={styles.scoreCardValue}>{todayScore.totalPoints}</Text>
                {todayScore.bonusPoints > 0 && (
                  <Text style={styles.scoreCardBonus}>+{todayScore.bonusPoints} bonus</Text>
                )}
              </View>
              <View style={styles.scoreCard}>
                <Text style={styles.scoreCardLabel}>This week</Text>
                <Text style={styles.scoreCardValue}>{weekScore}</Text>
              </View>
            </View>
            <View style={styles.chartWrap}>
              <ScoreTrendChart history={scoreHistory} width={trendWidth} height={160} />
            </View>

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
  scoreCardsRow: { flexDirection: 'row', gap: 10, marginBottom: 4 },
  scoreCard: {
    flex: 1,
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  scoreCardLabel: { fontSize: 12, color: '#92700C', fontWeight: '600', marginBottom: 4 },
  scoreCardValue: { fontSize: 24, fontWeight: '700', color: '#92700C' },
  scoreCardBonus: { fontSize: 11, color: '#B45309', fontWeight: '600', marginTop: 2 },
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
