import { useState } from 'react';

type PhotoProps = {
  src: string;
  tint: string;
  alt?: string;
};

export function Photo({ src, tint, alt = '' }: PhotoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  if (failed) {
    return <div className="photo-fallback" style={{ background: tint }} />;
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
