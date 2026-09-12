import type { ReactNode } from 'react';
import './globals.css';

export const metadata={
  title:'ClinAI | Connected Healthcare OS',
  description:'ClinAI clinical operations, connected care and healthcare intelligence workspace.',
  icons:{icon:[{url:'/favicon.ico'},{url:'/clinai-icon.png',type:'image/png'}],apple:'/clinai-icon-192.png'},
  manifest:'/manifest.json',
};

export default function RootLayout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>}
