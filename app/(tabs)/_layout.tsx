import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import SpeakScreen from './speak';
import ListenScreen from './listen';
import LibraryScreen from './library';
import ProfileScreen from './profile';

export type TabParamList = {
  Speak: undefined;
  Listen: undefined;
  Library: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export default function TabLayout() {
  return (
    <Tab.Navigator screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: '#7c5cfc',
      tabBarInactiveTintColor: '#a09db8',
      tabBarStyle: { backgroundColor: '#ffffff', borderTopColor: '#e4e1f0', borderTopWidth: 1, paddingTop: 4, paddingBottom: 20, height: 72 },
      tabBarLabelStyle: { fontSize: 10, fontWeight: '500' as const },
    }}>
      <Tab.Screen name="Speak" component={SpeakScreen} options={{ title: '口语', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>💬</Text> }} />
      <Tab.Screen name="Listen" component={ListenScreen} options={{ title: '精听', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🎧</Text> }} />
      <Tab.Screen name="Library" component={LibraryScreen} options={{ title: '学习库', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>📚</Text> }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: '我的', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>👤</Text> }} />
    </Tab.Navigator>
  );
}
