export const PROVIDERS = ['naver', 'kakao', 'google'];
export const LABELS = { naver: '네이버지도', kakao: '카카오맵', google: 'Google 지도' };
export const CATEGORIES = ['landmark', 'cuisine', 'cafeteria', 'bar'];
export const LIST_NAMES = {
  naver: { landmark: '내 장소', cuisine: 'cuisine', cafeteria: 'cafeteria', bar: 'bar' },
  kakao: { landmark: '기본 그룹', cuisine: 'cuisine', cafeteria: 'cafeteria', bar: 'bar' },
  google: { landmark: 'landmark', cuisine: 'cuisine', cafeteria: 'cafeteria', bar: 'bar' },
};
// User-provided screenshots: reference counts, never completeness evidence.
export const REFERENCE_COUNTS = {
  naver: { landmark: 115, cuisine: 722, cafeteria: 101, bar: 63 },
  kakao: { landmark: 103, cuisine: 124, cafeteria: 101, bar: 60 },
  google: { landmark: 79, cuisine: 158, cafeteria: 74, bar: 11 },
};
export const POLICY = Object.freeze({ country: 'KR', copyNotes: false, sharedListsAllowed: true,
  ignoredGoogleLists: ['Saved places', '여행 계획'], noteCleanup: 'report-first' });
