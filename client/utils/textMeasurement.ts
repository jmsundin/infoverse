/**
 * Utility for measuring text width using Canvas 2D API
 */

// Cache the canvas context for performance
let measureContext: CanvasRenderingContext2D | null = null;

/**
 * Get or create a cached canvas context for text measurement
 */
const getMeasureContext = (): CanvasRenderingContext2D | null => {
  if (typeof window === 'undefined') return null;

  if (!measureContext) {
    const canvas = document.createElement('canvas');
    measureContext = canvas.getContext('2d');
  }
  return measureContext;
};

/**
 * Measure the pixel width of text with specified font properties.
 *
 * @param text - The text to measure
 * @param fontWeight - CSS font weight (e.g., 'bold', '700')
 * @param fontSize - CSS font size (e.g., '1.5rem', '24px')
 * @param fontFamily - CSS font family (defaults to system font stack)
 * @returns The width in pixels, or 0 if measurement fails
 */
export const measureTextWidth = (
  text: string,
  fontWeight: string = 'bold',
  fontSize: string = '1.5rem', // text-2xl equivalent
  fontFamily: string = 'ui-sans-serif, system-ui, sans-serif'
): number => {
  const ctx = getMeasureContext();
  if (!ctx) return 0;

  // Set font to match the title style
  ctx.font = `${fontWeight} ${fontSize} ${fontFamily}`;

  const metrics = ctx.measureText(text);
  return metrics.width;
};

/**
 * Calculate dynamic node width based on title text length.
 * Only applies to mobile - returns null for desktop to use default behavior.
 *
 * @param titleText - The title text to measure
 * @param isMobile - Whether the device is mobile
 * @param minWidth - Minimum node width
 * @param maxWidth - Maximum node width for mobile
 * @param horizontalPadding - Total horizontal padding/chrome
 * @returns The calculated width, or null if default should be used
 */
export const calculateMobileNodeWidth = (
  titleText: string,
  isMobile: boolean,
  minWidth: number = 250,
  maxWidth: number = 350,
  horizontalPadding: number = 48
): number | null => {
  // Only apply dynamic sizing on mobile
  if (!isMobile) return null;

  // Measure the title text width
  const textWidth = measureTextWidth(titleText);

  // Add padding for node chrome (borders, padding, etc.)
  const totalWidth = textWidth + horizontalPadding;

  // Clamp to min/max constraints
  return Math.max(minWidth, Math.min(maxWidth, Math.ceil(totalWidth)));
};
