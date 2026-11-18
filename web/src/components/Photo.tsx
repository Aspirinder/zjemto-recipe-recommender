import { useState } from 'react';

type PhotoProps = {
  src: string;
  tint: string;
  alt?: string;
};

export function Photo({ src, tint, alt = '' }: PhotoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  if (failed || !src) {
    return (
      <div className="photo-fallback" style={{ background: tint }}>
        {/* Many Food.com recipes have no photo — a plate keeps the card from looking broken. */}
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="34" r="20" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <circle cx="32" cy="34" r="12" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
          <path d="M8 14v12a4 4 0 0 0 4 4v20M12 14v10M16 14v12a4 4 0 0 1-4 4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M54 14c-4 2-5 8-5 14h5v22" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      onError={() => setFailedSrc(src)}
    />
  );
}
