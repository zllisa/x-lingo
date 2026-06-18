-- 在 Supabase SQL Editor 中执行以下 SQL 建表
-- 路径：Supabase 控制台 → SQL Editor → New query → 粘贴 → Run

-- 学习记录
CREATE TABLE IF NOT EXISTS study_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  speak_rounds INTEGER DEFAULT 0,
  listen_count INTEGER DEFAULT 0,
  duration_minutes INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 打卡记录
CREATE TABLE IF NOT EXISTS checkins (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  checkin_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, checkin_date)
);

-- 生词本
CREATE TABLE IF NOT EXISTS vocabulary (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  word_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 收藏句库
CREATE TABLE IF NOT EXISTS sentences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users NOT NULL,
  sentence_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 允许用户读取自己的数据（Row Level Security）
ALTER TABLE study_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary ENABLE ROW LEVEL SECURITY;
ALTER TABLE sentences ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can read own study_records" ON study_records FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own study_records" ON study_records FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own checkins" ON checkins FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own checkins" ON checkins FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own vocabulary" ON vocabulary FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own vocabulary" ON vocabulary FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own vocabulary" ON vocabulary FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can read own sentences" ON sentences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own sentences" ON sentences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own sentences" ON sentences FOR DELETE USING (auth.uid() = user_id);
