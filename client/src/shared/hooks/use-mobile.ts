import { useMediaQuery } from './useMediaQuery';

export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)');
}
