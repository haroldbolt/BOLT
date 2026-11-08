import React, {useState} from 'react';
import {ImageOff} from 'lucide-react';
import {usableProductImage} from '../../lib/productImages';

type Props = React.ImgHTMLAttributes<HTMLImageElement>;
export function ProductImage({src, alt = '', className = '', onError, ...props}: Props) {
  const [failedSource,setFailedSource] = useState<string>();
  if (!usableProductImage(src) || failedSource === src) return (
    <span role="img" aria-label={`Imagen por confirmar${alt ? `: ${alt}` : ''}`}
      className={`${className.replace(/object-cover/g,'object-contain')} bg-slate-50 text-slate-500 flex flex-col items-center justify-center gap-1 p-2 text-center overflow-hidden`}>
      <ImageOff className="w-5 h-5 shrink-0" aria-hidden="true" />
      <span className="text-[10px] leading-tight">Imagen por confirmar</span>
    </span>
  );
  return <img {...props} src={src} alt={alt} className={className.replace(/object-cover/g,'object-contain')}
    onError={event => {setFailedSource(src);onError?.(event);}} />;
}
