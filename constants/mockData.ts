import { Topic, AudioFile, TranscriptItem, Word, SavedSentence } from '../types';

export const MOCK_TOPICS: Topic[] = [
  { id: '1', name: '일상 대화', nameCN: '日常生活', icon: '🏠', progress: '1/3', questions: ['오늘 뭐 했어요?', '주말에 보통 뭐 해요?', '아침에 뭐 먹었어요?'] },
  { id: '2', name: '직장 한국어', nameCN: '职场韩语', icon: '💼', progress: '0/3', questions: ['어떤 일을 하세요?', '회의는 몇 시에 시작해요?', '이 서류 좀 확인해 주세요.'] },
  { id: '3', name: 'TOPIK 말하기', nameCN: 'TOPIK 口语备考', icon: '📝', progress: '0/3', questions: ['자기소개를 해 주세요.', '한국어를 공부하는 이유가 뭐예요?', '한국 문화에 대해 어떻게 생각해요?'] },
];

export const MOCK_AUDIO_FILES: AudioFile[] = [
  { id: '1', name: 'coffee_menu_intro.mp3', duration: '00:48', date: '2026-06-18', icon: '🎵' },
  { id: '2', name: '한국어 인터뷰 - 마케팅 팀.mp4', duration: '03:22', date: '2026-06-17', icon: '🎬' },
  { id: '3', name: 'TOPIK 듣기 12회.mp3', duration: '02:15', date: '2026-06-15', icon: '🎵' },
];

export const MOCK_TRANSCRIPTS: Record<string, TranscriptItem[]> = {
  '1': [
    { time: '00:12', ko: '안녕하세요, 오늘은 새로운 coffee 메뉴를 소개해 드리겠습니다.', roma: 'annyeonghaseyo, oneureun saeroun coffee menyureul sogaehae deurigetseumnida.', zh: '大家好，今天我来介绍新的咖啡菜单。', active: false },
    { time: '00:18', ko: '이 메뉴는 정말 special 하고 맛있어요.', roma: 'i menyuneun jeongmal special hago masisseoyo.', zh: '这个菜单真的很特别而且好吃。', active: false },
    { time: '00:24', ko: '먼저, 아이스 아메리카노는 기본이죠.', roma: 'meonjeo, aiseu amerikano-neun gibonijyo.', zh: '首先，冰美式是基本的。', active: false },
    { time: '00:30', ko: '그리고 저희만의 signature 라떼도 준비되어 있습니다.', roma: 'geurigo jeohuiman-ui signature rattedo junbidoeeo itseumnida.', zh: '而且我们也准备了独家招牌拿铁。', active: false },
    { time: '00:37', ko: '가격은 매우 reasonable 하게 책정했어요.', roma: 'gagyeogeun maeu reasonable hage chaekjeonghaesseoyo.', zh: '价格定得非常合理。', active: false },
    { time: '00:42', ko: '많이 찾아주시고 즐거운 시간 보내세요!', roma: 'mani chajajusigo jeulgeoun sigan bonaeseyo!', zh: '请多多光临，祝大家度过愉快时光！', active: false },
  ],
  '2': [
    { time: '00:08', ko: '오늘 인터뷰에 응해 주셔서 감사합니다.', roma: 'oneul inteobyue eunghae jusyeoseo gamsahamnida.', zh: '感谢您今天接受采访。', active: false },
    { time: '00:15', ko: '저희 마케팅 팀은 creative 한 아이디어로 유명하죠.', roma: 'jeohui maketing timeun creative han aidieoro yumyeonghajyo.', zh: '我们营销团队以创意点子闻名。', active: false },
    { time: '00:24', ko: '이번 프로젝트의 key point 는 무엇인가요?', roma: 'ibeon peurojekteuui key point neun mueosingayo?', zh: '这次项目的关键点是什么？', active: false },
  ],
  '3': [
    { time: '00:05', ko: '다음 대화를 잘 듣고 질문에 답하세요.', roma: 'daeum daehwareul jal deutgo jilmun-e dapaseyo.', zh: '请仔细听以下对话并回答问题。', active: false },
    { time: '00:12', ko: '여행 계획에 대해 이야기하고 있습니다.', roma: 'yeohaeng gyehoek-e daehae iyagihago itseumnida.', zh: '正在讨论旅行计划。', active: false },
  ],
};

export const MOCK_WORDS: Word[] = [
  { id: '1', ko: '가다', base: '가다', roma: 'ga-da', pos: '동사 (动词)', meaning: '去，走', example: '학교에 가요.', source: 'AI 口语对话 · 日常生活', tags: ['常用'], mastered: false, isLoanword: false, section: 'speak', savedAt: Date.now() },
  { id: '2', ko: '커피', base: '커피', roma: 'keo-pi', pos: '명사 (名词)', meaning: '咖啡', example: '커피 한 잔 주세요.', source: '音视频精听 · coffee_menu', tags: ['外来词'], mastered: false, isLoanword: true, section: 'listen', savedAt: Date.now() },
  { id: '3', ko: '맛있다', base: '맛있다', roma: 'ma-sit-da', pos: '형용사 (形容词)', meaning: '好吃，美味', example: '이 김치 정말 맛있어요!', source: 'AI 口语对话 · 日常生活', tags: ['常用'], mastered: false, isLoanword: false, section: 'speak', savedAt: Date.now() },
  { id: '4', ko: '공부하다', base: '공부하다', roma: 'gong-bu-ha-da', pos: '동사 (动词)', meaning: '学习', example: '매일 한국어를 공부해요.', source: 'AI 口语对话 · TOPIK', tags: ['常用'], mastered: true, isLoanword: false, section: 'speak', savedAt: Date.now() },
  { id: '5', ko: 'special', base: 'special', roma: 'seu-pe-syeol', pos: '외래어 (外来词)', meaning: '特别的', example: '이건 정말 special 해요.', source: '音视频精听 · coffee_menu', tags: ['外来词'], mastered: false, isLoanword: true, section: 'listen', savedAt: Date.now() },
];

export const MOCK_SENTENCES: SavedSentence[] = [
  { id: '1', ko: '오늘은 새로운 coffee 메뉴를 소개해 드리겠습니다.', zh: '今天我来介绍新的咖啡菜单。', source: '音视频精听 · coffee_menu', section: 'listen', savedAt: Date.now() },
  { id: '2', ko: '내일 친구랑 카페에 가고 싶으신 거예요?', zh: '您明天想和朋友去咖啡厅吗？', source: 'AI 口语对话 · 日常生活', section: 'speak', savedAt: Date.now() },
  { id: '3', ko: '한국어를 공부하는 이유가 뭐예요?', zh: '您学习韩语的原因是什么？', source: 'AI 口语对话 · TOPIK', section: 'speak', savedAt: Date.now() },
];

// Fallback replies when DeepSeek API is unavailable
export const AI_FALLBACK_REPLIES = [
  '네, 알겠습니다. 계속 이야기해 주세요.',
  '아, 그렇군요. 더 자세히 들려주세요.',
  '재미있네요! 다른 이야기도 해 주세요.',
  '그렇군요. 저도 그렇게 생각해요.',
  '한국어 정말 잘하시네요!',
  '음, 그런 경험이 있으셨군요.',
  '좋은 질문이에요. 한번 생각해 볼게요.',
  '맞아요, 그 점이 중요하죠.',
  '더 이야기해 주실래요?',
  '아하, 이해했어요.',
];
