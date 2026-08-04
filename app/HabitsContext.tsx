import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';
export type Period = 'day' | 'week' | 'month';
export type PeriodStatus = 'met' | 'onTrack' | 'dueSoon' | 'behind';

export type Habit = {
  id: string;
  name: string;
  category: string;
  timeOfDay: TimeOfDay;
  targetCount: number;
  targetPeriod: Period;
  order: number;
  completions: Record<string, boolean>; // date string -> done
};

export type PeriodInfo = {
  status: PeriodStatus;
  completedCount: number;
  targetCount: number;
  squares: { date: string; done: boolean }[];
};

export type MomentumPoint = { date: string; score: number };
export type CategoryScore = { category: string; score: number };
export type CategoryScoreHistoryPoint = { date: string; scores: Record<string, number> };
export type HistorySquare = { date: string; done: boolean };
export type CompletionRate = { met: number; total: number; rate: number };

type StoredData = {
  version: number;
  habits: Habit[];
};

type HabitsContextType = {
  habits: Habit[];
  loaded: boolean;
  today: string;
  selectedDate: string;
  goToPreviousDay: () => void;
  goToNextDay: () => void;
  goToToday: () => void;
  isViewingToday: boolean;
  toggleHabit: (id: string) => void;
  addHabit: (name: string, category: string, timeOfDay: TimeOfDay, targetCount: number, targetPeriod: Period) => void;
  deleteHabit: (id: string) => void;
  editHabit: (id: string, updates: Partial<Omit<Habit, 'id' | 'completions' | 'order'>>) => void;
  moveHabit: (id: string, direction: 'up' | 'down') => void;
  getStreak: (habit: Habit) => number;
  getPeriodInfo: (habit: Habit) => PeriodInfo;
  getHabitMomentumSeries: (habit: Habit) => MomentumPoint[];
  getCategoryScores: () => CategoryScore[];
  getCategoryScoreHistory: () => CategoryScoreHistoryPoint[];
  getLongestStreak: (habit: Habit) => number;
  getHabitHistorySquares: (habit: Habit) => HistorySquare[];
  getPeriodStreak: (habit: Habit) => number;
  getCompletionRate: (habit: Habit) => CompletionRate;
};

const STORAGE_KEY = 'habits';
const CURRENT_VERSION = 3;
const DEFAULT_CATEGORY = 'Uncategorized';

const MOMENTUM_WINDOW_DAYS = 90;
const MOMENTUM_BASELINE = 50;
const MOMENTUM_GAIN = 10;
const MOMENTUM_DECAY = 2;
const MOMENTUM_MIN = 0;
const MOMENTUM_MAX = 100;

const defaultHabits: Habit[] = [
  { id: '1', name: 'Stretch', category: 'Body', timeOfDay: 'morning', targetCount: 1, targetPeriod: 'day', order: 0, completions: {} },
  { id: '2', name: 'Drink water', category: 'Body', timeOfDay: 'afternoon', targetCount: 1, targetPeriod: 'day', order: 0, completions: {} },
  { id: '3', name: 'Read', category: 'Mind', timeOfDay: 'evening', targetCount: 1, targetPeriod: 'day', order: 0, completions: {} },
];

const CATEGORY_PALETTE = [
  '#F3E8FF', '#E0F2FE', '#DCFCE7', '#FEF3C7',
  '#FCE7F3', '#E7E5E4', '#FFEDD5', '#E0E7FF',
];

// Same hue family as CATEGORY_PALETTE, but saturated enough to read as a
// line/stroke on a white background (the pastel palette is too faint for that).
const CATEGORY_ACCENT_PALETTE = [
  '#a855f7', '#0ea5e9', '#22c55e', '#eab308',
  '#ec4899', '#78716c', '#f97316', '#6366f1',
];

function categoryPaletteIndex(category: string): number {
  if (!category) return 0;
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = (hash << 5) - hash + category.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % CATEGORY_PALETTE.length;
}

export function getCategoryColor(category: string): string {
  if (!category || category === DEFAULT_CATEGORY) return '#F2F2F2';
  return CATEGORY_PALETTE[categoryPaletteIndex(category)];
}

export function getCategoryAccentColor(category: string): string {
  if (!category || category === DEFAULT_CATEGORY) return '#999999';
  return CATEGORY_ACCENT_PALETTE[categoryPaletteIndex(category)];
}

function dateToString(d: Date): string {
  return d.toISOString().split('T')[0];
}

function getTodayString(): string {
  return dateToString(new Date());
}

function calculateStreak(completions: Record<string, boolean>, today: string): number {
  let streak = 0;
  let cursor = new Date(today);

  if (completions[today] !== true) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (true) {
    const dateStr = dateToString(cursor);
    if (completions[dateStr] === true) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

function migrateHabits(oldHabits: any[]): Habit[] {
  return oldHabits.map((h, index) => ({
    id: h.id,
    name: h.name,
    category: h.category ?? DEFAULT_CATEGORY,
    timeOfDay: h.timeOfDay ?? 'morning',
    targetCount: h.targetCount ?? 1,
    targetPeriod: h.targetPeriod ?? 'day',
    order: h.order ?? index,
    completions: h.completions ?? {},
  }));
}

function getPeriodBounds(dateStr: string, period: Period): { start: Date; end: Date } {
  const d = new Date(dateStr);

  if (period === 'day') {
    return { start: new Date(d), end: new Date(d) };
  }

  if (period === 'week') {
    const dayOfWeek = d.getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const start = new Date(d);
    start.setDate(d.getDate() - diffToMonday);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start, end };
  }

  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start, end };
}

function calculatePeriodInfo(habit: Habit, selectedDate: string): PeriodInfo {
  const { start, end } = getPeriodBounds(selectedDate, habit.targetPeriod);
  const selected = new Date(selectedDate);

  const totalDaysInPeriod = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const daysElapsed = Math.round((selected.getTime() - start.getTime()) / 86400000) + 1;

  const squares: { date: string; done: boolean }[] = [];
  let completedCount = 0;

  const cursor = new Date(start);
  for (let i = 0; i < daysElapsed; i++) {
    const dateStr = dateToString(cursor);
    const done = habit.completions[dateStr] === true;
    squares.push({ date: dateStr, done });
    if (done) completedCount++;
    cursor.setDate(cursor.getDate() + 1);
  }

  const daysRemainingAfterSelected = totalDaysInPeriod - daysElapsed;
  const selectedDoneAlready = habit.completions[selectedDate] === true;
  const availableDays = daysRemainingAfterSelected + (selectedDoneAlready ? 0 : 1);
  const remainingNeeded = habit.targetCount - completedCount;

  let status: PeriodStatus;
  if (remainingNeeded <= 0) {
    status = 'met';
  } else if (remainingNeeded > availableDays) {
    status = 'behind';
  } else if (remainingNeeded === availableDays) {
    status = 'dueSoon';
  } else {
    status = 'onTrack';
  }

  return { status, completedCount, targetCount: habit.targetCount, squares };
}

function calculateMomentumSeries(habit: Habit, today: string, windowDays: number): MomentumPoint[] {
  const series: MomentumPoint[] = [];
  const startCursor = new Date(today);
  startCursor.setDate(startCursor.getDate() - (windowDays - 1));

  let score = MOMENTUM_BASELINE;
  const cursor = new Date(startCursor);

  for (let i = 0; i < windowDays; i++) {
    const dateStr = dateToString(cursor);
    const doneThatDay = habit.completions[dateStr] === true;

    if (doneThatDay) {
      score = Math.min(MOMENTUM_MAX, score + MOMENTUM_GAIN);
    } else {
      const info = calculatePeriodInfo(habit, dateStr);
      if (info.status === 'behind') {
        score = Math.max(MOMENTUM_MIN, score - MOMENTUM_DECAY);
      }
    }

    series.push({ date: dateStr, score });
    cursor.setDate(cursor.getDate() + 1);
  }

  return series;
}

function calculateLongestStreak(completions: Record<string, boolean>): number {
  const doneDates = Object.keys(completions)
    .filter(d => completions[d] === true)
    .sort();

  if (doneDates.length === 0) return 0;

  let longest = 1;
  let current = 1;

  for (let i = 1; i < doneDates.length; i++) {
    const prev = new Date(doneDates[i - 1]);
    const curr = new Date(doneDates[i]);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);

    if (diffDays === 1) {
      current++;
    } else if (diffDays > 1) {
      current = 1;
    }
    // diffDays === 0 shouldn't happen (duplicate keys aren't possible in an object)

    longest = Math.max(longest, current);
  }

  return longest;
}

// Builds one square per day from the earliest recorded completion through today.
// If nothing's ever been completed, returns an empty array (nothing to show yet).
function buildHistorySquares(habit: Habit, today: string): HistorySquare[] {
  const doneDates = Object.keys(habit.completions).filter(d => habit.completions[d] === true);
  if (doneDates.length === 0) return [];

  const earliest = doneDates.sort()[0];
  const squares: HistorySquare[] = [];
  const cursor = new Date(earliest);
  const end = new Date(today);

  while (cursor <= end) {
    const dateStr = dateToString(cursor);
    squares.push({ date: dateStr, done: habit.completions[dateStr] === true });
    cursor.setDate(cursor.getDate() + 1);
  }

  return squares;
}

// Consecutive periods (days/weeks/months, depending on habit.targetPeriod) where
// the target was met, counting backward from the current (possibly still-open)
// period. Mirrors the day-streak logic, but at the habit's own period granularity.
function calculatePeriodStreak(habit: Habit, today: string): number {
  let streak = 0;
  const currentInfo = calculatePeriodInfo(habit, today);
  const currentBounds = getPeriodBounds(today, habit.targetPeriod);

  if (currentInfo.status === 'met') {
    streak++;
  }

  let cursor = new Date(currentBounds.start);
  cursor.setDate(cursor.getDate() - 1); // step into the previous period

  let safety = 0;
  while (safety < 1000) {
    safety++;
    const dateStr = dateToString(cursor);
    const info = calculatePeriodInfo(habit, dateStr);
    if (info.status !== 'met') break;

    streak++;
    const bounds = getPeriodBounds(dateStr, habit.targetPeriod);
    cursor = new Date(bounds.start);
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

// % of fully-closed past periods where the target was met, from the earliest
// recorded completion through the most recent period that's actually finished
// (the current, still-in-progress period is excluded — it hasn't had its full
// chance yet).
function calculateCompletionRate(habit: Habit, today: string): CompletionRate {
  const doneDates = Object.keys(habit.completions).filter(d => habit.completions[d] === true);
  if (doneDates.length === 0) return { met: 0, total: 0, rate: 0 };

  const earliest = doneDates.sort()[0];
  const todayDate = new Date(today);

  let cursor = new Date(earliest);
  let met = 0;
  let total = 0;
  let safety = 0;

  while (safety < 2000) {
    safety++;
    const dateStr = dateToString(cursor);
    const bounds = getPeriodBounds(dateStr, habit.targetPeriod);

    if (bounds.end >= todayDate) break; // period isn't fully closed yet — stop here

    const endDateStr = dateToString(bounds.end);
    const info = calculatePeriodInfo(habit, endDateStr);
    total++;
    if (info.status === 'met') met++;

    cursor = new Date(bounds.end);
    cursor.setDate(cursor.getDate() + 1);
  }

  const rate = total > 0 ? Math.round((met / total) * 100) : 0;
  return { met, total, rate };
}

const HabitsContext = createContext<HabitsContextType | undefined>(undefined);

export function HabitsProvider({ children }: { children: ReactNode }) {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const today = getTodayString();
  const [selectedDate, setSelectedDate] = useState(today);

  useEffect(() => {
    async function loadHabits() {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);

      if (!stored) {
        setHabits(defaultHabits);
        setLoaded(true);
        return;
      }

      const parsed = JSON.parse(stored);

      if (Array.isArray(parsed)) {
        setHabits(migrateHabits(parsed));
      } else if (parsed.version === CURRENT_VERSION) {
        setHabits(parsed.habits);
      } else {
        setHabits(migrateHabits(parsed.habits ?? []));
      }

      setLoaded(true);
    }
    loadHabits();
  }, []);

  useEffect(() => {
    if (loaded) {
      const data: StoredData = { version: CURRENT_VERSION, habits };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  }, [habits]);

  function goToPreviousDay() {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(dateToString(d));
  }

  function goToNextDay() {
    if (selectedDate === today) return;
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    setSelectedDate(dateToString(d));
  }

  function goToToday() {
    setSelectedDate(today);
  }

  function toggleHabit(id: string) {
    setHabits(habits.map(habit => {
      if (habit.id !== id) return habit;
      const currentlyDone = habit.completions[selectedDate] === true;
      return {
        ...habit,
        completions: { ...habit.completions, [selectedDate]: !currentlyDone },
      };
    }));
  }

  function addHabit(name: string, category: string, timeOfDay: TimeOfDay, targetCount: number, targetPeriod: Period) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const trimmedCategory = category.trim() || DEFAULT_CATEGORY;
    const maxOrder = habits.reduce((max, h) => Math.max(max, h.order), -1);
    const newHabit: Habit = {
      id: Date.now().toString(),
      name: trimmed,
      category: trimmedCategory,
      timeOfDay,
      targetCount,
      targetPeriod,
      order: maxOrder + 1,
      completions: {},
    };
    setHabits([...habits, newHabit]);
  }

  function deleteHabit(id: string) {
    setHabits(habits.filter(habit => habit.id !== id));
  }

  function editHabit(id: string, updates: Partial<Omit<Habit, 'id' | 'completions' | 'order'>>) {
    setHabits(habits.map(habit =>
      habit.id === id ? { ...habit, ...updates } : habit
    ));
  }

  function moveHabit(id: string, direction: 'up' | 'down') {
    const target = habits.find(h => h.id === id);
    if (!target) return;

    const group = habits
      .filter(h => h.timeOfDay === target.timeOfDay)
      .sort((a, b) => a.order - b.order);

    const index = group.findIndex(h => h.id === id);
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= group.length) return;

    const neighbor = group[swapIndex];

    setHabits(habits.map(h => {
      if (h.id === target.id) return { ...h, order: neighbor.order };
      if (h.id === neighbor.id) return { ...h, order: target.order };
      return h;
    }));
  }

  function getStreak(habit: Habit): number {
    return calculateStreak(habit.completions, today);
  }

  function getPeriodInfo(habit: Habit): PeriodInfo {
    return calculatePeriodInfo(habit, selectedDate);
  }

  function getHabitMomentumSeries(habit: Habit): MomentumPoint[] {
    return calculateMomentumSeries(habit, today, MOMENTUM_WINDOW_DAYS);
  }

  function getLongestStreak(habit: Habit): number {
    return calculateLongestStreak(habit.completions);
  }

  function getHabitHistorySquares(habit: Habit): HistorySquare[] {
    return buildHistorySquares(habit, today);
  }

  function getPeriodStreak(habit: Habit): number {
    return calculatePeriodStreak(habit, today);
  }

  function getCompletionRate(habit: Habit): CompletionRate {
    return calculateCompletionRate(habit, today);
  }

  function getCategoryScores(): CategoryScore[] {
    const categories = Array.from(new Set(habits.map(h => h.category)));
    return categories.map(category => {
      const habitsInCategory = habits.filter(h => h.category === category);
      const latestScores = habitsInCategory.map(h => {
        const series = calculateMomentumSeries(h, today, MOMENTUM_WINDOW_DAYS);
        return series[series.length - 1]?.score ?? MOMENTUM_BASELINE;
      });
      const avg = latestScores.length > 0
        ? latestScores.reduce((sum, s) => sum + s, 0) / latestScores.length
        : MOMENTUM_BASELINE;
      return { category, score: Math.round(avg) };
    });
  }

  function getCategoryScoreHistory(): CategoryScoreHistoryPoint[] {
    const categories = Array.from(new Set(habits.map(h => h.category)));

    const habitSeries = habits.map(h => ({
      category: h.category,
      series: calculateMomentumSeries(h, today, MOMENTUM_WINDOW_DAYS),
    }));

    const history: CategoryScoreHistoryPoint[] = [];

    for (let i = 0; i < MOMENTUM_WINDOW_DAYS; i++) {
      const fallbackDate = new Date(today);
      fallbackDate.setDate(fallbackDate.getDate() - (MOMENTUM_WINDOW_DAYS - 1 - i));
      const date = habitSeries[0]?.series[i]?.date ?? dateToString(fallbackDate);

      const scores: Record<string, number> = {};
      categories.forEach(category => {
        const pointsForCategory = habitSeries
          .filter(hs => hs.category === category)
          .map(hs => hs.series[i]?.score ?? MOMENTUM_BASELINE);
        const avg = pointsForCategory.length > 0
          ? pointsForCategory.reduce((sum, s) => sum + s, 0) / pointsForCategory.length
          : MOMENTUM_BASELINE;
        scores[category] = Math.round(avg);
      });

      history.push({ date, scores });
    }

    return history;
  }

  return (
    <HabitsContext.Provider
      value={{
        habits,
        loaded,
        today,
        selectedDate,
        goToPreviousDay,
        goToNextDay,
        goToToday,
        isViewingToday: selectedDate === today,
        toggleHabit,
        addHabit,
        deleteHabit,
        editHabit,
        moveHabit,
        getStreak,
        getPeriodInfo,
        getHabitMomentumSeries,
        getCategoryScores,
        getCategoryScoreHistory,
        getLongestStreak,
        getHabitHistorySquares,
        getPeriodStreak,
        getCompletionRate,
      }}
    >
      {children}
    </HabitsContext.Provider>
  );
}

export function useHabits() {
  const context = useContext(HabitsContext);
  if (!context) {
    throw new Error('useHabits must be used within a HabitsProvider');
  }
  return context;
}
