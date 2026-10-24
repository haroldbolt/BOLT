import React from 'react';
import { ChevronRight } from 'lucide-react';
import { MainCategory, Product } from '../../types';

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
  // Take up to 4 images for the collage
  const collageImages = products.slice(0, 4).map(p => p.image);
  while (collageImages.length < 4 && products.length > 0) {
    collageImages.push(products[0].image);
  }

  return (
    <div
      onClick={() => onSelectCategory(category)}
      className={`rounded-3xl p-3.5 border transition cursor-pointer flex flex-col justify-between group hover:shadow-md ${
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
            {count} {count === 1 ? 'producto' : 'productos'}
          </p>
        </div>
        <div className="w-6 h-6 rounded-full bg-slate-100 group-hover:bg-red-600 group-hover:text-white flex items-center justify-center text-slate-400 transition">
          <ChevronRight className="w-3.5 h-3.5" />
        </div>
      </div>

      {/* 4-Image Grid Collage */}
      <div className="grid grid-cols-2 gap-1.5 aspect-square rounded-2xl overflow-hidden bg-slate-50 p-1">
        {collageImages.map((img, idx) => (
          <div key={idx} className="w-full h-full rounded-xl overflow-hidden bg-white">
            <img
              src={img}
              alt=""
              className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
              loading="lazy"
            />
          </div>
        ))}
      </div>
    </div>
  );
};
