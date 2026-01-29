import { useEffect } from 'react';
import { useDispatch } from './useAppStore';

export function useWindowResize() {
  const dispatch = useDispatch();

  useEffect(() => {
    const handleResize = () => {
      dispatch({
        type: 'WINDOW_SIZE_SET',
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [dispatch]);
}
