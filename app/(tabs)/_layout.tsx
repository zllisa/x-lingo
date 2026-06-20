import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BookOpen, Headphones, MessageCircle, User } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LibraryScreen from './library';
import ListenScreen from './listen';
import ProfileScreen from './profile';
import SpeakScreen from './speak';

export type TabParamList = {
  Speak: undefined;
  Listen: undefined;
  Library: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: '#7c5cfc',
      tabBarInactiveTintColor: '#a09db8',
      tabBarStyle: { backgroundColor: '#ffffff', borderTopColor: '#e4e1f0', borderTopWidth: 1, paddingTop: 6, paddingBottom: insets.bottom || 6, height: 40 + (insets.bottom || 0) },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '500' as const },
    }}>
      <Tab.Screen name="Speak" component={SpeakScreen} options={{ title: '口语', tabBarIcon: ({ color, size }) => <MessageCircle size={size ?? 24} color={color} /> }} />
      <Tab.Screen name="Listen" component={ListenScreen} options={{ title: '精听', tabBarIcon: ({ color, size }) => <Headphones size={size ?? 24} color={color} /> }} />
      <Tab.Screen name="Library" component={LibraryScreen} options={{ title: '学习库', tabBarIcon: ({ color, size }) => <BookOpen size={size ?? 24} color={color} /> }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: '我的', tabBarIcon: ({ color, size }) => <User size={size ?? 24} color={color} /> }} />
    </Tab.Navigator>
  );
}
