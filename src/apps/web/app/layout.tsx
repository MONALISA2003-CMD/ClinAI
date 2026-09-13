import type { ReactNode } from 'react';
import './globals.css';

export const viewport={width:'device-width',initialScale:1};

export const metadata={
  title:'ClinAI | Better care, connected',
  description:'ClinAI helps care teams keep patient care clear, connected and organized.',
  icons:{icon:[{url:'/favicon.ico'},{url:'/clinai-icon.png',type:'image/png'}],apple:'/clinai-icon-192.png'},
  manifest:'/manifest.json',
};

export default function RootLayout({children}:{children:ReactNode}){return <html lang="en"><body>{children}</body></html>}
