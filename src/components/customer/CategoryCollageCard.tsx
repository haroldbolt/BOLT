import React, {useState} from 'react';
import { ChevronRight, Package } from 'lucide-react';
import { MainCategory, Product } from '../../types';
import {categoryImageCandidates} from '../../lib/productImages';
import {matchesCatalogCategory} from '../../lib/catalogCategories';

interface CategoryCollageCardProps {
  title: string;
  category: MainCategory;
  count: number;
  products: Product[];
  onSelectCategory: (cat: MainCategory) => void;
  isSpecial?: boolean;
}

export const CategoryCollageCard: React.FC<CategoryCollageCardProps> = ({
  title,
  category,
  count,
  products,
  onSelectCategory,
  isSpecial = false,
}) => {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const collageImages = categoryImageCandidates(products, category).filter(img => !failed.has(img.src)).slice(0, 4);
  const activeCount = products.filter(p => (!p.status || p.status === 'ACTIVE') && matchesCatalogCategory(p, category)).length;

  return (
    <button
      type="button"
      aria-label={`${title}, ${activeCount} productos`}
      onClick={() => onSelectCategory(category)}
      className={`text-left rounded-3xl p-3.5 border transition cursor-pointer flex flex-col justify-between group hover:shadow-md ${
        isSpecial
          ? 'bg-red-50/50 border-red-200 hover:border-red-400'
          : 'bg-white border-slate-200/80 hover:border-slate-300'
      }`}
    >
      {/* Title & Count Header */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <h4 className="font-extrabold text-sm text-slate-900 group-hover:text-red-600 transition flex items-center gap-1.5">
            {isSpecial && <span className="text-red-600">💊</span>}
            {title}
          </h4>
          <p className="text-[11px] text-slate-500 font-medium">
            {activeCount} {activeCount === 1 ? 'producto' : 'productos'}
          </p>
        </div>
        <div className="w-6 h-6 rounded-full bg-slate-100 group-hover:bg-red-600 group-hover:text-white flex items-center justify-center text-slate-400 transition">
          <ChevronRight className="w-3.5 h-3.5" />
        </div>
      </div>

      <div className={`grid ${collageImages.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-1.5 aspect-square rounded-2xl overflow-hidden bg-slate-50 p-1`}>
        {collageImages.length ? collageImages.map((img, idx) => (
          <div key={img.src} className={`min-h-0 min-w-0 rounded-xl overflow-hidden bg-white ${collageImages.length === 3 && idx === 0 ? 'row-span-2' : ''}`}>
            <img src={img.src} alt={img.alt}
              className="w-full h-full object-contain p-1 group-hover:scale-105 transition duration-300" loading="lazy"
              onError={() => setFailed(previous => new Set([...previous, img.src]))} />
          </div>
        )) : <div className="flex flex-col items-center justify-center text-slate-400 gap-2" aria-label="Imágenes de categoría por confirmar">
          <Package className="w-10 h-10" aria-hidden="true"/><span className="text-[11px]">Explorar productos</span>
        </div>}
      </div>
    </button>
  );
};
