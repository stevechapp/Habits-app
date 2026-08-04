import { useState, useMemo, useRef } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, FlatList, SafeAreaView, View } from 'react-native';
import { useHabits, TimeOfDay, Period, getCategoryColor } from '../HabitsContext';

const TIME_OPTIONS: TimeOfDay[] = ['morning', 'afternoon', 'evening'];
const PERIOD_OPTIONS: Period[] = ['day', 'week', 'month'];

function CategoryInput({
  value,
  onChange,
  existingCategories,
}: {
  value: string;
  onChange: (v: string) => void;
  existingCategories: string[];
}) {
  const [focused, setFocused] = useState(false);
  const isSelectingRef = useRef(false);

  const suggestions = useMemo(() => {
    const query = value.trim().toLowerCase();
    return existingCategories.filter(cat => {
      if (query === '') return true;
      return cat.toLowerCase().includes(query) && cat.toLowerCase() !== query;
    });
  }, [value, existingCategories]);

  const showDropdown = focused && suggestions.length > 0;

  function handleBlur() {
    if (isSelectingRef.current) return;
    setFocused(false);
  }

  function handleSelect(cat: string) {
    isSelectingRef.current = true;
    onChange(cat);
    setFocused(false);
  }

  return (
    <View>
      <TextInput
        style={styles.input}
        placeholder="e.g. Mind, Body, Money, Creativity"
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={handleBlur}
      />
      {showDropdown && (
        <View style={styles.dropdown}>
          {suggestions.map(cat => (
            <TouchableOpacity
              key={cat}
              style={styles.dropdownItem}
              onPressIn={() => handleSelect(cat)}
            >
              <Text style={styles.dropdownItemText}>{cat}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

export default function ManageScreen() {
  const { habits, addHabit, deleteHabit, editHabit, moveHabit } = useHabits();

  const existingCategories = useMemo(() => {
    const set = new Set(habits.map(h => h.category).filter(c => c && c !== 'Uncategorized'));
    return Array.from(set).sort();
  }, [habits]);

  const [newHabitName, setNewHabitName] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [newTimeOfDay, setNewTimeOfDay] = useState<TimeOfDay>('morning');
  const [newTargetCount, setNewTargetCount] = useState('1');
  const [newTargetPeriod, setNewTargetPeriod] = useState<Period>('day');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingCategory, setEditingCategory] = useState('');
  const [editingTimeOfDay, setEditingTimeOfDay] = useState<TimeOfDay>('morning');
  const [editingTargetCount, setEditingTargetCount] = useState('1');
  const [editingTargetPeriod, setEditingTargetPeriod] = useState<Period>('day');

  function handleAdd() {
    const count = parseInt(newTargetCount, 10) || 1;
    addHabit(newHabitName, newCategory, newTimeOfDay, count, newTargetPeriod);
    setNewHabitName('');
    setNewCategory('');
    setNewTimeOfDay('morning');
    setNewTargetCount('1');
    setNewTargetPeriod('day');
  }

  function startEditing(habit: typeof habits[number]) {
    setEditingId(habit.id);
    setEditingName(habit.name);
    setEditingCategory(habit.category);
    setEditingTimeOfDay(habit.timeOfDay);
    setEditingTargetCount(String(habit.targetCount));
    setEditingTargetPeriod(habit.targetPeriod);
  }

  function saveEdit() {
    if (editingId) {
      const count = parseInt(editingTargetCount, 10) || 1;
      editHabit(editingId, {
        name: editingName.trim(),
        category: editingCategory.trim() || 'Uncategorized',
        timeOfDay: editingTimeOfDay,
        targetCount: count,
        targetPeriod: editingTargetPeriod,
      });
    }
    setEditingId(null);
  }

  function PickerRow<T extends string>({
    options, value, onChange,
  }: { options: T[]; value: T; onChange: (v: T) => void }) {
    return (
      <View style={styles.pickerRow}>
        {options.map(option => (
          <TouchableOpacity
            key={option}
            style={[styles.pickerOption, value === option && styles.pickerOptionSelected]}
            onPress={() => onChange(option)}
          >
            <Text style={[styles.pickerText, value === option && styles.pickerTextSelected]}>
              {option}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  // Sort for display: group by time-of-day, ordered within each group — matches Today screen ordering.
  const timeOrder: TimeOfDay[] = ['morning', 'afternoon', 'evening'];
  const sortedHabits = [...habits].sort((a, b) => {
    const timeDiff = timeOrder.indexOf(a.timeOfDay) - timeOrder.indexOf(b.timeOfDay);
    if (timeDiff !== 0) return timeDiff;
    return a.order - b.order;
  });

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Manage Habits</Text>

      {!editingId && (
        <View style={styles.addSection}>
          <TextInput
            style={styles.input}
            placeholder="New habit name"
            value={newHabitName}
            onChangeText={setNewHabitName}
          />

          <Text style={styles.label}>Category</Text>
          <CategoryInput
            value={newCategory}
            onChange={setNewCategory}
            existingCategories={existingCategories}
          />

          <Text style={styles.label}>Time of day</Text>
          <PickerRow options={TIME_OPTIONS} value={newTimeOfDay} onChange={setNewTimeOfDay} />

          <Text style={styles.label}>Target</Text>
          <View style={styles.targetRow}>
            <TextInput
              style={styles.countInput}
              value={newTargetCount}
              onChangeText={setNewTargetCount}
              keyboardType="number-pad"
            />
            <Text style={styles.perText}>× per</Text>
            <PickerRow options={PERIOD_OPTIONS} value={newTargetPeriod} onChange={setNewTargetPeriod} />
          </View>

          <TouchableOpacity style={styles.addButton} onPress={handleAdd}>
            <Text style={styles.addButtonText}>Add Habit</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={sortedHabits}
        keyExtractor={item => item.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const isEditing = editingId === item.id;

          if (isEditing) {
            return (
              <View style={styles.editCard}>
                <TextInput
                  style={styles.input}
                  value={editingName}
                  onChangeText={setEditingName}
                  autoFocus
                />
                <Text style={styles.label}>Category</Text>
                <CategoryInput
                  value={editingCategory}
                  onChange={setEditingCategory}
                  existingCategories={existingCategories}
                />
                <Text style={styles.label}>Time of day</Text>
                <PickerRow options={TIME_OPTIONS} value={editingTimeOfDay} onChange={setEditingTimeOfDay} />
                <Text style={styles.label}>Target</Text>
                <View style={styles.targetRow}>
                  <TextInput
                    style={styles.countInput}
                    value={editingTargetCount}
                    onChangeText={setEditingTargetCount}
                    keyboardType="number-pad"
                  />
                  <Text style={styles.perText}>× per</Text>
                  <PickerRow options={PERIOD_OPTIONS} value={editingTargetPeriod} onChange={setEditingTargetPeriod} />
                </View>
                <TouchableOpacity style={styles.addButton} onPress={saveEdit}>
                  <Text style={styles.addButtonText}>Save</Text>
                </TouchableOpacity>
              </View>
            );
          }

          return (
            <View style={[styles.habitRow, { backgroundColor: getCategoryColor(item.category) }]}>
              <View style={styles.reorderColumn}>
                <TouchableOpacity onPress={() => moveHabit(item.id, 'up')} style={styles.reorderButton}>
                  <Text style={styles.reorderArrow}>▲</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => moveHabit(item.id, 'down')} style={styles.reorderButton}>
                  <Text style={styles.reorderArrow}>▼</Text>
                </TouchableOpacity>
              </View>

              <View style={{ flex: 1 }}>
                <View style={styles.titleRow}>
                  <Text style={styles.habitText}>{item.name}</Text>
                  <View style={styles.categoryTag}>
                    <Text style={styles.categoryTagText}>{item.category}</Text>
                  </View>
                </View>
                <Text style={styles.habitMeta}>
                  {item.timeOfDay} · {item.targetCount}× per {item.targetPeriod}
                </Text>
              </View>
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => startEditing(item)}>
                  <Text style={styles.editText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteHabit(item.id)}>
                  <Text style={styles.deleteText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 20 },
  header: { fontSize: 28, fontWeight: 'bold', marginBottom: 20 },
  addSection: { marginBottom: 24, padding: 12, backgroundColor: '#f7f7f7', borderRadius: 12 },
  editCard: { padding: 12, backgroundColor: '#f0f7ff', borderRadius: 12, marginBottom: 10 },
  label: { fontSize: 13, color: '#666', marginTop: 10, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  dropdown: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    backgroundColor: '#fff',
    maxHeight: 150,
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  dropdownItemText: { fontSize: 15, color: '#333' },
  pickerRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pickerOption: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: '#e0e0e0',
  },
  pickerOptionSelected: { backgroundColor: '#333' },
  pickerText: { fontSize: 13, color: '#333' },
  pickerTextSelected: { color: '#fff' },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countInput: {
    width: 50,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingVertical: 8,
    textAlign: 'center',
    backgroundColor: '#fff',
  },
  perText: { fontSize: 14, color: '#666' },
  addButton: {
    backgroundColor: '#333',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 14,
  },
  addButtonText: { color: '#fff', fontWeight: '600' },
  habitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 10,
  },
  reorderColumn: { marginRight: 10, gap: 2 },
  reorderButton: { padding: 4 },
  reorderArrow: { fontSize: 12, color: '#666' },
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
  actions: { flexDirection: 'row', gap: 16, marginLeft: 8 },
  editText: { color: '#2980b9', fontWeight: '600' },
  deleteText: { color: '#c0392b', fontWeight: '600' },
});
