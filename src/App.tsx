/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Play, Pause, RotateCcw, CheckCircle2, Circle, Plus, Trash2, 
  BarChart3, Timer as TimerIcon, ListTodo, LogOut, SkipForward,
  AlertCircle, Trophy, Clock, Volume2, VolumeX, Maximize2, Minimize2,
  Flame, Target, Music, Wind, Coffee, CloudRain, Palette, Check,
  Sparkles, BrainCircuit, ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, query, where, onSnapshot, addDoc, updateDoc, 
  deleteDoc, doc, serverTimestamp, orderBy, limit, getDoc, setDoc
} from 'firebase/firestore';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { GoogleGenAI } from "@google/genai";
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area
} from 'recharts';
import { 
  format, isSameDay, subDays, eachDayOfInterval, startOfDay
} from 'date-fns';

import { auth, db, signIn, logOut } from './firebase';
import { cn } from './lib/utils';

// --- Types ---

type Priority = 'low' | 'medium' | 'high';
type TimerMode = 'focus' | 'short_break' | 'long_break';
type SoundType = 'none' | 'rain' | 'forest' | 'cafe';

interface UserSettings {
  themeId: string;
  dailyGoalHours: number;
}

const THEMES = [
  {
    id: 'forest',
    name: 'Emerald Forest',
    bg: 'https://images.unsplash.com/photo-1542273917363-3b1817f69a2d?q=80&w=2074&auto=format&fit=crop',
    color: 'emerald',
    gradient: 'from-emerald-500/10',
    accent: 'text-emerald-500',
    glow: 'rgba(16, 185, 129, 0.3)'
  },
  {
    id: 'ocean',
    name: 'Midnight Ocean',
    bg: 'https://images.unsplash.com/photo-1505118380757-91f5f45d8de4?q=80&w=2052&auto=format&fit=crop',
    color: 'blue',
    gradient: 'from-blue-500/10',
    accent: 'text-blue-500',
    glow: 'rgba(59, 130, 246, 0.3)'
  },
  {
    id: 'cyber',
    name: 'Cyberpunk',
    bg: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2070&auto=format&fit=crop',
    color: 'purple',
    gradient: 'from-purple-500/10',
    accent: 'text-purple-500',
    glow: 'rgba(168, 85, 247, 0.3)'
  },
  {
    id: 'sunset',
    name: 'Desert Sunset',
    bg: 'https://images.unsplash.com/photo-1473580044384-7ba9967e16a0?q=80&w=2070&auto=format&fit=crop',
    color: 'orange',
    gradient: 'from-orange-500/10',
    accent: 'text-orange-500',
    glow: 'rgba(249, 115, 22, 0.3)'
  },
  {
    id: 'minimal',
    name: 'Pure Void',
    bg: '',
    color: 'zinc',
    gradient: 'from-zinc-500/5',
    accent: 'text-zinc-100',
    glow: 'rgba(255, 255, 255, 0.1)'
  }
];

interface Task {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  estimated_pomodoros: number;
  completed: boolean;
  userId: string;
  createdAt: any;
}

interface FocusSession {
  id: string;
  taskId?: string;
  userId: string;
  startTime: any;
  endTime: any;
  durationMinutes: number;
  type: TimerMode;
}

// --- Constants ---

const TIMER_CONFIG = {
  focus: 25 * 60,
  short_break: 5 * 60,
  long_break: 15 * 60,
};

const PRIORITY_COLORS = {
  low: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  medium: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  high: 'text-rose-400 bg-rose-400/10 border-rose-400/20',
};

const AMBIENT_SOUNDS: Record<SoundType, string> = {
  none: '',
  rain: 'https://assets.mixkit.co/sfx/preview/mixkit-rain-on-window-loop-2457.mp3',
  forest: 'https://assets.mixkit.co/sfx/preview/mixkit-forest-birds-and-river-2460.mp3',
  cafe: 'https://assets.mixkit.co/sfx/preview/mixkit-coffee-shop-ambience-2462.mp3',
};

// --- Components ---

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [guestMode, setGuestMode] = useState(() => localStorage.getItem('focus_guest_mode') === 'true');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'timer' | 'tasks' | 'stats' | 'settings'>('timer');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [userSettings, setUserSettings] = useState<UserSettings>({ themeId: 'forest', dailyGoalHours: 4 });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [ambientSound, setAmbientSound] = useState<SoundType>('none');
  const [volume, setVolume] = useState(0.5);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentTheme = THEMES.find(t => t.id === userSettings.themeId) || THEMES[0];

  // AI Assistant
  const ai = useMemo(() => new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' }), []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Fetch user settings
        try {
          const settingsDoc = await getDoc(doc(db, 'users', u.uid));
          if (settingsDoc.exists()) {
            const data = settingsDoc.data() as UserSettings;
            setUserSettings({
              themeId: data.themeId || 'forest',
              dailyGoalHours: data.dailyGoalHours || 4
            });
          } else {
            // Initialize settings
            await setDoc(doc(db, 'users', u.uid), { themeId: 'forest', dailyGoalHours: 4 });
          }
        } catch (e) {
          console.error("Error fetching settings", e);
        }
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const updateTheme = async (themeId: string) => {
    setUserSettings(prev => {
      const newSettings = { ...prev, themeId };
      if (!user) {
        localStorage.setItem('focus_settings', JSON.stringify(newSettings));
      }
      return newSettings;
    });
    
    if (user) {
      try {
        await setDoc(doc(db, 'users', user.uid), { themeId }, { merge: true });
      } catch (e) {
        console.error("Error updating theme", e);
      }
    }
  };

  const updateGoal = async (hours: number) => {
    setUserSettings(prev => {
      const newSettings = { ...prev, dailyGoalHours: hours };
      if (!user) {
        localStorage.setItem('focus_settings', JSON.stringify(newSettings));
      }
      return newSettings;
    });

    if (user) {
      try {
        await setDoc(doc(db, 'users', user.uid), { dailyGoalHours: hours }, { merge: true });
      } catch (e) {
        console.error("Error updating goal", e);
      }
    }
  };

  // Today's Progress Calculation
  const todayMinutes = useMemo(() => {
    return sessions
      .filter(s => isSameDay(s.startTime?.toDate ? s.startTime.toDate() : new Date(s.startTime), new Date()))
      .reduce((acc, s) => acc + s.durationMinutes, 0);
  }, [sessions]);

  const goalProgress = Math.min((todayMinutes / (userSettings.dailyGoalHours * 60)) * 100, 100);

  // Firestore Listeners
  useEffect(() => {
    if (!user && !guestMode) return;

    if (user) {
      const tasksQuery = query(
        collection(db, 'tasks'),
        where('userId', '==', user.uid),
        orderBy('createdAt', 'desc')
      );

      const sessionsQuery = query(
        collection(db, 'focus_sessions'),
        where('userId', '==', user.uid),
        orderBy('startTime', 'desc'),
        limit(500)
      );

      const unsubTasks = onSnapshot(tasksQuery, (snapshot) => {
        setTasks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task)));
      });

      const unsubSessions = onSnapshot(sessionsQuery, (snapshot) => {
        setSessions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as FocusSession)));
      });

      return () => {
        unsubTasks();
        unsubSessions();
      };
    } else {
      // Guest Mode: Load from LocalStorage
      const localTasks = JSON.parse(localStorage.getItem('focus_tasks') || '[]');
      const localSessions = JSON.parse(localStorage.getItem('focus_sessions') || '[]');
      setTasks(localTasks);
      setSessions(localSessions);
      
      // Load settings
      const localSettings = JSON.parse(localStorage.getItem('focus_settings') || '{"themeId":"forest","dailyGoalHours":4}');
      setUserSettings(localSettings);
    }
  }, [user, guestMode]);

  // Ambient Sound Control
  useEffect(() => {
    if (audioRef.current) {
      if (ambientSound !== 'none') {
        audioRef.current.src = AMBIENT_SOUNDS[ambientSound];
        audioRef.current.loop = true;
        audioRef.current.volume = volume;
        audioRef.current.play().catch(e => console.log("Audio play blocked", e));
      } else {
        audioRef.current.pause();
      }
    }
  }, [ambientSound]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <div className="w-12 h-12 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user && !guestMode) {
    return <LoginScreen onGuest={() => {
      setGuestMode(true);
      localStorage.setItem('focus_guest_mode', 'true');
    }} />;
  }

  const effectiveUserId = user?.uid || 'guest-user';

  const addSession = async (sessionData: any) => {
    if (user) {
      await addDoc(collection(db, 'focus_sessions'), {
        ...sessionData,
        userId: user.uid,
        createdAt: serverTimestamp()
      });
    } else {
      const newSession = {
        ...sessionData,
        id: Math.random().toString(36).substr(2, 9),
        userId: 'guest-user',
        startTime: { toDate: () => new Date(sessionData.startTime) }, // Mock Firestore timestamp
        createdAt: new Date().toISOString()
      };
      const updated = [newSession, ...sessions];
      setSessions(updated);
      localStorage.setItem('focus_sessions', JSON.stringify(updated));
    }
  };

  const addTaskAction = async (taskData: any) => {
    if (user) {
      await addDoc(collection(db, 'tasks'), {
        ...taskData,
        userId: user.uid,
        createdAt: serverTimestamp()
      });
    } else {
      const newTask = {
        ...taskData,
        id: Math.random().toString(36).substr(2, 9),
        userId: 'guest-user',
        createdAt: new Date().toISOString()
      };
      const updated = [newTask, ...tasks];
      setTasks(updated);
      localStorage.setItem('focus_tasks', JSON.stringify(updated));
    }
  };

  const updateTaskAction = async (taskId: string, updates: any) => {
    if (user) {
      await updateDoc(doc(db, 'tasks', taskId), updates);
    } else {
      const updated = tasks.map(t => t.id === taskId ? { ...t, ...updates } : t);
      setTasks(updated);
      localStorage.setItem('focus_tasks', JSON.stringify(updated));
    }
  };

  const deleteTaskAction = async (taskId: string) => {
    if (user) {
      await deleteDoc(doc(db, 'tasks', taskId));
    } else {
      const updated = tasks.filter(t => t.id !== taskId);
      setTasks(updated);
      localStorage.setItem('focus_tasks', JSON.stringify(updated));
    }
  };

  return (
    <div className={cn(
      "min-h-screen bg-[#050505] text-zinc-100 font-sans selection:bg-emerald-500/30 transition-all duration-700",
      isFullscreen ? "overflow-hidden" : ""
    )}>
      <audio ref={audioRef} />
      
      {/* Immersive Background */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className={cn("absolute inset-0 bg-gradient-to-b via-transparent to-black", currentTheme.gradient)} />
        <div className={cn("absolute top-[-10%] left-[-10%] w-[40%] h-[40%] blur-[120px] rounded-full animate-pulse", 
          currentTheme.id === 'forest' ? 'bg-emerald-500/10' : 
          currentTheme.id === 'ocean' ? 'bg-blue-500/10' : 
          currentTheme.id === 'cyber' ? 'bg-purple-500/10' : 
          currentTheme.id === 'sunset' ? 'bg-orange-500/10' : 'bg-zinc-500/10'
        )} />
        
        {/* Background Image */}
        {currentTheme.bg && (
          <img 
            src={currentTheme.bg} 
            className="absolute inset-0 w-full h-full object-cover opacity-10 mix-blend-overlay transition-opacity duration-1000"
            alt="Background"
            referrerPolicy="no-referrer"
          />
        )}
      </div>

      {/* Navigation */}
      {!isFullscreen && (
        <nav className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="glass rounded-full p-2 flex items-center gap-1 shadow-2xl shadow-black/50"
          >
            <NavButton 
              active={activeTab === 'timer'} 
              onClick={() => setActiveTab('timer')}
              icon={<TimerIcon size={20} />}
              label="Focus"
              theme={currentTheme}
            />
            <NavButton 
              active={activeTab === 'tasks'} 
              onClick={() => setActiveTab('tasks')}
              icon={<ListTodo size={20} />}
              label="Tasks"
              theme={currentTheme}
            />
            <NavButton 
              active={activeTab === 'stats'} 
              onClick={() => setActiveTab('stats')}
              icon={<BarChart3 size={20} />}
              label="Analytics"
              theme={currentTheme}
            />
            <NavButton 
              active={activeTab === 'settings'} 
              onClick={() => setActiveTab('settings')}
              icon={<Palette size={20} />}
              label="Themes"
              theme={currentTheme}
            />
            <div className="w-px h-4 bg-white/10 mx-2" />
            <button 
              onClick={() => {
                if (user) {
                  logOut();
                } else {
                  setGuestMode(false);
                  localStorage.removeItem('focus_guest_mode');
                }
              }}
              className="p-3 rounded-full text-zinc-500 hover:text-rose-400 hover:bg-rose-400/10 transition-all"
            >
              <LogOut size={20} />
            </button>
          </motion.div>
        </nav>
      )}

      {/* Header / Top Bar */}
      {!isFullscreen && (
        <header className="relative z-10 px-8 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shadow-lg transition-colors duration-500", 
              currentTheme.id === 'forest' ? 'bg-emerald-500 shadow-emerald-500/20' : 
              currentTheme.id === 'ocean' ? 'bg-blue-500 shadow-blue-500/20' : 
              currentTheme.id === 'cyber' ? 'bg-purple-500 shadow-purple-500/20' : 
              currentTheme.id === 'sunset' ? 'bg-orange-500 shadow-orange-500/20' : 'bg-zinc-100 shadow-white/20'
            )}>
              <TimerIcon size={24} className="text-black" />
            </div>
            <div>
              <h1 className="font-display font-bold text-lg tracking-tight">Focus To-Do</h1>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Session Engine v2.0</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5">
              <Flame size={16} className={cn(currentTheme.accent)} />
              <span className="text-sm font-bold">{calculateStreak(sessions)} Day Streak</span>
            </div>
            <div className="w-10 h-10 rounded-full border border-white/10 overflow-hidden">
              <img src={user?.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user?.email || 'guest'}`} alt="User" />
            </div>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main className={cn(
        "relative z-10 mx-auto transition-all duration-700",
        isFullscreen ? "max-w-none h-screen flex items-center justify-center" : "max-w-5xl px-8 pt-4 pb-40"
      )}>
        <AnimatePresence mode="wait">
          {activeTab === 'timer' && (
            <motion.div
              key="timer"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className={cn("w-full", isFullscreen ? "h-full flex flex-col items-center justify-center" : "grid grid-cols-1 lg:grid-cols-12 gap-12")}
            >
              {/* Left Column: Timer */}
              <div className={cn(
                "flex flex-col items-center justify-center",
                isFullscreen ? "w-full" : "lg:col-span-7"
              )}>
                <Timer 
                  user={user} 
                  selectedTask={tasks.find(t => t.id === selectedTaskId)} 
                  isFullscreen={isFullscreen}
                  onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
                  theme={currentTheme}
                  onComplete={addSession}
                />
                
                {!isFullscreen && (
                  <div className="mt-12 w-full max-w-md">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Active Task</h3>
                      <button 
                        onClick={() => setActiveTab('tasks')}
                        className="text-xs text-emerald-500 font-bold hover:underline"
                      >
                        Change Task
                      </button>
                    </div>
                    {selectedTaskId ? (
                      <div className="glass rounded-3xl p-5 flex items-center justify-between group">
                        <div className="flex items-center gap-4">
                          <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center border", PRIORITY_COLORS[tasks.find(t => t.id === selectedTaskId)?.priority || 'low'])}>
                            <CheckCircle2 size={24} />
                          </div>
                          <div>
                            <h4 className="font-display font-bold text-lg">{tasks.find(t => t.id === selectedTaskId)?.title}</h4>
                            <p className="text-xs text-zinc-500">Focusing on this objective</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <button 
                        onClick={() => setActiveTab('tasks')}
                        className="w-full bg-white/5 border border-dashed border-white/10 rounded-3xl p-8 flex flex-col items-center justify-center gap-3 text-zinc-500 hover:text-zinc-300 hover:border-white/20 transition-all"
                      >
                        <Plus size={24} />
                        <span className="font-medium">Select a task to start</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Right Column: Sidebar (Only visible when not fullscreen) */}
              {!isFullscreen && (
                <div className="lg:col-span-5 space-y-8">
                  {/* Daily Progress */}
                  <div className="glass rounded-[2rem] p-8">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-3">
                        <Target className={cn(currentTheme.accent)} size={20} />
                        <h3 className="font-display font-bold text-xl">Daily Goal</h3>
                      </div>
                      <span className="text-sm font-mono text-zinc-500">
                        {Math.floor(todayMinutes / 60)}h {todayMinutes % 60}m / {userSettings.dailyGoalHours}h
                      </span>
                    </div>
                    <div className="h-3 bg-white/5 rounded-full overflow-hidden mb-4">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${goalProgress}%` }}
                        className={cn("h-full shadow-lg transition-all duration-1000", 
                          currentTheme.id === 'forest' ? 'bg-emerald-500 shadow-emerald-500/50' : 
                          currentTheme.id === 'ocean' ? 'bg-blue-500 shadow-blue-500/50' : 
                          currentTheme.id === 'cyber' ? 'bg-purple-500 shadow-purple-500/50' : 
                          currentTheme.id === 'sunset' ? 'bg-orange-500 shadow-orange-500/50' : 'bg-zinc-100 shadow-white/50'
                        )}
                      />
                    </div>
                    <p className="text-xs text-zinc-500 leading-relaxed">
                      {goalProgress >= 100 ? "Goal achieved! You're a productivity master." : `You're ${Math.round(goalProgress)}% towards your daily focus goal.`}
                    </p>
                  </div>

                  {/* Ambient Sounds */}
                  <div className="glass rounded-[2rem] p-8">
                    <div className="flex items-center gap-3 mb-6">
                      <Music className="text-blue-400" size={20} />
                      <h3 className="font-display font-bold text-xl">Soundscapes</h3>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <SoundButton 
                        active={ambientSound === 'rain'} 
                        onClick={() => setAmbientSound(ambientSound === 'rain' ? 'none' : 'rain')}
                        icon={<CloudRain size={18} />}
                        label="Rain"
                      />
                      <SoundButton 
                        active={ambientSound === 'forest'} 
                        onClick={() => setAmbientSound(ambientSound === 'forest' ? 'none' : 'forest')}
                        icon={<Wind size={18} />}
                        label="Forest"
                      />
                      <SoundButton 
                        active={ambientSound === 'cafe'} 
                        onClick={() => setAmbientSound(ambientSound === 'cafe' ? 'none' : 'cafe')}
                        icon={<Coffee size={18} />}
                        label="Cafe"
                      />
                      <SoundButton 
                        active={ambientSound === 'none'} 
                        onClick={() => setAmbientSound('none')}
                        icon={<VolumeX size={18} />}
                        label="Silence"
                      />
                    </div>
                    {ambientSound !== 'none' && (
                      <div className="mt-6 flex items-center gap-4">
                        <Volume2 size={14} className="text-zinc-500" />
                        <input 
                          type="range" 
                          min="0" max="1" step="0.01" 
                          value={volume} 
                          onChange={(e) => setVolume(parseFloat(e.target.value))}
                          className="flex-1 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-emerald-500"
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'tasks' && (
            <motion.div
              key="tasks"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <TaskList 
                user={user} 
                tasks={tasks} 
                selectedTaskId={selectedTaskId}
                ai={ai}
                theme={currentTheme}
                onSelectTask={(id) => {
                  setSelectedTaskId(id);
                  setActiveTab('timer');
                }}
                onAddTask={addTaskAction}
                onUpdateTask={updateTaskAction}
                onDeleteTask={deleteTaskAction}
              />
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-10"
            >
              <div>
                <h2 className="text-4xl font-display font-extrabold tracking-tight">Preferences</h2>
                <p className="text-zinc-500 mt-1">Personalize your focus environment</p>
              </div>

              <div className="glass rounded-[2.5rem] p-10 max-w-2xl">
                <div className="flex items-center gap-4 mb-8">
                  <Target className={cn(currentTheme.accent)} size={24} />
                  <h3 className="font-display font-bold text-2xl">Daily Focus Goal</h3>
                </div>
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400 font-medium">Study Target (Hours)</span>
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => updateGoal(Math.max(1, userSettings.dailyGoalHours - 1))}
                        className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center hover:bg-white/10 transition-all"
                      >
                        -
                      </button>
                      <span className="text-2xl font-display font-bold w-12 text-center">{userSettings.dailyGoalHours}</span>
                      <button 
                        onClick={() => updateGoal(Math.min(24, userSettings.dailyGoalHours + 1))}
                        className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center hover:bg-white/10 transition-all"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Setting a realistic goal helps maintain long-term consistency. Most users aim for 4-6 hours of deep focus.
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="font-display font-bold text-2xl px-2">Visual Themes</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {THEMES.map(theme => (
                  <button
                    key={theme.id}
                    onClick={() => updateTheme(theme.id)}
                    className={cn(
                      "group relative glass rounded-[2.5rem] p-6 text-left transition-all hover:border-white/20",
                      userSettings.themeId === theme.id && "border-white/40 bg-white/10"
                    )}
                  >
                    <div className="aspect-video rounded-2xl overflow-hidden mb-4 relative">
                      {theme.bg ? (
                        <img src={theme.bg} className="w-full h-full object-cover" alt={theme.name} />
                      ) : (
                        <div className="w-full h-full bg-zinc-900" />
                      )}
                      <div className={cn("absolute inset-0 bg-gradient-to-t from-black/60 to-transparent")} />
                      {userSettings.themeId === theme.id && (
                        <div className="absolute top-3 right-3 w-8 h-8 bg-white text-black rounded-full flex items-center justify-center shadow-lg">
                          <Check size={18} strokeWidth={3} />
                        </div>
                      )}
                    </div>
                    <h3 className="font-display font-bold text-xl mb-1">{theme.name}</h3>
                    <div className="flex items-center gap-2">
                      <div className={cn("w-3 h-3 rounded-full", 
                        theme.id === 'forest' ? 'bg-emerald-500' : 
                        theme.id === 'ocean' ? 'bg-blue-500' : 
                        theme.id === 'cyber' ? 'bg-purple-500' : 
                        theme.id === 'sunset' ? 'bg-orange-500' : 'bg-zinc-100'
                      )} />
                      <span className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Primary Accent</span>
                    </div>
                  </button>
                ))}
                </div>
              </div>

              <div className="glass rounded-[2.5rem] p-10 max-w-2xl">
                <div className="flex items-center gap-4 mb-8">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                    <BrainCircuit size={24} />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-2xl">Install as Mobile App</h3>
                    <p className="text-sm text-zinc-500">Add Focus to your home screen</p>
                  </div>
                </div>
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <h4 className="font-bold text-sm uppercase tracking-widest text-zinc-400">iOS (Safari)</h4>
                      <ol className="text-xs text-zinc-500 space-y-2 list-decimal pl-4">
                        <li>Tap the <strong>Share</strong> button at the bottom</li>
                        <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
                        <li>Tap <strong>Add</strong> to confirm</li>
                      </ol>
                    </div>
                    <div className="space-y-3">
                      <h4 className="font-bold text-sm uppercase tracking-widest text-zinc-400">Android (Chrome)</h4>
                      <ol className="text-xs text-zinc-500 space-y-2 list-decimal pl-4">
                        <li>Tap the <strong>three dots</strong> (⋮) menu</li>
                        <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong></li>
                        <li>Follow the prompts to install</li>
                      </ol>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'stats' && (
            <motion.div
              key="stats"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <Stats sessions={sessions} tasks={tasks} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// --- Sub-components ---

function LoginScreen({ onGuest }: { onGuest: () => void }) {
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setError(null);
    try {
      await signIn();
    } catch (err: any) {
      if (err.code !== 'auth/cancelled-popup-request' && err.code !== 'auth/popup-closed-by-user') {
        setError('Failed to sign in. Please try again.');
        console.error(err);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] bg-emerald-500/10 blur-[150px] rounded-full" />
        <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] bg-blue-500/10 blur-[150px] rounded-full" />
      </div>

      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative z-10 flex flex-col items-center"
      >
        <div className="w-24 h-24 bg-emerald-500 rounded-[2rem] flex items-center justify-center mb-10 shadow-2xl shadow-emerald-500/40">
          <TimerIcon size={48} className="text-black" />
        </div>
        <h1 className="text-6xl font-display font-extrabold tracking-tighter mb-4">Focus To-Do</h1>
        <p className="text-zinc-400 mb-12 text-center max-w-sm text-lg leading-relaxed">
          The ultimate productivity engine. Manage tasks, track focus, and master your time.
        </p>
        
        {error && (
          <div className="mb-8 p-5 glass border-rose-500/20 rounded-3xl text-rose-400 text-sm flex items-center gap-3">
            <AlertCircle size={20} />
            {error}
          </div>
        )}

        <button 
          onClick={handleSignIn}
          disabled={isLoggingIn}
          className={cn(
            "bg-white text-black font-bold px-10 py-5 rounded-[1.5rem] hover:bg-zinc-200 transition-all flex items-center gap-4 text-lg shadow-xl shadow-white/5",
            isLoggingIn && "opacity-50 cursor-not-allowed"
          )}
        >
          {isLoggingIn ? (
            <div className="w-6 h-6 border-3 border-black border-t-transparent rounded-full animate-spin" />
          ) : (
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="Google" />
          )}
          {isLoggingIn ? 'Authenticating...' : 'Continue with Google'}
        </button>

        <button 
          onClick={onGuest}
          className="mt-6 text-zinc-500 hover:text-zinc-300 transition-colors font-medium"
        >
          Continue as Guest (Local Only)
        </button>
      </motion.div>
    </div>
  );
}

function NavButton({ active, onClick, icon, label, theme }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string, theme: any }) {
  const activeClass = theme.id === 'forest' ? 'bg-emerald-500 shadow-emerald-500/30' : 
                      theme.id === 'ocean' ? 'bg-blue-500 shadow-blue-500/30' : 
                      theme.id === 'cyber' ? 'bg-purple-500 shadow-purple-500/30' : 
                      theme.id === 'sunset' ? 'bg-orange-500 shadow-orange-500/30' : 'bg-zinc-100 shadow-white/30';

  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-5 py-3 rounded-full transition-all duration-500",
        active ? `${activeClass} text-black font-bold shadow-lg` : "text-zinc-500 hover:text-zinc-100 hover:bg-white/5"
      )}
    >
      {icon}
      {active && <span className="text-sm font-display">{label}</span>}
    </button>
  );
}

function SoundButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all duration-300",
        active ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-white/5 border-white/5 text-zinc-500 hover:border-white/10 hover:text-zinc-300"
      )}
    >
      {icon}
      <span className="text-sm font-bold">{label}</span>
    </button>
  );
}

function Timer({ user, selectedTask, isFullscreen, onToggleFullscreen, theme, onComplete }: { user: FirebaseUser | null, selectedTask?: Task, isFullscreen: boolean, onToggleFullscreen: () => void, theme: any, onComplete: (data: any) => Promise<void> }) {
  const [mode, setMode] = useState<TimerMode>('focus');
  const [timeLeft, setTimeLeft] = useState(TIMER_CONFIG.focus);
  const [isActive, setIsActive] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<Date | null>(null);

  useEffect(() => {
    if (isActive && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => prev - 1);
      }, 1000);
    } else if (timeLeft === 0) {
      handleTimerComplete();
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isActive, timeLeft]);

  const handleTimerComplete = async () => {
    setIsActive(false);
    if (timerRef.current) clearInterval(timerRef.current);

    if (Notification.permission === 'granted') {
      new Notification(mode === 'focus' ? 'Focus Session Complete!' : 'Break Over!', {
        body: mode === 'focus' ? 'Time for a well-deserved break.' : 'Ready to get back to work?',
      });
    }

    if (mode === 'focus') {
      await onComplete({
        taskId: selectedTask?.id || null,
        startTime: startTimeRef.current || new Date(),
        endTime: new Date(),
        durationMinutes: Math.round((TIMER_CONFIG.focus - timeLeft) / 60) || 25,
        type: 'focus'
      });
    }

    if (mode === 'focus') setMode('short_break');
    else setMode('focus');
  };

  const toggleTimer = () => {
    if (!isActive) startTimeRef.current = new Date();
    setIsActive(!isActive);
  };

  const resetTimer = () => {
    setIsActive(false);
    setTimeLeft(TIMER_CONFIG[mode]);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    resetTimer();
  }, [mode]);

  return (
    <div className="flex flex-col items-center">
      {!isFullscreen && (
        <div className="flex glass p-1.5 rounded-[1.5rem] mb-16">
          {(['focus', 'short_break', 'long_break'] as TimerMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "px-8 py-3 rounded-2xl text-sm font-bold transition-all duration-500",
                mode === m ? "bg-white/10 text-white shadow-xl" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {m.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </button>
          ))}
        </div>
      )}

      <div className={cn(
        "relative flex items-center justify-center transition-all duration-700",
        isFullscreen ? "w-[32rem] h-[32rem]" : "w-96 h-96"
      )}>
        <svg className="w-full h-full -rotate-90">
          <circle
            cx="50%"
            cy="50%"
            r="45%"
            fill="transparent"
            stroke="currentColor"
            strokeWidth="1"
            className="text-white/5 timer-dashed"
          />
          <circle
            cx="50%"
            cy="50%"
            r="42%"
            fill="transparent"
            stroke="currentColor"
            strokeWidth="12"
            className="text-white/5"
          />
          <motion.circle
            cx="50%"
            cy="50%"
            r="42%"
            fill="transparent"
            stroke="currentColor"
            strokeWidth="12"
            strokeDasharray="100 100"
            animate={{ strokeDashoffset: 100 * (1 - timeLeft / TIMER_CONFIG[mode]) }}
            transition={{ duration: 1, ease: "linear" }}
            pathLength="100"
            className={cn(
              theme.id === 'forest' ? 'text-emerald-500' : 
              theme.id === 'ocean' ? 'text-blue-500' : 
              theme.id === 'cyber' ? 'text-purple-500' : 
              theme.id === 'sunset' ? 'text-orange-500' : 'text-zinc-100'
            )}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span 
            key={timeLeft}
            initial={{ scale: 0.95, opacity: 0.8 }}
            animate={{ scale: 1, opacity: 1 }}
            className={cn(
              "font-display font-extrabold tracking-tighter tabular-nums text-glow",
              isFullscreen ? "text-[10rem]" : "text-8xl"
            )}
            style={{ textShadow: `0 0 20px ${theme.glow}` }}
          >
            {formatTime(timeLeft)}
          </motion.span>
          <span className="text-zinc-500 font-bold mt-4 uppercase tracking-[0.3em] text-[10px]">
            {isActive ? 'System Active' : 'System Paused'}
          </span>
        </div>
      </div>

      <div className={cn(
        "flex items-center gap-6 mt-16 transition-all duration-700",
        isFullscreen ? "scale-125" : ""
      )}>
        <button 
          onClick={resetTimer}
          className="p-5 rounded-3xl glass text-zinc-500 hover:text-zinc-100 transition-all"
        >
          <RotateCcw size={28} />
        </button>
        <button 
          onClick={toggleTimer}
          className={cn(
            "w-28 h-28 rounded-[2.5rem] text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-xl",
            theme.id === 'forest' ? 'bg-emerald-500 shadow-emerald-500/30' : 
            theme.id === 'ocean' ? 'bg-blue-500 shadow-blue-500/30' : 
            theme.id === 'cyber' ? 'bg-purple-500 shadow-purple-500/30' : 
            theme.id === 'sunset' ? 'bg-orange-500 shadow-orange-500/30' : 'bg-zinc-100 shadow-white/30'
          )}
        >
          {isActive ? <Pause size={40} fill="currentColor" /> : <Play size={40} fill="currentColor" className="ml-1" />}
        </button>
        <button 
          onClick={onToggleFullscreen}
          className="p-5 rounded-3xl glass text-zinc-500 hover:text-zinc-100 transition-all"
        >
          {isFullscreen ? <Minimize2 size={28} /> : <Maximize2 size={28} />}
        </button>
      </div>
    </div>
  );
}

function TaskList({ 
  user, tasks, selectedTaskId, onSelectTask, ai, theme, 
  onAddTask, onUpdateTask, onDeleteTask 
}: { 
  user: FirebaseUser | null, 
  tasks: Task[], 
  selectedTaskId: string | null, 
  onSelectTask: (id: string) => void, 
  ai: GoogleGenAI, 
  theme: any,
  onAddTask: (data: any) => Promise<void>,
  onUpdateTask: (id: string, updates: any) => Promise<void>,
  onDeleteTask: (id: string) => Promise<void>
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', priority: 'medium' as Priority });
  const [isBreakingDown, setIsBreakingDown] = useState<string | null>(null);

  const breakDownTask = async (task: Task) => {
    if (isBreakingDown) return;
    setIsBreakingDown(task.id);
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Break down the following task into 3-5 small, actionable sub-tasks for a productivity app. Task: "${task.title}". Return only the sub-tasks as a bulleted list.`,
      });
      
      const subtasks = response.text?.split('\n').filter(line => line.trim()).map(line => line.replace(/^[•\-\d\.]\s*/, '').trim());
      
      if (subtasks) {
        for (const sub of subtasks) {
          await onAddTask({
            title: sub,
            description: `Sub-task of: ${task.title}`,
            priority: task.priority,
            estimated_pomodoros: 1,
            completed: false
          });
        }
      }
    } catch (e) {
      console.error("AI breakdown failed", e);
    } finally {
      setIsBreakingDown(null);
    }
  };

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.title.trim()) return;

    await onAddTask({
      title: newTask.title,
      description: '',
      priority: newTask.priority,
      estimated_pomodoros: 1,
      completed: false
    });

    setNewTask({ title: '', priority: 'medium' });
    setIsAdding(false);
  };

  const toggleComplete = async (task: Task) => {
    await onUpdateTask(task.id, {
      completed: !task.completed
    });
  };

  const deleteTask = async (id: string) => {
    await onDeleteTask(id);
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-4xl font-display font-extrabold tracking-tight">Tasks</h2>
          <p className="text-zinc-500 mt-1">Organize your focus objectives</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="bg-emerald-500 text-black px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20"
        >
          <Plus size={20} />
          New Objective
        </button>
      </div>

      <AnimatePresence>
        {isAdding && (
          <motion.form 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            onSubmit={addTask}
            className="glass rounded-[2rem] p-8 space-y-6"
          >
            <input 
              autoFocus
              placeholder="What's the next goal?"
              className="w-full bg-transparent border-none outline-none text-2xl font-display font-bold placeholder:text-zinc-700"
              value={newTask.title}
              onChange={e => setNewTask({ ...newTask, title: e.target.value })}
            />
            <div className="flex items-center justify-between pt-4 border-t border-white/5">
              <div className="flex gap-3">
                {(['low', 'medium', 'high'] as Priority[]).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setNewTask({ ...newTask, priority: p })}
                    className={cn(
                      "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest border transition-all",
                      newTask.priority === p ? PRIORITY_COLORS[p] : "bg-white/5 border-white/5 text-zinc-600 hover:text-zinc-400"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <div className="flex gap-4">
                <button 
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="text-sm font-bold text-zinc-500 hover:text-zinc-300"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="bg-white text-black px-6 py-2.5 rounded-xl text-sm font-bold shadow-lg"
                >
                  Create Task
                </button>
              </div>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tasks.length === 0 && !isAdding && (
          <div className="col-span-full text-center py-32 text-zinc-600">
            <div className="w-20 h-20 bg-white/5 rounded-3xl flex items-center justify-center mx-auto mb-6">
              <ListTodo size={40} className="opacity-20" />
            </div>
            <p className="text-lg font-medium">Your task list is empty.</p>
            <p className="text-sm mt-1">Add a task to start tracking your focus.</p>
          </div>
        )}
        {tasks.map((task) => (
          <motion.div 
            layout
            key={task.id}
            className={cn(
              "group glass rounded-3xl p-6 flex items-start gap-5 transition-all hover:border-white/20",
              selectedTaskId === task.id && "border-emerald-500/50 bg-emerald-500/5",
              task.completed && "opacity-40"
            )}
          >
            <button 
              onClick={() => toggleComplete(task)}
              className={cn(
                "mt-1 transition-all",
                task.completed ? "text-emerald-500" : "text-zinc-700 hover:text-zinc-500"
              )}
            >
              {task.completed ? <CheckCircle2 size={28} /> : <Circle size={28} />}
            </button>
            <div 
              className="flex-1 cursor-pointer"
              onClick={() => onSelectTask(task.id)}
            >
              <h4 className={cn("text-xl font-display font-bold transition-all", task.completed && "line-through text-zinc-500")}>
                {task.title}
              </h4>
              <div className="flex items-center gap-4 mt-3">
                <span className={cn("text-[9px] font-bold uppercase tracking-[0.2em] px-2 py-1 rounded-lg border", PRIORITY_COLORS[task.priority])}>
                  {task.priority}
                </span>
                <span className="text-[10px] text-zinc-600 flex items-center gap-1.5 font-bold uppercase tracking-widest">
                  <TimerIcon size={12} />
                  {task.estimated_pomodoros} Pomo
                </span>
                {!task.completed && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); breakDownTask(task); }}
                    disabled={isBreakingDown === task.id}
                    className={cn(
                      "flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest transition-all px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10",
                      isBreakingDown === task.id ? "animate-pulse text-zinc-500" : theme.accent
                    )}
                  >
                    <Sparkles size={12} />
                    {isBreakingDown === task.id ? 'Breaking down...' : 'AI Breakdown'}
                  </button>
                )}
              </div>
            </div>
            <button 
              onClick={() => deleteTask(task.id)}
              className="text-zinc-700 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all p-2"
            >
              <Trash2 size={20} />
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function Stats({ sessions, tasks }: { sessions: FocusSession[], tasks: Task[] }) {
  const todaySessions = sessions.filter(s => {
    const start = s.startTime?.toDate ? s.startTime.toDate() : new Date(s.startTime);
    return isSameDay(start, new Date());
  });

  const totalFocusMinutes = todaySessions.reduce((acc, s) => acc + s.durationMinutes, 0);
  const completedTasksCount = tasks.filter(t => t.completed).length;

  const chartData = useMemo(() => {
    const days = eachDayOfInterval({
      start: subDays(new Date(), 6),
      end: new Date()
    });

    return days.map(day => {
      const daySessions = sessions.filter(s => {
        const start = s.startTime?.toDate ? s.startTime.toDate() : new Date(s.startTime);
        return isSameDay(start, day);
      });
      return {
        name: format(day, 'EEE'),
        minutes: daySessions.reduce((acc, s) => acc + s.durationMinutes, 0),
        fullDate: format(day, 'MMM d')
      };
    });
  }, [sessions]);

  // Heatmap Data (Last 35 days)
  const heatmapData = useMemo(() => {
    const days = eachDayOfInterval({
      start: subDays(new Date(), 34),
      end: new Date()
    });
    return days.map(day => {
      const count = sessions.filter(s => {
        const start = s.startTime?.toDate ? s.startTime.toDate() : new Date(s.startTime);
        return isSameDay(start, day);
      }).length;
      return { date: day, count };
    });
  }, [sessions]);

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-4xl font-display font-extrabold tracking-tight">Analytics</h2>
        <p className="text-zinc-500 mt-1">Your productivity engine performance</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard 
          label="Focus Today" 
          value={`${Math.floor(totalFocusMinutes / 60)}h ${totalFocusMinutes % 60}m`}
          icon={<Clock className="text-emerald-500" size={20} />}
          trend="+12% from yesterday"
        />
        <StatCard 
          label="Tasks Completed" 
          value={completedTasksCount.toString()}
          icon={<Trophy className="text-amber-500" size={20} />}
          trend="Top 5% of users"
        />
        <StatCard 
          label="Focus Streak" 
          value={`${calculateStreak(sessions)} Days`}
          icon={<Flame className="text-orange-500" size={20} />}
          trend="Personal record!"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Weekly Activity Chart */}
        <div className="lg:col-span-8 glass rounded-[2.5rem] p-10">
          <div className="flex items-center justify-between mb-10">
            <div>
              <h3 className="font-display font-bold text-2xl">Weekly Activity</h3>
              <p className="text-sm text-zinc-500">Focus minutes per day</p>
            </div>
            <div className="flex gap-2">
              <button className="px-4 py-2 rounded-xl bg-white/5 text-xs font-bold">Week</button>
              <button className="px-4 py-2 rounded-xl text-xs font-bold text-zinc-500 hover:bg-white/5">Month</button>
            </div>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorMinutes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff05" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#71717a', fontSize: 12, fontWeight: 600 }}
                  dy={15}
                />
                <YAxis hide />
                <Tooltip 
                  cursor={{ stroke: '#10b981', strokeWidth: 2 }}
                  contentStyle={{ 
                    backgroundColor: '#0a0a0a', 
                    border: '1px solid #ffffff10',
                    borderRadius: '16px',
                    padding: '12px'
                  }}
                />
                <Area 
                  type="monotone" 
                  dataKey="minutes" 
                  stroke="#10b981" 
                  strokeWidth={4}
                  fillOpacity={1} 
                  fill="url(#colorMinutes)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Activity Heatmap */}
        <div className="lg:col-span-4 glass rounded-[2.5rem] p-10">
          <h3 className="font-display font-bold text-2xl mb-2">Consistency</h3>
          <p className="text-sm text-zinc-500 mb-8">Last 5 weeks activity</p>
          <div className="grid grid-cols-7 gap-2">
            {heatmapData.map((day, i) => (
              <div 
                key={i}
                title={`${format(day.date, 'MMM d')}: ${day.count} sessions`}
                className={cn(
                  "aspect-square rounded-md transition-all hover:scale-110",
                  day.count === 0 ? "bg-white/5" : 
                  day.count < 3 ? "bg-emerald-900/40" :
                  day.count < 6 ? "bg-emerald-700/60" : "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]"
                )}
              />
            ))}
          </div>
          <div className="mt-8 flex items-center justify-between text-[10px] font-bold text-zinc-600 uppercase tracking-widest">
            <span>Less</span>
            <div className="flex gap-1">
              <div className="w-2 h-2 rounded-sm bg-white/5" />
              <div className="w-2 h-2 rounded-sm bg-emerald-900/40" />
              <div className="w-2 h-2 rounded-sm bg-emerald-700/60" />
              <div className="w-2 h-2 rounded-sm bg-emerald-500" />
            </div>
            <span>More</span>
          </div>
        </div>
      </div>

      {/* Recent Activity List */}
      <div className="glass rounded-[2.5rem] p-10">
        <h3 className="font-display font-bold text-2xl mb-8">Recent Sessions</h3>
        <div className="space-y-4">
          {sessions.slice(0, 5).map((session) => (
            <div key={session.id} className="bg-white/5 border border-white/5 rounded-3xl p-5 flex items-center justify-between hover:border-white/10 transition-all">
              <div className="flex items-center gap-5">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
                  <TimerIcon size={24} />
                </div>
                <div>
                  <p className="font-bold text-lg">Focus Session</p>
                  <p className="text-xs text-zinc-500 font-medium">
                    {format(session.startTime?.toDate ? session.startTime.toDate() : new Date(session.startTime), 'EEEE, MMMM do • h:mm a')}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-xl font-mono font-bold text-emerald-500">{session.durationMinutes}m</span>
                <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-bold mt-1">Duration</p>
              </div>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="text-center py-12 text-zinc-600 italic">No focus history found.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, trend }: { label: string, value: string, icon: React.ReactNode, trend: string }) {
  return (
    <div className="glass rounded-[2.5rem] p-8">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center">
          {icon}
        </div>
        <span className="text-xs font-bold text-zinc-500 uppercase tracking-[0.2em]">{label}</span>
      </div>
      <div className="text-4xl font-display font-extrabold tracking-tight mb-2">{value}</div>
      <p className="text-[10px] font-bold text-emerald-500/80 uppercase tracking-widest">{trend}</p>
    </div>
  );
}

// --- Helper Functions ---

function calculateStreak(sessions: FocusSession[]) {
  if (sessions.length === 0) return 0;
  
  const sortedDates = sessions
    .map(s => startOfDay(s.startTime?.toDate ? s.startTime.toDate() : new Date(s.startTime)))
    .sort((a, b) => b.getTime() - a.getTime());
  
  const uniqueDates = Array.from(new Set(sortedDates.map(d => d.getTime()))).map(t => new Date(t));
  
  let streak = 0;
  let currentDate = startOfDay(new Date());
  
  const hasToday = uniqueDates.some(d => isSameDay(d, currentDate));
  const hasYesterday = uniqueDates.some(d => isSameDay(d, subDays(currentDate, 1)));
  
  if (!hasToday && !hasYesterday) return 0;
  
  let checkDate = hasToday ? currentDate : subDays(currentDate, 1);
  
  for (let i = 0; i < uniqueDates.length; i++) {
    const found = uniqueDates.find(d => isSameDay(d, checkDate));
    if (found) {
      streak++;
      checkDate = subDays(checkDate, 1);
    } else {
      break;
    }
  }
  
  return streak;
}
