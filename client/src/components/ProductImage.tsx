import { useCallback, useEffect, useState } from 'react';
import { categoryTint, initials } from '../utils/format';

interface Props {
  src: string | null | undefined;
  name: string;
  categoryName?: string | null | undefined;
  className?: string;
  /** Load immediately (POS grid) instead of lazily (long lists). */
  eager?: boolean;
}

/**
 * Product photo with a graceful fallback. The category-tinted initials tile is
 * always rendered underneath; the photo fades in over it once loaded and is
 * dropped if it fails, so a tile is never blank.
 */
export function ProductImage({ src, name, categoryName, className = '', eager = false }: Props) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => setState('loading'), [src]);
  // Cached images can be complete before React attaches onLoad, so check on mount.
  const imgRef = useCallback((el: HTMLImageElement | null) => {
    if (el && el.complete && el.naturalWidth > 0) setState('ready');
  }, []);
  const showImage = Boolean(src) && state !== 'failed';
  return (
    <div
      className={`product-image ${className}`.trim()}
      style={{ background: categoryTint(categoryName) }}
      aria-hidden="true"
    >
      <span className="fallback">{initials(name)}</span>
      {showImage && (
        <img
          ref={imgRef}
          src={src ?? undefined}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className={state === 'ready' ? 'ready' : ''}
          onLoad={() => setState('ready')}
          onError={() => setState('failed')}
        />
      )}
    </div>
  );
}
