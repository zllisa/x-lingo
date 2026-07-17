import { useWindowDimensions } from 'react-native';

export const TABLET_BREAKPOINT = 700;
export const TABLET_CONTENT_MAX = 900;
export const TABLET_READING_MAX = 820;
export const TABLET_FORM_MAX = 560;

/** Width-based responsive values also work in iPad Split View and after rotation. */
export function useResponsiveLayout() {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= TABLET_BREAKPOINT;

  return {
    width,
    height,
    isTablet,
    pagePadding: isTablet ? 24 : 16,
    contentMaxWidth: TABLET_CONTENT_MAX,
    readingMaxWidth: TABLET_READING_MAX,
    formMaxWidth: TABLET_FORM_MAX,
    sheetWidth: Math.min(width - (isTablet ? 48 : 0), 720),
  };
}

export function centeredContent(maxWidth = TABLET_CONTENT_MAX) {
  return {
    width: '100%' as const,
    maxWidth,
    alignSelf: 'center' as const,
  };
}
