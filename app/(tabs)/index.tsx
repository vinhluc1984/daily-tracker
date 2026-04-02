import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View, Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import DraggableFlatList, { RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { Image } from 'expo-image';
import { ExternalLink } from '@/components/external-link';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type TimeOfDay = 'Morning' | 'Afternoon' | 'Evening';

interface Task {
  id: string;
  text: string;
  link?: string;
  completed: boolean;
  weeklyCompletedCount: number;
  timeOfDay: TimeOfDay;
}

type ListItem = 
  | (Task & { type: 'task' })
  | { id: string; type: 'header'; title: TimeOfDay };

const STORAGE_KEY = '@daily_tracker_tasks_v5'; // Bumped version for new schema
const LAST_OPENED_KEY = '@daily_tracker_last_opened_v5';
const WEEK_START_KEY = '@daily_tracker_week_start_v5';
const NOTIFICATION_ID_KEY = '@daily_notification_id_v5';

export default function HomeScreen() {
  const [taskText, setTaskText] = useState('');
  const [taskLink, setTaskLink] = useState('');
  const [selectedTimeOfDay, setSelectedTimeOfDay] = useState<TimeOfDay>('Morning');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskText, setEditingTaskText] = useState('');
  const notificationListener = useRef<any>();
  const responseListener = useRef<any>();

  const timeOfDayOptions: TimeOfDay[] = ['Morning', 'Afternoon', 'Evening'];

  const getStartOfWeek = () => {
    const d = new Date();
    const day = d.getDay(); // 0 is Sunday
    const diff = d.getDate() - day;
    const start = new Date(d.setDate(diff));
    start.setHours(0, 0, 0, 0);
    return start.toDateString();
  };

  const getGrade = (count: number) => {
    if (count >= 6) return 'A+';
    if (count >= 5) return 'A';
    if (count === 4) return 'B';
    if (count === 3) return 'C';
    if (count === 2) return 'D';
    return 'F';
  };

  const getGradeColor = (grade: string) => {
    if (grade.startsWith('A')) return '#4CAF50';
    if (grade === 'B') return '#8BC34A';
    if (grade === 'C') return '#FFC107';
    if (grade === 'D') return '#FF9800';
    return '#FF5252';
  };

  // Load tasks on mount
  useEffect(() => {
    registerForPushNotificationsAsync();

    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('Notification received:', notification);
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('Notification response:', response);
    });

    const loadData = async () => {
      try {
        let storedTasks = await AsyncStorage.getItem(STORAGE_KEY);
        
        // Migration logic: recover tasks from v4 if v5 is empty
        if (storedTasks === null) {
          const v4Tasks = await AsyncStorage.getItem('@daily_tracker_tasks_v4');
          if (v4Tasks !== null) {
            storedTasks = v4Tasks;
          }
        }

        const lastOpened = await AsyncStorage.getItem(LAST_OPENED_KEY);
        const storedWeekStart = await AsyncStorage.getItem(WEEK_START_KEY);
        
        const today = new Date().toDateString();
        const currentWeekStart = getStartOfWeek();

        let tasksToSet: Task[] = [];

        if (storedTasks !== null) {
          tasksToSet = JSON.parse(storedTasks);
          
          // Ensure weeklyCompletedCount and timeOfDay exist for migrated tasks
          tasksToSet = tasksToSet.map(t => ({
            ...t,
            weeklyCompletedCount: t.weeklyCompletedCount || 0,
            timeOfDay: t.timeOfDay || 'Morning'
          }));
          
          // Weekly Reset Logic
          if (storedWeekStart !== currentWeekStart) {
            tasksToSet = tasksToSet.map(task => ({
              ...task,
              weeklyCompletedCount: 0,
              completed: false,
            }));
            await AsyncStorage.setItem(WEEK_START_KEY, currentWeekStart);
            await AsyncStorage.setItem(LAST_OPENED_KEY, today);
          } 
          // Daily Reset Logic
          else if (lastOpened !== today) {
            tasksToSet = tasksToSet.map(task => ({ ...task, completed: false }));
            await AsyncStorage.setItem(LAST_OPENED_KEY, today);
          }
        } else {
          await AsyncStorage.setItem(LAST_OPENED_KEY, today);
          await AsyncStorage.setItem(WEEK_START_KEY, currentWeekStart);
        }

        setTasks(tasksToSet);
      } catch (e) {
        console.error('Load failed:', e);
        Alert.alert('Error', 'Failed to load your tasks.');
      } finally {
        setIsLoaded(true);
      }
    };

    loadData();

    return () => {
      Notifications.removeNotificationSubscription(notificationListener.current);
      Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, []);

  // Save tasks
  useEffect(() => {
    if (!isLoaded) return;

    const saveData = async () => {
      try {
        const jsonValue = JSON.stringify(tasks);
        await AsyncStorage.setItem(STORAGE_KEY, jsonValue);
        
        const incompleteTasks = tasks.filter(t => !t.completed);
        if (incompleteTasks.length > 0) {
          await scheduleDailyReminder(incompleteTasks.length);
        } else {
          await Notifications.cancelAllScheduledNotificationsAsync();
        }
      } catch (e) {
        console.error('Save failed:', e);
      }
    };

    saveData();
  }, [tasks, isLoaded]);

  const scheduleDailyReminder = async (count: number) => {
    await Notifications.cancelAllScheduledNotificationsAsync();
    const trigger: any = {
      hour: 12,
      minute: 0,
      repeats: true,
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
    };
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Daily Task Reminder 📝",
        body: `You still have ${count} uncompleted ${count === 1 ? 'task' : 'tasks'} for today.`,
        sound: 'default',
      },
      trigger,
    });
    await AsyncStorage.setItem(NOTIFICATION_ID_KEY, identifier);
  };

  const registerForPushNotificationsAsync = async () => {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
      });
    }
    if (Device.isDevice) {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') return;
    }
  };

  const addTask = () => {
    if (taskText.trim().length === 0) {
      Alert.alert('Wait!', 'Please enter a task description.');
      return;
    }

    let formattedLink = taskLink.trim();
    if (formattedLink && !formattedLink.startsWith('http')) {
      formattedLink = `https://${formattedLink}`;
    }

    const newTask: Task = {
      id: Date.now().toString(),
      text: taskText,
      link: formattedLink || undefined,
      completed: false,
      weeklyCompletedCount: 0,
      timeOfDay: selectedTimeOfDay,
    };

    setTasks(prev => [...prev, newTask]);
    setTaskText('');
    setTaskLink('');
  };

  const removeTask = (id: string) => {
    setTasks(prev => prev.filter((t) => t.id !== id));
  };

  const toggleTask = (id: string) => {
    setTasks(prev =>
      prev.map((t) => {
        if (t.id === id) {
          const isNowCompleted = !t.completed;
          return {
            ...t,
            completed: isNowCompleted,
            weeklyCompletedCount: isNowCompleted 
              ? (t.weeklyCompletedCount || 0) + 1 
              : Math.max(0, (t.weeklyCompletedCount || 0) - 1)
          };
        }
        return t;
      })
    );
  };

  const startEditingTask = (task: Task) => {
    setEditingTaskId(task.id);
    setEditingTaskText(task.text);
  };

  const saveEditedTask = () => {
    if (editingTaskText.trim().length === 0) {
      Alert.alert('Wait!', 'Task description cannot be empty.');
      return;
    }
    setTasks(prev =>
      prev.map((t) => (t.id === editingTaskId ? { ...t, text: editingTaskText } : t))
    );
    setEditingTaskId(null);
    setEditingTaskText('');
  };

  const cancelEditing = () => {
    setEditingTaskId(null);
    setEditingTaskText('');
  };

  const getLinkIcon = (link: string) => {
    const l = link.toLowerCase();
    if (l.includes('youtube.com') || l.includes('youtu.be')) return 'logo-youtube';
    if (l.includes('instagram.com')) return 'logo-instagram';
    return 'link-outline';
  };

  const onDragEnd = (data: ListItem[]) => {
    let currentSection: TimeOfDay = 'Morning';
    const updatedTasks: Task[] = [];

    data.forEach(item => {
      if (item.type === 'header') {
        currentSection = item.title;
      } else {
        updatedTasks.push({
          ...item,
          timeOfDay: currentSection
        });
      }
    });

    setTasks(updatedTasks);
  };

  const renderItem = ({ item, drag, isActive }: RenderItemParams<ListItem>) => {
    if (item.type === 'header') {
      return (
        <View style={styles.sectionContainer}>
          <ThemedText style={styles.sectionHeader}>{item.title}</ThemedText>
        </View>
      );
    }

    const grade = getGrade(item.weeklyCompletedCount);
    return (
      <ScaleDecorator>
        <ThemedView style={[
          styles.taskItem,
          isActive && styles.activeTaskItem
        ]}>
          <TouchableOpacity
            onLongPress={drag}
            delayLongPress={100}
            style={styles.dragHandle}>
            <Ionicons name="reorder-three-outline" size={24} color="#888" />
          </TouchableOpacity>

          {editingTaskId === item.id ? (
            <View style={styles.editingContainer}>
              <TextInput
                style={styles.editInput}
                value={editingTaskText}
                onChangeText={setEditingTaskText}
                autoFocus
                onBlur={saveEditedTask}
                onSubmitEditing={saveEditedTask}
              />
              <View style={styles.editActions}>
                <TouchableOpacity onPress={saveEditedTask}>
                  <Ionicons name="checkmark-circle" size={28} color="#4CAF50" />
                </TouchableOpacity>
                <TouchableOpacity onPress={cancelEditing}>
                  <Ionicons name="close-circle" size={28} color="#FF5252" />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <>
              <View style={styles.taskMainContent}>
                <TouchableOpacity
                  style={styles.taskTextContainer}
                  onPress={() => toggleTask(item.id)}>
                  <Ionicons
                    name={item.completed ? 'checkbox' : 'square-outline'}
                    size={24}
                    color={item.completed ? '#4CAF50' : '#888'}
                  />
                  <View style={styles.textContent}>
                    <ThemedText
                      style={[
                        styles.taskText,
                        item.completed && styles.completedTaskText,
                      ]}>
                      {item.text}
                    </ThemedText>
                    
                    <View style={styles.metaRow}>
                      {item.link && (
                        <ExternalLink href={item.link as any}>
                          <View style={styles.linkBadge}>
                            <Ionicons 
                              name={getLinkIcon(item.link)} 
                              size={12} 
                              color="#2196F3" 
                            />
                            <ThemedText style={styles.linkText} numberOfLines={1}>Ref</ThemedText>
                          </View>
                        </ExternalLink>
                      )}
                      <View style={[styles.gradeBadge, { backgroundColor: getGradeColor(grade) + '20' }]}>
                        <ThemedText style={[styles.gradeText, { color: getGradeColor(grade) }]}>
                          Grade: {grade} ({item.weeklyCompletedCount}/7)
                        </ThemedText>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
                <View style={styles.actionButtons}>
                  <TouchableOpacity onPress={() => startEditingTask(item)} style={styles.iconButton}>
                    <Ionicons name="pencil-outline" size={22} color="#2196F3" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => removeTask(item.id)} style={styles.iconButton}>
                    <Ionicons name="trash-outline" size={22} color="#FF5252" />
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}
        </ThemedView>
      </ScaleDecorator>
    );
  };

  const listData: ListItem[] = [];
  timeOfDayOptions.forEach(time => {
    listData.push({ id: `header-${time}`, type: 'header', title: time });
    const sectionTasks = tasks.filter(t => t.timeOfDay === time);
    sectionTasks.forEach(task => listData.push({ ...task, type: 'task' }));
  });

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={
        <Image
          source={require('@/assets/images/partial-react-logo.png')}
          style={styles.reactLogo}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Daily Tracker</ThemedText>
      </ThemedView>

      <ThemedView style={styles.inputSection}>
        <TextInput
          style={styles.input}
          placeholder="What needs to be done today?"
          placeholderTextColor="#888"
          value={taskText}
          onChangeText={setTaskText}
        />
        <View style={styles.linkInputRow}>
          <TextInput
            style={[styles.input, styles.linkInput]}
            placeholder="Link (e.g. instagram.com/...)"
            placeholderTextColor="#888"
            value={taskLink}
            onChangeText={setTaskLink}
            autoCapitalize="none"
            keyboardType="url"
          />
          <View style={styles.dropdownContainer}>
            <TouchableOpacity 
              style={styles.dropdownButton} 
              onPress={() => setIsDropdownOpen(!isDropdownOpen)}>
              <ThemedText style={styles.dropdownButtonText}>{selectedTimeOfDay}</ThemedText>
              <Ionicons name={isDropdownOpen ? "chevron-up" : "chevron-down"} size={16} color="#2196F3" />
            </TouchableOpacity>
            {isDropdownOpen && (
              <View style={styles.dropdownMenu}>
                {timeOfDayOptions.map((option) => (
                  <TouchableOpacity 
                    key={option} 
                    style={styles.dropdownItem} 
                    onPress={() => {
                      setSelectedTimeOfDay(option);
                      setIsDropdownOpen(false);
                    }}>
                    <ThemedText style={[
                      styles.dropdownItemText,
                      selectedTimeOfDay === option && styles.selectedDropdownItemText
                    ]}>{option}</ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
          <TouchableOpacity style={styles.addButton} onPress={addTask}>
            <Ionicons name="add" size={24} color="white" />
          </TouchableOpacity>
        </View>
      </ThemedView>

      <View style={styles.listContainer}>
        <DraggableFlatList
          data={listData}
          onDragEnd={({ data }) => onDragEnd(data)}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          scrollEnabled={false} // ParallaxScrollView handles scrolling
        />
        {tasks.length === 0 && isLoaded && (
          <ThemedText style={styles.emptyText}>No tasks for today. Add one above!</ThemedText>
        )}
      </View>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  inputSection: {
    marginBottom: 20,
    gap: 10,
  },
  linkInputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  input: {
    height: 50,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    paddingHorizontal: 15,
    fontSize: 16,
    color: '#333',
  },
  linkInput: {
    flex: 1,
  },
  addButton: {
    width: 50,
    height: 50,
    backgroundColor: '#2196F3',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContainer: {
    gap: 12,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 15,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  activeTaskItem: {
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  taskTextContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    gap: 10,
  },
  textContent: {
    flex: 1,
    gap: 2,
  },
  taskText: {
    fontSize: 16,
    fontWeight: '500',
  },
  completedTaskText: {
    textDecorationLine: 'line-through',
    color: '#888',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  linkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(33, 150, 243, 0.1)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  linkText: {
    fontSize: 11,
    color: '#2196F3',
  },
  gradeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  gradeText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 20,
    color: '#888',
    fontStyle: 'italic',
  },
  reactLogo: {
    height: 178,
    width: 290,
    bottom: 0,
    left: 0,
    position: 'absolute',
  },
  editingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 10,
  },
  editInput: {
    flex: 1,
    height: 40,
    backgroundColor: '#fff',
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 16,
    color: '#333',
    borderWidth: 1,
    borderColor: '#2196F3',
  },
  editActions: {
    flexDirection: 'row',
    gap: 5,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  iconButton: {
    padding: 4,
  },
  dragHandle: {
    paddingRight: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  taskMainContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownContainer: {
    zIndex: 1000,
    position: 'relative',
  },
  dropdownButton: {
    height: 50,
    backgroundColor: '#f0f0f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 100,
  },
  dropdownButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2196F3',
  },
  dropdownMenu: {
    position: 'absolute',
    top: 55,
    left: 0,
    right: 0,
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 5,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    zIndex: 1001,
  },
  dropdownItem: {
    padding: 10,
    borderRadius: 8,
  },
  dropdownItemText: {
    fontSize: 14,
    color: '#333',
  },
  selectedDropdownItemText: {
    color: '#2196F3',
    fontWeight: 'bold',
  },
  sectionContainer: {
    marginBottom: 20,
    gap: 8,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2196F3',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  emptySectionText: {
    fontSize: 13,
    color: '#aaa',
    fontStyle: 'italic',
    paddingLeft: 4,
  },
});
