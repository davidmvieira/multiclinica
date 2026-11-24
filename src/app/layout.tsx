import type { Metadata } from 'next';
import { JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Iatris — Gestão clínica para profissionais',
  description:
    'Prontuário, agenda, avaliações e financeiro para profissionais de saúde.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${plusJakartaSans.variable} ${jetbrainsMono.variable}`}
    >
      <body
        className={`${plusJakartaSans.className} min-h-screen bg-white text-slate-900 antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
