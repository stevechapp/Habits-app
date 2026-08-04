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
};

const STORAGE_KEY = 'habits';
const CURRENT_VERSION = 3;
const DEFAULT_CATEGORY = 'Uncategorized';

const defaultHabits: Habit[] = [
  { id: '1', name: 'Stretch', category: 'Body', timeOfDay: 'morning', targetCount: 1, targetPeriod: 'day', order: 0, completions: {} },
  { id: '2', name: 'Drink water', category: 'Body', timeOfDay: 'afternoon', targetCount: 1, targetPeriod: 'day', order: 0, completions: {} },
  { id: '3', name: 'Read', category: 'Mind', timeOfDay: 'evening', targetCount: 1, targetPeriod: 'day', order: 0, completions: {} },
];

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

export function getCategoryColor(category: string): string {
  if (!category || category === DEFAULT_CATEGORY) return '#F2F2F2';
  let hash = 0;
  for (let i = 0; i < category.length; i++) {
    hash = (hash << 5) - hash + category.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % CATEGORY_PALETTE.length;
  return CATEGORY_PALETTE[index];
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
