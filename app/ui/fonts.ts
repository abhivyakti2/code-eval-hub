// fonts used in the application
import { Instrument_Serif, Plus_Jakarta_Sans } from 'next/font/google';

export const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-plus-jakarta-sans',
});

export const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-instrument-serif',
});
