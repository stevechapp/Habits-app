import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening';
export type Period = 'day' | 'week' | 'month';
export type PeriodStatus = 'met' | 'onTrack' | 'dueSoon' | 'behind';
export type ViewMode = 'static' | 'dynamic' | 'auto';

export type Habit = {
  id: string;
  name: string;
  category: string;
  timeOfDay: TimeOfDay;
  targetCount: number;
  targetPeriod: Period;
  order: number;
  pointValue: number;
  completions: Record<string, boolean>; // date string -> done
};

export type PeriodInfo = {
  status: PeriodStatus;
  completedCount: number;
  targetCount: number;
  squares: { date: string; done: boolean }[];
};

// --- Insights types -----------------------------------------------------
export type CategoryScore = { category: string; score: number };
export type CategoryScoreHistoryPoint = { date: string; scores: Record<string, number> };
export type HistorySquare = { date: string; done: boolean };
export type CompletionRate = { met: number; total: number; rate: number };
export type DayScore = { date: string; basePoints: number; bonusPoints: number; totalPoints: number };
export type PeriodComparison = { period: Period; current: number; previous: number; average: number };
export type ScheduleDay = { date: string; scheduled: Habit[] };

type StoredData = {
  version: number;
  habits: Habit[];
};

// Display preferences are intentionally stored separately from habit data.
// They don't affect the shape of a Habit, so they don't need to participate
// in the CURRENT_VERSION / migrateHabits pipeline at all.
type StoredSettings = {
  viewMode: ViewMode;
  hideCompleted: boolean;
};

// A DaySnapshot is computed once, the first time a given date is viewed,
// and then frozen — it is never recalculated for that date again, even if
// completions for that date change afterwards. This is what makes dynamic
// order "set once per day": today's neglect ranking reflects the state of
// the world when today started (or first got viewed), and checking things
// off today can only ever influence tomorrow's snapshot, not today's.
type DaySnapshot = {
  orderedIds: string[]; // habit ids, most-neglected first, as of snapshot time
  completedAtSnapshot: string[]; // habit ids already done as of snapshot time
  scheduledIds: string[]; // habit ids Auto mode picked for this date, capped per section
};
type DaySnapshots = Record<string, DaySnapshot>; // date string -> snapshot

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
  addHabit: (name: string, category: string, timeOfDay: TimeOfDay, targetCount: number, targetPeriod: Period, pointValue?: number) => void;
  deleteHabit: (id: string) => void;
  editHabit: (id: string, updates: Partial<Omit<Habit, 'id' | 'completions' | 'order'>>) => void;
  moveHabit: (id: string, direction: 'up' | 'down') => void;
  getStreak: (habit: Habit) => number;
  getPeriodInfo: (habit: Habit) => PeriodInfo;
  // Category colour (creation-order based, needs full habit list)
  getCategoryColor: (category: string) => string;
  getCategoryAccentColor: (category: string) => string;
  // Insights / momentum
  getCategoryScores: () => CategoryScore[];
  getCategoryScoreHistory: () => CategoryScoreHistoryPoint[];
  getLongestStreak: (habit: Habit) => number;
  getHabitHistorySquares: (habit: Habit) => HistorySquare[];
  getPeriodStreak: (habit: Habit) => number;
  getCompletionRate: (habit: Habit) => CompletionRate;
  // Points / scoring
  getDayScore: (dateStr: string, categories?: string[]) => DayScore;
  getWeekScore: (categories?: string[]) => number;
  getMonthScore: (categories?: string[]) => number;
  getScoreComparison: (period: Period, categories?: string[]) => PeriodComparison;
  getScoreHistory: (days?: number) => DayScore[];
  getPointsHistoryByCategory: (days?: number) => CategoryScoreHistoryPoint[];
  // View mode / neglect-sorting
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  getOrderedHabits: (habitsInGroup: Habit[]) => Habit[];
  // Hide-completed
  hideCompleted: boolean;
  setHideCompleted: (hide: boolean) => void;
  shouldShowHabit: (habit: Habit) => boolean;
  swapHabit: (id: string) => void;
  getScheduleProjection: (days?: number) => ScheduleDay[];
};

const STORAGE_KEY = 'habits';
const SETTINGS_KEY = 'habitSettings';
const DAY_SNAPSHOTS_KEY = 'habitDaySnapshots';
const CURRENT_VERSION = 4;
const DEFAULT_CATEGORY = 'Uncategorized';
const DEFAULT_POINT_VALUE = 10;
const PERIOD_STREAK_BONUS = 15; // flat bonus every PERIOD_STREAK_THRESHOLD-th consecutive met period
const PERIOD_STREAK_THRESHOLD = 3;
const COMPARISON_LOOKBACK = 5; // how many prior completed periods the "average" comparison covers

const defaultHabits: Habit[] = [
  { id: '1', name: 'Stretch', category: 'Body', timeOfDay: 'morning', targetCount: 1, targetPeriod: 'day', order: 0, pointValue: DEFAULT_POINT_VALUE, completions: {} },
  { id: '2', name: 'Drink water', category: 'Body', timeOfDay: 'afternoon', targetCount: 1, targetPeriod: 'day', order: 0, pointValue: DEFAULT_POINT_VALUE, completions: {} },
  { id: '3', name: 'Read', category: 'Mind', timeOfDay: 'evening', targetCount: 1, targetPeriod: 'day', order: 0, pointValue: DEFAULT_POINT_VALUE, completions: {} },
];

const defaultSettings: StoredSettings = {
  viewMode: 'static',
  hideCompleted: false,
};

// Ranks PeriodStatus from most to least neglected. Used for dynamic sort order
// and as the raw ingredient for the momentum score below.
const STATUS_PRIORITY: Record<PeriodStatus, number> = {
  behind: 0,
  dueSoon: 1,
  onTrack: 2,
  met: 3,
};

// Soft, low-saturation palette — subtle enough not to clash with the done/not-done row tint.
const CATEGORY_PALETTE = [
  '#F3E8FF', // lavender
  '#E0F2FE', // sky
  '#DCFCE7', // mint
  '#FEF3C7', // cream
  '#FCE7F3', // blush
  '#E7E5E4', // stone
  '#FFEDD5', // peach
  '#E0E7FF', // periwinkle
];

// More saturated pairing of the same hues, for chart lines / heatmap "done" cells,
// where the pastel row-background colour would be too washed out to read.
const CATEGORY_ACCENT_PALETTE = [
  '#8B5CF6', // violet
  '#0EA5E9', // sky
  '#22C55E', // green
  '#F59E0B', // amber
  '#EC4899', // pink
  '#78716C', // stone
  '#F97316', // orange
  '#6366F1', // indigo
];

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

// Upgrades any old stored shape into the current Habit shape.
function migrateHabits(oldHabits: any[]): Habit[] {
  return oldHabits.map((h, index) => ({
    id: h.id,
    name: h.name,
    category: h.category ?? DEFAULT_CATEGORY,
    timeOfDay: h.timeOfDay ?? 'morning',
    targetCount: h.targetCount ?? 1,
    targetPeriod: h.targetPeriod ?? 'day',
    order: h.order ?? index,
    pointValue: h.pointValue ?? DEFAULT_POINT_VALUE,
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

// A habit's urgency for scheduling purposes, evaluated as if it hadn't
// already been completed on dateStr. Without this, a habit that was
// urgent this morning and got done before you even opened the app would
// compute to 'met' and silently never make it onto today's schedule —
// this keeps "was this worth scheduling today" independent of how early
// you got to it.
function calculateStatusIgnoringDate(habit: Habit, dateStr: string): PeriodStatus {
  const habitAsIfNotDone: Habit = {
    ...habit,
    completions: { ...habit.completions, [dateStr]: false },
  };
  return calculatePeriodInfo(habitAsIfNotDone, dateStr).status;
}

// Picks Auto mode's schedule for a date: within each time-of-day section,
// the most urgent habits first (behind, then dueSoon), topped up with the
// next most-neglected on-track habits if there's room, capped at
// MAX_SCHEDULED_PER_SECTION. Habits already 'met' for their period don't
// need scheduling — filtering them out and sorting the rest by
// STATUS_PRIORITY does both the ranking and the "urgent first, fill with
// on-track" behaviour in one pass, since STATUS_PRIORITY already orders
// behind < dueSoon < onTrack.
const MAX_SCHEDULED_PER_SECTION = 3;

function computeScheduledIds(habits: Habit[], dateStr: string): string[] {
  const timeOfDays: TimeOfDay[] = ['morning', 'afternoon', 'evening'];
  const scheduled: string[] = [];

  timeOfDays.forEach(timeOfDay => {
    const group = habits.filter(h => h.timeOfDay === timeOfDay);

    const ranked = group
      .map(h => ({ habit: h, status: calculateStatusIgnoringDate(h, dateStr) }))
      .filter(x => x.status !== 'met')
      .sort((a, b) => {
        const diff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
        if (diff !== 0) return diff;
        return a.habit.order - b.habit.order;
      });

    ranked.slice(0, MAX_SCHEDULED_PER_SECTION).forEach(x => scheduled.push(x.habit.id));
  });

  return scheduled;
}

// Computes the neglect-ranked id list for a date from current habit data.
// Only ever called once per date — see the snapshot effect below.
function computeDaySnapshot(habits: Habit[], dateStr: string): DaySnapshot {
  const ranked = [...habits].sort((a, b) => {
    const statusA = calculatePeriodInfo(a, dateStr).status;
    const statusB = calculatePeriodInfo(b, dateStr).status;
    const diff = STATUS_PRIORITY[statusA] - STATUS_PRIORITY[statusB];
    if (diff !== 0) return diff;
    return a.order - b.order; // stable tiebreak within the same status
  });

  return {
    orderedIds: ranked.map(h => h.id),
    completedAtSnapshot: habits.filter(h => h.completions[dateStr] === true).map(h => h.id),
    scheduledIds: computeScheduledIds(habits, dateStr),
  };
}

// --- Category creation order --------------------------------------------
// Categories are colour-coded in the order they were first used, so a
// category's colour never shifts as new categories get added later. Habit
// ids double as creation timestamps (Date.now() for user-added habits, or
// small hand-assigned numbers for the seeded defaults, which sort first
// either way), so sorting by numeric id gives creation order for free.
function getCategoryCreationOrder(habits: Habit[]): string[] {
  const sorted = [...habits].sort((a, b) => Number(a.id) - Number(b.id));
  const seen: string[] = [];
  for (const h of sorted) {
    if (!seen.includes(h.category)) seen.push(h.category);
  }
  return seen;
}

// --- Momentum / insights engine -----------------------------------------
// NOTE: this is a from-scratch reconstruction of the momentum scoring
// engine after the original implementation was lost to a file mixup. It
// satisfies the same API/shape your screens expect, but the exact numbers
// it produces will likely differ from what you saw before. Flagging this
// so you can sanity-check the Insights tab rather than assume it's
// byte-for-byte identical to the old formula.

const MOMENTUM_WINDOW_DAYS = 14; // how far back momentum looks
const MOMENTUM_DECAY = 0.85; // per-day recency decay; closer to 1 = longer memory

const STATUS_SCORE: Record<PeriodStatus, number> = {
  met: 100,
  onTrack: 70,
  dueSoon: 40,
  behind: 0,
};

// Recency-weighted average of daily period-status over the last
// MOMENTUM_WINDOW_DAYS, ending at dateStr. More recent days count more,
// so a single bad day dents the score without erasing a long good run.
function calculateMomentum(habit: Habit, dateStr: string): number {
  let weightedSum = 0;
  let weightTotal = 0;
  let weight = 1;
  const cursor = new Date(dateStr);

  for (let i = 0; i < MOMENTUM_WINDOW_DAYS; i++) {
    const ds = dateToString(cursor);
    const status = calculatePeriodInfo(habit, ds).status;
    weightedSum += STATUS_SCORE[status] * weight;
    weightTotal += weight;
    weight *= MOMENTUM_DECAY;
    cursor.setDate(cursor.getDate() - 1);
  }

  return weightTotal > 0 ? Math.round(weightedSum / weightTotal) : 0;
}

function countFullPeriodCompletions(habit: Habit, anchorDateStr: string): number {
  const { start, end } = getPeriodBounds(anchorDateStr, habit.targetPeriod);
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const ds = dateToString(cursor);
    if (habit.completions[ds] === true) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

// Returns a date string that falls inside the period immediately before
// the one containing dateStr.
function stepToPreviousPeriod(dateStr: string, period: Period): string {
  const { start } = getPeriodBounds(dateStr, period);
  const prevPeriodAnchor = new Date(start);
  prevPeriodAnchor.setDate(prevPeriodAnchor.getDate() - 1);
  return dateToString(prevPeriodAnchor);
}

// --- Points / scoring engine ---------------------------------------------
// Points are computed live from existing completions/period data, the same
// way momentum and streaks are — nothing new is stored per day, so past
// days' scores never need a snapshot and can't go stale.

// Same "consecutive periods fully met, counting backward from asOfDateStr"
// logic as getPeriodStreak below, but parameterized on an arbitrary date
// instead of always anchoring on `today`, since bonus points need to be
// evaluated as of whatever date a period closed on (which is often in the
// past by the time you look at it).
function calculatePeriodStreakAsOf(habit: Habit, asOfDateStr: string): number {
  if (habit.targetPeriod === 'day') {
    return calculateStreak(habit.completions, asOfDateStr);
  }

  let streak = 0;

  const currentInfo = calculatePeriodInfo(habit, asOfDateStr);
  if (currentInfo.completedCount >= habit.targetCount) {
    streak++;
  }

  let anchor = stepToPreviousPeriod(asOfDateStr, habit.targetPeriod);
  let safety = 0;
  while (safety < 1000) {
    safety++;
    const completed = countFullPeriodCompletions(habit, anchor);
    if (completed < habit.targetCount) break;
    streak++;
    anchor = stepToPreviousPeriod(anchor, habit.targetPeriod);
  }

  return streak;
}

function isPeriodEndDate(habit: Habit, dateStr: string): boolean {
  const { end } = getPeriodBounds(dateStr, habit.targetPeriod);
  return dateToString(end) === dateStr;
}

// Sum of pointValue for every habit completed on this date. This is the
// only piece that fires every day — bonuses below only fire on the date a
// period closes.
function calculateBasePoints(habits: Habit[], dateStr: string): number {
  return habits.reduce(
    (sum, h) => sum + (h.completions[dateStr] === true ? h.pointValue : 0),
    0
  );
}

// Bonus points for a single habit on a single date: a target-met bonus
// plus a period-streak bonus, evaluated only on the date a week/month
// period closes. Daily-target habits are excluded entirely — for those,
// "met" and "completed" are the same event already counted in base
// points, so a bonus here would just double-count it.
function getHabitBonusForDate(habit: Habit, dateStr: string): number {
  if (habit.targetPeriod === 'day') return 0;
  if (!isPeriodEndDate(habit, dateStr)) return 0;

  const info = calculatePeriodInfo(habit, dateStr);
  if (info.status !== 'met') return 0;

  let bonus = habit.pointValue; // target-met bonus, one "extra day's" worth of points

  const streak = calculatePeriodStreakAsOf(habit, dateStr);
  if (streak > 0 && streak % PERIOD_STREAK_THRESHOLD === 0) {
    bonus += PERIOD_STREAK_BONUS;
  }

  return bonus;
}

// Sums total points across any period type — the period containing
// anchorDateStr, whatever its bounds are. Works unmodified for a
// currently-in-progress period (e.g. this week, with days still to come)
// because future dates simply have no completions yet and contribute 0.
function sumPointsForPeriod(scoped: Habit[], anchorDateStr: string, period: Period): number {
  const { start, end } = getPeriodBounds(anchorDateStr, period);
  let total = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    total += calculateDayScore(scoped, dateToString(cursor)).totalPoints;
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

function calculateDayScore(habits: Habit[], dateStr: string): DayScore {
  const basePoints = calculateBasePoints(habits, dateStr);
  const bonusPoints = habits.reduce((sum, h) => sum + getHabitBonusForDate(h, dateStr), 0);
  return { date: dateStr, basePoints, bonusPoints, totalPoints: basePoints + bonusPoints };
}

const HabitsContext = createContext<HabitsContextType | undefined>(undefined);

export function HabitsProvider({ children }: { children: ReactNode }) {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loaded, setLoaded] = useState(false);
  const today = getTodayString();
  const [selectedDate, setSelectedDate] = useState(today);

  const [viewMode, setViewModeState] = useState<ViewMode>(defaultSettings.viewMode);
  const [hideCompleted, setHideCompletedState] = useState<boolean>(defaultSettings.hideCompleted);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [daySnapshots, setDaySnapshots] = useState<DaySnapshots>({});
  const [daySnapshotsLoaded, setDaySnapshotsLoaded] = useState(false);

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

  useEffect(() => {
    async function loadSettings() {
      const stored = await AsyncStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<StoredSettings>;
        setViewModeState(parsed.viewMode ?? defaultSettings.viewMode);
        setHideCompletedState(parsed.hideCompleted ?? defaultSettings.hideCompleted);
      }
      setSettingsLoaded(true);
    }
    loadSettings();
  }, []);

  useEffect(() => {
    if (settingsLoaded) {
      const data: StoredSettings = { viewMode, hideCompleted };
      AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    }
  }, [viewMode, hideCompleted]);

  useEffect(() => {
    async function loadDaySnapshots() {
      const stored = await AsyncStorage.getItem(DAY_SNAPSHOTS_KEY);
      if (stored) {
        setDaySnapshots(JSON.parse(stored));
      }
      setDaySnapshotsLoaded(true);
    }
    loadDaySnapshots();
  }, []);

  useEffect(() => {
    if (daySnapshotsLoaded) {
      AsyncStorage.setItem(DAY_SNAPSHOTS_KEY, JSON.stringify(daySnapshots));
    }
  }, [daySnapshots]);

  // Takes the snapshot for selectedDate the first time it's encountered,
  // then never again — this is the "set once per day" rule. Checking
  // habits off after the snapshot exists has no effect on it; it can only
  // shape the snapshot for a date that hasn't been taken yet (e.g.
  // tomorrow, once tomorrow arrives and gets its own first-visit snapshot).
  //
  // Also backfills scheduledIds onto any snapshot that predates Auto mode
  // (loaded from storage without that field) — this only fills in the new
  // field; orderedIds and completedAtSnapshot stay exactly as originally
  // frozen, so this isn't a re-snapshot, just closing a data-shape gap.
  useEffect(() => {
    if (!loaded || !daySnapshotsLoaded) return;

    const existing = daySnapshots[selectedDate];

    if (!existing) {
      const snapshot = computeDaySnapshot(habits, selectedDate);
      setDaySnapshots(prev => ({ ...prev, [selectedDate]: snapshot }));
      return;
    }

    if (!existing.scheduledIds) {
      const scheduledIds = computeScheduledIds(habits, selectedDate);
      setDaySnapshots(prev => ({ ...prev, [selectedDate]: { ...existing, scheduledIds } }));
    }
  }, [loaded, daySnapshotsLoaded, selectedDate, habits, daySnapshots]);

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

  function addHabit(name: string, category: string, timeOfDay: TimeOfDay, targetCount: number, targetPeriod: Period, pointValue: number = DEFAULT_POINT_VALUE) {
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
      pointValue,
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

  // Swaps order values with the neighboring habit within the same time-of-day group.
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

  function getCategoryColor(category: string): string {
    if (!category || category === DEFAULT_CATEGORY) return '#F2F2F2';
    const order = getCategoryCreationOrder(habits);
    const index = order.indexOf(category);
    const safeIndex = index === -1 ? order.length : index;
    return CATEGORY_PALETTE[safeIndex % CATEGORY_PALETTE.length];
  }

  function getCategoryAccentColor(category: string): string {
    if (!category || category === DEFAULT_CATEGORY) return '#A8A29E';
    const order = getCategoryCreationOrder(habits);
    const index = order.indexOf(category);
    const safeIndex = index === -1 ? order.length : index;
    return CATEGORY_ACCENT_PALETTE[safeIndex % CATEGORY_ACCENT_PALETTE.length];
  }

  // Today's momentum score per category (average of that category's habits).
  function getCategoryScores(): CategoryScore[] {
    const order = getCategoryCreationOrder(habits);
    return order.map(category => {
      const inCategory = habits.filter(h => h.category === category);
      if (inCategory.length === 0) return { category, score: 0 };
      const avg = inCategory.reduce((sum, h) => sum + calculateMomentum(h, today), 0) / inCategory.length;
      return { category, score: Math.round(avg) };
    });
  }

  // Last 90 days of category momentum, for the trend line chart.
  function getCategoryScoreHistory(): CategoryScoreHistoryPoint[] {
    const TREND_DAYS = 90;
    const categories = getCategoryCreationOrder(habits);
    const points: CategoryScoreHistoryPoint[] = [];

    const cursor = new Date(today);
    cursor.setDate(cursor.getDate() - (TREND_DAYS - 1));

    for (let i = 0; i < TREND_DAYS; i++) {
      const ds = dateToString(cursor);
      const scores: Record<string, number> = {};

      categories.forEach(category => {
        const inCategory = habits.filter(h => h.category === category);
        const avg = inCategory.length > 0
          ? inCategory.reduce((sum, h) => sum + calculateMomentum(h, ds), 0) / inCategory.length
          : 0;
        scores[category] = Math.round(avg);
      });

      points.push({ date: ds, scores });
      cursor.setDate(cursor.getDate() + 1);
    }

    return points;
  }

  // Longest consecutive-day streak this habit has ever had, across its whole history.
  function getLongestStreak(habit: Habit): number {
    const doneDates = Object.keys(habit.completions)
      .filter(d => habit.completions[d] === true)
      .sort();

    if (doneDates.length === 0) return 0;

    let longest = 1;
    let current = 1;
    for (let i = 1; i < doneDates.length; i++) {
      const prev = new Date(doneDates[i - 1]);
      const curr = new Date(doneDates[i]);
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);
      current = diffDays === 1 ? current + 1 : 1;
      longest = Math.max(longest, current);
    }
    return longest;
  }

  // Full done/not-done history for the heatmap, from the earliest completion
  // (or 90 days back if there's no history yet) through today.
  function getHabitHistorySquares(habit: Habit): HistorySquare[] {
    const doneDates = Object.keys(habit.completions).filter(d => habit.completions[d] === true).sort();

    let startDateStr: string;
    if (doneDates.length > 0) {
      startDateStr = doneDates[0];
    } else {
      const d = new Date(today);
      d.setDate(d.getDate() - 90);
      startDateStr = dateToString(d);
    }

    const squares: HistorySquare[] = [];
    const cursor = new Date(startDateStr);
    const end = new Date(today);
    while (cursor <= end) {
      const ds = dateToString(cursor);
      squares.push({ date: ds, done: habit.completions[ds] === true });
      cursor.setDate(cursor.getDate() + 1);
    }
    return squares;
  }

  // Consecutive periods (in the habit's own unit — day/week/month) that
  // fully met the target, counting backward from the current one.
  function getPeriodStreak(habit: Habit): number {
    return calculatePeriodStreakAsOf(habit, today);
  }

  function getDayScore(dateStr: string, categories?: string[]): DayScore {
    const scoped = categories ? habits.filter(h => categories.includes(h.category)) : habits;
    return calculateDayScore(scoped, dateStr);
  }

  // Sum of daily totals from this calendar week's Monday through today —
  // same "calendar-aligned week" definition used everywhere else (period
  // status, momentum), so it lines up with what the rest of the app means
  // by "this week." Optional categories filter scopes it to a subset of
  // habits, same convention as getDayScore.
  function getWeekScore(categories?: string[]): number {
    const scoped = categories ? habits.filter(h => categories.includes(h.category)) : habits;
    return sumPointsForPeriod(scoped, today, 'week');
  }

  // Same idea as getWeekScore, but for the calendar month to date.
  function getMonthScore(categories?: string[]): number {
    const scoped = categories ? habits.filter(h => categories.includes(h.category)) : habits;
    return sumPointsForPeriod(scoped, today, 'month');
  }

  // Compares the current (possibly in-progress) day/week/month total
  // against the immediately preceding period, and against the average of
  // the COMPARISON_LOOKBACK completed periods before that — e.g. "today
  // vs yesterday, and vs your average day over the last 5." The average
  // deliberately starts from the previous period, not the current one, so
  // an in-progress period's partial total is never averaged in alongside
  // completed ones.
  function getScoreComparison(period: Period, categories?: string[]): PeriodComparison {
    const scoped = categories ? habits.filter(h => categories.includes(h.category)) : habits;

    const current = sumPointsForPeriod(scoped, today, period);

    let anchor = stepToPreviousPeriod(today, period);
    const previous = sumPointsForPeriod(scoped, anchor, period);

    let total = 0;
    for (let i = 0; i < COMPARISON_LOOKBACK; i++) {
      total += sumPointsForPeriod(scoped, anchor, period);
      anchor = stepToPreviousPeriod(anchor, period);
    }
    const average = Math.round(total / COMPARISON_LOOKBACK);

    return { period, current, previous, average };
  }

  // Daily score series for the trend chart, same shape/window convention
  // as getCategoryScoreHistory (defaults to the last 90 days, ending today).
  function getScoreHistory(days: number = 90): DayScore[] {
    const points: DayScore[] = [];
    const cursor = new Date(today);
    cursor.setDate(cursor.getDate() - (days - 1));
    for (let i = 0; i < days; i++) {
      const ds = dateToString(cursor);
      points.push(calculateDayScore(habits, ds));
      cursor.setDate(cursor.getDate() + 1);
    }
    return points;
  }

  // Per-category daily point totals, same shape as getCategoryScoreHistory
  // (CategoryScoreHistoryPoint), so the same "history + a list of which
  // categories to draw" chart pattern works for points as for momentum.
  // Each category's total for a day is just that category's habits run
  // through the same calculateDayScore used everywhere else — bonuses are
  // already per-habit, so filtering the habit list first is all this needs.
  function getPointsHistoryByCategory(days: number = 90): CategoryScoreHistoryPoint[] {
    const categories = getCategoryCreationOrder(habits);
    const points: CategoryScoreHistoryPoint[] = [];

    const cursor = new Date(today);
    cursor.setDate(cursor.getDate() - (days - 1));

    for (let i = 0; i < days; i++) {
      const ds = dateToString(cursor);
      const scores: Record<string, number> = {};

      categories.forEach(category => {
        const inCategory = habits.filter(h => h.category === category);
        scores[category] = calculateDayScore(inCategory, ds).totalPoints;
      });

      points.push({ date: ds, scores });
      cursor.setDate(cursor.getDate() + 1);
    }

    return points;
  }

  // Overall completion rate across every fully-elapsed period since the
  // habit's first completion (the current, still-in-progress period is
  // excluded so it can't unfairly count as a miss).
  function getCompletionRate(habit: Habit): CompletionRate {
    const doneDates = Object.keys(habit.completions).filter(d => habit.completions[d] === true).sort();
    if (doneDates.length === 0) {
      return { met: 0, total: 0, rate: 0 };
    }

    const currentPeriodStart = getPeriodBounds(today, habit.targetPeriod).start;

    let anchor = doneDates[0];
    let met = 0;
    let total = 0;
    let safety = 0;

    while (safety < 2000) {
      safety++;
      const { start, end } = getPeriodBounds(anchor, habit.targetPeriod);
      if (start >= currentPeriodStart) break;

      const completed = countFullPeriodCompletions(habit, anchor);
      total++;
      if (completed >= habit.targetCount) met++;

      const next = new Date(end);
      next.setDate(next.getDate() + 1);
      anchor = dateToString(next);
    }

    const rate = total > 0 ? Math.round((met / total) * 100) : 0;
    return { met, total, rate };
  }

  // Auto mode's explicit escape hatch: replaces one scheduled habit with
  // whatever's next in line for urgency in the same section, re-running the
  // exact same ranking computeScheduledIds used, minus everything already
  // on today's schedule. If nothing qualifies, the habit is simply removed
  // — swap becomes "drop," not "replace with something arbitrary." This is
  // the one place today's snapshot is allowed to change after being frozen
  // — a deliberate, explicit override, not an automatic recalculation.
  function swapHabit(id: string) {
    const habit = habits.find(h => h.id === id);
    const snapshot = daySnapshots[selectedDate];
    if (!habit || !snapshot) return;

    const currentScheduled = snapshot.scheduledIds ?? [];

    const group = habits.filter(h => h.timeOfDay === habit.timeOfDay);
    const ranked = group
      .map(h => ({ habit: h, status: calculateStatusIgnoringDate(h, selectedDate) }))
      .filter(x => x.status !== 'met')
      .filter(x => !currentScheduled.includes(x.habit.id))
      .sort((a, b) => {
        const diff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
        if (diff !== 0) return diff;
        return a.habit.order - b.habit.order;
      });

    const replacement = ranked[0]?.habit;

    const newScheduledIds = currentScheduled
      .filter(sid => sid !== id)
      .concat(replacement ? [replacement.id] : []);

    setDaySnapshots(prev => ({
      ...prev,
      [selectedDate]: { ...snapshot, scheduledIds: newScheduledIds },
    }));
  }

  // A read-only, forward-looking projection of what Auto mode would
  // schedule over the coming days — recomputed fresh every call, nothing
  // persisted. To project beyond today, it has to assume *something*
  // about whether today's picks get done, since that changes what's still
  // urgent tomorrow — so it simulates the best case: everything scheduled
  // on a given day is treated as completed for the purpose of computing
  // the *next* day's schedule. That simulation only ever touches a local
  // working copy of completions; the real habits/completions data (and
  // any actual daySnapshots) are never written to.
  function getScheduleProjection(days: number = 28): ScheduleDay[] {
    let simulatedHabits = habits.map(h => ({ ...h, completions: { ...h.completions } }));
    const result: ScheduleDay[] = [];

    const cursor = new Date(today);
    for (let i = 0; i < days; i++) {
      const ds = dateToString(cursor);
      const scheduledIds = computeScheduledIds(simulatedHabits, ds);

      // Return the real (non-simulated) habit objects for display, so
      // names/categories/etc. are never accidentally sourced from the
      // hypothetical completions used internally by the simulation.
      const scheduled = scheduledIds
        .map(id => habits.find(h => h.id === id))
        .filter((h): h is Habit => h !== undefined);

      result.push({ date: ds, scheduled });

      simulatedHabits = simulatedHabits.map(h =>
        scheduledIds.includes(h.id)
          ? { ...h, completions: { ...h.completions, [ds]: true } }
          : h
      );

      cursor.setDate(cursor.getDate() + 1);
    }

    return result;
  }

  function setViewMode(mode: ViewMode) {
    setViewModeState(mode);
  }

  function setHideCompleted(hide: boolean) {
    setHideCompletedState(hide);
  }

  // Sorts (and, in Auto mode, filters) a group of habits already narrowed
  // to one timeOfDay. Static = manual `order`. Dynamic = the frozen
  // per-day neglect ranking from daySnapshots. Auto = that same ranking,
  // but restricted to only the habits daySnapshots picked as today's
  // schedule (see computeScheduledIds) — capped at
  // MAX_SCHEDULED_PER_SECTION per section. All non-static modes fall back
  // to manual `order`, unfiltered, for the brief moment before today's
  // first snapshot has been computed.
  function getOrderedHabits(habitsInGroup: Habit[]): Habit[] {
    if (viewMode === 'static') {
      return [...habitsInGroup].sort((a, b) => a.order - b.order);
    }

    const snapshot = daySnapshots[selectedDate];
    if (!snapshot) {
      return [...habitsInGroup].sort((a, b) => a.order - b.order);
    }

    const pool = viewMode === 'auto'
      ? habitsInGroup.filter(h => (snapshot.scheduledIds ?? []).includes(h.id))
      : habitsInGroup;

    const rank = new Map(snapshot.orderedIds.map((id, index) => [id, index]));
    return [...pool].sort((a, b) => {
      const rankA = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const rankB = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      return a.order - b.order;
    });
  }

  // Whether a habit should currently be visible, given the hide-completed
  // setting. Uses the same frozen per-day snapshot as ordering: a habit
  // only counts as "was completed" for hiding purposes if it was already
  // done at snapshot time, so checking it off today never hides it today.
  function shouldShowHabit(habit: Habit): boolean {
    if (!hideCompleted) return true;
    const snapshot = daySnapshots[selectedDate];
    if (!snapshot) return true;
    return !snapshot.completedAtSnapshot.includes(habit.id);
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
        getCategoryColor,
        getCategoryAccentColor,
        getCategoryScores,
        getCategoryScoreHistory,
        getLongestStreak,
        getHabitHistorySquares,
        getPeriodStreak,
        getCompletionRate,
        getDayScore,
        getWeekScore,
        getMonthScore,
        getScoreComparison,
        getScoreHistory,
        getPointsHistoryByCategory,
        viewMode,
        setViewMode,
        getOrderedHabits,
        hideCompleted,
        setHideCompleted,
        shouldShowHabit,
        swapHabit,
        getScheduleProjection,
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
