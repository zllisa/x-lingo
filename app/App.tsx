import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar, ActivityIndicator, View, Text, Image } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/useAuthStore';
import { useProfileStore } from '../stores/useProfileStore';
import { useLibraryStore } from '../stores/useLibraryStore';
import { useListenStore } from '../stores/useListenStore';
import { useSpeakStore } from '../stores/useSpeakStore';
import { useUsageStore } from '../stores/useUsageStore';
import { S } from '../utils/theme';
import TabLayout from './(tabs)/_layout';
import ChatScreen from './speak/chat';
import TaskIntroScreen from './speak/task-intro';
import ConversationsScreen from './speak/conversations';
import WordDetailModal from './modals/word-detail';
import SentenceDetailModal from './modals/sentence-detail';
import PlayerScreen from './listen/player';
import CalendarScreen from './calendar';
import LoginScreen from './auth/login';
import MembershipScreen from './membership';

export type RootStackParamList = {
  Tabs: undefined;
  Chat: undefined;
  TaskIntro: undefined;
  Conversations: undefined;
  Player: undefined;
  Calendar: undefined;
  Membership: undefined;
  WordDetail: { word: string; source: string };
  SentenceDetail: { text: string; source: string };
  Login: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const queryClient = new QueryClient();

export default function App() {
  const restoreSession = useAuthStore(s => s.restoreSession);
  const isLoggedIn = useAuthStore(s => s.isLoggedIn);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    restoreSession().finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      useProfileStore.getState().loadCheckinsFromCloud();
      useLibraryStore.getState().loadWordsFromCloud();
      useLibraryStore.getState().loadSentencesFromCloud();
      useListenStore.getState().loadFromCloud();
      useSpeakStore.getState().loadFromCloud();
      useUsageStore.getState().initialize();
    }
  }, [isLoggedIn]);

  if (checking) {
    return (
      <View style={[S.flex1, S.center, S.bg]}>
        <Image source={require('../assets/icon.png')} style={{ width: 72, height: 72, borderRadius: 18, marginBottom: 20 }} />
        <ActivityIndicator size="large" color="#7c5cfc" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={S.flex1}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
          <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={isLoggedIn ? 'Tabs' : 'Login'}>
              <Stack.Screen name="Tabs" component={TabLayout} />
              {/* 禁用侧滑返回：聊天页要用右滑锁定语音，两者会冲突；返回用页面内的「返回」按钮 */}
              <Stack.Screen name="Chat" component={ChatScreen} options={{ gestureEnabled: false }} />
              <Stack.Screen name="TaskIntro" component={TaskIntroScreen} />
              <Stack.Screen name="Conversations" component={ConversationsScreen} />
              {/* 播放器底部有横向进度拖动；关闭原生侧滑返回，返回仍使用页头按钮。 */}
              <Stack.Screen name="Player" component={PlayerScreen} options={{ gestureEnabled: false }} />
              <Stack.Screen name="Calendar" component={CalendarScreen} />
              <Stack.Screen name="WordDetail" component={WordDetailModal} options={{ presentation: 'transparentModal' }} />
              <Stack.Screen name="SentenceDetail" component={SentenceDetailModal} options={{ presentation: 'transparentModal' }} />
              <Stack.Screen name="Login" component={LoginScreen} />
              <Stack.Screen name="Membership" component={MembershipScreen} />
            </Stack.Navigator>
          </NavigationContainer>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
