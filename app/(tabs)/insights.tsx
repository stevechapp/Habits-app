import { StyleSheet, Text, SafeAreaView, View, ScrollView, useWindowDimensions } from 'react-native';
import Svg, { Polygon, Line, Circle, Text as SvgText } from 'react-native-svg';
import { useHabits, getCategoryColor, CategoryScore } from '../HabitsContext';

const GRID_LEVELS = [0.25, 0.5, 0.75, 1.0]; // as fraction of max radius
const CHART_ACCENT = '#7c3aed'; // solid line/fill colour for the data shape itself

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

  // Grid rings (concentric polygons, spiderweb style)
  const gridPolygons = GRID_LEVELS.map(level => {
    const points = data
      .map((_, i) => {
        const p = polarPoint(center, center, maxRadius * level, i * angleStep);
        return `${p.x},${p.y}`;
      })
      .join(' ');
    return points;
  });

  // Axis lines from center to edge
  const axisLines = data.map((_, i) => polarPoint(center, center, maxRadius, i * angleStep));

  // The actual data shape
  const dataPoints = data
    .map((d, i) => {
      const r = maxRadius * (Math.max(0, Math.min(100, d.score)) / 100);
      const p = polarPoint(center, center, r, i * angleStep);
      return `${p.x},${p.y}`;
    })
    .join(' ');

  // Label positions, nudged slightly further out than the outer grid ring
  const labels = data.map((d, i) => {
    const p = polarPoint(center, center, maxRadius + 20, i * angleStep);
    return { ...p, category: d.category };
  });

  return (
    <Svg width={size} height={size}>
      {gridPolygons.map((points, i) => (
        <Polygon
          key={i}
          points={points}
          fill="none"
          stroke="#e5e5e5"
          strokeWidth={1}
        />
      ))}

      {axisLines.map((p, i) => (
        <Line
          key={i}
          x1={center}
          y1={center}
          x2={p.x}
          y2={p.y}
          stroke="#e5e5e5"
          strokeWidth={1}
        />
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
        <SvgText
          key={i}
          x={l.x}
          y={l.y}
          fontSize={12}
          fontWeight="600"
          fill="#555"
          textAnchor="middle"
        >
          {l.category}
        </SvgText>
      ))}
    </Svg>
  );
}

export default function InsightsScreen() {
  const { loaded, getCategoryScores } = useHabits();
  const { width } = useWindowDimensions();

  if (!loaded) return null;

  const categoryScores = getCategoryScores();
  const chartSize = Math.min(width - 32, 340);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.header}>Insights</Text>
        <Text style={styles.subheader}>Category momentum (today)</Text>

        {categoryScores.length === 0 && (
          <Text style={styles.empty}>No habits yet — add some to see insights here.</Text>
        )}

        {categoryScores.length > 0 && (
          <View style={styles.chartWrap}>
            <RadarChart data={categoryScores} size={chartSize} />
          </View>
        )}

        {categoryScores.map(({ category, score }) => (
          <View
            key={category}
            style={[styles.row, { backgroundColor: getCategoryColor(category) }]}
          >
            <Text style={styles.categoryName}>{category}</Text>
            <Text style={styles.score}>{score}</Text>
          </View>
        ))}
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
});
