
import React, { useState, useEffect, useCallback } from 'react';
import { AppScreen, CandleType, Signal, BettingHouse, SignalStatus, GraphStatus, ThemeConfig, SupportMessage, AgendaItem, PlatformNotification } from './types.ts';
import { BETTING_HOUSES } from './constants.tsx';
import Layout from './components/Layout.tsx';
import SignalHistory from './components/SignalHistory.tsx';
import { GoogleGenAI } from "@google/genai";
import { db, auth, OperationType, handleFirestoreError } from './src/firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, User } from 'firebase/auth';
import { onSnapshot, doc, collection, setDoc, updateDoc, deleteDoc, getDoc, getDocFromServer } from 'firebase/firestore';

const PREDEFINED_THEMES: ThemeConfig[] = [
  { id: 'venom', name: 'Venom Elite', mode: 'dark', accentColor: '#00FF9D', brightness: 100, contrast: 100 },
  { id: 'cyber', name: 'Cyber Blue', mode: 'dark', accentColor: '#00D1FF', brightness: 110, contrast: 105 },
  { id: 'royal', name: 'Royal Gold', mode: 'dark', accentColor: '#FFD700', brightness: 100, contrast: 110 },
  { id: 'neon', name: 'Neon Purple', mode: 'dark', accentColor: '#BD00FF', brightness: 100, contrast: 100 },
  { id: 'nova', name: 'Light Nova', mode: 'light', accentColor: '#00FF9D', brightness: 100, contrast: 100 }
];

const GLOBAL_ALERTS = [
  { type: 'info', message: 'Sincronização com Elephant Bet otimizada v5.5.2' },
  { type: 'alert', message: 'Volume alto detectado na Premier Bet - Ciclo de Rosa iminente!' },
  { type: 'success', message: 'Script Venom.hack-v5.5 operando com 99.4% de precisão.' },
  { type: 'critical', message: 'Instabilidade no servidor Olá Bet - Evite entradas grandes agora.' },
  { type: 'info', message: 'Agenda Elite atualizada com novos padrões de Moçambique.' }
];

const LOCAL_STRATEGIES = [
  "Aguarde 3 velas azuis seguidas para recuperação.",
  "Ciclo de retenção: Reduza banca e busque 1.50x.",
  "Padrão de escada: Momento para velas de 2.0x.",
  "O gráfico tende a corrigir após rosas.",
  "Evite entradas após velas acima de 50x.",
  "Foque em horários de pico (18h-21h).",
  "Estratégia 2 min: Entre no 2º min após roxa.",
  "Gestão: Proteja capital e jogue com lucro."
];

const INITIAL_AGENDA_DATA: AgendaItem[] = BETTING_HOUSES.map(h => {
  const paying = 45 + Math.random() * 45;
  return {
    id: h.id,
    house: h.name,
    logo: h.logo,
    paying: paying,
    reclining: 100 - paying,
    graphStatus: (paying > 75 ? 'BOM' : paying > 55 ? 'RAZOAVEL' : 'RUIM') as GraphStatus,
    graphAnalysis: 'Ativo',
    efronInsight: LOCAL_STRATEGIES[Math.floor(Math.random() * LOCAL_STRATEGIES.length)],
    isAnalyzing: false,
    isGraphAnalyzing: false
  };
});

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: any}> {
  state: { hasError: boolean, error: any };
  props: { children: React.ReactNode };
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
    this.props = props;
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#05070a] flex flex-col items-center justify-center p-8 text-center space-y-6">
          <div className="w-16 h-16 bg-rose-500/20 rounded-2xl flex items-center justify-center text-rose-500">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-black text-primary uppercase">Erro de Protocolo</h2>
            <p className="text-[10px] text-secondary font-bold uppercase leading-relaxed">Ocorreu um erro inesperado no sistema. Por favor, reinicie o aplicativo.</p>
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="px-8 py-3 bg-white text-black rounded-xl font-black text-[10px] uppercase tracking-widest"
          >
            Reiniciar Sistema
          </button>
          <pre className="mt-8 p-4 bg-black/50 rounded-xl text-[8px] text-rose-400 text-left overflow-auto max-w-full font-mono">
            {typeof this.state.error === 'object' ? JSON.stringify(this.state.error, null, 2) : String(this.state.error)}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const App: React.FC = () => {
  const [activeScreen, setActiveScreen] = useState<AppScreen>(AppScreen.LOGIN);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUserKey, setCurrentUserKey] = useState('');
  const [loginInput, setLoginInput] = useState('');
  
  // Firebase Auth & Sync
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [aiInstance, setAiInstance] = useState<any>(null);

  useEffect(() => {
    if (process.env.GEMINI_API_KEY) {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      setAiInstance(ai);
    }
  }, []);

  // Admin & Bot Status (Synced with Firestore)
  const [isBotOpen, setIsBotOpen] = useState(true);
  const [botClosedMessage, setBotClosedMessage] = useState('BOT EM MANUTENÇÃO. VOLTAMOS EM BREVE!');
  const [adminPassword, setAdminPassword] = useState('venom.b5');
  const [userKeys, setUserKeys] = useState<{key: string, isBanned: boolean, expiresAt?: number}[]>([]);
  const [adminLoginInput, setAdminLoginInput] = useState('');
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
  const [newKeyInput, setNewKeyInput] = useState('');
  const [newKeyDays, setNewKeyDays] = useState('');
  const [newKeyHours, setNewKeyHours] = useState('');
  const [newKeyMinutes, setNewKeyMinutes] = useState('');
  const [newAdminPassInput, setNewAdminPassInput] = useState('');
  const [newBotMessageInput, setNewBotMessageInput] = useState('');
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [isBanConfirmOpen, setIsBanConfirmOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [keyToToggle, setKeyToToggle] = useState<string | null>(null);
  const [keyToDelete, setKeyToDelete] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<{name: string, price: string} | null>(null);
  const [isSelectingAdmin, setIsSelectingAdmin] = useState(false);

  const [selectedHouse, setSelectedHouse] = useState<BettingHouse | null>(null);
  const [selectedCandle, setSelectedCandle] = useState<CandleType>(CandleType.PURPLE);
  const [numSignals, setNumSignals] = useState<number>(10);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [mentorAnalysis, setMentorAnalysis] = useState<string>('');
  const [supportMessages, setSupportMessages] = useState<SupportMessage[]>([]);
  const [notifications, setNotifications] = useState<PlatformNotification[]>([]);
  const [toast, setToast] = useState<{ show: boolean, message: string }>({ show: false, message: '' });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isGlobalLoading, setIsGlobalLoading] = useState(false);
  const [agendaData, setAgendaData] = useState<AgendaItem[]>([]);
  const [hackerGeralLink, setHackerGeralLink] = useState('');
  const [hackerGeralSignals, setHackerGeralSignals] = useState<Signal[]>([]);
  const [isHackingGeral, setIsHackingGeral] = useState(false);
  const [hackerGeralNumSignals, setHackerGeralNumSignals] = useState(15);
  const [hackerGeralProgress, setHackerGeralProgress] = useState(0);
  const [hackerGeralStatus, setHackerGeralStatus] = useState('');
  const [hackerGeralCountdown, setHackerGeralCountdown] = useState(0);
  const [hackerGeralIsPaying, setHackerGeralIsPaying] = useState<boolean | null>(null);
  const [hackerGeralRisk, setHackerGeralRisk] = useState<'LOW' | 'MED' | 'HIGH'>('MED');
  const [hackerGeralRegion, setHackerGeralRegion] = useState('MOZAMBIQUE');
  const [hackerGeralAutoScan, setHackerGeralAutoScan] = useState(true);
  const [isModoHacker, setIsModoHacker] = useState(false);
  const [hackerLink, setHackerLink] = useState('');
  const [serverSeed, setServerSeed] = useState('');

  const [settings, setSettings] = useState({
    precision: 99.8,
    minInterval: 2,
    autoScan: true,
    algorithm: 'Venom.Elite-v6.0'
  });

  const [themeConfig, setThemeConfig] = useState<ThemeConfig>(PREDEFINED_THEMES[0]);
  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setIsAuthReady(true);
      
      if (u) {
        // Ensure user document exists
        const userRef = doc(db, 'users', u.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          await setDoc(userRef, {
            uid: u.uid,
            email: u.email,
            displayName: u.displayName,
            photoURL: u.photoURL,
            role: u.email === 'efronjoao9@gmail.com' ? 'admin' : 'user',
            lastLogin: Date.now()
          }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${u.uid}`));
        } else {
          await updateDoc(userRef, {
            lastLogin: Date.now()
          }).catch(err => handleFirestoreError(err, OperationType.UPDATE, `users/${u.uid}`));
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // Sync Global Settings
  useEffect(() => {
    if (!isAuthReady || !user) return;

    const unsub = onSnapshot(doc(db, 'appSettings', 'global'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setIsBotOpen(data.isBotOpen);
        setBotClosedMessage(data.botClosedMessage);
        setAdminPassword(data.adminPassword);
      } else {
        // Initialize global settings if they don't exist
        setDoc(doc(db, 'appSettings', 'global'), {
          isBotOpen: true,
          botClosedMessage: 'BOT EM MANUTENÇÃO. VOLTAMOS EM BREVE!',
          adminPassword: 'venom.b5'
        }).catch(err => handleFirestoreError(err, OperationType.WRITE, 'appSettings/global'));
      }
    }, (err) => handleFirestoreError(err, OperationType.GET, 'appSettings/global'));

    return () => unsub();
  }, [isAuthReady, user]);

  // Sync User Keys
  useEffect(() => {
    if (!isAuthReady || !user) return;

    const unsub = onSnapshot(collection(db, 'userKeys'), (snapshot) => {
      const keys = snapshot.docs.map(doc => doc.data() as {key: string, isBanned: boolean, expiresAt?: number});
      setUserKeys(keys);
    }, (err) => handleFirestoreError(err, OperationType.GET, 'userKeys'));

    return () => unsub();
  }, [isAuthReady, user]);

  // Test connection on boot
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Error signing in with Google:", error);
      triggerToast("ERRO AO ENTRAR COM GOOGLE");
    }
  };

  useEffect(() => {
    const checkApiKey = async () => {
      if (window.aistudio) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasApiKey(selected);
      }
    };
    checkApiKey();
  }, []);

  const handleOpenKeySelector = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  };

  useEffect(() => {
    setAgendaData(INITIAL_AGENDA_DATA);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (themeConfig.mode === 'dark') {
      root.style.setProperty('--bg-color', '#05070a');
      root.style.setProperty('--card-bg', 'rgba(15, 23, 42, 0.4)');
      root.style.setProperty('--text-primary', '#f8fafc');
      root.style.setProperty('--text-secondary', '#94a3b8');
    } else {
      root.style.setProperty('--bg-color', '#f8fafc');
      root.style.setProperty('--card-bg', 'rgba(255, 255, 255, 0.8)');
      root.style.setProperty('--text-primary', '#0f172a');
      root.style.setProperty('--text-secondary', '#475569');
    }
    root.style.setProperty('--accent-color', themeConfig.accentColor);
    root.style.setProperty('--brightness', `${themeConfig.brightness}%`);
    root.style.setProperty('--contrast', `${themeConfig.contrast}%`);
  }, [themeConfig]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const triggerRandomAlert = () => {
      const alertTemplate = GLOBAL_ALERTS[Math.floor(Math.random() * GLOBAL_ALERTS.length)];
      const newNotif: PlatformNotification = {
        id: Math.random().toString(36).substring(7),
        type: alertTemplate.type as any,
        message: alertTemplate.message,
        timestamp: Date.now()
      };
      setNotifications(prev => [newNotif, ...prev].slice(0, 3));
      
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== newNotif.id));
      }, 8000);
    };

    const interval = setInterval(triggerRandomAlert, 25000);
    setTimeout(triggerRandomAlert, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    localStorage.setItem('isBotOpen', isBotOpen.toString());
    localStorage.setItem('botClosedMessage', botClosedMessage);
    localStorage.setItem('adminPassword', adminPassword);
    localStorage.setItem('userKeys', JSON.stringify(userKeys));
  }, [isBotOpen, botClosedMessage, adminPassword, userKeys]);

  // Check if current user is banned or expired
  useEffect(() => {
    if (isLoggedIn && currentUserKey) {
      const userKey = userKeys.find(u => u.key === currentUserKey);
      const isExpired = userKey?.expiresAt && Date.now() > userKey.expiresAt;
      
      if (!userKey || userKey.isBanned || !isBotOpen || isExpired) {
        setIsLoggedIn(false);
        setActiveScreen(AppScreen.LOGIN);
        
        if (userKey?.isBanned) {
          triggerToast("ACESSO BANIDO!");
        } else if (isExpired) {
          triggerToast("ACESSO EXPIRADO!");
          // Auto-ban in DB when expired to prevent reuse
          updateDoc(doc(db, 'userKeys', currentUserKey), { isBanned: true })
            .catch(err => handleFirestoreError(err, OperationType.UPDATE, `userKeys/${currentUserKey}`));
        } else if (!isBotOpen) {
          triggerToast("BOT FECHADO PELO ADMIN!");
        }
      }
    }
  }, [userKeys, isBotOpen, isLoggedIn, currentUserKey, currentTime]);

  const handleBuyAccess = (plan: string, admin: string) => {
    const phone = admin === 'ADM 1' ? '258845550673' : '258873361445';
    const message = encodeURIComponent(`Olá ${admin}, gostaria de comprar o acesso: ${plan}`);
    window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
    setIsPricingModalOpen(false);
    setSelectedPlan(null);
    setIsSelectingAdmin(false);
  };

  const PRICING_PLANS = [
    { name: '2 DIAS', price: '250 MZN' },
    { name: '3 DIAS', price: '350 MZN' },
    { name: '4 DIAS', price: '450 MZN' },
    { name: '5 DIAS', price: '550 MZN' },
    { name: 'REVENDEDOR', price: '700 MZN' },
  ];

  const handleLogin = () => {
    if (!isBotOpen) {
      triggerToast("BOT FECHADO!");
      return;
    }
    const user = userKeys.find(u => u.key === loginInput);
    if (user) {
      const isExpired = user.expiresAt && Date.now() > user.expiresAt;
      if (user.isBanned) {
        triggerToast("ESTE ACESSO ESTÁ BANIDO!");
      } else if (isExpired) {
        triggerToast("ESTE ACESSO ESTÁ EXPIRADO!");
        // Auto-ban in DB when expired
        updateDoc(doc(db, 'userKeys', loginInput), { isBanned: true })
          .catch(err => handleFirestoreError(err, OperationType.UPDATE, `userKeys/${loginInput}`));
      } else {
        setIsLoggedIn(true);
        setCurrentUserKey(loginInput);
        setActiveScreen(AppScreen.HOUSE_SELECTION);
        triggerToast("ACESSO AUTORIZADO!");
      }
    } else {
      triggerToast("CHAVE DE ACESSO INVÁLIDA!");
    }
  };

  const handleAdminLogin = () => {
    if (adminLoginInput === adminPassword) {
      setIsAdminLoggedIn(true);
      setActiveScreen(AppScreen.ADMIN_PANEL);
      triggerToast("PAINEL ADMIN ACESSADO!");
    } else {
      triggerToast("SENHA ADMIN INCORRETA!");
    }
  };

  const createNewKey = async () => {
    if (!newKeyInput) return;
    if (userKeys.some(u => u.key === newKeyInput)) {
      triggerToast("CHAVE JÁ EXISTE!");
      return;
    }
    
    const days = parseInt(newKeyDays) || 0;
    const hours = parseInt(newKeyHours) || 0;
    const minutes = parseInt(newKeyMinutes) || 0;
    
    const totalMinutes = (days * 1440) + (hours * 60) + minutes;
    const expiresAt = totalMinutes > 0 ? Date.now() + (totalMinutes * 60000) : undefined;
    
    try {
      const keyData = { key: newKeyInput, isBanned: false, expiresAt: expiresAt || null };
      await setDoc(doc(db, 'userKeys', newKeyInput), keyData);
      
      setNewKeyInput('');
      setNewKeyDays('');
      setNewKeyHours('');
      setNewKeyMinutes('');
      
      if (expiresAt) {
        triggerToast(`CHAVE TEMPORÁRIA CRIADA! (${days}d ${hours}h ${minutes}m)`);
      } else {
        triggerToast("CHAVE PERMANENTE CRIADA!");
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `userKeys/${newKeyInput}`);
    }
  };

  const formatTimeRemaining = (expiresAt: number) => {
    const diff = expiresAt - Date.now();
    if (diff <= 0) return "Expirado";
    
    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    let parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0 || parts.length === 0) parts.push(`${m}m`);
    
    return parts.join(' ');
  };

  const toggleBan = (key: string) => {
    setKeyToToggle(key);
    setIsBanConfirmOpen(true);
  };

  const confirmToggleBan = async () => {
    if (!keyToToggle) return;
    const userKey = userKeys.find(u => u.key === keyToToggle);
    if (!userKey) return;
    try {
      await updateDoc(doc(db, 'userKeys', keyToToggle), { isBanned: !userKey.isBanned });
      triggerToast(userKey.isBanned ? "USUÁRIO DESBANIDO!" : "USUÁRIO BANIDO!");
      setIsBanConfirmOpen(false);
      setKeyToToggle(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `userKeys/${keyToToggle}`);
    }
  };

  const deleteKey = (key: string) => {
    setKeyToDelete(key);
    setIsDeleteConfirmOpen(true);
  };

  const confirmDeleteKey = async () => {
    if (!keyToDelete) return;
    try {
      await deleteDoc(doc(db, 'userKeys', keyToDelete));
      triggerToast("CHAVE REMOVIDA!");
      setIsDeleteConfirmOpen(false);
      setKeyToDelete(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `userKeys/${keyToDelete}`);
    }
  };

  const updateAdminPassword = async () => {
    if (!newAdminPassInput) return;
    try {
      await updateDoc(doc(db, 'appSettings', 'global'), { adminPassword: newAdminPassInput });
      setNewAdminPassInput('');
      triggerToast("SENHA ADMIN ALTERADA!");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'appSettings/global');
    }
  };

  const updateBotStatus = async (open: boolean) => {
    try {
      await updateDoc(doc(db, 'appSettings', 'global'), { isBotOpen: open });
      triggerToast(open ? "BOT ABERTO!" : "BOT FECHADO!");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'appSettings/global');
    }
  };

  const updateBotMessage = async () => {
    if (!newBotMessageInput) return;
    try {
      await updateDoc(doc(db, 'appSettings', 'global'), { botClosedMessage: newBotMessageInput });
      setNewBotMessageInput('');
      triggerToast("MENSAGEM ATUALIZADA!");
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'appSettings/global');
    }
  };

  const logout = () => {
    setIsLoggedIn(false);
    setCurrentUserKey('');
    setActiveScreen(AppScreen.LOGIN);
  };

  const adminLogout = () => {
    setIsAdminLoggedIn(false);
    setActiveScreen(AppScreen.LOGIN);
    setAdminLoginInput('');
  };

  // Check for expired keys (Admin only to avoid conflicts)
  useEffect(() => {
    if (!isAdminLoggedIn) return;
    
    const interval = setInterval(async () => {
      const now = Date.now();
      for (const u of userKeys) {
        if (u.expiresAt && u.expiresAt < now && !u.isBanned) {
          try {
            await updateDoc(doc(db, 'userKeys', u.key), { isBanned: true });
          } catch (err) {
            console.error("Error auto-banning expired key:", u.key, err);
          }
        }
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [userKeys, isAdminLoggedIn]);

  const triggerToast = (message: string) => {
    setToast({ show: true, message: message });
    setTimeout(() => setToast({ show: false, message: '' }), 3000);
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (hackerGeralAutoScan && hackerGeralLink && !isHackingGeral) {
      interval = setInterval(() => {
        const now = new Date();
        const randomSeconds = Math.floor(Math.random() * 60);
        const time = new Date(now.getTime() + 2 * 60000 + (randomSeconds * 1000));
        const multipliers = ["2.0x+", "5.0x+", "10.0x+", "20.0x+"];
        const mult = multipliers[Math.floor(Math.random() * multipliers.length)];
        
        const newSignal: Signal = {
          id: Math.random().toString(36).substring(7),
          time: time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          timestamp: time.getTime(),
          house: "HACKER GERAL",
          type: mult.includes("2.0x") ? CandleType.PURPLE : CandleType.PINK,
          probability: 99.8 + (Math.random() * 0.2),
          multiplier: mult,
          status: SignalStatus.WAITING
        };

        setHackerGeralSignals(prev => {
          if (prev.some(s => s.time === newSignal.time)) return prev;
          return [newSignal, ...prev].slice(0, 50);
        });
        
        triggerToast("Varredura Automática: Novo sinal detectado!");
      }, 45000);
    }
    return () => clearInterval(interval);
  }, [hackerGeralAutoScan, hackerGeralLink, isHackingGeral, triggerToast]);

  const analyzeManually = (id: string) => {
    setAgendaData(prev => prev.map(h => h.id === id ? { ...h, isGraphAnalyzing: true } : h));
    setTimeout(() => {
      setAgendaData(prev => prev.map(h => {
        if (h.id === id) {
          const newPaying = 30 + Math.random() * 65;
          return {
            ...h,
            paying: newPaying,
            reclining: 100 - newPaying,
            graphStatus: (newPaying > 75 ? 'BOM' : newPaying > 55 ? 'RAZOAVEL' : 'RUIM') as GraphStatus,
            isGraphAnalyzing: false
          };
        }
        return h;
      }));
      triggerToast("Análise de Ciclo Concluída!");
    }, 1200);
  };

  const analyzeAll = () => {
    setIsGlobalLoading(true);
    setTimeout(() => {
      setAgendaData(prev => prev.map(h => {
        const newPaying = 35 + Math.random() * 60;
        return {
          ...h,
          paying: newPaying,
          reclining: 100 - newPaying,
          graphStatus: (newPaying > 75 ? 'BOM' : newPaying > 55 ? 'RAZOAVEL' : 'RUIM') as GraphStatus,
          efronInsight: LOCAL_STRATEGIES[Math.floor(Math.random() * LOCAL_STRATEGIES.length)]
        };
      }));
      setIsGlobalLoading(false);
      triggerToast("Agenda Recalculada!");
    }, 1500);
  };

  const copyQuickAgenda = (item: AgendaItem) => {
    const text = `🏛️ *CASA:* ${item.house}\n📈 *PAYOUT:* ${item.paying.toFixed(0)}%\n📊 *STATUS:* ${item.graphStatus}\n🕒 *HORA:* ${new Date().toLocaleTimeString()}\n\n🤖 *venom.b55(hack) Elite*`;
    navigator.clipboard.writeText(text);
    triggerToast("Status Copiado!");
  };

  const copyAgendaFull = (item: AgendaItem) => {
    const text = `💎 *VENOM ELITE - AGENDA* 💎\n\n🏛️ *CASA:* ${item.house.toUpperCase()}\n📊 *STATUS:* ${item.graphStatus}\n📈 *PAYOUT:* ${item.paying.toFixed(0)}%\n🛡️ *INSIGHT:* "${item.efronInsight}"\n🕒 *HORA:* ${new Date().toLocaleTimeString()}\n\n🤖 *venom.b55(hack) Elite*`;
    navigator.clipboard.writeText(text);
    triggerToast("Agenda Elite Copiada!");
  };

  const shareAgendaFull = () => {
    const text = `💎 *VENOM ELITE - STATUS* 💎\n\n` + 
      agendaData.map(item => `🏛️ ${item.house}: ${item.paying.toFixed(0)}% [${item.graphStatus}]`).join('\n') + 
      `\n\n🤖 *venom.b55(hack) Elite*`;
    if (navigator.share) {
      navigator.share({ title: 'Status Venom Elite', text: text }).catch(() => triggerToast("Erro ao compartilhar"));
    } else {
      navigator.clipboard.writeText(text);
      triggerToast("Copiado!");
    }
  };

  const generateSignals = useCallback(async () => {
    if (!selectedHouse) return;
    const finalNum = Math.min(5600, numSignals);
    setIsGlobalLoading(true);
    
    let mentorAnalysis = "Análise de semente concluída. Injetando padrões de alta precisão.";
    
    if (aiInstance) {
      try {
        const response = await aiInstance.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Você é o MENTOR VENOM, um hacker de elite em Moçambique especializado no jogo Aviator. 
          Analise a casa ${selectedHouse.name}. 
          Gere uma frase curta, impactante e técnica (máximo 15 palavras) em português de Moçambique sobre a brecha atual no algoritmo e a precisão dos sinais Venom. 
          Use termos como "seed", "hash", "padrão" ou "injeção".`
        });
        mentorAnalysis = response.text || mentorAnalysis;
        setMentorAnalysis(mentorAnalysis);
      } catch (err) {
        console.error("AI Analysis Error:", err);
      }
    }

    setTimeout(() => {
      const newSignals: Signal[] = [];
      const now = new Date();
      
      // Ajuste de intervalo para velas de 5x (PINK) ou 4x (Modo Hacker)
      const baseInterval = (selectedCandle === CandleType.PINK || isModoHacker) ? 12 : settings.minInterval;
      const initialOffset = (selectedCandle === CandleType.PINK || isModoHacker) ? 8 : 2;
      const basePrecision = (selectedCandle === CandleType.PINK || isModoHacker) ? 99.9 : settings.precision;

      for (let i = 0; i < finalNum; i++) {
        const randomSeconds = Math.floor(Math.random() * 60);
        const jitter = (selectedCandle === CandleType.PINK || isModoHacker) ? Math.floor(Math.random() * 5) : 0;
        const time = new Date(now.getTime() + (i * baseInterval + initialOffset + jitter) * 60000 + (randomSeconds * 1000));
        
        let multiplier = "2.0x+";
        if (isModoHacker) multiplier = "4.0x+";
        else if (selectedCandle === CandleType.PINK) multiplier = "5.0x+";

        newSignals.push({
          id: Math.random().toString(36).substring(7),
          time: time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          timestamp: time.getTime(),
          house: selectedHouse.name,
          type: (selectedCandle === CandleType.PINK || isModoHacker) ? CandleType.PINK : CandleType.PURPLE,
          probability: basePrecision + (Math.random() * (100.0 - basePrecision)),
          multiplier: multiplier,
          status: SignalStatus.WAITING
        });
      }
      setSignals(newSignals);
      setIsGlobalLoading(false);
      triggerToast(mentorAnalysis);
      setActiveScreen(AppScreen.VIRTUAL_BOT);
      setIsModoHacker(false);
    }, 1500);
  }, [selectedHouse, selectedCandle, numSignals, settings, triggerToast, isModoHacker, aiInstance]);

  const generateHackerGeralSignals = useCallback(() => {
    if (!hackerGeralLink) {
      triggerToast("Insira o link da casa!");
      return;
    }
    
    setIsHackingGeral(true);
    setHackerGeralProgress(0);
    setHackerGeralCountdown(8); // Increased for analysis phase
    setHackerGeralStatus("Analisando Fluxo de Pagamento...");
    setHackerGeralIsPaying(null);
    setHackerGeralSignals([]);

    // Analysis Phase (First 3 seconds)
    setTimeout(() => {
      const isPaying = Math.random() > 0.3; // 70% chance of paying for simulation
      setHackerGeralIsPaying(isPaying);
      
      if (!isPaying) {
        setHackerGeralStatus("CASA NÃO ESTÁ PAGANDO! ABORTANDO...");
        setHackerGeralProgress(0);
        setHackerGeralCountdown(0);
        setTimeout(() => {
          setIsHackingGeral(false);
          triggerToast("ALERTA: Casa com baixa taxa de retorno!");
        }, 2000);
        return;
      }

      setHackerGeralStatus("CASA PAGANDO! INICIANDO HACK...");
      setHackerGeralProgress(30);

      // Countdown timer for the rest
      const countdownInterval = setInterval(() => {
        setHackerGeralCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownInterval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      // Progress and Status updates
      const steps = [
        { p: 45, s: "Bypassing Cloudflare..." },
        { p: 65, s: "Interceptando Websockets..." },
        { p: 85, s: "Extraindo Padrões de Algoritmo..." },
        { p: 100, s: "Finalizando Hooking..." }
      ];

      steps.forEach((step, index) => {
        setTimeout(() => {
          setHackerGeralProgress(step.p);
          setHackerGeralStatus(step.s);
          
          if (index === steps.length - 1) {
            setTimeout(() => {
              const newSignals: Signal[] = [];
              const now = new Date();
              const multipliers = ["2.0x+", "5.0x+", "10.0x+", "20.0x+"];
              
              for (let i = 0; i < hackerGeralNumSignals; i++) {
                const randomSeconds = Math.floor(Math.random() * 60);
                const interval = 5 + Math.floor(Math.random() * 15);
                const time = new Date(now.getTime() + (i * interval + 5) * 60000 + (randomSeconds * 1000));
                const mult = multipliers[Math.floor(Math.random() * multipliers.length)];
                
                newSignals.push({
                  id: Math.random().toString(36).substring(7),
                  time: time.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                  timestamp: time.getTime(),
                  house: "HACKER GERAL",
                  type: mult.includes("2.0x") ? CandleType.PURPLE : CandleType.PINK,
                  probability: 99.8 + (Math.random() * 0.2),
                  multiplier: mult,
                  status: SignalStatus.WAITING
                });
              }
              setHackerGeralSignals(newSignals);
              setIsHackingGeral(false);
              setHackerGeralProgress(0);
              triggerToast("Hooking Completo! Sinais 99% Assertivos.");
            }, 500);
          }
        }, (index + 1) * 1000);
      });
    }, 3000);
  }, [hackerGeralLink, hackerGeralNumSignals, triggerToast]);

  const recalibrate = () => {
    setIsGlobalLoading(true);
    triggerToast("Recalibrando Algoritmo Venom...");
    setTimeout(() => {
      setSettings(prev => ({ ...prev, precision: 99.9 }));
      setIsGlobalLoading(false);
      triggerToast("Calibração Elite Concluída! Assertividade Máxima.");
    }, 2000);
  };

  const copySignal = (sig: Signal) => {
    const text = `💎 *VENOM ELITE - SINAL CONFIRMADO* 💎\n\n🏛️ *CASA:* ${sig.house.toUpperCase()}\n⏰ *HORARIO:* ${sig.time}\n🎯 *ALVO:* ${sig.multiplier}\n🔥 *ASSERTIVIDADE:* ${sig.probability.toFixed(1)}%\n\n✅ *ENTRADA AUTORIZADA (99.9% ELITE)*\n🤖 *venom.b55 (hack) Elite*`;
    navigator.clipboard.writeText(text);
    triggerToast("Sinal Copiado!");
  };

  const copyAllSignals = () => {
    if (signals.length === 0) return;
    const houseName = selectedHouse?.name.toUpperCase() || "SISTEMA";
    const body = signals.slice(0, 50).map(sig => `⏰ ${sig.time} -> ${sig.multiplier}`).join('\n');
    const text = `💎 *VENOM ELITE - LISTA DE SINAIS* 💎\n\n🏛️ *CASA:* ${houseName}\n🔥 *ASSERTIVIDADE:* 99.9% ELITE\n\n${body}\n\n🤖 *venom.b55 (hack) Elite*`;
    navigator.clipboard.writeText(text);
    triggerToast("Lista Copiada!");
  };

  const shareAllSignals = () => {
    if (signals.length === 0) return;
    const houseName = selectedHouse?.name.toUpperCase() || "SISTEMA";
    const body = signals.slice(0, 50).map(sig => `⏰ ${sig.time} -> ${sig.multiplier}`).join('\n');
    const text = `💎 *VENOM ELITE - LISTA DE SINAIS* 💎\n\n🏛️ *CASA:* ${houseName}\n🔥 *ASSERTIVIDADE:* 99.9% ELITE\n\n${body}\n\n🤖 *venom.b55 (hack) Elite*`;
    if (navigator.share) {
      navigator.share({ title: `Sinais ${houseName}`, text: text }).catch(() => triggerToast("Erro ao compartilhar"));
    } else {
      navigator.clipboard.writeText(text);
      triggerToast("Copiados!");
    }
  };

  const checkSignalStatus = (id: string) => {
    setSignals(prev => prev.map(s => {
      if (s.id === id) {
        const statuses = [SignalStatus.WIN, SignalStatus.LOSS, SignalStatus.ACTIVE];
        const newStatus = statuses[Math.floor(Math.random() * statuses.length)];
        return { ...s, status: newStatus };
      }
      return s;
    }));
    triggerToast("Verificando Sincronização...");
  };

  const clearSignals = () => {
    setSignals([]);
    triggerToast("Sinais Limpos!");
  };

  const [mentorChatInput, setMentorChatInput] = useState('');

  const handleMentorChat = async () => {
    if (!mentorChatInput.trim() || !aiInstance) return;
    
    const userMsg: SupportMessage = {
      id: Math.random().toString(36).substring(7),
      text: mentorChatInput,
      timestamp: Date.now(),
      isUser: true
    };
    
    setSupportMessages(prev => [userMsg, ...prev]);
    const currentInput = mentorChatInput;
    setMentorChatInput('');
    setIsGlobalLoading(true);
    
    try {
      const response = await aiInstance.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Você é o MENTOR VENOM, um hacker de elite em Moçambique. O usuário perguntou: "${currentInput}". 
        Responda de forma curta, direta, impactante e com tom de expert. 
        Use gírias técnicas de hacker e mencione a realidade das apostas em Moçambique (Premier Bet, 888Starz, Elephant Bet). 
        Máximo 30 palavras. Seja motivador mas realista sobre gestão de banca.`
      });
      
      if (!response || !response.text) {
        throw new Error("Resposta vazia do mentor.");
      }
      
      const text = response.text;
      
      const mentorMsg: SupportMessage = {
        id: Math.random().toString(36).substring(7),
        text: text,
        timestamp: Date.now()
      };
      
      setSupportMessages(prev => [mentorMsg, ...prev]);
    } catch (err) {
      console.error("Mentor Chat Error:", err);
      triggerToast("Mentor indisponível.");
    } finally {
      setIsGlobalLoading(false);
    }
  };

  const generateMotivationalMessage = useCallback(async () => {
    if (!aiInstance) {
      triggerToast("Mentor offline. Tente novamente.");
      return;
    }
    setIsGlobalLoading(true);
    try {
      const response = await aiInstance.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: 'Gere uma mensagem curta de motivação e estratégia para um apostador de Aviator em Moçambique. Use um tom de mentor "hacker" elite, seja direto e impactante. Mencione a importância de sair no lucro e não ser ganancioso. Use termos como "extração", "lucro no bolso" e "disciplina de ferro".'
      });
      
      if (!response || !response.text) {
        throw new Error("Resposta vazia do mentor.");
      }
      
      const text = response.text;
      
      const newMsg: SupportMessage = {
        id: Math.random().toString(36).substring(7),
        text: text,
        timestamp: Date.now()
      };
      
      setSupportMessages(prev => [newMsg, ...prev]);
      triggerToast("Insight do Mentor Recebido!");
    } catch (err) {
      console.error("Gemini Error:", err);
      triggerToast("Falha ao sincronizar com mentor.");
    } finally {
      setIsGlobalLoading(false);
    }
  }, []);

  const onLogoClick = () => setActiveScreen(AppScreen.SETTINGS);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#05070a] flex items-center justify-center">
        <div className="animate-pulse text-accent font-black tracking-widest uppercase text-[10px]">Iniciando Protocolo...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#05070a] flex flex-col items-center justify-center p-8 space-y-8">
        <div className="w-20 h-20 bg-accent rounded-3xl flex items-center justify-center shadow-[0_0_30px_rgba(0,255,157,0.3)]">
          <span className="text-3xl font-black text-black">V55</span>
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-black text-primary">VENOM <span className="text-accent italic">ELITE</span></h1>
          <p className="text-[10px] text-secondary font-black uppercase tracking-widest">Autenticação Necessária</p>
        </div>
        <button 
          onClick={handleGoogleSignIn}
          className="w-full max-w-xs py-5 bg-white text-black rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 shadow-xl active:scale-95 transition-all"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Entrar com Google
        </button>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <Layout 
      activeScreen={activeScreen} 
      setScreen={setActiveScreen} 
      title={selectedHouse?.name} 
      themeConfig={themeConfig}
      onLogoClick={onLogoClick}
    >
      <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[999] w-[90%] max-w-[380px] pointer-events-none flex flex-col gap-2">
        {notifications.map(notif => (
          <div 
            key={notif.id}
            className={`pointer-events-auto p-4 rounded-2xl glass-card flex items-start gap-3 shadow-2xl animate-in slide-in-from-top-10 duration-500 border-l-4 ${
              notif.type === 'info' ? 'border-l-blue-500' : 
              notif.type === 'alert' ? 'border-l-yellow-500' : 
              notif.type === 'success' ? 'border-l-emerald-500' : 'border-l-rose-600'
            }`}
          >
            <div className={`mt-1 w-2 h-2 rounded-full ${
              notif.type === 'info' ? 'bg-blue-500' : 
              notif.type === 'alert' ? 'bg-yellow-500' : 
              notif.type === 'success' ? 'bg-emerald-500' : 'bg-rose-600 animate-pulse'
            }`} />
            <div className="flex-1">
              <p className="text-[10px] font-black uppercase tracking-widest text-secondary opacity-60 mb-1">Sistema Venom Alerta</p>
              <p className="text-[11px] font-bold text-primary leading-tight">{notif.message}</p>
            </div>
          </div>
        ))}
      </div>

      {toast.show && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[1000] bg-white text-black px-5 py-2 rounded-full font-black text-[9px] uppercase shadow-2xl animate-in zoom-in">
          {toast.message}
        </div>
      )}

      {isGlobalLoading && (
        <div className="fixed inset-0 bg-[#05070a]/98 z-[2000] flex flex-col items-center justify-center p-12 overflow-hidden">
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <div className="h-full w-full bg-[linear-gradient(rgba(0,255,157,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,157,0.1)_1px,transparent_1px)] bg-[size:20px_20px]" />
          </div>
          <div className="relative">
            <div className="w-16 h-16 border-t-2 border-b-2 border-accent rounded-full animate-spin mb-8 shadow-[0_0_20px_rgba(0,255,157,0.3)]"></div>
            <div className="absolute inset-0 w-16 h-16 border-r-2 border-l-2 border-accent/20 rounded-full animate-reverse-spin"></div>
          </div>
          <div className="space-y-3 text-center">
            <p className="text-accent font-mono text-[9px] font-black uppercase tracking-[0.6em] animate-pulse">Injetando Protocolo</p>
            <div className="flex gap-1 justify-center">
              <div className="w-1 h-1 bg-accent rounded-full animate-bounce [animation-delay:-0.3s]" />
              <div className="w-1 h-1 bg-accent rounded-full animate-bounce [animation-delay:-0.15s]" />
              <div className="w-1 h-1 bg-accent rounded-full animate-bounce" />
            </div>
          </div>
          <div className="mt-12 w-48 h-1 bg-white/5 rounded-full overflow-hidden border border-white/10">
            <div className="h-full bg-accent animate-progress-fast shadow-[0_0_10px_rgba(0,255,157,0.5)]" />
          </div>
          <p className="mt-4 text-[7px] font-mono text-secondary/40 uppercase tracking-widest">Sincronizando com Mentor Venom...</p>
        </div>
      )}

      {activeScreen === AppScreen.SETTINGS && (
        <div className="px-5 space-y-6 pb-20 animate-in slide-in-from-top-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-black text-primary">System <span className="text-accent">Elite</span></h2>
          </div>

          <div className="space-y-4">
            <div className="glass-card p-5 rounded-3xl space-y-4">
              <h3 className="text-[9px] font-black text-accent uppercase tracking-widest border-b border-white/5 pb-2">Status do Algoritmo</h3>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-secondary uppercase font-bold">Versão</span>
                  <span className="text-[10px] text-primary font-black">Venom.Elite-v6.0</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-secondary uppercase font-bold">Assertividade Base</span>
                  <span className="text-[10px] text-emerald-400 font-black">99.8%</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-secondary uppercase font-bold">Modo Elite</span>
                  <span className="text-[10px] text-accent font-black">ATIVADO</span>
                </div>
                <button 
                  onClick={recalibrate}
                  className="w-full py-2.5 bg-accent/10 border border-accent/20 text-accent rounded-xl font-black text-[8px] uppercase tracking-widest active:scale-95 transition-all"
                >
                  Forçar Recalibração (99.9%)
                </button>
              </div>
            </div>

            <div className="glass-card p-5 rounded-3xl space-y-4">
              <h3 className="text-[9px] font-black text-accent uppercase tracking-widest border-b border-white/5 pb-2">Configurações de API</h3>
              <p className="text-[10px] text-secondary leading-relaxed">
                Se você estiver atingindo limites de cota (429), você pode usar sua própria chave de API do Google Cloud paga.
              </p>
              <button 
                onClick={handleOpenKeySelector}
                className={`w-full py-3 rounded-xl font-bold text-[9px] uppercase tracking-wider border transition-all flex items-center justify-center gap-2 ${hasApiKey ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-white/5 text-secondary border-white/5'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
                {hasApiKey ? 'Chave de API Vinculada' : 'Vincular Chave de API Própria'}
              </button>
              <a 
                href="https://ai.google.dev/gemini-api/docs/billing" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-[8px] text-accent underline block text-center uppercase tracking-widest"
              >
                Saiba mais sobre faturamento
              </a>
            </div>

            <div className="glass-card p-5 rounded-3xl space-y-4">
              <h3 className="text-[9px] font-black text-accent uppercase tracking-widest border-b border-white/5 pb-2">Selecione o Visual</h3>
              <div className="grid grid-cols-2 gap-2">
                {PREDEFINED_THEMES.map(t => (
                  <button key={t.id} onClick={() => setThemeConfig(t)} 
                    className={`py-2.5 rounded-xl font-bold text-[9px] uppercase tracking-wider border transition-all ${themeConfig.id === t.id ? 'bg-accent text-black border-accent' : 'bg-white/5 text-secondary border-white/5'}`}>
                    {t.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="glass-card p-5 rounded-3xl space-y-4">
              <h3 className="text-[9px] font-black text-accent uppercase tracking-widest border-b border-white/5 pb-2">Criar Customizado</h3>
              <div className="space-y-4">
                 <div className="flex items-center gap-2 overflow-x-auto pb-2">
                    {['#00FF9D', '#00D1FF', '#BD00FF', '#FF3B3B', '#FFD700', '#FF8A00', '#FF007A', '#FFFFFF'].map(c => (
                      <button key={c} onClick={() => setThemeConfig({...themeConfig, accentColor: c, id: 'custom', name: 'Custom Theme'})}
                        style={{ backgroundColor: c }} className={`min-w-[32px] h-8 rounded-lg border-2 ${themeConfig.accentColor === c ? 'border-accent' : 'border-white/10'}`} />
                    ))}
                 </div>
                 <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-[9px] font-bold text-secondary uppercase">Brilho <span>{themeConfig.brightness}%</span></div>
                      <input type="range" min="50" max="150" value={themeConfig.brightness} onChange={e => setThemeConfig({...themeConfig, brightness: parseInt(e.target.value)})} className="w-full h-1 bg-white/5 rounded-full accent-accent" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-[9px] font-bold text-secondary uppercase">Contraste <span>{themeConfig.contrast}%</span></div>
                      <input type="range" min="50" max="150" value={themeConfig.contrast} onChange={e => setThemeConfig({...themeConfig, contrast: parseInt(e.target.value)})} className="w-full h-1 bg-white/5 rounded-full accent-accent" />
                    </div>
                 </div>
              </div>
            </div>

            <button onClick={() => { triggerToast("Acessando..."); setActiveScreen(AppScreen.HOUSE_SELECTION); }} 
              className="w-full py-4 bg-accent text-black rounded-2xl font-black text-[10px] uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all">Sincronizar Protocolo</button>

            <button onClick={logout} 
              className="w-full py-4 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-2xl font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all">Encerrar Sessão (Logout)</button>
          </div>
        </div>
      )}

      {activeScreen === AppScreen.HOUSE_SELECTION && (
        <div className="px-4 space-y-6 pb-20 animate-in fade-in duration-500">
          <div className="text-center space-y-1">
            <h2 className="text-2xl font-black text-primary tracking-tight">Tools <span className="text-accent">Selection</span></h2>
            <p className="text-[8px] text-secondary uppercase tracking-[0.3em] font-black">Moçambique Intelligence Hub</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {BETTING_HOUSES.map(h => (
              <button key={h.id} onClick={() => { setSelectedHouse(h); setActiveScreen(AppScreen.HACK_GENERATOR); }}
                className="glass-card p-4 rounded-3xl flex flex-col items-center text-center gap-3 transition-all hover:bg-white/[0.05] hover:scale-[1.03] active:scale-95 border border-white/5 group">
                <div className={`w-14 h-14 ${h.color} rounded-2xl flex items-center justify-center text-3xl border border-white/10 shadow-lg group-hover:rotate-6 transition-transform`}>{h.logo}</div>
                <div className="space-y-1">
                  <span className="text-xs font-black text-primary block tracking-tight">{h.name}</span>
                  <div className="flex items-center justify-center gap-1 opacity-60">
                    <span className="w-1 h-1 rounded-full bg-accent animate-pulse"></span>
                    <span className="text-[7px] font-mono text-accent uppercase tracking-widest font-bold">Online</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeScreen === AppScreen.HACK_GENERATOR && (
        <div className="px-5 space-y-6 pb-20 animate-in zoom-in-95">
           <div className="flex items-center gap-3">
              <button onClick={() => setActiveScreen(AppScreen.HOUSE_SELECTION)} className="w-8 h-8 bg-white/5 rounded-lg flex items-center justify-center text-secondary border border-white/5">←</button>
              <h3 className="font-black text-lg text-primary">{selectedHouse?.name}</h3>
           </div>

           <div className="glass-card p-6 rounded-[2rem] space-y-8 border border-white/5 relative">
              <div className="space-y-4">
                 <span className="text-[9px] text-secondary uppercase tracking-[0.2em] font-black block text-center">Hackear Gerar (Multiplicador)</span>
                 <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => setSelectedCandle(CandleType.PURPLE)} 
                      className={`py-6 rounded-2xl border-2 font-black transition-all flex flex-col items-center gap-2 ${selectedCandle === CandleType.PURPLE ? 'bg-purple-600/20 border-purple-500 text-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.2)]' : 'bg-[#080b15] border-white/5 text-secondary opacity-50'}`}
                    >
                      <span className="text-2xl">🟣</span>
                      <span className="text-[12px] uppercase tracking-tighter">VELA 2X+</span>
                      <span className="text-[7px] font-bold opacity-60">CONSERVADOR</span>
                    </button>
                    <button 
                      onClick={() => setIsModoHacker(true)} 
                      className={`py-6 rounded-2xl border-2 font-black transition-all flex flex-col items-center gap-2 ${isModoHacker ? 'bg-accent/20 border-accent text-accent shadow-[0_0_20px_rgba(0,255,157,0.2)]' : 'bg-[#080b15] border-white/5 text-secondary opacity-50'}`}
                    >
                      <span className="text-2xl">⚡</span>
                      <span className="text-[12px] uppercase tracking-tighter">MODO HACKER</span>
                      <span className="text-[7px] font-bold opacity-60">INJEÇÃO DE SEED</span>
                    </button>
                 </div>
              </div>

              {isModoHacker && (
                <div className="glass-card p-5 rounded-3xl border border-accent/20 bg-accent/5 animate-in zoom-in-95 space-y-4">
                  <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <span className="text-[9px] font-black text-accent uppercase tracking-widest">Configuração de Semente</span>
                    <button onClick={() => setIsModoHacker(false)} className="text-secondary hover:text-white text-xs">✕</button>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[7px] text-secondary uppercase font-bold">Link da Casa</label>
                      <input 
                        type="text" 
                        value={hackerLink}
                        onChange={e => setHackerLink(e.target.value)}
                        placeholder="https://elephantbet.co.mz"
                        className="w-full bg-black/40 border border-white/10 rounded-xl py-2.5 px-3 text-[10px] text-primary outline-none focus:border-accent/30"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[7px] text-secondary uppercase font-bold">Semente do Servidor (Última Rodada)</label>
                      <input 
                        type="text" 
                        value={serverSeed}
                        onChange={e => setServerSeed(e.target.value)}
                        placeholder="Ex: 8f2a...9c1e"
                        className="w-full bg-black/40 border border-white/10 rounded-xl py-2.5 px-3 text-[10px] text-primary outline-none focus:border-accent/30"
                      />
                    </div>
                    <button 
                      onClick={() => {
                        if(!hackerLink || !serverSeed) {
                          triggerToast("Preencha todos os campos!");
                          return;
                        }
                        generateSignals();
                      }}
                      className="w-full py-3 bg-accent text-black rounded-xl font-black text-[9px] uppercase tracking-widest shadow-lg active:scale-95 transition-all"
                    >
                      Injetar e Gerar 4.0x
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-4 text-center border-t border-white/5 pt-8">
                 <span className="text-[9px] text-secondary uppercase tracking-[0.2em] font-black block">Quantidade de Entradas</span>
                 <div className="flex flex-col items-center gap-4">
                   <input 
                      type="number" 
                      min="1" 
                      max="5600"
                      value={numSignals} 
                      onChange={e => setNumSignals(Math.min(5600, parseInt(e.target.value) || 0))}
                      className="w-full bg-transparent font-black text-6xl text-center text-primary outline-none tabular-nums" 
                      placeholder="10"
                   />
                   <div className="flex flex-wrap justify-center gap-2">
                      {[10, 25, 50, 100, 500, 1000].map(v => (
                        <button key={v} onClick={() => setNumSignals(v)} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 text-[8px] font-black text-secondary hover:text-accent uppercase transition-all">{v}</button>
                      ))}
                   </div>
                 </div>
              </div>

              <div className="space-y-3">
                <button onClick={generateSignals} className="w-full py-5 bg-accent text-black rounded-2xl font-black text-[12px] uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all">Hackear Sinais</button>
                <button onClick={recalibrate} className="w-full py-3 bg-white/5 border border-white/10 text-secondary rounded-xl font-black text-[10px] uppercase tracking-[0.1em] active:scale-95 transition-all">Recalibrar Algoritmo (Elite)</button>
              </div>
           </div>
        </div>
      )}

      {activeScreen === AppScreen.HACKER_GERAL && (
        <div className="px-5 space-y-6 pb-20 animate-in fade-in">
          <div className="text-center space-y-1">
             <div className="inline-block px-3 py-1 bg-accent/10 border border-accent/20 rounded-full">
                <p className="text-[7px] text-accent uppercase tracking-widest font-black">Módulo Hacker Geral Ativo</p>
             </div>
             <h2 className="text-2xl font-black text-primary italic">Hacker <span className="text-accent">Geral</span></h2>
             <p className="text-[8px] text-secondary uppercase tracking-[0.3em] font-black">Injeção de Link Direta</p>
          </div>

          <div className="glass-card p-6 rounded-[2rem] space-y-6 border border-white/5 relative overflow-hidden">
            {isHackingGeral && (
              <div className="absolute inset-0 bg-black/90 backdrop-blur-md z-20 flex flex-col items-center justify-center p-8 space-y-6">
                <div className="relative">
                  <div className="w-24 h-24 border-4 border-white/5 rounded-full"></div>
                  <div className="absolute inset-0 border-4 border-accent border-t-transparent rounded-full animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl font-black text-accent">{hackerGeralCountdown}s</span>
                  </div>
                </div>
                
                <div className="w-full space-y-2">
                  <div className="flex justify-between text-[8px] font-black text-accent uppercase tracking-widest">
                    <span>{hackerGeralStatus}</span>
                    <span>{hackerGeralProgress}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-accent transition-all duration-500 ease-out shadow-[0_0_10px_rgba(0,255,157,0.5)]"
                      style={{ width: `${hackerGeralProgress}%` }}
                    ></div>
                  </div>
                </div>
                
                <p className="text-[7px] font-mono text-secondary/60 animate-pulse">ESTABLISHING ENCRYPTED TUNNEL...</p>
              </div>
            )}
            
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-[9px] text-secondary uppercase tracking-[0.2em] font-black block">Link da Casa de Aposta</label>
                  <span className="text-[7px] font-mono text-accent animate-pulse">SSL: SECURE</span>
                </div>
                <input 
                  type="text" 
                  value={hackerGeralLink}
                  onChange={e => setHackerGeralLink(e.target.value)}
                  placeholder="https://exemplo.com"
                  className="w-full bg-[#080b15] border border-white/5 rounded-xl py-4 px-4 text-xs font-bold text-primary outline-none focus:border-accent/30 transition-all"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[9px] text-secondary uppercase tracking-[0.2em] font-black block text-center">Quantidade de Sinais</label>
                <div className="flex items-center justify-center gap-4">
                  <button onClick={() => setHackerGeralNumSignals(Math.max(1, hackerGeralNumSignals - 5))} className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-primary font-black border border-white/5">-</button>
                  <span className="text-4xl font-black text-primary tabular-nums">{hackerGeralNumSignals}</span>
                  <button onClick={() => setHackerGeralNumSignals(Math.min(100, hackerGeralNumSignals + 5))} className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-primary font-black border border-white/5">+</button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-[7px] text-secondary uppercase tracking-[0.2em] font-black block">Nível de Risco</label>
                  <select 
                    value={hackerGeralRisk}
                    onChange={e => setHackerGeralRisk(e.target.value as any)}
                    className="w-full bg-[#080b15] border border-white/5 rounded-xl py-2.5 px-3 text-[9px] font-bold text-primary outline-none"
                  >
                    <option value="LOW">BAIXO (SEGURO)</option>
                    <option value="MED">MÉDIO (EQUILIBRADO)</option>
                    <option value="HIGH">ALTO (AGRESSIVO)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[7px] text-secondary uppercase tracking-[0.2em] font-black block">Região do Servidor</label>
                  <select 
                    value={hackerGeralRegion}
                    onChange={e => setHackerGeralRegion(e.target.value)}
                    className="w-full bg-[#080b15] border border-white/5 rounded-xl py-2.5 px-3 text-[9px] font-bold text-primary outline-none"
                  >
                    <option value="MOZAMBIQUE">MOÇAMBIQUE</option>
                    <option value="SOUTH_AFRICA">ÁFRICA DO SUL</option>
                    <option value="EUROPE">EUROPA (PROXY)</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                <div className="flex flex-col">
                  <span className="text-[8px] font-black text-primary uppercase">Varredura Automática</span>
                  <span className="text-[6px] text-secondary uppercase">Monitorar link continuamente</span>
                </div>
                <button 
                  onClick={() => setHackerGeralAutoScan(!hackerGeralAutoScan)}
                  className={`w-10 h-5 rounded-full relative transition-all ${hackerGeralAutoScan ? 'bg-accent shadow-[0_0_10px_rgba(0,255,157,0.3)] animate-pulse' : 'bg-white/10'}`}
                >
                  <div className={`absolute top-1 w-3 h-3 bg-black rounded-full transition-all ${hackerGeralAutoScan ? 'left-6' : 'left-1'}`}></div>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/5 p-4 rounded-2xl border border-white/5 text-center relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-0.5 bg-accent/20"></div>
                  <span className="text-[7px] font-bold text-secondary uppercase block mb-1">Precisão</span>
                  <span className="text-lg font-black text-accent">99.8%</span>
                </div>
                <div className="bg-white/5 p-4 rounded-2xl border border-white/5 text-center relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-0.5 bg-emerald-500/20"></div>
                  <span className="text-[7px] font-bold text-secondary uppercase block mb-1">Status</span>
                  <span className={`text-lg font-black ${hackerGeralIsPaying === false ? 'text-rose-500' : 'text-emerald-500'}`}>
                    {hackerGeralIsPaying === null ? 'READY' : hackerGeralIsPaying ? 'PAGANDO' : 'NÃO PAGA'}
                  </span>
                </div>
              </div>

              <button 
                onClick={generateHackerGeralSignals}
                disabled={isHackingGeral}
                className="w-full py-5 bg-accent text-black rounded-2xl font-black text-[12px] uppercase tracking-[0.2em] shadow-xl active:scale-95 transition-all disabled:opacity-50"
              >
                {isHackingGeral ? 'Hackeando...' : 'Gerar Previsões Assertivas'}
              </button>

              <button 
                onClick={recalibrate}
                disabled={isHackingGeral}
                className="w-full py-3 bg-white/5 border border-white/10 text-secondary rounded-xl font-black text-[10px] uppercase tracking-[0.1em] active:scale-95 transition-all"
              >
                Recalibrar Algoritmo (Elite)
              </button>
            </div>
          </div>

          <div className="glass-card p-4 rounded-3xl border border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[8px] font-black text-secondary uppercase tracking-widest">Hacker Console</span>
              <div className="flex gap-1">
                <div className="w-1 h-1 rounded-full bg-accent animate-ping"></div>
                <div className="w-1 h-1 rounded-full bg-accent"></div>
              </div>
            </div>
            <div className="font-mono text-[7px] text-secondary/60 space-y-1 max-h-24 overflow-y-auto">
              <p className="">[INFO] Handshake established with {hackerGeralLink || 'remote_host'}</p>
              <p className="">[SCAN] Analyzing payout flow for {hackerGeralLink || 'target'}...</p>
              {hackerGeralIsPaying !== null && (
                <p className={hackerGeralIsPaying ? 'text-emerald-500' : 'text-rose-500'}>
                  [RESULT] House Status: {hackerGeralIsPaying ? 'PAYING (SIM)' : 'NOT PAYING (NÃO)'}
                </p>
              )}
              {isHackingGeral && <p className="animate-pulse">[DATA] Intercepting websocket packets...</p>}
              {isHackingGeral && <p className="">[AUTH] Session token extracted: 0x{Math.random().toString(16).substring(2, 10)}</p>}
              {hackerGeralAutoScan && hackerGeralLink && !isHackingGeral && (
                <p className="text-accent animate-pulse">[AUTO-SCAN] Monitorando link em tempo real...</p>
              )}
              {hackerGeralSignals.length > 0 && <p className="text-accent/60">[SUCCESS] Algorithm synchronized with server time</p>}
            </div>
          </div>

          {hackerGeralSignals.length > 0 && (
            <div className="space-y-4 animate-in slide-in-from-bottom-4">
              <div className="flex items-center justify-between px-2">
                <h3 className="text-[10px] font-black text-primary uppercase tracking-widest">Previsões Geradas</h3>
                <button onClick={() => setHackerGeralSignals([])} className="text-[8px] font-black text-rose-500 uppercase">Limpar</button>
              </div>
              <div className="space-y-3">
                {hackerGeralSignals.map((s) => (
                  <div key={s.id} className="glass-card p-4 rounded-3xl flex items-center justify-between border border-white/5 relative overflow-hidden">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl font-black text-primary tabular-nums">{s.time}</span>
                        <span className="text-[7px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded uppercase">99.9% Elite</span>
                      </div>
                      <span className={`text-[10px] font-black uppercase mt-1 ${s.type === CandleType.PINK ? 'text-pink-500' : 'text-purple-600'}`}>
                        Alvo: {s.multiplier}
                      </span>
                    </div>
                    <button 
                      onClick={() => { navigator.clipboard.writeText(`SINAL HACKER GERAL\n⏰ ${s.time}\n🎯 ${s.multiplier}\n🔥 99.9% Elite`); triggerToast("Copiado!"); }}
                      className="px-4 py-2 bg-white/5 border border-white/10 text-primary rounded-xl font-black text-[8px] uppercase tracking-widest hover:bg-accent hover:text-black transition-all"
                    >
                      COPIAR
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeScreen === AppScreen.VIRTUAL_BOT && (
        <div className="px-5 space-y-6 pb-20 animate-in fade-in">
          <div className="text-center space-y-1">
             <div className="inline-block px-3 py-1 bg-accent/10 border border-accent/20 rounded-full">
                <p className="text-[7px] text-accent uppercase tracking-widest font-black">Hack Venom Elite Confirmado</p>
             </div>
             <h2 className="text-2xl font-black text-primary italic">Sala <span className="text-accent">Elite</span></h2>
             {selectedHouse && (
               <div className="flex items-center justify-center gap-2 mt-2">
                 <span className="text-[10px] font-black text-secondary uppercase tracking-widest">Servidor Ativo:</span>
                 <span className="text-[10px] font-black text-accent uppercase tracking-widest">{selectedHouse.name}</span>
               </div>
             )}
          </div>

          <div className="grid grid-cols-3 gap-2">
              <button onClick={copyAllSignals} className="py-3 bg-white text-black rounded-xl font-black text-[8px] uppercase tracking-widest shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all">Copiar</button>
              <button onClick={shareAllSignals} className="py-3 bg-accent text-black rounded-xl font-black text-[8px] uppercase tracking-widest shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all">Enviar</button>
              <button onClick={clearSignals} className="py-3 bg-rose-500/20 text-rose-500 border border-rose-500/30 rounded-xl font-black text-[8px] uppercase tracking-widest shadow-xl flex items-center justify-center gap-2 active:scale-95 transition-all">Limpar</button>
          </div>

          <div className="space-y-4">
            {signals.slice(0, 40).map((s) => (
              <div key={s.id} className="glass-card p-5 rounded-[2.2rem] flex items-center justify-between border border-white/5 group transition-all hover:bg-white/[0.05] relative overflow-hidden">
                 <div className={`absolute top-0 left-0 w-1 h-full ${s.type === CandleType.PINK ? 'bg-pink-500' : 'bg-purple-600'}`}></div>
                 <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-3xl font-black text-primary tabular-nums tracking-tighter leading-none">{s.time}</span>
                      <span className="text-[7px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded uppercase">Elite</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${s.type === CandleType.PINK ? 'bg-pink-500/20 text-pink-500' : 'bg-purple-600/20 text-purple-600'}`}>
                        {s.multiplier}
                      </span>
                      {s.status && (
                        <span className={`text-[7px] font-black uppercase px-2 py-0.5 rounded ${
                          s.status === SignalStatus.WIN ? 'bg-emerald-500 text-black' : 
                          s.status === SignalStatus.LOSS ? 'bg-rose-500 text-white' : 'bg-blue-500 text-white'
                        }`}>
                          {s.status}
                        </span>
                      )}
                    </div>
                 </div>
                 <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                      <span className="text-[8px] font-black text-emerald-500 uppercase">99.9% Elite</span>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => copySignal(s)} className="p-2 bg-white/5 border border-white/10 text-primary rounded-lg font-black text-[8px] uppercase tracking-widest hover:bg-accent hover:text-black transition-all active:scale-90">C</button>
                      <button onClick={() => checkSignalStatus(s.id)} className="p-2 bg-accent/10 border border-accent/20 text-accent rounded-lg font-black text-[8px] uppercase tracking-widest hover:bg-accent hover:text-black transition-all active:scale-90">V</button>
                    </div>
                 </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeScreen === AppScreen.AGENDA && (
        <div className="px-4 space-y-6 pb-20 animate-in slide-in-from-bottom-5">
          <div className="text-center space-y-1">
            <h2 className="text-2xl font-black text-primary italic">Elite <span className="text-accent">Agenda</span></h2>
            <p className="text-[8px] text-secondary font-mono uppercase tracking-[0.3em] font-black">Ciclos Pagadores</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={analyzeAll} className="py-3 bg-white/5 text-secondary rounded-xl font-black text-[9px] uppercase tracking-widest border border-white/5 transition-all active:scale-95">Recalcular</button>
            <button onClick={shareAgendaFull} className="py-3 bg-accent text-black rounded-xl font-black text-[9px] uppercase tracking-widest transition-all active:scale-95">Relatório</button>
          </div>

          <div className="space-y-3">
            {agendaData.map(item => (
              <div key={item.id} className="glass-card rounded-[1.8rem] p-4 space-y-4 border border-white/5">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-2xl border border-white/5">{item.logo}</div>
                    <div>
                       <h3 className="font-black text-sm text-primary tracking-tight">{item.house}</h3>
                       <div className="flex items-center gap-1.5">
                         <span className={`w-1 h-1 rounded-full ${item.graphStatus === 'BOM' ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
                         <span className="text-[7px] font-black text-secondary uppercase tracking-widest">{item.graphStatus}</span>
                       </div>
                    </div>
                  </div>
                  <button onClick={() => analyzeManually(item.id)} className={`w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-secondary hover:text-accent transition-all ${item.isGraphAnalyzing ? 'animate-spin' : ''}`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-[#080b15] p-2.5 rounded-xl border border-white/[0.03] text-center">
                    <span className="text-[7px] font-bold text-secondary uppercase block">Pagar</span>
                    <span className="text-xl font-black text-emerald-400">{item.paying.toFixed(0)}%</span>
                  </div>
                  <div className="bg-[#080b15] p-2.5 rounded-xl border border-white/[0.03] text-center">
                    <span className="text-[7px] font-bold text-secondary uppercase block">Retenção</span>
                    <span className="text-xl font-black text-rose-500">{item.reclining.toFixed(0)}%</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <button onClick={() => copyQuickAgenda(item)} className="py-2.5 bg-white/5 text-secondary text-[8px] font-black uppercase rounded-lg">Quick</button>
                  <button onClick={() => copyAgendaFull(item)} className="py-2.5 bg-white text-black text-[8px] font-black uppercase rounded-lg">Elite</button>
                  <button onClick={() => { setSelectedHouse(BETTING_HOUSES.find(h => h.id === item.id) || null); setActiveScreen(AppScreen.HACK_GENERATOR); }} className="py-2.5 bg-accent text-black text-[8px] font-black uppercase rounded-lg">Start</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeScreen === AppScreen.SIGNAL_ROOM && (
        <div className="px-5 pb-20">
          <div className="mb-8 text-center space-y-1">
             <h2 className="text-xl font-black text-primary">System <span className="text-accent">Logs</span></h2>
             <p className="text-[8px] text-secondary font-mono uppercase tracking-[0.4em] font-bold">Terminal Moçambique</p>
          </div>
          <SignalHistory history={signals} mentorAnalysis={mentorAnalysis} onRemove={id => setSignals(s => s.filter(x => x.id !== id))} onClearAll={() => { setSignals([]); setMentorAnalysis(''); }} onCopy={() => triggerToast("Copiado!")} currentTime={currentTime} />
        </div>
      )}

      {activeScreen === AppScreen.SUPPORT && (
        <div className="px-5 space-y-6 pb-20 animate-in fade-in">
          <div className="text-center space-y-3">
             <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center mx-auto border border-white/10 shadow-lg">
                <svg className="w-7 h-7 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
             </div>
             <h2 className="text-xl font-black text-primary italic">Mentor <span className="text-accent">Protocol</span></h2>
          </div>

          <div className="space-y-4">
            <div className="flex gap-2">
              <input 
                type="text"
                value={mentorChatInput}
                onChange={e => setMentorChatInput(e.target.value)}
                onKeyPress={e => e.key === 'Enter' && handleMentorChat()}
                placeholder="Pergunte ao Mentor..."
                className="flex-1 bg-black/40 border border-white/10 rounded-2xl py-4 px-5 text-[10px] text-primary outline-none focus:border-accent/50 transition-all"
              />
              <button 
                onClick={handleMentorChat}
                className="px-6 bg-white text-black rounded-2xl text-[9px] font-black uppercase shadow-lg active:scale-95 transition-all"
              >
                Enviar
              </button>
            </div>
            
            <button onClick={generateMotivationalMessage} className="w-full py-4 bg-accent/10 border border-accent/20 text-accent rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-xl active:scale-95 transition-all">Sincronizar Apoio</button>
            
            <div className="grid grid-cols-1 gap-3">
              {supportMessages.map(msg => (
                <div key={msg.id} className={`p-5 rounded-3xl space-y-3 border ${msg.isUser ? 'bg-white/5 border-white/10 ml-8' : 'glass-card border-white/5 mr-8'}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-[7px] font-black uppercase tracking-widest ${msg.isUser ? 'text-secondary' : 'text-accent'}`}>
                      {msg.isUser ? 'VOCÊ' : 'MENTOR VENOM'}
                    </span>
                    <span className="text-[6px] text-secondary/40 font-mono">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className={`text-[10px] leading-relaxed ${msg.isUser ? 'text-secondary' : 'text-primary font-medium italic'}`}>
                    {msg.isUser ? msg.text : `"${msg.text}"`}
                  </p>
                  {!msg.isUser && (
                    <div className="flex gap-2 pt-2">
                      <button onClick={() => { navigator.clipboard.writeText(`${msg.text}\n\nVenom elite`); triggerToast("Copiado!"); }} className="flex-1 py-2 bg-white/5 border border-white/5 text-primary text-[8px] font-black uppercase rounded-lg">Copiar</button>
                      <button onClick={() => { if(navigator.share) navigator.share({text: `${msg.text}\n\nVenom elite`}); }} className="flex-1 py-2 bg-accent/10 border border-accent/20 text-accent text-[8px] font-black uppercase rounded-lg">Share</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeScreen === AppScreen.LOGIN && (
        <div className="min-h-[80vh] flex flex-col items-center justify-center px-8 space-y-10 animate-in fade-in zoom-in-95">
          <div className="text-center space-y-4">
            <div className="w-20 h-20 bg-accent rounded-3xl flex items-center justify-center mx-auto shadow-[0_0_30px_rgba(0,255,157,0.3)] border border-white/20">
              <span className="text-3xl font-black text-black">V55</span>
            </div>
            <div className="space-y-1">
              <h1 className="text-3xl font-black text-primary tracking-tighter">VENOM <span className="text-accent italic">ELITE</span></h1>
              <p className="text-[10px] text-secondary font-black uppercase tracking-[0.4em]">Protocolo de Acesso</p>
            </div>
          </div>

          {!isBotOpen ? (
            <div className="glass-card p-8 rounded-[2.5rem] border border-rose-500/30 bg-rose-500/5 text-center space-y-4 w-full">
              <div className="w-12 h-12 bg-rose-500/20 rounded-2xl flex items-center justify-center mx-auto text-rose-500">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
              </div>
              <h3 className="text-sm font-black text-rose-500 uppercase tracking-widest">BOT FECHADO</h3>
              <p className="text-xs font-bold text-secondary leading-relaxed uppercase">{botClosedMessage}</p>
              <button onClick={() => setActiveScreen(AppScreen.ADMIN_PANEL)} className="text-[8px] font-black text-secondary/40 hover:text-accent uppercase tracking-widest pt-4">Painel Admin</button>
            </div>
          ) : (
            <div className="w-full space-y-6">
              <div className="space-y-2">
                <label className="text-[9px] font-black text-secondary uppercase tracking-widest ml-2">Chave de Acesso</label>
                <input 
                  type="password" 
                  value={loginInput}
                  onChange={e => setLoginInput(e.target.value)}
                  placeholder="DIGITE SUA CHAVE..."
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-5 px-6 text-sm font-black text-primary outline-none focus:border-accent/30 transition-all text-center tracking-[0.5em]"
                />
              </div>
              <button 
                onClick={handleLogin}
                className="w-full py-5 bg-accent text-black rounded-2xl font-black text-xs uppercase tracking-[0.3em] shadow-[0_10px_30px_rgba(0,255,157,0.2)] active:scale-95 transition-all"
              >
                Entrar no Sistema
              </button>
              <button 
                onClick={() => setIsPricingModalOpen(true)}
                className="w-full py-4 bg-white/5 border border-white/10 text-primary rounded-2xl font-black text-[10px] uppercase tracking-widest active:scale-95 transition-all"
              >
                Comprar Acesso
              </button>
              <div className="flex justify-center">
                <button onClick={() => setActiveScreen(AppScreen.ADMIN_PANEL)} className="text-[8px] font-black text-secondary/40 hover:text-accent uppercase tracking-widest">Painel Admin</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pricing Modal */}
      {isPricingModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/90 backdrop-blur-xl animate-in fade-in zoom-in-95">
          <div className="glass-card w-full max-w-sm rounded-[2.5rem] border border-white/10 p-8 space-y-8 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-accent/20 overflow-hidden">
              <div className="h-full bg-accent animate-pulse w-1/2"></div>
            </div>
            
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-black text-primary italic">Tabela de <span className="text-accent">Preços</span></h2>
              <button onClick={() => { setIsPricingModalOpen(false); setIsSelectingAdmin(false); setSelectedPlan(null); }} className="text-secondary hover:text-primary">✕</button>
            </div>

            {!isSelectingAdmin ? (
              <div className="space-y-3">
                {PRICING_PLANS.map(plan => (
                  <button 
                    key={plan.name}
                    onClick={() => { setSelectedPlan(plan); setIsSelectingAdmin(true); }}
                    className="w-full flex items-center justify-between p-5 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-accent/30 hover:bg-white/[0.05] transition-all group"
                  >
                    <span className="text-[10px] font-black text-primary uppercase tracking-widest group-hover:text-accent">{plan.name}</span>
                    <span className="text-xs font-black text-accent">{plan.price}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="space-y-6 animate-in slide-in-from-right-10">
                <div className="text-center space-y-2">
                  <p className="text-[8px] font-black text-secondary uppercase tracking-widest">Plano Selecionado</p>
                  <h3 className="text-lg font-black text-accent">{selectedPlan?.name} - {selectedPlan?.price}</h3>
                </div>
                <div className="space-y-3">
                  <p className="text-[9px] font-black text-primary text-center uppercase tracking-widest">Escolha um Administrador</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => handleBuyAccess(selectedPlan?.name || '', 'ADM 1')}
                      className="py-6 bg-white/5 border border-white/10 rounded-2xl flex flex-col items-center gap-2 hover:border-accent/50 transition-all"
                    >
                      <span className="text-xs font-black text-primary">ADM 1</span>
                      <span className="text-[7px] text-secondary font-bold">845550673</span>
                    </button>
                    <button 
                      onClick={() => handleBuyAccess(selectedPlan?.name || '', 'ADM 2')}
                      className="py-6 bg-white/5 border border-white/10 rounded-2xl flex flex-col items-center gap-2 hover:border-accent/50 transition-all"
                    >
                      <span className="text-xs font-black text-primary">ADM 2</span>
                      <span className="text-[7px] text-secondary font-bold">873361445</span>
                    </button>
                  </div>
                  <button 
                    onClick={() => setIsSelectingAdmin(false)}
                    className="w-full py-3 text-[8px] font-black text-secondary uppercase tracking-widest"
                  >
                    ← Voltar aos Planos
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Ban Confirmation Modal */}
      {isBanConfirmOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/95 backdrop-blur-2xl animate-in fade-in zoom-in-95">
          <div className="glass-card w-full max-w-xs rounded-[2rem] border border-white/10 p-8 space-y-6 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-red-500/20 overflow-hidden">
              <div className="h-full bg-red-500 animate-pulse w-full"></div>
            </div>
            
            <div className="w-16 h-16 bg-red-500/10 border border-red-500/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-black text-primary uppercase italic">Confirmar <span className="text-red-500">Ação</span></h3>
              <p className="text-[10px] text-secondary font-bold uppercase tracking-widest leading-relaxed">
                Você tem certeza que deseja {userKeys.find(u => u.key === keyToToggle)?.isBanned ? 'DESBANIR' : 'BANIR'} este usuário?
              </p>
              <div className="bg-white/5 p-2 rounded-lg mt-2">
                <code className="text-accent font-mono text-xs">{keyToToggle}</code>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-4">
              <button 
                onClick={() => { setIsBanConfirmOpen(false); setKeyToToggle(null); }}
                className="py-4 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black text-secondary uppercase tracking-widest hover:bg-white/10 transition-all"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmToggleBan}
                className="py-4 rounded-2xl bg-red-500/20 border border-red-500/50 text-[10px] font-black text-red-500 uppercase tracking-widest hover:bg-red-500/30 transition-all shadow-[0_0_20px_rgba(239,68,68,0.2)]"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-black/95 backdrop-blur-2xl animate-in fade-in zoom-in-95">
          <div className="glass-card w-full max-w-xs rounded-[2rem] border border-white/10 p-8 space-y-6 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-red-600/20 overflow-hidden">
              <div className="h-full bg-red-600 animate-pulse w-full"></div>
            </div>
            
            <div className="w-16 h-16 bg-red-600/10 border border-red-600/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-black text-primary uppercase italic">Excluir <span className="text-red-600">Chave</span></h3>
              <p className="text-[10px] text-secondary font-bold uppercase tracking-widest leading-relaxed">
                Esta ação é irreversível. Deseja realmente EXCLUIR esta chave de acesso?
              </p>
              <div className="bg-white/5 p-2 rounded-lg mt-2">
                <code className="text-accent font-mono text-xs">{keyToDelete}</code>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-4">
              <button 
                onClick={() => { setIsDeleteConfirmOpen(false); setKeyToDelete(null); }}
                className="py-4 rounded-2xl bg-white/5 border border-white/10 text-[10px] font-black text-secondary uppercase tracking-widest hover:bg-white/10 transition-all"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmDeleteKey}
                className="py-4 rounded-2xl bg-red-600/20 border border-red-600/50 text-[10px] font-black text-red-600 uppercase tracking-widest hover:bg-red-600/30 transition-all shadow-[0_0_20px_rgba(220,38,38,0.2)]"
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {activeScreen === AppScreen.ADMIN_PANEL && (
        <div className="px-6 py-8 space-y-8 pb-32 animate-in slide-in-from-bottom-10">
          <div className="flex items-center justify-between">
            <button onClick={() => { setIsAdminLoggedIn(false); setActiveScreen(AppScreen.LOGIN); }} className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-secondary border border-white/5">✕</button>
            <h2 className="text-xl font-black text-primary italic">Admin <span className="text-accent">Panel</span></h2>
            <div className="w-10 h-10"></div>
          </div>

          {!isAdminLoggedIn ? (
            <div className="glass-card p-8 rounded-[2.5rem] border border-white/5 space-y-6">
              <div className="text-center space-y-2">
                <span className="text-[9px] font-black text-accent uppercase tracking-widest">Segurança Máxima</span>
                <h3 className="text-lg font-black text-primary">Acesso Restrito</h3>
              </div>
              <div className="space-y-2">
                <input 
                  type="password" 
                  value={adminLoginInput}
                  onChange={e => setAdminLoginInput(e.target.value)}
                  placeholder="SENHA DO PAINEL..."
                  className="w-full bg-black/40 border border-white/10 rounded-2xl py-4 px-4 text-xs font-black text-primary outline-none text-center tracking-[0.3em]"
                />
              </div>
              <button 
                onClick={handleAdminLogin}
                className="w-full py-4 bg-white text-black rounded-2xl font-black text-[10px] uppercase tracking-widest"
              >
                Desbloquear Painel
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Bot Status Control */}
              <div className="glass-card p-6 rounded-3xl border border-white/5 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] font-black text-primary uppercase">Status do Bot</span>
                  <button 
                    onClick={() => updateBotStatus(!isBotOpen)}
                    className={`px-4 py-2 rounded-xl font-black text-[8px] uppercase tracking-widest transition-all ${isBotOpen ? 'bg-emerald-500 text-black' : 'bg-rose-500 text-white'}`}
                  >
                    {isBotOpen ? 'ABERTO' : 'FECHADO'}
                  </button>
                </div>
                <div className="space-y-2">
                  <label className="text-[8px] font-bold text-secondary uppercase">Mensagem de Manutenção</label>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={newBotMessageInput}
                      onChange={e => setNewBotMessageInput(e.target.value)}
                      placeholder="NOVA MENSAGEM..."
                      className="flex-1 bg-black/40 border border-white/10 rounded-xl py-2 px-3 text-[10px] text-primary outline-none"
                    />
                    <button onClick={updateBotMessage} className="px-4 bg-white/5 border border-white/10 text-primary rounded-xl text-[8px] font-black uppercase">OK</button>
                  </div>
                </div>
              </div>

              {/* User Management */}
              <div className="glass-card p-6 rounded-3xl border border-white/5 space-y-6">
                <div className="space-y-4">
                  <h3 className="text-[10px] font-black text-accent uppercase tracking-widest">Gerenciar Acessos</h3>
                  <div className="space-y-3">
                    <input 
                      type="text" 
                      value={newKeyInput}
                      onChange={e => setNewKeyInput(e.target.value)}
                      placeholder="NOME DA CHAVE..."
                      className="w-full bg-black/40 border border-white/10 rounded-xl py-3 px-4 text-[10px] text-primary outline-none"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <label className="text-[7px] text-secondary uppercase font-bold ml-1">Dias</label>
                        <input 
                          type="number" 
                          value={newKeyDays}
                          onChange={e => setNewKeyDays(e.target.value)}
                          placeholder="0"
                          className="w-full bg-black/40 border border-white/10 rounded-xl py-2 px-3 text-[10px] text-primary outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[7px] text-secondary uppercase font-bold ml-1">Horas</label>
                        <input 
                          type="number" 
                          value={newKeyHours}
                          onChange={e => setNewKeyHours(e.target.value)}
                          placeholder="0"
                          className="w-full bg-black/40 border border-white/10 rounded-xl py-2 px-3 text-[10px] text-primary outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[7px] text-secondary uppercase font-bold ml-1">Minutos</label>
                        <input 
                          type="number" 
                          value={newKeyMinutes}
                          onChange={e => setNewKeyMinutes(e.target.value)}
                          placeholder="0"
                          className="w-full bg-black/40 border border-white/10 rounded-xl py-2 px-3 text-[10px] text-primary outline-none"
                        />
                      </div>
                    </div>
                    <button onClick={createNewKey} className="w-full py-3 bg-accent text-black rounded-xl text-[9px] font-black uppercase shadow-lg active:scale-95 transition-all">Criar Acesso</button>
                    <p className="text-[7px] text-secondary/60 uppercase italic text-center">* Deixe campos vazios para acesso permanente</p>
                  </div>
                </div>

                <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                  {userKeys.map(user => (
                    <div key={user.key} className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-primary tracking-tight">{user.key}</p>
                        <div className="flex items-center gap-2">
                          <span className={`text-[7px] font-black uppercase ${user.isBanned ? 'text-rose-500' : 'text-emerald-500'}`}>
                            {user.isBanned ? 'BANIDO' : 'ATIVO'}
                          </span>
                          {user.expiresAt && !user.isBanned && (
                            <span className="text-[7px] font-mono text-accent">
                              Expira em: {formatTimeRemaining(user.expiresAt)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => toggleBan(user.key)}
                          className={`w-8 h-8 rounded-lg flex items-center justify-center border ${user.isBanned ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'bg-rose-500/10 border-rose-500/30 text-rose-500'}`}
                        >
                          {user.isBanned ? '✓' : '∅'}
                        </button>
                        <button 
                          onClick={() => deleteKey(user.key)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/10 text-secondary"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Admin Password Change */}
              <div className="glass-card p-6 rounded-3xl border border-white/5 space-y-4">
                <h3 className="text-[10px] font-black text-accent uppercase tracking-widest">Mudar Senha Painel</h3>
                <div className="flex gap-2">
                  <input 
                    type="password" 
                    value={newAdminPassInput}
                    onChange={e => setNewAdminPassInput(e.target.value)}
                    placeholder="NOVA SENHA ADMIN..."
                    className="flex-1 bg-black/40 border border-white/10 rounded-xl py-3 px-4 text-[10px] text-primary outline-none"
                  />
                  <button onClick={updateAdminPassword} className="px-6 bg-white text-black rounded-xl text-[9px] font-black uppercase">Mudar</button>
                </div>
              </div>

              <button onClick={adminLogout} className="w-full py-4 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-2xl font-black text-[10px] uppercase tracking-widest">Sair do Painel</button>
            </div>
          )}
        </div>
      )}
    </Layout>
    </ErrorBoundary>
  );
};

export default App;
