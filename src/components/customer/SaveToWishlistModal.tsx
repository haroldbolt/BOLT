import React, { useState } from 'react';
import { Bookmark, X, Plus, Check, FolderPlus, Sparkles } from 'lucide-react';
import { Product, WishlistCollection } from '../../types';
import { formatCOP } from '../../lib/formatters';

interface SaveToWishlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  collections: WishlistCollection[];
  onToggleProductInCollection: (collectionId: string, productId: string) => void;
  onCreateCollection: (name: string, icon?: string, initialProductId?: string) => void;
}

const DEFAULT_EMOJIS = ['🐶', '🐱', '🍖', '💊', '🎾', '📦', '⭐', '❤️'];

export const SaveToWishlistModal: React.FC<SaveToWishlistModalProps> = ({
  isOpen,
  onClose,
  product,
  collections,
  onToggleProductInCollection,
  onCreateCollection,
}) => {
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState('🐶');

  if (!isOpen || !product) return null;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newCollectionName.trim();
    if (!cleanName) return;

    onCreateCollection(cleanName, selectedEmoji, product.id);
    setNewCollectionName('');
    setIsCreatingNew(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden border border-slate-100 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/90">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-md">
              <Bookmark className="w-5 h-5 fill-white" />
            </div>
            <div>
              <h3 className="font-black text-slate-900 text-sm sm:text-base leading-tight">
                Guardar en Lista de Deseos
              </h3>
              <p className="text-[11px] text-slate-500 font-medium">
                Organiza tus compras programadas en colecciones
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Product Preview Card */}
        <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center gap-3">
          <img
            src={product.image}
            alt={product.name}
            className="w-14 h-14 object-cover rounded-2xl border border-slate-200 bg-white p-1 shrink-0"
          />
          <div className="flex-1 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 block truncate">
              {product.brand}
            </span>
            <h4 className="font-bold text-xs sm:text-sm text-slate-900 truncate">
              {product.name}
            </h4>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-extrabold text-xs text-slate-900">
                {formatCOP(product.price)}
              </span>
              {product.presentation && (
                <span className="text-[10px] text-slate-500 font-medium">
                  • {product.presentation}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Collections List */}
        <div className="p-4 flex-1 overflow-y-auto space-y-2.5">
          <label className="text-xs font-bold text-slate-700 block">
            Selecciona las colecciones donde deseas guardarlo:
          </label>

          {collections.length === 0 ? (
            <div className="p-4 text-center rounded-2xl border border-dashed border-slate-200 text-slate-500 text-xs">
              Aún no tienes colecciones creadas. ¡Crea tu primera lista abajo!
            </div>
          ) : (
            <div className="space-y-1.5">
              {collections.map((col) => {
                const isSelected = col.items.some((i) => i.productId === product.id);
                return (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => onToggleProductInCollection(col.id, product.id)}
                    className={`w-full p-3 rounded-2xl border text-left flex items-center justify-between transition ${
                      isSelected
                        ? 'bg-amber-50/80 border-amber-300 shadow-2xs'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-lg">{col.icon || '📦'}</span>
                      <div>
                        <p className="text-xs font-bold text-slate-900">{col.name}</p>
                        <p className="text-[10px] text-slate-500 font-medium">
                          {col.items.length} {col.items.length === 1 ? 'producto' : 'productos'}
                        </p>
                      </div>
                    </div>

                    <div
                      className={`w-6 h-6 rounded-xl flex items-center justify-center transition ${
                        isSelected
                          ? 'bg-amber-500 text-white shadow-xs'
                          : 'border-2 border-slate-300'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Create New Collection Form / Button */}
          {!isCreatingNew ? (
            <button
              type="button"
              onClick={() => setIsCreatingNew(true)}
              className="w-full mt-2 py-2.5 px-3 rounded-2xl border border-dashed border-red-300 bg-red-50/60 hover:bg-red-50 text-red-700 font-bold text-xs flex items-center justify-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Crear nueva colección</span>
            </button>
          ) : (
            <form onSubmit={handleCreate} className="mt-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <FolderPlus className="w-4 h-4 text-red-600" />
                  Nueva colección personalizada
                </span>
                <button
                  type="button"
                  onClick={() => setIsCreatingNew(false)}
                  className="text-[11px] text-slate-400 hover:text-slate-600 font-bold"
                >
                  Cancelar
                </button>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                  Nombre de la lista
                </label>
                <input
                  type="text"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="Ej: Comida mensual Max, Botiquín..."
                  autoFocus
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:border-red-500 font-medium"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                  Icono identificador
                </label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {DEFAULT_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setSelectedEmoji(emoji)}
                      className={`w-7 h-7 rounded-lg text-sm flex items-center justify-center transition ${
                        selectedEmoji === emoji
                          ? 'bg-red-600 text-white scale-110 shadow-xs'
                          : 'bg-white border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={!newCollectionName.trim()}
                className="w-full py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-300 text-white font-bold text-xs rounded-xl shadow-xs transition"
              >
                Crear y guardar producto
              </button>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 text-xs font-black bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-sm transition"
          >
            Listo
          </button>
        </div>
      </div>
    </div>
  );
};
