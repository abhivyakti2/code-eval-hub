// fonts used in the application
import { Playfair_Display, Plus_Jakarta_Sans } from 'next/font/google';

export const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-plus-jakarta-sans',
});

export const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: ["600"],
  style: ["italic"],
  variable: "--font-playfair-display",
});