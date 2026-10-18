export function Icon({ name, size = 22 }: { name: 'send' | 'more' | 'check' | 'bowl' | 'close' | 'spark' | 'chevron' | 'mic' | 'attach' | 'stop'; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === 'send' && <><path d="m21 3-7.5 18-3.6-7.9L2 9.5 21 3Z" /><path d="m10 13 5-5" /></>}
      {name === 'more' && <><circle cx="12" cy="5" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="19" r="1" fill="currentColor" /></>}
      {name === 'check' && <path d="m2 12 4 4 8-8m-4 6 2 2 8-8" />}
      {name === 'bowl' && <><path d="M3 12h18a9 9 0 0 1-18 0Zm3 9h12M8 8c-3-3 3-3 0-6m8 6c-3-3 3-3 0-6" /></>}
      {name === 'close' && <path d="m6 6 12 12M6 18 18 6" />}
      {name === 'spark' && <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /></>}
      {name === 'chevron' && <path d="m8 10 4 4 4-4" />}
      {name === 'mic' && <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" /></>}
      {name === 'attach' && <path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9m-5 13 7-7" />}
      {name === 'stop' && <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />}
    </svg>
  );
}
