import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, Image, KeyboardAvoidingView, Platform, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../stores/useAuthStore';
import { C, S } from '../../utils/theme';
import { RootStackParamList } from '../App';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export default function LoginScreen() {
  const navigation = useNavigation<Nav>();
  const { login, register } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('提示', '请输入邮箱和密码');
      return;
    }
    if (password.length < 6) {
      Alert.alert('提示', '密码至少 6 位');
      return;
    }
    setLoading(true);
    // 先尝试登录，失败则自动注册
    const result = await login(email.trim(), password);
    if (!result.error) {
      setLoading(false);
      navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
      return;
    }
    // 登录失败 → 自动注册
    const regResult = await register(email.trim(), password);
    setLoading(false);
    if (regResult.error) Alert.alert('失败', regResult.error);
    else navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
  };

  return (
    <SafeAreaView style={[S.flex1, S.bg]} edges={['top']}>
      <KeyboardAvoidingView style={S.flex1} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[S.flex1, S.center, S.px5]}>
          <View style={{ marginBottom: 18, shadowColor: C.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6 }}>
            <Image source={require('../../assets/icon.png')} style={{ width: 76, height: 76, borderRadius: 18 }} />
          </View>
          <Text style={[{ fontSize: 30, fontWeight: '700', letterSpacing: -0.5 }, S.text, { marginBottom: 8 }]}>K-lingo</Text>
          <Text style={[{ fontSize: 15 }, S.text3, { marginBottom: 32 }]}>首次自动注册，之后直接登录</Text>

          <TextInput
            style={[S.bgSurface, S.border, S.roundedCard, S.px4, S.text, { width: '100%', height: 54, fontSize: 16, marginBottom: 14 }]}
            placeholder="邮箱"
            placeholderTextColor={C.text3}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextInput
            style={[S.bgSurface, S.border, S.roundedCard, S.px4, S.text, { width: '100%', height: 54, fontSize: 16, marginBottom: 24 }]}
            placeholder="密码（至少 6 位）"
            placeholderTextColor={C.text3}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity
            style={[S.bgAccent, S.roundedFull, { width: '100%', height: 56 }, S.center, { shadowColor: C.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 4 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            <Text style={[S.textWhite, S.semibold, { fontSize: 17 }]}>{loading ? '请稍候...' : '登录'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={{ marginTop: 28 }} onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] })}>
            <Text style={[{ fontSize: 14 }, S.text3]}>跳过，本地使用</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
