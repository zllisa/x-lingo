import { Tabs } from 'expo-router';
import { Text } from 'react-native';

export default function TabLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: '#7c5cfc',
      tabBarInactiveTintColor: '#a09db8',
      tabBarStyle: { backgroundColor: '#ffffff', borderTopColor: '#e4e1f0', borderTopWidth: 1, paddingTop: 4, paddingBottom: 20, height: 72 },
      tabBarLabelStyle: { fontSize: 10, fontWeight: '500' as const },
    }}>
      <Tabs.Screen name="speak" options={{ title: '口语', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>💬</Text> }} />
      <Tabs.Screen name="listen" options={{ title: '精听', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🎧</Text> }} />
      <Tabs.Screen name="library" options={{ title: '学习库', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>📚</Text> }} />
      <Tabs.Screen name="profile" options={{ title: '我的', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>👤</Text> }} />
    </Tabs>
  );
}
