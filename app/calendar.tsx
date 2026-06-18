import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useState, useMemo } from 'react';
import { useProfileStore } from '../stores/useProfileStore';
import { S, C } from '../utils/theme';

export default function CalendarScreen() {
  const navigation = useNavigation();
  const checkinDates = useProfileStore(s => s.checkinDates);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const today = now.toISOString().slice(0, 10);

  const days = useMemo(() => {
    const firstDay = new Date(year, month - 1, 1);
    const startDow = firstDay.getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    const prevMonthDays = new Date(year, month - 1, 0).getDate();
    const result: { date: string; day: number; isCurrentMonth: boolean; isToday: boolean }[] = [];

    for (let i = startDow - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const m = month === 1 ? 12 : month - 1;
      const y = month === 1 ? year - 1 : year;
      result.push({ date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, day: d, isCurrentMonth: false, isToday: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      result.push({ date: ds, day: d, isCurrentMonth: true, isToday: ds === today });
    }
    const remaining = 42 - result.length;
    for (let d = 1; d <= remaining; d++) {
      const m = month === 12 ? 1 : month + 1;
      const y = month === 12 ? year + 1 : year;
      result.push({ date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, day: d, isCurrentMonth: false, isToday: false });
    }
    return result;
  }, [year, month, today]);

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const sortedDates = [...checkinDates].sort((a, b) => b.localeCompare(a));

  return (
    <SafeAreaView style={[S.flex1, S.bg]} edges={['top']}>
      <View style={[S.flexRow, S.spaceBetween, S.itemsCenter, S.px4, S.py3, S.borderBottom]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[S.textSm, S.textAccent, S.semibold]}>← 返回</Text>
        </TouchableOpacity>
        <Text style={[S.textBase, S.bold, S.text]}>📅 打卡日历</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={[S.bgSurface, S.border, S.roundedCard, S.p4, S.mx4, S.mt4]}>
          <View style={[S.flexRow, S.spaceBetween, S.itemsCenter, S.mb3]}>
            <TouchableOpacity onPress={prevMonth}><Text style={[S.textLg, S.text]}>{'‹'}</Text></TouchableOpacity>
            <Text style={[S.textBase, S.bold, S.text]}>{year}年 {month}月</Text>
            <TouchableOpacity onPress={nextMonth}><Text style={[S.textLg, S.text]}>{'›'}</Text></TouchableOpacity>
          </View>
          <View style={[S.row, S.mb1]}>
            {['日', '一', '二', '三', '四', '五', '六'].map(d => <View key={d} style={[S.flex1, S.itemsCenter, S.py1]}><Text style={[S.textXs, S.text3]}>{d}</Text></View>)}
          </View>
          {Array.from({ length: 6 }).map((_, row) => (
            <View key={row} style={S.row}>
              {days.slice(row * 7, row * 7 + 7).map(({ date, day, isCurrentMonth, isToday }) => {
                const checked = checkinDates.includes(date);
                return (
                  <View key={date} style={[S.flex1, S.aspect1, S.roundedFull, S.center, { margin: 2 }, checked ? { backgroundColor: 'rgba(0,184,148,0.2)' } : undefined, isToday && !checked ? { borderWidth: 2, borderColor: C.accent } : undefined]}>
                    <Text style={[{ fontSize: 12 }, !isCurrentMonth ? S.text3 : checked ? [S.textGreen, S.bold] : S.text]}>{checked ? '🔥' : day}</Text>
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        <Text style={[S.textSm, S.semibold, S.text, S.mt5, S.mb2, S.px4]}>📋 全部打卡记录 ({checkinDates.length} 次)</Text>
        {sortedDates.length === 0 ? (
          <View style={[S.itemsCenter, { paddingVertical: 40 }]}><Text style={S.text3}>暂无打卡记录</Text></View>
        ) : (
          sortedDates.map((date, index) => (
            <View key={date} style={[S.flexRow, S.itemsCenter, S.py2, S.px4, S.borderBottom]}>
              <Text style={[S.textXl, S.mr3]}>🔥</Text>
              <View style={S.flex1}>
                <Text style={[S.textSm, S.text, S.semibold]}>{date} ({['日', '一', '二', '三', '四', '五', '六'][new Date(date).getDay()]})</Text>
                <Text style={[S.textXs, S.text3]}>第 {sortedDates.length - index} 次打卡</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
